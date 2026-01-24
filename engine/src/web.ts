import fs from 'fs';
import path from 'path';

import ejs from 'ejs';
import { register } from 'prom-client';

import { CrcBuffer } from '#/cache/CrcTable.js';
import World from '#/engine/World.js';
import { LoggerEventType } from '#/server/logger/LoggerEventType.js';
import NullClientSocket from '#/server/NullClientSocket.js';
import WSClientSocket from '#/server/ws/WSClientSocket.js';
import Environment from '#/util/Environment.js';
import OnDemand from '#/engine/OnDemand.js';
import { tryParseInt } from '#/util/TryParse.js';
import { getPublicPerDeploymentToken } from '#/io/PemUtil.js';
import { findLongPath, isZoneAllocated } from '#/engine/GameMap.js';

function getIp(req: Request) {
    // todo: environment flag to respect cf-connecting-ip (NOT safe if origin is exposed publicly by IP + proxied)
    const forwardedFor = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for');
    if (!forwardedFor) {
        return null;
    }

    return forwardedFor.split(',')[0].trim();
}

const MIME_TYPES = new Map<string, string>();
MIME_TYPES.set('.js', 'application/javascript');
MIME_TYPES.set('.mjs', 'application/javascript');
MIME_TYPES.set('.css', 'text/css');
MIME_TYPES.set('.html', 'text/html');
MIME_TYPES.set('.wasm', 'application/wasm');
MIME_TYPES.set('.sf2', 'application/octet-stream');

// ============ Agent Transcript Renderer ============

interface RunMetadata {
    runId: string;
    username: string;
    goal: string;
    startTime: number;
    endTime?: number;
    eventCount: number;
    screenshotCount: number;
}

