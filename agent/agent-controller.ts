#!/usr/bin/env bun
// Agent Controller Service - Manages rsbot-agent process and provides WebSocket API
// Allows UI to start/stop agent, send messages, and view action logs

import { spawn, type Subprocess } from 'bun';
import { join } from 'path';

// Prevent unhandled AbortError from crashing the process when child process streams close
process.on('unhandledRejection', (reason: any) => {
    if (reason?.name === 'AbortError') {
        // Expected when child process exits while we're reading its streams
        return;
    }
    console.error('[Controller] Unhandled rejection:', reason);
});

const CONTROLLER_PORT = parseInt(process.env.CONTROLLER_PORT || '7781');
const AGENT_DIR = import.meta.dir;

interface ActionLogEntry {
    timestamp: number;
    type: 'thinking' | 'action' | 'result' | 'error' | 'system' | 'user_message' | 'todo';
    content: string;
}

interface AgentState {
    running: boolean;
    sessionId: string | null;
    goal: string | null;
    startedAt: number | null;
    actionLog: ActionLogEntry[];
}

// Per-bot agent tracking
interface BotAgentSession {
    state: AgentState;
    process: Subprocess | null;
    outputBuffer: string;
    uiClients: Set<any>;
}

// Map of username -> bot session
const botSessions = new Map<string, BotAgentSession>();

// Map WebSocket -> username for routing
const wsToUsername = new Map<any, string>();

// Get or create session for a bot username
function getOrCreateSession(username: string): BotAgentSession {
    let session = botSessions.get(username);
    if (!session) {
        session = {
            state: {
                running: false,
                sessionId: null,
                goal: null,
                startedAt: null,
                actionLog: []
            },
            process: null,
            outputBuffer: '',
            uiClients: new Set()
        };
        botSessions.set(username, session);
    }
    return session;
}

// Broadcast to all UI clients for a specific bot
function broadcastToBot(username: string, message: any) {
    const session = botSessions.get(username);
    if (!session) return;

    const data = JSON.stringify(message);
    for (const client of session.uiClients) {
        try {
            client.send(data);
        } catch (e) {
            // Client disconnected
        }
    }
}

// Add to action log and broadcast for a specific bot
function addLogEntryForBot(username: string, type: ActionLogEntry['type'], content: string) {
    const session = getOrCreateSession(username);
    const entry: ActionLogEntry = {
        timestamp: Date.now(),
        type,
        content
    };
    session.state.actionLog.push(entry);

    // Keep last 200 entries
    if (session.state.actionLog.length > 200) {
        session.state.actionLog = session.state.actionLog.slice(-200);
    }

    broadcastToBot(username, { type: 'log', entry });
}

// Parse agent output and extract meaningful parts for a specific bot
function parseAgentOutputForBot(username: string, chunk: string) {
    const session = getOrCreateSession(username);
    session.outputBuffer += chunk;
    const lines = session.outputBuffer.split('\n');
    session.outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
        if (!line.trim()) continue;

        // Parse different output types
        if (line.startsWith('[Agent] Session started:')) {
            const sessionId = line.split(': ')[1]?.trim();
            session.state.sessionId = sessionId || null;
            addLogEntryForBot(username, 'system', `Session started: ${sessionId}`);
        } else if (line.startsWith('[Claude]:')) {
            const content = line.replace('[Claude]:', '').trim();
            addLogEntryForBot(username, 'thinking', content);
        } else if (line.startsWith('[Tool]:')) {
            const content = line.replace('[Tool]:', '').trim();
            // Use 'todo' type for TodoWrite/TodoRead to highlight in UI
            if (content === 'TodoWrite' || content === 'TodoRead') {
                addLogEntryForBot(username, 'todo', content);
            } else {
                addLogEntryForBot(username, 'action', content);
            }
        } else if (line.startsWith('  >')) {
            // Command being executed
            addLogEntryForBot(username, 'action', `$ ${line.replace('  >', '').trim()}`);
        } else if (line.match(/^\s+\[(x|~| )\]/)) {
            // Todo item line (e.g., "  [ ] Task name" or "  [x] Done task")
            addLogEntryForBot(username, 'todo', line.trim());
        } else if (line.startsWith('[Result]:')) {
            // Skip the [Result]: prefix, content follows
        } else if (line.startsWith('[Agent] Task completed')) {
            addLogEntryForBot(username, 'system', 'Task completed');
        } else if (line.startsWith('[Final Result]:')) {
            const content = line.replace('[Final Result]:', '').trim();
            addLogEntryForBot(username, 'result', content);
        } else if (line.startsWith('Queued:')) {
            addLogEntryForBot(username, 'action', line);
        } else if (line.includes('Success:') || line.includes('Failed:')) {
            addLogEntryForBot(username, 'result', line.trim());
        } else if (line.startsWith('Error') || line.startsWith('[Agent] Error')) {
            addLogEntryForBot(username, 'error', line);
        } else if (!line.startsWith('===') && !line.startsWith('Goal:') && !line.startsWith('Checking')) {
            // Other output (probably command results)
            if (line.trim().length > 0 && line.trim().length < 200) {
                // Short lines might be status updates
            }
        }
    }
}

