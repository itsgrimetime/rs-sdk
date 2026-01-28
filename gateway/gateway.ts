#!/usr/bin/env bun
// Gateway Service - WebSocket router for Bot ↔ SDK communication
// SyncModule: handles bot and sdk client routing

import type {
    BotWorldState,
    BotAction,
    ActionResult,
    BotClientMessage,
    SyncToBotMessage,
    SDKMessage,
    SyncToSDKMessage
} from './types';

const GATEWAY_PORT = parseInt(process.env.AGENT_PORT || '7780');

// ============ Types ============

interface BotSession {
    ws: any;
    clientId: string;
    username: string;
    lastState: BotWorldState | null;
    currentActionId: string | null;
    pendingScreenshotId: string | null;
}

interface SDKSession {
    ws: any;
    sdkClientId: string;
    targetUsername: string;
}

// ============ State ============

const botSessions = new Map<string, BotSession>();      // username -> BotSession
const sdkSessions = new Map<string, SDKSession>();      // sdkClientId -> SDKSession
const wsToType = new Map<any, { type: 'bot' | 'sdk'; id: string }>();

// ============ Sync Module ============

const SyncModule = {
    sendToBot(session: BotSession, message: SyncToBotMessage) {
        if (session.ws) {
            try {
                session.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`[Gateway] [${session.username}] Failed to send to bot:`, error);
            }
        }
    },

    sendToSDK(session: SDKSession, message: SyncToSDKMessage) {
        if (session.ws) {
            try {
                session.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`[Gateway] [${session.sdkClientId}] Failed to send to SDK:`, error);
            }
        }
    },

    getSDKSessionsForBot(username: string): SDKSession[] {
        const sessions: SDKSession[] = [];
        for (const session of sdkSessions.values()) {
            if (session.targetUsername === username) {
                sessions.push(session);
            }
        }
        return sessions;
    },

    extractUsernameFromClientId(clientId: string | undefined): string | null {
        if (!clientId) return null;
        if (clientId.startsWith('bot-')) return null;
        const parts = clientId.split('-');
        if (parts.length >= 1 && parts[0] && !parts[0].match(/^\d+$/)) {
            return parts[0];
        }
        return null;
    },

    handleBotMessage(ws: any, message: BotClientMessage) {
        if (message.type === 'connected') {
            const username = message.username || this.extractUsernameFromClientId(message.clientId) || 'default';
            const clientId = message.clientId || `bot-${Date.now()}`;

            const existingSession = botSessions.get(username);
            if (existingSession && existingSession.ws !== ws) {
                try { existingSession.ws?.close(); } catch {}
            }

            const session: BotSession = {
                ws,
                clientId,
                username,
                lastState: existingSession?.lastState || null,
                currentActionId: null,
                pendingScreenshotId: null
            };

            botSessions.set(username, session);
            wsToType.set(ws, { type: 'bot', id: username });

            console.log(`[Gateway] Bot connected: ${clientId} (${username})`);

            this.sendToBot(session, { type: 'status', status: 'Connected to gateway' });

            for (const sdkSession of this.getSDKSessionsForBot(username)) {
                this.sendToSDK(sdkSession, { type: 'sdk_connected', success: true });
            }
            return;
        }

        const wsInfo = wsToType.get(ws);
        if (!wsInfo || wsInfo.type !== 'bot') return;

        const session = botSessions.get(wsInfo.id);
        if (!session) return;

        if (message.type === 'actionResult' && message.result) {
            const actionId = message.actionId || session.currentActionId || undefined;
            console.log(`[Gateway] [${session.username}] Action result: ${message.result.success ? 'success' : 'failed'} - ${message.result.message}`);

            for (const sdkSession of this.getSDKSessionsForBot(session.username)) {
                this.sendToSDK(sdkSession, {
                    type: 'sdk_action_result',
                    actionId,
                    result: message.result
                });
            }
            session.currentActionId = null;
            return;
        }

        if (message.type === 'state' && message.state) {
            session.lastState = message.state;
            for (const sdkSession of this.getSDKSessionsForBot(session.username)) {
                this.sendToSDK(sdkSession, { type: 'sdk_state', state: message.state });
            }
        }

        if (message.type === 'screenshot_response' && message.dataUrl) {
            const screenshotId = message.screenshotId || session.pendingScreenshotId || undefined;
            console.log(`[Gateway] [${session.username}] Screenshot received (${(message.dataUrl.length / 1024).toFixed(1)}KB)`);

            for (const sdkSession of this.getSDKSessionsForBot(session.username)) {
                this.sendToSDK(sdkSession, {
                    type: 'sdk_screenshot_response',
                    screenshotId,
                    dataUrl: message.dataUrl
                });
            }
            session.pendingScreenshotId = null;
        }
    },

    handleSDKMessage(ws: any, message: SDKMessage) {
        if (message.type === 'sdk_connect') {
            const sdkClientId = message.clientId || `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const targetUsername = message.username;

            const session: SDKSession = { ws, sdkClientId, targetUsername };
            sdkSessions.set(sdkClientId, session);
            wsToType.set(ws, { type: 'sdk', id: sdkClientId });

            console.log(`[Gateway] SDK connected: ${sdkClientId} -> ${targetUsername}`);

            this.sendToSDK(session, { type: 'sdk_connected', success: true });

            const botSession = botSessions.get(targetUsername);
            if (botSession?.lastState) {
                this.sendToSDK(session, { type: 'sdk_state', state: botSession.lastState });
            }
            return;
        }

        if (message.type === 'sdk_action') {
            const wsInfo = wsToType.get(ws);
            if (!wsInfo || wsInfo.type !== 'sdk') return;

            const sdkSession = sdkSessions.get(wsInfo.id);
            if (!sdkSession) return;

            const botSession = botSessions.get(message.username || sdkSession.targetUsername);
            if (!botSession || !botSession.ws) {
                this.sendToSDK(sdkSession, {
                    type: 'sdk_error',
                    actionId: message.actionId,
                    error: 'Bot not connected'
                });
                return;
            }

            botSession.currentActionId = message.actionId || null;
            this.sendToBot(botSession, {
                type: 'action',
                action: message.action,
                actionId: message.actionId
            });

            console.log(`[Gateway] [${botSession.username}] SDK action: ${message.action?.type} (${message.actionId})`);
        }

        if (message.type === 'sdk_screenshot_request') {
            const wsInfo = wsToType.get(ws);
            if (!wsInfo || wsInfo.type !== 'sdk') return;

            const sdkSession = sdkSessions.get(wsInfo.id);
            if (!sdkSession) return;

            const botSession = botSessions.get(message.username || sdkSession.targetUsername);
            if (!botSession || !botSession.ws) {
                this.sendToSDK(sdkSession, {
                    type: 'sdk_error',
                    screenshotId: message.screenshotId,
                    error: 'Bot not connected'
                });
                return;
            }

            botSession.pendingScreenshotId = message.screenshotId || null;
            this.sendToBot(botSession, {
                type: 'screenshot_request',
                screenshotId: message.screenshotId
            });

            console.log(`[Gateway] [${botSession.username}] SDK screenshot request (${message.screenshotId})`);
        }
    },

    handleClose(ws: any) {
        const wsInfo = wsToType.get(ws);
        if (!wsInfo) return;

        if (wsInfo.type === 'bot') {
            const session = botSessions.get(wsInfo.id);
            if (session) {
                console.log(`[Gateway] Bot disconnected: ${session.clientId} (${session.username})`);
                session.ws = null;

                for (const sdkSession of this.getSDKSessionsForBot(session.username)) {
                    this.sendToSDK(sdkSession, { type: 'sdk_error', error: 'Bot disconnected' });
                }
            }
        } else if (wsInfo.type === 'sdk') {
            const session = sdkSessions.get(wsInfo.id);
            if (session) {
                console.log(`[Gateway] SDK disconnected: ${session.sdkClientId}`);
                sdkSessions.delete(wsInfo.id);
            }
        }

        wsToType.delete(ws);
    }
};

// ============ Message Router ============

function handleMessage(ws: any, data: string) {
    let parsed: any;
    try {
        parsed = JSON.parse(data);
    } catch {
        console.error('[Gateway] Invalid JSON');
        return;
    }

    // Check if this is already a known connection
    const wsInfo = wsToType.get(ws);
    if (wsInfo) {
        if (wsInfo.type === 'bot') {
            SyncModule.handleBotMessage(ws, parsed);
        } else if (wsInfo.type === 'sdk') {
            SyncModule.handleSDKMessage(ws, parsed);
        }
        return;
    }

    // Route based on message type for new connections
    if (parsed.type?.startsWith('sdk_')) {
        SyncModule.handleSDKMessage(ws, parsed);
    } else if (parsed.type === 'connected' || parsed.type === 'state' || parsed.type === 'actionResult') {
        SyncModule.handleBotMessage(ws, parsed);
    }
}

function handleClose(ws: any) {
    SyncModule.handleClose(ws);
}

// ============ Server Setup ============

console.log(`[Gateway] Starting Gateway Service on port ${GATEWAY_PORT}...`);

const server = Bun.serve({
    port: GATEWAY_PORT,

    fetch(req, server) {
        const url = new URL(req.url);

        // WebSocket upgrade
        if (req.headers.get('upgrade') === 'websocket') {
            const upgraded = server.upgrade(req);
            if (upgraded) return undefined;
            return new Response('WebSocket upgrade failed', { status: 400 });
        }

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Status endpoint
        if (url.pathname === '/' || url.pathname === '/status') {
            const bots: Record<string, any> = {};
            for (const [username, session] of botSessions) {
                bots[username] = {
                    connected: session.ws !== null,
                    clientId: session.clientId,
                    lastTick: session.lastState?.tick || 0,
                    inGame: session.lastState?.inGame || false,
                    player: session.lastState?.player?.name || null
                };
            }

            const sdks: Record<string, any> = {};
            for (const [id, session] of sdkSessions) {
                sdks[id] = { targetUsername: session.targetUsername };
            }

            return new Response(JSON.stringify({
                status: 'running',
                connectedBots: botSessions.size,
                connectedSDKs: sdkSessions.size,
                bots,
                sdks
            }, null, 2), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        return new Response(`Gateway Service (port ${GATEWAY_PORT})

Endpoints:
- GET /status    Connection status

WebSocket:
- ws://localhost:${GATEWAY_PORT}    Bot/SDK connections

Bots: ${botSessions.size} | SDKs: ${sdkSessions.size}
`, {
            headers: { 'Content-Type': 'text/plain', ...corsHeaders }
        });
    },

    websocket: {
        open(ws: any) {
            // Bot/SDK connections identify themselves via first message
        },

        message(ws: any, message: string | Buffer) {
            handleMessage(ws, message.toString());
        },

        close(ws: any) {
            handleClose(ws);
        }
    }
});

console.log(`[Gateway] Gateway running at http://localhost:${GATEWAY_PORT}`);
console.log(`[Gateway] Bot/SDK: ws://localhost:${GATEWAY_PORT}`);