interface RunEvent {
    timestamp: number;
    type: string;
    content: string;
    state?: object;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderAgentTranscript(runName: string, meta: RunMetadata, events: RunEvent[]): string {
    const duration = meta.endTime ? ((meta.endTime - meta.startTime) / 1000).toFixed(1) : 'ongoing';

    const renderEvent = (event: RunEvent, index: number): string => {
        const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        let content = escapeHtml(event.content || '');
        let extraHtml = '';

        if (event.type === 'screenshot') {
            extraHtml = `<img class="screenshot-thumb" src="/runs/${runName}/screenshots/${event.content}" alt="Screenshot">`;
            content = '';
        } else if (event.type === 'code' || event.type === 'result') {
            // Format JSON results nicely
            if (event.type === 'result') {
                try {
                    const parsed = JSON.parse(event.content);
                    content = escapeHtml(JSON.stringify(parsed, null, 2));
                } catch {}
            }
            // Always show full code with syntax highlighting wrapper
            const lines = content.split('\n');
            const lang = event.type === 'result' ? 'json' : 'typescript';
            extraHtml = `
                <div class="code-block">
                    <div class="code-header"><span class="line-count">${lines.length} lines</span></div>
                    <pre class="code-content"><code class="language-${lang}">${content}</code></pre>
                </div>`;
            content = '';
        } else if (event.type === 'state') {
            // State delta - show nicely formatted
            extraHtml = `<div class="state-delta">${content}</div>`;
            content = '';
        }

        return `<div class="event ${event.type}">
            <div class="event-header">
                <span class="event-time">${time}</span>
            </div>
            ${content ? `<div class="event-content">${content}</div>` : ''}
            ${extraHtml}
        </div>`;
    };

    const eventHtml = events.map((e, i) => renderEvent(e, i)).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Run: ${escapeHtml(meta.goal)}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a;
            color: #888;
            margin: 0;
            padding: 20px;
            line-height: 1.5;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #5bf; margin-bottom: 10px; font-size: 20px; }
        .back { color: #5bf; text-decoration: none; font-size: 14px; }
        .meta {
            color: #666;
            margin: 16px 0;
            padding: 12px;
            background: rgba(255,255,255,0.03);
            border: 1px solid #333;
            border-radius: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
        }
        .meta strong { color: #888; }
        .timeline { display: flex; flex-direction: column; gap: 8px; }
        .event {
            padding: 12px 16px;
            border-radius: 4px;
            border-left: 3px solid #333;
            background: rgba(255,255,255,0.02);
        }
        .event.system { border-left-color: #555; }
        .event.thinking { border-left-color: #6666aa; background: rgba(100,100,170,0.08); }
        .event.action { border-left-color: #aa8844; background: rgba(170,136,68,0.08); }
        .event.code { border-left-color: #888855; background: #0d0d0d; }
        .event.result { border-left-color: #558855; background: rgba(85,136,85,0.05); }
        .event.error { border-left-color: #884444; background: rgba(136,68,68,0.08); }
        .event.user_message { border-left-color: #446688; background: rgba(68,102,136,0.08); }
        .event.screenshot { border-left-color: #885588; background: rgba(136,85,136,0.05); }
        .event.state { border-left-color: #448888; background: rgba(68,136,136,0.05); }
        .event-header {
            margin-bottom: 6px;
        }
        .event-time { color: #444; font-size: 10px; font-family: 'Consolas', 'Monaco', monospace; }
        .event-content {
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 12px;
            color: #999;
        }
        .code-block {
            background: #111;
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid #222;
        }
        .code-header {
            padding: 4px 10px;
            background: #151515;
            border-bottom: 1px solid #222;
        }
        .line-count {
            font-size: 10px;
            color: #444;
            font-family: 'Consolas', 'Monaco', monospace;
        }
        .code-content {
            margin: 0;
            padding: 10px 12px;
            overflow-x: auto;
        }
        .code-content code {
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 11px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .state-delta {
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 11px;
            color: #668888;
            white-space: pre-wrap;
            background: #0d0d0d;
            padding: 8px 10px;
            border-radius: 4px;
        }
        .screenshot-thumb {
            max-width: 400px;
            max-height: 300px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 8px;
            border: 1px solid #333;
        }
        .screenshot-thumb:hover { opacity: 0.9; }
        .lightbox {
            display: none;
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.95);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .lightbox.active { display: flex; }
        .lightbox img { max-width: 95%; max-height: 95%; }
        .lightbox-close {
            position: absolute;
            top: 20px; right: 30px;
            color: #666;
            font-size: 30px;
            cursor: pointer;
        }
        /* Highlight.js custom theme - matching AgentPanel */
        .hljs { background: transparent; color: #808080; }
        .hljs-keyword { color: #907090; }
        .hljs-built_in { color: #709080; }
        .hljs-string { color: #908070; }
        .hljs-number { color: #809070; }
        .hljs-literal { color: #708090; }
        .hljs-comment { color: #505050; }
        .hljs-function { color: #909070; }
        .hljs-title.function_ { color: #909070; }
        .hljs-params { color: #707080; }
        .hljs-property { color: #707080; }
        .hljs-attr { color: #807070; }
        .hljs-variable { color: #707080; }
        .hljs-punctuation { color: #606060; }
        /* Scrollbar styling */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="container">
        <a href="/runs" class="back">← Back to runs</a>
        <h1>${escapeHtml(meta.goal)}</h1>
        <div class="meta">
            <span><strong>User:</strong> ${escapeHtml(meta.username)}</span>
            <span><strong>Duration:</strong> ${duration}s</span>
            <span><strong>Events:</strong> ${meta.eventCount}</span>
            <span><strong>Screenshots:</strong> ${meta.screenshotCount}</span>
        </div>
        <div class="timeline">${eventHtml}</div>
    </div>
    <div class="lightbox" onclick="this.classList.remove('active')">
        <span class="lightbox-close">&times;</span>
        <img src="" alt="Screenshot">
    </div>
    <script>
        // Apply syntax highlighting to all code blocks
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('pre.code-content code').forEach(block => {
                hljs.highlightElement(block);
            });
        });
        document.querySelectorAll('.screenshot-thumb').forEach(img => {
            img.addEventListener('click', e => {
                e.stopPropagation();
                const lb = document.querySelector('.lightbox');
                lb.querySelector('img').src = img.src;
                lb.classList.add('active');
            });
        });
    </script>
</body>
</html>`;
}

export type WebSocketData = {
    client: WSClientSocket,
    remoteAddress: string,
    isAgentProxy?: boolean,
    isAgentControllerProxy?: boolean,
    agentWs?: WebSocket,
    agentReady?: boolean,
    agentQueue?: string[],
    botUsername?: string  // Username for multi-bot routing
};

export type WebSocketRoutes = {
    '/': Response
};

export async function startWeb() {
    Bun.serve<WebSocketData, WebSocketRoutes>({
        port: Environment.WEB_PORT,
        async fetch(req, server) {
            const url = new URL(req.url ?? `', 'http://${req.headers.get('host')}`);

            // Agent WebSocket proxy endpoint
            if (url.pathname === '/agent' || url.pathname === '/agent/') {
                const upgradeHeader = req.headers.get('upgrade');
                if (upgradeHeader?.toLowerCase() === 'websocket') {
                    // Extract bot username from query param for multi-bot support
                    const botUsername = url.searchParams.get('bot') || 'default';
                    const upgraded = server.upgrade(req, {
                        data: {
                            client: new WSClientSocket(),
                            remoteAddress: getIp(req),
                            isAgentProxy: true,
                            botUsername
                        }
                    });

                    if (upgraded) {
                        return undefined;
                    }

                    return new Response(null, { status: 404 });
                }
                return new Response('WebSocket endpoint for AI agent (supports ?bot=username for multi-bot)', { status: 200 });
            }

            // Agent Controller WebSocket proxy endpoint
            if (url.pathname === '/agent-controller' || url.pathname === '/agent-controller/') {
                const upgradeHeader = req.headers.get('upgrade');
                if (upgradeHeader?.toLowerCase() === 'websocket') {
                    // Extract bot username from query param for multi-bot support
                    const botUsername = url.searchParams.get('bot') || 'default';
                    const upgraded = server.upgrade(req, {
                        data: {
                            client: new WSClientSocket(),
                            remoteAddress: getIp(req),
                            isAgentControllerProxy: true,
                            botUsername
                        }
                    });

                    if (upgraded) {
                        return undefined;
                    }

                    return new Response(null, { status: 404 });
                }
                return new Response('WebSocket endpoint for agent controller UI (supports ?bot=username for multi-bot)', { status: 200 });
            }

            if (url.pathname === '/' || url.pathname === '/bot' || url.pathname === '/bot/') {
                // Check if this is a WebSocket upgrade request
                const upgradeHeader = req.headers.get('upgrade');
                if (upgradeHeader?.toLowerCase() === 'websocket') {
                    const upgraded = server.upgrade(req, {
                        data: {
                            client: new WSClientSocket(),
                            remoteAddress: getIp(req)
                        }
                    });

                    if (upgraded) {
                        return undefined;
                    }

                    return new Response(null, { status: 404 });
                }

                // Serve web client at root, bot client at /bot
                const lowmem = tryParseInt(url.searchParams.get('lowmem'), 0);
                // Extract bot username from query param for multi-bot support
                const botUsername = url.searchParams.get('bot') || 'default';
                const template = url.pathname === '/bot' || url.pathname === '/bot/' ? 'view/bot.ejs' : 'view/client.ejs';
                return new Response(await ejs.renderFile(template, {
                    nodeid: Environment.NODE_ID,
                    lowmem,
                    members: Environment.NODE_MEMBERS,
                    botUsername,  // Pass bot username to template for multi-bot support
                    per_deployment_token: Environment.WEB_SOCKET_TOKEN_PROTECTION ? getPublicPerDeploymentToken() : ''
                }), {
                    headers: {
                        'Content-Type': 'text/html'
                    }
                });
            } else if (url.pathname.startsWith('/crc')) {
                return new Response(Buffer.from(CrcBuffer.data));
            } else if (url.pathname.startsWith('/title')) {
                return new Response(Buffer.from(OnDemand.cache.read(0, 1)!));
            } else if (url.pathname.startsWith('/config')) {
                return new Response(Buffer.from(OnDemand.cache.read(0, 2)!));
            } else if (url.pathname.startsWith('/interface')) {
                return new Response(Buffer.from(OnDemand.cache.read(0, 3)!));
            } else if (url.pathname.startsWith('/media')) {
                return new Response(Buffer.from(OnDemand.cache.read(0, 4)!));
            } else if (url.pathname.startsWith('/versionlist')) {
                return new Response(Buffer.from(OnDemand.cache.read(0, 5)!));
            } else if (url.pathname.startsWith('/textures')) {
                return new Response(Buffer.from(OnDemand.cache.read(0, 6)!));
            } else if (url.pathname.startsWith('/wordenc')) {
                return new Response(Buffer.from(OnDemand.cache.read(0, 7)!));
            } else if (url.pathname.startsWith('/sounds')) {
                return new Response(Buffer.from(OnDemand.cache.read(0, 8)!));
            } else if (url.pathname.startsWith('/ondemand.zip')) {
                return new Response(Bun.file('data/pack/ondemand.zip'));
            } else if (url.pathname.startsWith('/build')) {
                return new Response(Bun.file('data/pack/server/build'));
            } else if (url.pathname === '/rs2.cgi') {
                const plugin = tryParseInt(url.searchParams.get('plugin'), 0);
                const lowmem = tryParseInt(url.searchParams.get('lowmem'), 0);

                if (Environment.NODE_DEBUG && plugin === 1) {
                    return new Response(await ejs.renderFile('view/java.ejs', {
                        nodeid: Environment.NODE_ID,
                        lowmem,
                        members: Environment.NODE_MEMBERS,
                        portoff: Environment.NODE_PORT - 43594
                    }), {
                        headers: {
                            'Content-Type': 'text/html'
                        }
                    });
                } else {
                    return new Response(await ejs.renderFile('view/client.ejs', {
                        nodeid: Environment.NODE_ID,
                        lowmem,
                        members: Environment.NODE_MEMBERS,
                        per_deployment_token: Environment.WEB_SOCKET_TOKEN_PROTECTION ? getPublicPerDeploymentToken() : ''
                    }), {
                        headers: {
                            'Content-Type': 'text/html'
                        }
                    });
                }
            } else if (url.pathname === '/api/screenshot' && req.method === 'POST') {
                // Save screenshot from client
                try {
                    const data = await req.text();
                    const base64Data = data.replace(/^data:image\/png;base64,/, '');
                    const filename = `screenshot-${Date.now()}.png`;
                    const filepath = `screenshots/${filename}`;
                    fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
                    return new Response(JSON.stringify({ success: true, filename }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (e: any) {
                    return new Response(JSON.stringify({ success: false, error: e.message }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            } else if (url.pathname === '/api/findPath') {
                // Server-side pathfinding API for bots/agents
                // Uses the rsmod WASM pathfinder with the full collision map
                try {
                    const srcX = tryParseInt(url.searchParams.get('srcX'), -1);
                    const srcZ = tryParseInt(url.searchParams.get('srcZ'), -1);
                    const destX = tryParseInt(url.searchParams.get('destX'), -1);
                    const destZ = tryParseInt(url.searchParams.get('destZ'), -1);
                    const level = tryParseInt(url.searchParams.get('level'), 0);
                    const maxWaypoints = tryParseInt(url.searchParams.get('maxWaypoints'), 500);

                    if (srcX < 0 || srcZ < 0 || destX < 0 || destZ < 0) {
                        return new Response(JSON.stringify({
                            success: false,
                            error: 'Missing required parameters: srcX, srcZ, destX, destZ'
                        }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    // Check if zones are allocated (collision data is loaded)
                    const srcZoneAllocated = isZoneAllocated(level, srcX, srcZ);
                    const destZoneAllocated = isZoneAllocated(level, destX, destZ);

                    if (!srcZoneAllocated || !destZoneAllocated) {
                        return new Response(JSON.stringify({
                            success: false,
                            error: 'Zone not allocated (collision data not loaded)',
                            srcZoneAllocated,
                            destZoneAllocated
                        }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    // Find path using rsmod pathfinder
                    const waypointsRaw = findLongPath(level, srcX, srcZ, destX, destZ, maxWaypoints);

                    // Convert packed waypoints to coordinate objects
                    // Waypoints are packed as: z | (x << 14) | (level << 28) (see CoordGrid.packCoord)
                    const waypoints: Array<{ x: number; z: number; level: number }> = [];
                    for (let i = 0; i < waypointsRaw.length; i++) {
                        const packed = waypointsRaw[i];
                        waypoints.push({
                            z: packed & 0x3FFF,
                            x: (packed >> 14) & 0x3FFF,
                            level: (packed >> 28) & 0x3
                        });
                    }

                    return new Response(JSON.stringify({
                        success: true,
                        waypoints,
                        waypointCount: waypoints.length,
                        reachedDestination: waypoints.length > 0 &&
                            waypoints[waypoints.length - 1].x === destX &&
                            waypoints[waypoints.length - 1].z === destZ
                    }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (e: any) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: e.message
                    }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            } else if (url.pathname === '/runs' || url.pathname === '/runs/') {
                // Serve runs directory listing
                const runsDir = '../runs';
                if (!fs.existsSync(runsDir)) {
                    fs.mkdirSync(runsDir, { recursive: true });
                }

                const timeAgo = (ms: number): string => {
                    const seconds = Math.floor((Date.now() - ms) / 1000);
                    if (seconds < 60) return `${seconds}s ago`;
                    const minutes = Math.floor(seconds / 60);
                    if (minutes < 60) return `${minutes}m ago`;
                    const hours = Math.floor(minutes / 60);
                    if (hours < 24) return `${hours}h ago`;
                    const days = Math.floor(hours / 24);
                    return `${days}d ago`;
                };

                const formatDuration = (ms: number): string => {
                    const seconds = Math.floor(ms / 1000);
                    if (seconds < 60) return `${seconds}s`;
                    const minutes = Math.floor(seconds / 60);
                    const remainingSecs = seconds % 60;
                    if (minutes < 60) return `${minutes}m ${remainingSecs}s`;
                    const hours = Math.floor(minutes / 60);
                    const remainingMins = minutes % 60;
                    return `${hours}h ${remainingMins}m`;
                };

                const runs = fs.readdirSync(runsDir)
                    .filter(f => fs.statSync(path.join(runsDir, f)).isDirectory())
                    .map(f => {
                        const stat = fs.statSync(path.join(runsDir, f));
                        const summaryPath = path.join(runsDir, f, 'summary.json');
                        const metadataPath = path.join(runsDir, f, 'metadata.json');
                        const eventsPath = path.join(runsDir, f, 'events.jsonl');
                        const screenshotsDir = path.join(runsDir, f, 'screenshots');

                        let summary = null;
                        let metadata = null;
                        let turnCount = 0;
                        let duration = '';
                        let lastScreenshot: string | null = null;

                        // Try to load summary.json (old format)
                        if (fs.existsSync(summaryPath)) {
                            try {
                                summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
                            } catch {}
                        }

                        // Try to load metadata.json (new format)
                        if (fs.existsSync(metadataPath)) {
                            try {
                                metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                                // Calculate duration if we have start and end time
                                if (metadata.startTime && metadata.endTime) {
                                    duration = formatDuration(metadata.endTime - metadata.startTime);
                                }
                            } catch {}
                        }

                        // Count turns from events.jsonl (count 'code' events as turns)
                        if (fs.existsSync(eventsPath)) {
                            try {
                                const eventsRaw = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
                                turnCount = eventsRaw.filter(line => {
                                    try {
                                        const event = JSON.parse(line);
                                        return event.type === 'code';
                                    } catch { return false; }
                                }).length;
                            } catch {}
                        }

                        // Get last screenshot
                        if (fs.existsSync(screenshotsDir)) {
                            try {
                                const screenshots = fs.readdirSync(screenshotsDir)
                                    .filter(s => s.endsWith('.png'))
                                    .sort();
                                if (screenshots.length > 0) {
                                    lastScreenshot = screenshots[screenshots.length - 1];
                                }
                            } catch {}
                        }

                        return { name: f, mtime: stat.mtimeMs, summary, metadata, turnCount, duration, lastScreenshot };
                    })
                    .sort((a, b) => b.mtime - a.mtime);

                const html = `<!DOCTYPE html>
<html><head><title>Agent Test Runs</title>
<style>
body{background:#fff;color:#333;font-family:system-ui,-apple-system,sans-serif;padding:24px;margin:0;max-width:1100px}
h1{font-weight:500;font-size:18px;margin-bottom:20px}
.runs{display:flex;flex-direction:column;gap:8px}
.run{border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;transition:border-color 0.15s}
.run:hover{border-color:#999}
.run a{color:inherit;text-decoration:none;display:flex;gap:12px;align-items:stretch}
.run-thumb-wrap{width:120px;height:80px;overflow:hidden;background:#f5f5f5;flex-shrink:0}
.run-thumb{width:180px;height:120px;object-fit:cover;object-position:0 0}
.run-thumb-placeholder{width:120px;height:80px;background:#f0f0f0;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#999;font-size:11px}
.run-content{flex:1;min-width:0;padding:10px 12px 10px 0}
.run-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.run-name{font-weight:500;font-size:14px;color:#0066cc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.run-time{color:#888;font-size:14px;flex-shrink:0;margin-left:8px}
.run-meta{display:flex;gap:16px;font-size:14px;color:#555}
.run-meta span{display:flex;align-items:center;gap:4px}
.outcome{padding:2px 6px;border-radius:3px;font-size:11px;font-weight:500}
.outcome.success{background:#e6f4ea;color:#1e7e34}
.outcome.timeout{background:#fff3e0;color:#e65100}
.outcome.error{background:#fce8e8;color:#c62828}
.empty{color:#888;padding:40px;text-align:center}
</style></head>
<body>
<h1>Test Runs (${runs.length})</h1>
<div class="runs">
${runs.map(r => `<div class="run">
<a href="/runs/${r.name}/">
${r.lastScreenshot
    ? `<div class="run-thumb-wrap"><img class="run-thumb" src="/runs/${r.name}/screenshots/${r.lastScreenshot}" alt=""></div>`
    : `<div class="run-thumb-placeholder">No screenshot</div>`}
<div class="run-content">
<div class="run-header">
<span class="run-name">${r.name}</span>
<span class="run-time">${timeAgo(r.mtime)}</span>
</div>
<div class="run-meta">
${r.summary ? `<span class="outcome ${r.summary.outcome}">${r.summary.outcome}</span>` : ''}
<span>${r.turnCount || r.summary?.totalTurns || 0} turns</span>
<span>${r.duration || r.summary?.duration || 'N/A'}</span>
</div>
</div>
</a>
</div>`).join('')}
${runs.length === 0 ? '<div class="empty">No test runs yet</div>' : ''}
</div>
</body></html>`;
                return new Response(html, { headers: { 'Content-Type': 'text/html' } });
            } else if (url.pathname.match(/^\/runs\/[^/]+\/?$/)) {
                // Serve individual run viewer
                const runName = url.pathname.replace(/^\/runs\//, '').replace(/\/$/, '');
                const runDir = path.join('../runs', runName);

                if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
                    return new Response('Run not found', { status: 404 });
                }

                // New format: metadata.json + events.jsonl
                const metadataPath = path.join(runDir, 'metadata.json');
                const eventsPath = path.join(runDir, 'events.jsonl');

                if (fs.existsSync(metadataPath) && fs.existsSync(eventsPath)) {
                    // Render new format transcript dynamically
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                    const eventsRaw = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
                    const events = eventsRaw.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);

                    const html = renderAgentTranscript(runName, metadata, events);
                    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
                }

                // Fall back to old format
                const summaryPath = path.join(runDir, 'summary.json');
                const runPath = path.join(runDir, 'run.json');
                let summary = null;
                let runData = null;

                if (fs.existsSync(summaryPath)) {
                    try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')); } catch {}
                }
                if (fs.existsSync(runPath)) {
                    try { runData = JSON.parse(fs.readFileSync(runPath, 'utf-8')); } catch {}
                }

                const screenshotsDir = path.join(runDir, 'screenshots');
                let screenshots: string[] = [];
                if (fs.existsSync(screenshotsDir)) {
                    screenshots = fs.readdirSync(screenshotsDir)
                        .filter(f => f.endsWith('.png'))
                        .sort();
                }

                const turns = runData?.turns || [];

                // Filter to only turns with actions or significant state changes
                const actionTurns = turns.filter((t: any) => t.action !== null);

                // Escape HTML for JSON display
                const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                // Build interleaved timeline
                const timelineHtml = actionTurns.map((t: any, idx: number) => {
                    const pos = t.state?.player ? `(${t.state.player.x}, ${t.state.player.z})` : '';
                    const stateInfo = [];
                    if (t.state?.dialogOpen) stateInfo.push('dialog open');
                    if (t.state?.inventoryCount) stateInfo.push(`inv: ${t.state.inventoryCount}`);
                    if (t.state?.nearbyNpcCount) stateInfo.push(`npcs: ${t.state.nearbyNpcCount}`);

                    const actionType = t.action?.type || 'unknown';
                    const reason = t.action?.reason || '';
                    const result = t.action?.result?.message || (t.action?.result?.success ? 'success' : '');

                    const ssFile = t.screenshotFile?.replace('screenshots/', '') || '';

                    // Full state/action JSON for expandable view
                    const fullData = {
                        turn: t.turn,
                        tick: t.tick,
                        timestamp: t.timestamp,
                        state: t.state,
                        action: t.action
                    };
                    const fullJson = escapeHtml(JSON.stringify(fullData, null, 2));

                    return `<div class="turn">
<div class="turn-left">
<div class="turn-header">
<span class="turn-num">#${t.turn}</span>
<span class="turn-tick">tick ${t.tick}</span>
<span class="turn-pos">${pos}</span>
</div>
<div class="turn-action"><strong>${actionType}</strong></div>
<div class="turn-reason">${escapeHtml(reason)}</div>
${result ? `<div class="turn-result">→ ${escapeHtml(result)}</div>` : ''}
${stateInfo.length ? `<div class="turn-state">${stateInfo.join(' | ')}</div>` : ''}
<details class="turn-details">
<summary>Show full state</summary>
<pre>${fullJson}</pre>
</details>
</div>
<div class="turn-right">
${ssFile ? `<img src="/runs/${runName}/screenshots/${ssFile}" alt="turn ${t.turn}">` : ''}
</div>
</div>`;
                }).join('');

                const html = `<!DOCTYPE html>
<html><head><title>Run: ${runName}</title>
<style>
body{background:#fff;color:#333;font-family:system-ui,-apple-system,sans-serif;padding:24px;margin:0}
a{color:#0066cc}
h1{font-weight:500;margin-bottom:8px;font-size:18px}
.back{margin-bottom:16px;display:inline-block;font-size:14px}
.summary{border:1px solid #e0e0e0;border-radius:6px;padding:12px 16px;margin-bottom:24px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-size:13px}
.outcome{padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500}
.outcome.success{background:#e6f4ea;color:#1e7e34}
.outcome.timeout{background:#fff3e0;color:#e65100}
.outcome.error{background:#fce8e8;color:#c62828}
.meta-item{color:#666}
.goal{margin-bottom:16px;padding:12px 16px;background:#f8f9fa;border-radius:6px;font-size:13px;color:#555}
.goal strong{color:#333}
.note{font-size:12px;color:#888;margin-bottom:20px}
.note code{background:#f0f0f0;padding:1px 4px;border-radius:3px}
.timeline{display:flex;flex-direction:column;gap:16px}
.turn{display:grid;grid-template-columns:1fr 300px;gap:16px;padding:16px;border:1px solid #e0e0e0;border-radius:6px}
.turn-left{display:flex;flex-direction:column;gap:6px}
.turn-header{display:flex;gap:12px;font-size:12px;color:#888}
.turn-num{font-weight:600;color:#333}
.turn-action{font-size:14px}
.turn-reason{font-size:12px;color:#666;font-family:monospace}
.turn-result{font-size:12px;color:#1e7e34}
.turn-state{font-size:11px;color:#888;margin-top:4px}
.turn-details{margin-top:8px;font-size:12px}
.turn-details summary{cursor:pointer;color:#0066cc;font-size:11px}
.turn-details pre{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;padding:8px;margin-top:6px;font-size:11px;overflow-x:auto;max-height:200px;overflow-y:auto}
.turn-right img{width:100%;border-radius:4px;border:1px solid #e0e0e0}
</style>
</head>
<body>
<a href="/runs" class="back">&larr; Back</a>
<h1>${runName}</h1>

<div class="summary">
<span class="outcome ${summary?.outcome || ''}">${summary?.outcome || 'unknown'}</span>
<span class="meta-item">${actionTurns.length} actions / ${turns.length} turns</span>
<span class="meta-item">${summary?.duration || ''}</span>
</div>

${runData?.metadata?.config?.goal ? `<div class="goal"><strong>Goal:</strong> ${runData.metadata.config.goal}</div>` : ''}

<p class="note">Note: Full agent state (what Claude saw via <code>rsbot state</code>) is not yet captured in run.json. Only minimal state is shown below.</p>

<div class="timeline">
${timelineHtml || '<div>No actions recorded</div>'}
</div>
</body></html>`;
                return new Response(html, { headers: { 'Content-Type': 'text/html' } });
            } else if (url.pathname.startsWith('/runs/')) {
                // Serve run files (screenshots, json)
                const filePath = '../' + url.pathname.substring(1); // Remove leading / and prepend ../
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    const ext = path.extname(filePath);
                    let contentType = 'application/octet-stream';
                    if (ext === '.png') contentType = 'image/png';
                    else if (ext === '.json') contentType = 'application/json';
                    else if (ext === '.jsonl') contentType = 'application/jsonl';
                    else if (ext === '.html') contentType = 'text/html';
                    return new Response(Bun.file(filePath), {
                        headers: { 'Content-Type': contentType }
                    });
                }
                return new Response('File not found', { status: 404 });
            } else if (url.pathname === '/screenshots' || url.pathname === '/screenshots/') {
                // Serve screenshot directory listing
                const screenshotDir = 'screenshots';
                if (!fs.existsSync(screenshotDir)) {
                    fs.mkdirSync(screenshotDir, { recursive: true });
                }

                // Helper to format time ago
                const timeAgo = (ms: number): string => {
                    const seconds = Math.floor((Date.now() - ms) / 1000);
                    if (seconds < 60) return `${seconds}s ago`;
                    const minutes = Math.floor(seconds / 60);
                    if (minutes < 60) return `${minutes}m ago`;
                    const hours = Math.floor(minutes / 60);
                    if (hours < 24) return `${hours}h ago`;
                    const days = Math.floor(hours / 24);
                    return `${days}d ago`;
                };

                const files = fs.readdirSync(screenshotDir)
                    .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
                    .map(f => {
                        const stat = fs.statSync(path.join(screenshotDir, f));
                        return { name: f, mtime: stat.mtimeMs };
                    })
                    .sort((a, b) => b.mtime - a.mtime);

                const html = `<!DOCTYPE html>
<html><head><title>Screenshots</title>
<style>
body{background:#000;color:#04A800;font-family:monospace;padding:20px}
a{color:#04A800;text-decoration:none}
.grid{display:flex;flex-wrap:wrap;gap:15px}
.item{display:flex;flex-direction:column;align-items:center}
.item img{max-width:300px;max-height:200px;border:1px solid #04A800}
.item img:hover{border-color:#fff}
.time{font-size:11px;color:#888;margin-top:4px}
.name{font-size:10px;color:#666;max-width:300px;overflow:hidden;text-overflow:ellipsis}
</style></head>
<body><h1>Screenshots (${files.length})</h1>
<div class="grid">${files.map(f => `<a href="/screenshots/${f.name}" target="_blank" class="item">
<img src="/screenshots/${f.name}">
<span class="time">${timeAgo(f.mtime)}</span>
<span class="name">${f.name}</span>
</a>`).join('')}</div>
${files.length === 0 ? '<p>No screenshots yet</p>' : ''}
</body></html>`;
                return new Response(html, { headers: { 'Content-Type': 'text/html' } });
            } else if (url.pathname.startsWith('/screenshots/')) {
                // Serve individual screenshot files
                const filePath = url.pathname.substring(1); // Remove leading /
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    return new Response(Bun.file(filePath), {
                        headers: { 'Content-Type': 'image/png' }
                    });
                }
                return new Response(null, { status: 404 });
            } else if (fs.existsSync(`public${url.pathname}`) && fs.statSync(`public${url.pathname}`).isFile()) {
                return new Response(Bun.file(`public${url.pathname}`), {
                    headers: {
                        'Content-Type': MIME_TYPES.get(path.extname(url.pathname ?? '')) ?? 'text/plain'
                    }
                });
            } else {
                return new Response(null, { status: 404 });
            }
        },
        websocket: {
            maxPayloadLength: 16 * 1024 * 1024, // 16MB for screenshot responses
            open(ws) {
                // Handle agent proxy connections
                if (ws.data.isAgentProxy) {
                    // Connect to internal agent service
                    const agentWs = new WebSocket('ws://localhost:7780');
                    ws.data.agentWs = agentWs;
                    ws.data.agentReady = false;
                    ws.data.agentQueue = [];

                    agentWs.onopen = () => {
                        // Agent connection established - flush queued messages
                        ws.data.agentReady = true;
                        for (const msg of ws.data.agentQueue || []) {
                            agentWs.send(msg);
                        }
                        ws.data.agentQueue = [];
                    };

                    agentWs.onmessage = (event) => {
                        // Forward agent messages to client
                        try {
                            ws.send(event.data);
                        } catch (_) {
                            agentWs.close();
                        }
                    };

                    agentWs.onclose = () => {
                        try {
                            ws.close();
                        } catch (_) {}
                    };

                    agentWs.onerror = (err) => {
                        console.error('Agent WebSocket error:', err);
                        try {
                            ws.close();
                        } catch (_) {}
                    };

                    return;
                }

                // Handle agent controller proxy connections (now via gateway)
                if (ws.data.isAgentControllerProxy) {
                    // Connect to gateway service with bot username (UI connection)
                    const botUsername = ws.data.botUsername || 'default';
                    const agentWs = new WebSocket(`ws://localhost:7780?bot=${botUsername}`);
                    ws.data.agentWs = agentWs;
                    ws.data.agentReady = false;
                    ws.data.agentQueue = [];

                    agentWs.onopen = () => {
                        ws.data.agentReady = true;
                        for (const msg of ws.data.agentQueue || []) {
                            agentWs.send(msg);
                        }
                        ws.data.agentQueue = [];
                    };

                    agentWs.onmessage = (event) => {
                        try {
                            ws.send(event.data);
                        } catch (_) {
                            agentWs.close();
                        }
                    };

                    agentWs.onclose = () => {
                        try {
                            ws.close();
                        } catch (_) {}
                    };

                    agentWs.onerror = (err) => {
                        console.error('Agent Controller WebSocket error:', err);
                        try {
                            ws.close();
                        } catch (_) {}
                    };

                    return;
                }

                /* TODO:
                if (Environment.WEB_SOCKET_TOKEN_PROTECTION) {
                    // if WEB_CONNECTION_TOKEN_PROTECTION is enabled, we must
                    // have a matching per-deployment token sent via cookie.
                    const headers = info.req.headers;
                    if (!headers.cookie) {
                        // no cookie
                        cb(false);
                        return;
                    }
                    // cookie string is present at least
                    // find exact match. NOTE: the double quotes are deliberate
                    const search = `per_deployment_token="${getPublicPerDeploymentToken()}"`;
                    // could do something more fancy with cookie parsing, but
                    // this seems fine.
                    if (headers.cookie.indexOf(search) === -1) {
                        cb(false);
                        return;
                    }
                }
                const { origin } = info;

                // todo: check more than just the origin header (important!)
                if (Environment.WEB_ALLOWED_ORIGIN && origin !== Environment.WEB_ALLOWED_ORIGIN) {
                    cb(false);
                    return;
                }

                cb(true);
                */

                ws.data.client.init(ws, ws.data.remoteAddress ?? ws.remoteAddress);
            },
            message(ws, message: Buffer) {
                // Handle agent proxy connections
                if (ws.data.isAgentProxy || ws.data.isAgentControllerProxy) {
                    try {
                        const msgStr = message.toString();
                        if (ws.data.agentReady && ws.data.agentWs?.readyState === WebSocket.OPEN) {
                            ws.data.agentWs.send(msgStr);
                        } else {
                            // Queue message until agent connection is ready
                            ws.data.agentQueue?.push(msgStr);
                        }
                    } catch (err) {
                        console.error('Agent proxy message error:', err);
                        ws.close();
                    }
                    return;
                }

                try {
                    const { client } = ws.data;
                    if (client.state === -1 || client.remaining <= 0) {
                        client.terminate();
                        return;
                    }

                    client.buffer(message);

                    if (client.state === 0) {
                        World.onClientData(client);
                    } else if (client.state === 2) {
                        if (Environment.NODE_WS_ONDEMAND) {
                            OnDemand.onClientData(client);
                        } else {
                            client.terminate();
                        }
                    }
                } catch (_) {
                    ws.terminate();
                }
            },
            close(ws) {
                // Handle agent proxy connections
                if (ws.data.isAgentProxy || ws.data.isAgentControllerProxy) {
                    try {
                        ws.data.agentWs?.close();
                    } catch (_) {}
                    return;
                }

                const { client } = ws.data;
                client.state = -1;

                if (client.player) {
                    client.player.addSessionLog(LoggerEventType.ENGINE, 'WS socket closed');
                    client.player.client = new NullClientSocket();
                }
            }
        }
    });
}

export async function startManagementWeb() {
    Bun.serve({
        port: Environment.WEB_MANAGEMENT_PORT,
        routes: {
            '/prometheus': new Response(await register.metrics(), {
                headers: {
                    'Content-Type': register.contentType
                }
            })
        },
        fetch() {
            return new Response(null, { status: 404 });
        },
    });
}