// Start the agent with a goal for a specific bot
async function startAgentForBot(username: string, goal: string) {
    console.log(`[Controller] [${username}] startAgent called with goal: ${goal}`);

    const session = getOrCreateSession(username);

    if (session.process) {
        await stopAgentForBot(username);
    }

    session.state.running = true;
    session.state.goal = goal;
    session.state.startedAt = Date.now();
    session.state.actionLog = [];
    session.outputBuffer = '';

    addLogEntryForBot(username, 'system', `Starting agent with goal: ${goal}`);

    broadcastToBot(username, {
        type: 'status',
        status: 'starting',
        goal
    });

    // State directory for this bot - agent will run from here
    const botStateDir = join(AGENT_DIR, 'agent-state', username);

    // Ensure state directory exists and has rsbot symlink
    const { mkdirSync, existsSync, symlinkSync, unlinkSync } = await import('fs');
    if (!existsSync(botStateDir)) {
        mkdirSync(botStateDir, { recursive: true });
    }

    // Create/update symlink to rsbot in state directory so ./rsbot works
    const rsbotLink = join(botStateDir, 'rsbot');
    const rsbotTarget = join(AGENT_DIR, 'rsbot');
    try {
        if (existsSync(rsbotLink)) unlinkSync(rsbotLink);
        symlinkSync(rsbotTarget, rsbotLink);
    } catch (e) {
        console.error(`[Controller] [${username}] Failed to create rsbot symlink:`, e);
    }

    session.process = spawn({
        cmd: ['bun', 'run', join(AGENT_DIR, 'rsbot-agent.ts'), goal],
        cwd: botStateDir,  // Run from bot's state directory so rsbot uses correct state
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...process.env,
            FORCE_COLOR: '0', // Disable colors for easier parsing
            PATH: `${AGENT_DIR}:${process.env.PATH}` // Add agent dir to PATH so 'rsbot' command works
        }
    });

    const agentProcess = session.process;

    // Read stdout
    (async () => {
        const reader = agentProcess!.stdout.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                parseAgentOutputForBot(username, text);
            }
        } catch (e: any) {
            // Process ended or stream closed - this is expected
            if (e?.name !== 'AbortError') {
                console.error(`[Controller] [${username}] stdout reader error:`, e?.message || e);
            }
        }
    })().catch(() => {}); // Ensure unhandled rejections don't crash

    // Read stderr
    (async () => {
        const reader = agentProcess!.stderr.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                if (text.trim()) {
                    addLogEntryForBot(username, 'error', text.trim());
                }
            }
        } catch (e: any) {
            // Process ended or stream closed - this is expected
            if (e?.name !== 'AbortError') {
                console.error(`[Controller] [${username}] stderr reader error:`, e?.message || e);
            }
        }
    })().catch(() => {}); // Ensure unhandled rejections don't crash

    console.log(`[Controller] [${username}] Spawned agent process in ${botStateDir}, pid: ${agentProcess.pid}`);

    // Wait for process to complete
    agentProcess.exited.then((code) => {
        console.log(`[Controller] [${username}] Agent process exited with code: ${code}`);
        session.state.running = false;
        session.process = null;

        if (code === 0) {
            addLogEntryForBot(username, 'system', 'Agent completed successfully');
        } else {
            addLogEntryForBot(username, 'error', `Agent exited with code ${code}`);
        }

        broadcastToBot(username, {
            type: 'status',
            status: 'stopped',
            exitCode: code
        });
    });

    broadcastToBot(username, {
        type: 'status',
        status: 'running',
        goal,
        sessionId: session.state.sessionId
    });
}

