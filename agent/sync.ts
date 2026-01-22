// State Sync Service - Bridges bot client WebSocket to filesystem state
// Receives world state from bot client, writes to files
// Reads action queue from files, sends to bot client

import { mkdir, writeFile, readFile, watch } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const AGENT_PORT = parseInt(process.env.AGENT_PORT || '7780');
const STATE_BASE_DIR = join(import.meta.dir, 'agent-state');

// Get state directory for a specific bot username
function getStateDir(username: string): string {
    return join(STATE_BASE_DIR, username);
}

// Types for world state (matches BotSDK.ts)
interface PlayerState {
    name: string;
    combatLevel: number;
    x: number;
    z: number;
    worldX: number;
    worldZ: number;
    level: number;
    runEnergy: number;
    runWeight: number;
}

interface SkillState {
    name: string;
    level: number;
    baseLevel: number;
    experience: number;
}

interface InventoryItem {
    slot: number;
    id: number;
    name: string;
    count: number;
}

interface NearbyNpc {
    index: number;
    name: string;
    combatLevel: number;
    x: number;
    z: number;
    distance: number;
    options: string[];
}

interface NearbyPlayer {
    index: number;
    name: string;
    combatLevel: number;
    x: number;
    z: number;
    distance: number;
}

interface GroundItem {
    id: number;
    name: string;
    count: number;
    x: number;
    z: number;
    distance: number;
}

interface NearbyLoc {
    id: number;
    name: string;
    x: number;
    z: number;
    distance: number;
    options: string[];
}

interface GameMessage {
    type: number;
    text: string;
    sender: string;
}

interface DialogState {
    isOpen: boolean;
    options: Array<{ index: number; text: string }>;
    isWaiting: boolean;
}

interface InterfaceState {
    isOpen: boolean;
    interfaceId: number;
    options: Array<{ index: number; text: string }>;
}

interface ShopItem {
    slot: number;
    id: number;
    name: string;
    count: number;
}

interface ShopState {
    isOpen: boolean;
    title: string;
    shopItems: ShopItem[];
    playerItems: ShopItem[];
}

interface BotWorldState {
    tick: number;
    inGame: boolean;
    player: PlayerState | null;
    skills: SkillState[];
    inventory: InventoryItem[];
    equipment: InventoryItem[];
    nearbyNpcs: NearbyNpc[];
    nearbyPlayers: NearbyPlayer[];
    nearbyLocs: NearbyLoc[];
    groundItems: GroundItem[];
    gameMessages: GameMessage[];
    dialog: DialogState;
    interface: InterfaceState;
    shop: ShopState;
    modalOpen: boolean;
    modalInterface: number;
}

// Action types
type BotAction =
    | { type: 'none'; reason: string }
    | { type: 'wait'; reason: string; ticks?: number }
    | { type: 'talkToNpc'; npcIndex: number; reason: string }
    | { type: 'interactNpc'; npcIndex: number; optionIndex: number; reason: string }
    | { type: 'clickDialogOption'; optionIndex: number; reason: string }
    | { type: 'clickInterfaceOption'; optionIndex: number; reason: string }
    | { type: 'acceptCharacterDesign'; reason: string }
    | { type: 'skipTutorial'; reason: string }
    | { type: 'walkTo'; x: number; z: number; running?: boolean; reason: string }
    | { type: 'useInventoryItem'; slot: number; optionIndex: number; reason: string }
    | { type: 'dropItem'; slot: number; reason: string }
    | { type: 'pickupItem'; x: number; z: number; itemId: number; reason: string }
    | { type: 'interactGroundItem'; x: number; z: number; itemId: number; optionIndex: number; reason: string }
    | { type: 'interactLoc'; x: number; z: number; locId: number; optionIndex: number; reason: string }
    | { type: 'shopBuy'; slot: number; amount: number; reason: string }
    | { type: 'shopSell'; slot: number; amount: number; reason: string }
    | { type: 'closeShop'; reason: string }
    | { type: 'setCombatStyle'; style: number; reason: string }
    | { type: 'useItemOnItem'; sourceSlot: number; targetSlot: number; reason: string }
    | { type: 'useItemOnLoc'; itemSlot: number; x: number; z: number; locId: number; reason: string }
    | { type: 'say'; message: string; reason: string };

