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

                const runs = fs.readdirSync(runsDir)
                    .filter(f => fs.statSync(path.join(runsDir, f)).isDirectory())
                    .map(f => {
                        const stat = fs.statSync(path.join(runsDir, f));
                        const summaryPath = path.join(runsDir, f, 'summary.json');
                        let summary = null;
                        if (fs.existsSync(summaryPath)) {
                            try {
                                summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
                            } catch {}
                        }
                        return { name: f, mtime: stat.mtimeMs, summary };
                    })
                    .sort((a, b) => b.mtime - a.mtime);

                const html = `<!DOCTYPE html>
<html><head><title>Agent Test Runs</title>
<style>
body{background:#fff;color:#333;font-family:system-ui,-apple-system,sans-serif;padding:24px;margin:0;max-width:900px}
h1{font-weight:500;font-size:18px;margin-bottom:20px}
.runs{display:flex;flex-direction:column;gap:8px}
.run{border:1px solid #e0e0e0;border-radius:6px;padding:12px 16px;transition:border-color 0.15s}
.run:hover{border-color:#999}
.run a{color:inherit;text-decoration:none;display:block}
.run-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.run-name{font-weight:500;font-size:14px;color:#0066cc}
.run-time{color:#888;font-size:12px}
.run-meta{display:flex;gap:12px;font-size:12px;color:#666}
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
<div class="run-header">
<span class="run-name">${r.name}</span>
<span class="run-time">${timeAgo(r.mtime)}</span>
</div>
<div class="run-meta">
${r.summary ? `<span class="outcome ${r.summary.outcome}">${r.summary.outcome}</span>
<span>Turns: ${r.summary.totalTurns}</span>
<span>${r.summary.duration || ''}</span>` : '<span>No summary</span>'}
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
            maxPayloadLength: 65536,
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

                // Handle agent controller proxy connections
                if (ws.data.isAgentControllerProxy) {
                    // Connect to internal agent controller service with bot username
                    const botUsername = ws.data.botUsername || 'default';
                    const agentWs = new WebSocket(`ws://localhost:7781?bot=${botUsername}`);
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
