import { register } from 'prom-client';
import Environment from '#/util/Environment.js';
import { handleClientPage, handleCacheEndpoints } from './pages/client.js';
import { handleHiscoresPage, handleHiscoresPlayerPage } from './pages/hiscores.js';
import { handleScriptRunsListPage, handleScriptRunsForScriptPage, handleScriptRunViewerPage, handleScriptRunFilesPage } from './pages/scriptRuns.js';
import { handleScreenshotsListPage, handleScreenshotFilePage } from './pages/screenshots.js';
import { handleScreenshotUpload, handleExportCollisionApi } from './pages/api.js';
import { handleDisclaimerPage, handlePublicFiles } from './pages/static.js';
import { WebSocketData, handleWebSocketUpgrade, handleGatewayEndpointGet, websocketHandlers } from './websocket.js';

export type { WebSocketData };

export type WebSocketRoutes = {
    '/': Response
};

export async function startWeb() {
    Bun.serve<WebSocketData, WebSocketRoutes>({
        port: Environment.WEB_PORT,
        async fetch(req, server) {
            const url = new URL(req.url ?? '', `http://${req.headers.get('host')}`);

            // Handle WebSocket upgrades first
            const wsResponse = handleWebSocketUpgrade(req, server, url);
            if (wsResponse !== undefined) {
                return wsResponse;
            }

            // Gateway endpoint GET request
            const gatewayResponse = handleGatewayEndpointGet(url);
            if (gatewayResponse) return gatewayResponse;

            // Client pages (/, /bot, /rs2.cgi)
            const clientResponse = await handleClientPage(url);
            if (clientResponse) return clientResponse;

            // Cache endpoints
            const cacheResponse = handleCacheEndpoints(url);
            if (cacheResponse) return cacheResponse;

            // Disclaimer page
            const disclaimerResponse = handleDisclaimerPage(url);
            if (disclaimerResponse) return disclaimerResponse;

            // API endpoints
            const screenshotUploadResponse = await handleScreenshotUpload(req, url);
            if (screenshotUploadResponse) return screenshotUploadResponse;

            const exportCollisionResponse = handleExportCollisionApi(url);
            if (exportCollisionResponse) return exportCollisionResponse;

            // Hiscores
            const hiscoresResponse = await handleHiscoresPage(url);
            if (hiscoresResponse) return hiscoresResponse;

            const hiscoresPlayerResponse = await handleHiscoresPlayerPage(url);
            if (hiscoresPlayerResponse) return hiscoresPlayerResponse;

            // Screenshots
            const screenshotsListResponse = handleScreenshotsListPage(url);
            if (screenshotsListResponse) return screenshotsListResponse;

            const screenshotFileResponse = handleScreenshotFilePage(url);
            if (screenshotFileResponse) return screenshotFileResponse;

            // Script runs
            const scriptRunsListResponse = handleScriptRunsListPage(url);
            if (scriptRunsListResponse) return scriptRunsListResponse;

            const scriptRunsForScriptResponse = handleScriptRunsForScriptPage(url);
            if (scriptRunsForScriptResponse) return scriptRunsForScriptResponse;

            const scriptRunViewerResponse = handleScriptRunViewerPage(url);
            if (scriptRunViewerResponse) return scriptRunViewerResponse;

            const scriptRunFilesResponse = handleScriptRunFilesPage(url);
            if (scriptRunFilesResponse) return scriptRunFilesResponse;

            // Public static files
            const publicFilesResponse = handlePublicFiles(url);
            if (publicFilesResponse) return publicFilesResponse;

            // 404
            return new Response(null, { status: 404 });
        },
        websocket: websocketHandlers
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