// Action queue entry
interface QueuedAction {
    id: string;
    action: BotAction;
    timestamp: number;
    status: 'pending' | 'sent' | 'completed' | 'failed';
    result?: { success: boolean; message: string };
    completedAt?: number;
}

// Action queue file structure
interface ActionQueue {
    pending: QueuedAction[];
    current: QueuedAction | null;
    completed: QueuedAction[];
}

// Status file structure
interface SyncStatus {
    connected: boolean;
    clientId: string | null;
    lastUpdate: number;
    tick: number;
    inGame: boolean;
    playerName: string | null;
    lastActionId: string | null;
    lastActionResult: { success: boolean; message: string } | null;
}

// Message types
interface ClientMessage {
    type: 'state' | 'actionResult' | 'setGoal' | 'connected';
    state?: BotWorldState;
    formattedState?: string;
    result?: { success: boolean; message: string };
    goal?: string;
    clientId?: string;
}

interface AgentMessage {
    type: 'action' | 'thinking' | 'error' | 'status';
    action?: BotAction;
    thinking?: string;
    error?: string;
    status?: string;
}

// Bot session tracking - keyed by username
interface BotSession {
    ws: any;
    clientId: string;
    username: string;
    lastState: BotWorldState | null;
    actionQueue: ActionQueue;
    lastActionTick: number;
    lastActionTime: number;  // Wall-clock time of last action (ms)
}

const botSessions = new Map<string, BotSession>();

// Map WebSocket to username for quick lookup on disconnect
const wsToUsername = new Map<any, string>();

// Get or create session for a username
function getSession(username: string): BotSession | undefined {
    return botSessions.get(username);
}

// Legacy compatibility - get first connected session (for single-bot use)
function getFirstSession(): BotSession | undefined {
    const first = botSessions.values().next();
    return first.done ? undefined : first.value;
}

// Initialize base state directory
async function initBaseStateDir() {
    if (!existsSync(STATE_BASE_DIR)) {
        await mkdir(STATE_BASE_DIR, { recursive: true });
    }
}

// Initialize state directory for a specific bot
async function initStateDirForBot(username: string) {
    const stateDir = getStateDir(username);
    if (!existsSync(stateDir)) {
        await mkdir(stateDir, { recursive: true });
    }

    // Initialize action queue file
    const actionsFile = join(stateDir, 'actions.json');
    if (!existsSync(actionsFile)) {
        await writeFile(actionsFile, JSON.stringify({ pending: [], current: null, completed: [] }, null, 2));
    }

    // Initialize status file
    await writeStatusForBot(username, {
        connected: false,
        clientId: null,
        lastUpdate: Date.now(),
        tick: 0,
        inGame: false,
        playerName: null,
        lastActionId: null,
        lastActionResult: null
    });
}

// Write status file for a specific bot
async function writeStatusForBot(username: string, status: SyncStatus) {
    const stateDir = getStateDir(username);
    await writeFile(join(stateDir, 'status.json'), JSON.stringify(status, null, 2));
}