// Stop the agent for a specific bot
async function stopAgentForBot(username: string) {
    const session = botSessions.get(username);
    if (!session) return;

    if (session.process) {
        addLogEntryForBot(username, 'system', 'Stopping agent...');
        session.process.kill();
        session.process = null;
    }

    session.state.running = false;

    broadcastToBot(username, {
        type: 'status',
        status: 'stopped'
    });
}

// Send a message to the agent - queued for next iteration if running
async function sendMessageForBot(username: string, message: string) {
    const session = getOrCreateSession(username);
    console.log(`[Controller] [${username}] sendMessageForBot called, running=${session.state.running}, process=${session.process ? 'exists' : 'null'}`);

    // Log the user message first
    addLogEntryForBot(username, 'user_message', message);

    if (session.state.running) {
        // Agent is running - write message to file for next iteration
        const messageFile = join(AGENT_DIR, 'agent-state', username, 'user-message.json');
        const { writeFileSync, existsSync } = await import('fs');
        console.log(`[Controller] [${username}] Writing user message to: ${messageFile}`);
        try {
            const userMessage = {
                message,
                timestamp: Date.now()
            };
            writeFileSync(messageFile, JSON.stringify(userMessage, null, 2));
            console.log(`[Controller] [${username}] Message file written, exists: ${existsSync(messageFile)}`);
            addLogEntryForBot(username, 'system', `Message queued for agent (file: ${messageFile})`);
            broadcastToBot(username, {
                type: 'message_queued',
                message
            });
        } catch (e) {
            console.error(`[Controller] [${username}] Failed to write message file:`, e);
            addLogEntryForBot(username, 'error', `Failed to queue message: ${e}`);
        }
        return;
    }

    // Agent not running - inform user and start agent with the message
    addLogEntryForBot(username, 'system', 'Agent not running. Starting agent with your message as the goal...');
    await startAgentForBot(username, message);
}

// Handle WebSocket messages from UI
function handleUIMessage(ws: any, data: string) {
    let message;
    try {
        message = JSON.parse(data);
    } catch {
        return;
    }

    // Get username from WS mapping (set on open based on query param)
    const username = wsToUsername.get(ws) || 'default';
    const session = getOrCreateSession(username);

    switch (message.type) {
        case 'start':
            if (message.goal) {
                startAgentForBot(username, message.goal);
            }
            break;

        case 'stop':
            stopAgentForBot(username);
            break;

        case 'restart':
            if (session.state.goal) {
                startAgentForBot(username, session.state.goal);
            }
            break;

        case 'send':
            if (message.message) {
                sendMessageForBot(username, message.message);
            }
            break;

        case 'getState':
            ws.send(JSON.stringify({
                type: 'state',
                ...session.state
            }));
            break;

        case 'clearLog':
            session.state.actionLog = [];
            broadcastToBot(username, { type: 'logCleared' });
            break;
    }
}

// Start WebSocket server
console.log(`[Controller] Starting Agent Controller on port ${CONTROLLER_PORT}...`);

// Store bot username extracted during upgrade for use in open handler
const pendingUsernames = new Map<Request, string>();