// Write state to files for a specific bot
async function writeStateToFilesForBot(username: string, session: BotSession, state: BotWorldState, formattedState: string) {
    const stateDir = getStateDir(username);
    const writes: Promise<void>[] = [];

    // Full formatted state as markdown
    writes.push(writeFile(join(stateDir, 'world.md'), formattedState));

    // Player state
    writes.push(writeFile(join(stateDir, 'player.json'), JSON.stringify(state.player, null, 2)));

    // Skills
    writes.push(writeFile(join(stateDir, 'skills.json'), JSON.stringify(state.skills, null, 2)));

    // Inventory (with slot info for actions)
    writes.push(writeFile(join(stateDir, 'inventory.json'), JSON.stringify(state.inventory, null, 2)));

    // Equipment
    writes.push(writeFile(join(stateDir, 'equipment.json'), JSON.stringify(state.equipment, null, 2)));

    // Nearby NPCs
    writes.push(writeFile(join(stateDir, 'npcs.json'), JSON.stringify(state.nearbyNpcs, null, 2)));

    // Nearby players
    writes.push(writeFile(join(stateDir, 'players.json'), JSON.stringify(state.nearbyPlayers, null, 2)));

    // Nearby locations (interactable objects)
    writes.push(writeFile(join(stateDir, 'locations.json'), JSON.stringify(state.nearbyLocs, null, 2)));

    // Ground items
    writes.push(writeFile(join(stateDir, 'ground-items.json'), JSON.stringify(state.groundItems, null, 2)));

    // Game messages
    writes.push(writeFile(join(stateDir, 'messages.json'), JSON.stringify(state.gameMessages, null, 2)));

    // Dialog state
    writes.push(writeFile(join(stateDir, 'dialog.json'), JSON.stringify(state.dialog, null, 2)));

    // Interface state (crafting menus)
    if (state.interface) {
        writes.push(writeFile(join(stateDir, 'interface.json'), JSON.stringify(state.interface, null, 2)));
    }

    // Shop state
    if (state.shop) {
        writes.push(writeFile(join(stateDir, 'shop.json'), JSON.stringify(state.shop, null, 2)));
    }

    // Combat style state
    if (state.combatStyle) {
        writes.push(writeFile(join(stateDir, 'combatStyle.json'), JSON.stringify(state.combatStyle, null, 2)));
    }

    // Status update
    writes.push(writeStatusForBot(username, {
        connected: session.ws !== null,
        clientId: session.clientId,
        lastUpdate: Date.now(),
        tick: state.tick,
        inGame: state.inGame,
        playerName: state.player?.name || null,
        lastActionId: session.actionQueue.current?.id || null,
        lastActionResult: session.actionQueue.current?.result || null
    }));

    await Promise.all(writes);
}

// Read action queue from file for a specific bot
async function readActionQueueForBot(username: string): Promise<ActionQueue> {
    try {
        const stateDir = getStateDir(username);
        const data = await readFile(join(stateDir, 'actions.json'), 'utf-8');
        return JSON.parse(data);
    } catch {
        return { pending: [], current: null, completed: [] };
    }
}

// Write action queue to file for a specific bot
async function writeActionQueueForBot(username: string, queue: ActionQueue) {
    const stateDir = getStateDir(username);
    // Keep last 10 completed actions so CLI can poll for results
    // Older completed actions are trimmed to prevent unbounded growth
    if (queue.completed.length > 10) {
        queue.completed = queue.completed.slice(-10);
    }
    await writeFile(join(stateDir, 'actions.json'), JSON.stringify(queue, null, 2));
}

// Minimum ticks between actions (gives game time to respond)
const MIN_TICKS_BETWEEN_ACTIONS = 2;
const MIN_MS_BETWEEN_ACTIONS = 1200;  // Fallback: ~2 game ticks worth of time

// Process pending actions for a specific bot session
async function processPendingActionsForBot(username: string, session: BotSession) {
    if (!session.ws) return;

    // Read latest queue from file (CLI may have added new actions)
    session.actionQueue = await readActionQueueForBot(username);

    // If we have a current action in progress, don't send another
    if (session.actionQueue.current && session.actionQueue.current.status === 'sent') {
        return;
    }

    // Enforce minimum delay between actions (tick-based or time-based fallback)
    const currentTick = session.lastState?.tick || 0;
    const now = Date.now();
    const tickDelayOk = currentTick > 0 && (currentTick - session.lastActionTick >= MIN_TICKS_BETWEEN_ACTIONS);
    const timeDelayOk = (now - session.lastActionTime) >= MIN_MS_BETWEEN_ACTIONS;

    // Allow action if either tick delay or time delay is satisfied
    if (!tickDelayOk && !timeDelayOk) {
        return;
    }

    // Get next pending action
    if (session.actionQueue.pending.length === 0) return;

    const nextAction = session.actionQueue.pending.shift()!;
    nextAction.status = 'sent';
    session.actionQueue.current = nextAction;
    session.lastActionTick = currentTick;
    session.lastActionTime = now;

    // Send to client
    sendToSession(session, {
        type: 'action',
        action: nextAction.action
    });

    console.log(`[Sync] [${username}] Sent action: ${nextAction.action.type} (${nextAction.id}) at tick ${currentTick}`);

    // Update queue file
    await writeActionQueueForBot(username, session.actionQueue);
}

// Send message to a specific session
function sendToSession(session: BotSession, message: AgentMessage) {
    if (session.ws) {
        try {
            session.ws.send(JSON.stringify(message));
        } catch (error) {
            console.error(`[Sync] [${session.username}] Failed to send to client:`, error);
        }
    }
}

// Extended client message type with username
interface ClientMessageExtended extends ClientMessage {
    username?: string;
}

// Handle messages from bot client
async function handleClientMessage(ws: any, data: string) {
    let message: ClientMessageExtended;
    try {
        message = JSON.parse(data);
    } catch {
        console.error('[Sync] Invalid JSON from client');
        return;
    }

    if (message.type === 'connected') {
        // Extract username from message or clientId, default to 'default'
        const username = message.username || extractUsernameFromClientId(message.clientId) || 'default';
        const clientId = message.clientId || `bot-${Date.now()}`;

        // Initialize state directory for this bot
        await initStateDirForBot(username);

        // Create or update session for this username
        const existingSession = botSessions.get(username);
        if (existingSession && existingSession.ws !== ws) {
            // Close old connection if different
            try {
                existingSession.ws?.close();
            } catch {}
        }

        // Clear any stuck current action from previous session
        // This prevents agents from getting stuck if an action was in-flight when they disconnected
        const existingQueue = existingSession?.actionQueue || { pending: [], current: null, completed: [] };
        if (existingQueue.current) {
            console.log(`[Sync] [${username}] Clearing stuck current action on reconnect: ${existingQueue.current.action.type} (${existingQueue.current.id})`);
            existingQueue.current = null;
        }

        const session: BotSession = {
            ws,
            clientId,
            username,
            lastState: existingSession?.lastState || null,
            actionQueue: existingQueue,
            lastActionTick: 0,  // Reset to allow immediate action processing
            lastActionTime: 0   // Reset to allow immediate action processing
        };

        botSessions.set(username, session);
        wsToUsername.set(ws, username);

        console.log(`[Sync] Bot client connected: ${clientId} (username: ${username})`);

        sendToSession(session, {
            type: 'status',
            status: 'Connected to sync service'
        });

        await writeStatusForBot(username, {
            connected: true,
            clientId,
            lastUpdate: Date.now(),
            tick: 0,
            inGame: false,
            playerName: null,
            lastActionId: null,
            lastActionResult: null
        });
        return;
    }

    // For other messages, look up the session by WebSocket
    const username = wsToUsername.get(ws);
    if (!username) {
        console.error('[Sync] Received message from unknown WebSocket');
        return;
    }

    const session = botSessions.get(username);
    if (!session) {
        console.error(`[Sync] No session found for username: ${username}`);
        return;
    }

    if (message.type === 'actionResult') {
        if (session.actionQueue.current && message.result) {
            session.actionQueue.current.status = message.result.success ? 'completed' : 'failed';
            session.actionQueue.current.result = message.result;
            session.actionQueue.current.completedAt = Date.now();

            console.log(`[Sync] [${username}] Action ${session.actionQueue.current.id} ${session.actionQueue.current.status}: ${message.result.message}`);

            // Move to completed
            session.actionQueue.completed.push(session.actionQueue.current);
            session.actionQueue.current = null;

            await writeActionQueueForBot(username, session.actionQueue);
        }
        return;
    }

    if (message.type === 'state' && message.state) {
        session.lastState = message.state;

        // Write state to files
        await writeStateToFilesForBot(username, session, message.state, message.formattedState || '');

        // Check for pending actions to send
        await processPendingActionsForBot(username, session);
    }
}