const server = Bun.serve({
    port: CONTROLLER_PORT,
    async fetch(req, server) {
        const url = new URL(req.url);

        // Upgrade WebSocket connections
        if (req.headers.get('upgrade') === 'websocket') {
            // Extract bot username from query param
            const botUsername = url.searchParams.get('bot') || 'default';
            pendingUsernames.set(req, botUsername);
            const upgraded = server.upgrade(req, { data: { botUsername } });
            if (upgraded) return undefined;
            pendingUsernames.delete(req);
            return new Response('WebSocket upgrade failed', { status: 400 });
        }

        // CORS headers for API
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // HTTP API endpoints - now support ?bot= query param
        const botUsername = url.searchParams.get('bot') || 'default';

        if (url.pathname === '/status') {
            // Show all bots or specific bot
            if (botUsername === 'all') {
                const allBots: Record<string, any> = {};
                for (const [name, session] of botSessions) {
                    allBots[name] = {
                        running: session.state.running,
                        sessionId: session.state.sessionId,
                        goal: session.state.goal,
                        startedAt: session.state.startedAt,
                        logCount: session.state.actionLog.length
                    };
                }
                return new Response(JSON.stringify({ bots: allBots, count: botSessions.size }), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
            const session = getOrCreateSession(botUsername);
            return new Response(JSON.stringify({
                bot: botUsername,
                running: session.state.running,
                sessionId: session.state.sessionId,
                goal: session.state.goal,
                startedAt: session.state.startedAt,
                logCount: session.state.actionLog.length
            }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        if (url.pathname === '/log') {
            const session = getOrCreateSession(botUsername);
            return new Response(JSON.stringify(session.state.actionLog), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        if (url.pathname === '/start' && req.method === 'POST') {
            try {
                const body = await req.json();
                console.log(`[Controller] [${botUsername}] POST /start received:`, body);
                if (body.goal) {
                    startAgentForBot(botUsername, body.goal);
                    return new Response(JSON.stringify({ ok: true, bot: botUsername }), {
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                } else {
                    return new Response(JSON.stringify({ ok: false, error: 'No goal provided' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
            } catch (err: any) {
                console.error(`[Controller] [${botUsername}] Error parsing /start request:`, err?.message || err);
                return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
        }

        if (url.pathname === '/stop' && req.method === 'POST') {
            stopAgentForBot(botUsername);
            return new Response(JSON.stringify({ ok: true, bot: botUsername }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        return new Response('Agent Controller API (Multi-Bot)\n\nEndpoints:\n- GET /status?bot=<name>  (or ?bot=all for all bots)\n- GET /log?bot=<name>\n- POST /start?bot=<name> {goal}\n- POST /stop?bot=<name>\n- WebSocket?bot=<name> for real-time updates', {
            headers: { 'Content-Type': 'text/plain', ...corsHeaders }
        });
    },
    websocket: {
        open(ws: any) {
            // Extract username from ws.data set during upgrade
            const botUsername = ws.data?.botUsername || 'default';
            const session = getOrCreateSession(botUsername);

            session.uiClients.add(ws);
            wsToUsername.set(ws, botUsername);

            console.log(`[Controller] [${botUsername}] UI client connected (${session.uiClients.size} for this bot)`);

            // Send current state for this bot
            ws.send(JSON.stringify({
                type: 'state',
                ...session.state
            }));
        },
        message(ws: any, message: any) {
            handleUIMessage(ws, message.toString());
        },
        close(ws: any) {
            const username = wsToUsername.get(ws);
            if (username) {
                const session = botSessions.get(username);
                if (session) {
                    session.uiClients.delete(ws);
                    console.log(`[Controller] [${username}] UI client disconnected (${session.uiClients.size} for this bot)`);

                    // Clean up when last client disconnects - stop agent and clear session
                    // This gives a fresh start on reconnect instead of replaying old logs
                    if (session.uiClients.size === 0) {
                        if (session.state.running) {
                            stopAgentForBot(username);
                            console.log(`[Controller] [${username}] Agent stopped (no clients remaining)`);
                        }
                        botSessions.delete(username);
                        console.log(`[Controller] [${username}] Session cleared (no clients remaining)`);
                    }
                }
                wsToUsername.delete(ws);
            }
        }
    }
});

console.log(`[Controller] Agent Controller running at http://localhost:${CONTROLLER_PORT}`);
console.log(`[Controller] WebSocket endpoint: ws://localhost:${CONTROLLER_PORT}?bot=<username>`);
console.log('[Controller] Supports multiple bots - each bot identified by ?bot= parameter');