// Extract username from clientId if it contains one (format: bot-timestamp-random or username-timestamp-random)
function extractUsernameFromClientId(clientId: string | undefined): string | null {
    if (!clientId) return null;
    // If clientId starts with 'bot-', it's the default format, return null
    if (clientId.startsWith('bot-')) return null;
    // Otherwise, the first part before '-' might be the username
    const parts = clientId.split('-');
    if (parts.length >= 1 && parts[0] && !parts[0].match(/^\d+$/)) {
        return parts[0];
    }
    return null;
}

// Poll pending actions periodically (every 500ms) to avoid relying solely on state messages
async function pollPendingActions() {
    for (const [username, session] of botSessions) {
        if (session.ws) {
            await processPendingActionsForBot(username, session);
        }
    }
}

// Start polling loop
setInterval(pollPendingActions, 500);

// Start WebSocket server
console.log(`[Sync] Starting State Sync Service on port ${AGENT_PORT}...`);

await initBaseStateDir();

const server = Bun.serve({
    port: AGENT_PORT,
    fetch(req, server) {
        const url = new URL(req.url);

        // Upgrade WebSocket connections
        if (req.headers.get('upgrade') === 'websocket') {
            const upgraded = server.upgrade(req);
            if (upgraded) return undefined;
            return new Response('WebSocket upgrade failed', { status: 400 });
        }

        // Serve status page - now shows all connected bots
        if (url.pathname === '/' || url.pathname === '/status') {
            const bots: Record<string, any> = {};
            for (const [username, session] of botSessions) {
                bots[username] = {
                    connected: session.ws !== null,
                    clientId: session.clientId,
                    stateDir: getStateDir(username),
                    lastTick: session.lastState?.tick || 0,
                    inGame: session.lastState?.inGame || false,
                    player: session.lastState?.player?.name || null,
                    pendingActions: session.actionQueue.pending.length,
                    currentAction: session.actionQueue.current?.action.type || null
                };
            }
            return new Response(JSON.stringify({
                status: 'running',
                connectedBots: botSessions.size,
                bots
            }, null, 2), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response('Not found', { status: 404 });
    },
    websocket: {
        open(ws) {
            console.log('[Sync] WebSocket connection opened');
        },
        message(ws, message) {
            handleClientMessage(ws, message.toString());
        },
        close(ws) {
            const username = wsToUsername.get(ws);
            if (username) {
                const session = botSessions.get(username);
                console.log(`[Sync] Bot client disconnected: ${session?.clientId} (username: ${username})`);

                // Mark session as disconnected but keep it for state persistence
                if (session) {
                    session.ws = null;

                    // Update status
                    writeStatusForBot(username, {
                        connected: false,
                        clientId: session.clientId,
                        lastUpdate: Date.now(),
                        tick: session.lastState?.tick || 0,
                        inGame: false,
                        playerName: null,
                        lastActionId: null,
                        lastActionResult: null
                    });
                }

                wsToUsername.delete(ws);
            }
        }
    }
});

console.log(`[Sync] State Sync Service running at http://localhost:${AGENT_PORT}`);
console.log(`[Sync] State files will be written to: ${STATE_BASE_DIR}/<username>/`);
console.log('[Sync] Waiting for bot clients to connect...');
console.log('[Sync] Supports multiple bots - each bot identified by username in connect message');
