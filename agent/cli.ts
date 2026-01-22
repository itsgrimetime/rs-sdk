#!/usr/bin/env bun
// rsbot CLI - Command line tool for controlling the RuneScape bot
// Reads state from files, queues actions via actions.json
// Supports multiple bots via BOT_USERNAME env var or --bot flag

import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Get state directory - uses current working directory by default
// Can be overridden with --bot flag or BOT_USERNAME env var
function getStateDir(): { dir: string; botName: string | null } {
    const args = process.argv.slice(2);
    const botFlagIndex = args.indexOf('--bot');

    // If --bot flag provided, use agent-state/<bot>/
    if (botFlagIndex !== -1 && args[botFlagIndex + 1]) {
        const botName = args[botFlagIndex + 1];
        return {
            dir: join(import.meta.dir, 'agent-state', botName),
            botName
        };
    }

    // If BOT_USERNAME env var set, use agent-state/<BOT_USERNAME>/
    if (process.env.BOT_USERNAME) {
        return {
            dir: join(import.meta.dir, 'agent-state', process.env.BOT_USERNAME),
            botName: process.env.BOT_USERNAME
        };
    }

    // Default: use current working directory (for when agent runs from bot's state dir)
    return { dir: process.cwd(), botName: null };
}

const { dir: STATE_DIR, botName: BOT_USERNAME } = getStateDir();
const STATE_BASE_DIR = join(import.meta.dir, 'agent-state');

// Generate unique action ID
function generateId(): string {
    return Math.random().toString(36).substring(2, 10);
}

// Read JSON file
async function readJson<T>(filename: string): Promise<T | null> {
    const filepath = join(STATE_DIR, filename);
    if (!existsSync(filepath)) {
        return null;
    }
    try {
        const data = await readFile(filepath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${filename}:`, error);
        return null;
    }
}

// Read text file
async function readText(filename: string): Promise<string | null> {
    const filepath = join(STATE_DIR, filename);
    if (!existsSync(filepath)) {
        return null;
    }
    try {
        return await readFile(filepath, 'utf-8');
    } catch (error) {
        console.error(`Error reading ${filename}:`, error);
        return null;
    }
}

// Action queue types
interface QueuedAction {
    id: string;
    action: any;
    timestamp: number;
    status: 'pending' | 'sent' | 'completed' | 'failed';
    result?: { success: boolean; message: string };
    completedAt?: number;
}

interface ActionQueue {
    pending: QueuedAction[];
    current: QueuedAction | null;
    completed: QueuedAction[];
}

// Queue an action
async function queueAction(action: any): Promise<string> {
    const filepath = join(STATE_DIR, 'actions.json');

    let queue: ActionQueue = { pending: [], current: null, completed: [] };
    if (existsSync(filepath)) {
        try {
            const data = await readFile(filepath, 'utf-8');
            queue = JSON.parse(data);
        } catch { }
    }

    const id = generateId();
    const queuedAction: QueuedAction = {
        id,
        action,
        timestamp: Date.now(),
        status: 'pending'
    };

    queue.pending.push(queuedAction);
    await writeFile(filepath, JSON.stringify(queue, null, 2));

    return id;
}

// Wait for action to complete
async function waitForAction(actionId: string, timeout: number = 30000): Promise<QueuedAction | null> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const queue = await readJson<ActionQueue>('actions.json');
        if (!queue) {
            await Bun.sleep(100);
            continue;
        }

        // Check if it's the current action and completed
        if (queue.current?.id === actionId && (queue.current.status === 'completed' || queue.current.status === 'failed')) {
            return queue.current;
        }

        // Check completed list
        const completed = queue.completed.find(a => a.id === actionId);
        if (completed) {
            return completed;
        }

        await Bun.sleep(100);
    }

    return null;
}

// Format inventory items nicely
function formatInventory(items: any[]): string {
    if (!items || items.length === 0) {
        return 'Inventory is empty';
    }

    const lines: string[] = ['Inventory:'];
    for (const item of items) {
        // Format options with their indices like [1:Use, 2:Wield, 5:Drop]
        let opts = '';
        if (item.optionsWithIndex && item.optionsWithIndex.length > 0) {
            const optStrs = item.optionsWithIndex.map((o: any) => `${o.opIndex}:${o.text}`);
            opts = ` [${optStrs.join(', ')}]`;
        } else if (item.options && item.options.length > 0) {
            // Fallback to old format if optionsWithIndex not available
            opts = ` [${item.options.join(', ')}]`;
        }
        lines.push(`  [${item.slot}] ${item.name} x${item.count} (id: ${item.id})${opts}`);
    }
    return lines.join('\n');
}

// Format NPCs nicely
function formatNpcs(npcs: any[]): string {
    if (!npcs || npcs.length === 0) {
        return 'No NPCs nearby';
    }

    const lines: string[] = ['Nearby NPCs:'];
    for (const npc of npcs) {
        const lvl = npc.combatLevel > 0 ? ` (Lvl ${npc.combatLevel})` : '';
        // Use optionsWithIndex to show actual op indices (1-5)
        // Format: [1:Talk-to, 3:Trade] so consumers can use the correct index
        let opts = '';
        if (npc.optionsWithIndex && npc.optionsWithIndex.length > 0) {
            const optStrs = npc.optionsWithIndex.map((o: any) => `${o.opIndex}:${o.text}`);
            opts = ` [${optStrs.join(', ')}]`;
        } else if (npc.options && npc.options.length > 0) {
            // Fallback to old format if optionsWithIndex not available
            opts = ` [${npc.options.join(', ')}]`;
        }
        lines.push(`  #${npc.index}: ${npc.name}${lvl} - ${npc.distance} tiles${opts}`);
    }
    return lines.join('\n');
}

// Format locations nicely
function formatLocations(locs: any[]): string {
    if (!locs || locs.length === 0) {
        return 'No interactable objects nearby';
    }

    const lines: string[] = ['Nearby Objects:'];
    for (const loc of locs) {
        // Use optionsWithIndex to show actual op indices (1-5)
        // Format: [1:Open, 2:Close] so consumers can use the correct index
        let opts = '';
        if (loc.optionsWithIndex && loc.optionsWithIndex.length > 0) {
            const optStrs = loc.optionsWithIndex.map((o: any) => `${o.opIndex}:${o.text}`);
            opts = ` [${optStrs.join(', ')}]`;
        } else if (loc.options && loc.options.length > 0) {
            // Fallback to old format if optionsWithIndex not available
            opts = ` [${loc.options.join(', ')}]`;
        }
        lines.push(`  ${loc.name} at (${loc.x}, ${loc.z}) - ${loc.distance} tiles, id: ${loc.id}${opts}`);
    }
    return lines.join('\n');
}

// Format ground items nicely
function formatGroundItems(items: any[]): string {
    if (!items || items.length === 0) {
        return 'No ground items nearby';
    }

    const lines: string[] = ['Ground Items:'];
    for (const item of items) {
        lines.push(`  ${item.name} x${item.count} at (${item.x}, ${item.z}) - ${item.distance} tiles (id: ${item.id})`);
    }
    return lines.join('\n');
}

// Format status nicely
function formatStatus(status: any): string {
    const botLabel = BOT_USERNAME || 'current directory';
    if (!status) {
        return `Status for '${botLabel}': Unknown (sync service may not be running or bot not connected)`;
    }

    const lines: string[] = [
        `Status (${botLabel}):`,
        `  Connected: ${status.connected ? 'Yes' : 'No'}`,
        `  Client ID: ${status.clientId || 'N/A'}`,
        `  In Game: ${status.inGame ? 'Yes' : 'No'}`,
        `  Player: ${status.playerName || 'N/A'}`,
        `  Tick: ${status.tick}`,
        `  Last Update: ${new Date(status.lastUpdate).toLocaleTimeString()}`
    ];

    if (status.lastActionId) {
        lines.push(`  Last Action: ${status.lastActionId}`);
        if (status.lastActionResult) {
            lines.push(`  Result: ${status.lastActionResult.success ? 'Success' : 'Failed'} - ${status.lastActionResult.message}`);
        }
    }

    return lines.join('\n');
}

// Format player info
function formatPlayer(player: any): string {
    if (!player) {
        return 'Player: Not logged in';
    }

    return [
        `Player: ${player.name}`,
        `  Combat Level: ${player.combatLevel}`,
        `  Position: (${player.worldX}, ${player.worldZ})`,
        `  Map Level: ${player.level}`,
        `  Run Energy: ${player.runEnergy}%`,
        `  Weight: ${player.runWeight}kg`
    ].join('\n');
}

// Format dialog state
function formatDialog(dialog: any): string {
    if (!dialog) {
        return 'Dialog: None';
    }

    if (!dialog.isOpen) {
        return 'Dialog: Closed';
    }

    const lines: string[] = ['Dialog: OPEN'];
    if (dialog.isWaiting) {
        lines.push('  (Waiting for server response...)');
    } else if (dialog.options && dialog.options.length > 0) {
        lines.push('  Options:');
        for (const opt of dialog.options) {
            lines.push(`    ${opt.index}. ${opt.text}`);
        }
    } else {
        lines.push('  (Click to continue - use: rsbot action dialog 0)');
    }

    return lines.join('\n');
}

// Print help
function printHelp() {
    console.log(`
rsbot - RuneScape Bot CLI (Multi-Bot Support)

USAGE:
  rsbot [--bot <name>] <command> [args...]

  By default, reads state from current working directory.
  Use --bot <name> or BOT_USERNAME env var to specify a bot by name.

MULTI-BOT COMMANDS:
  rsbot bots               List all available bots
  rsbot --bot mybot state  Get state for bot named 'mybot'

STATE COMMANDS:
  rsbot state              Full world state (markdown)
  rsbot status             Connection and sync status
  rsbot player             Player info
  rsbot inventory          Inventory contents with slots
  rsbot npcs               Nearby NPCs with indices
  rsbot locations          Nearby interactable objects
  rsbot ground             Ground items
  rsbot dialog             Current dialog state
  rsbot messages           Recent game messages
  rsbot skills             Skill levels
  rsbot shop               Shop state (if open)

ACTION COMMANDS:
  rsbot action walk <x> <z> [--run]           Walk to coordinates
  rsbot action talk <npc_index>               Talk to NPC (option 1)
  rsbot action interact-npc <index> <option>  Interact with NPC
  rsbot action interact-loc <x> <z> <id> <option>  Interact with object
  rsbot action pickup <x> <z> <item_id>       Pick up ground item
  rsbot action use-item <slot> <option>       Use inventory item
  rsbot action item-on-item <src> <tgt>       Use item on another item
  rsbot action item-on-loc <slot> <x> <z> <id>  Use item on world object
  rsbot action drop <slot>                    Drop item from inventory
  rsbot action dialog <option>                Click dialog (0=continue, 1-5=choice)
  rsbot action shop-buy <slot> [amount]       Buy item from shop (amount: 1/5/10)
  rsbot action shop-sell <slot> [amount]      Sell inventory item (amount: 1/5/10)
  rsbot action design                         Accept character design
  rsbot action skip-tutorial                  Skip tutorial (talk to guide/click dialogs)
  rsbot action wait [ticks]                   Wait (do nothing)
  rsbot action say <message>                  Send public chat message

UTILITY COMMANDS:
  rsbot wait [action_id]   Wait for action to complete
  rsbot queue              Show action queue
  rsbot clear              Clear pending actions
  rsbot help               Show this help

EXAMPLES:
  rsbot bots                                  # List all bots
  rsbot --bot bot1 npcs                       # List NPCs for bot1
  rsbot status                                # Status from current directory
  cd agent-state/mybot && rsbot state         # Run from bot's directory

Current state directory: ${STATE_DIR}
`);
}

// Main CLI handler
async function main() {
    let args = process.argv.slice(2);

    // Filter out --bot and its value from args for command processing
    const botFlagIndex = args.indexOf('--bot');
    if (botFlagIndex !== -1) {
        args = [...args.slice(0, botFlagIndex), ...args.slice(botFlagIndex + 2)];
    }

    if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
        printHelp();
        return;
    }

    const command = args[0];

    // List all available bots
    if (command === 'bots') {
        if (!existsSync(STATE_BASE_DIR)) {
            console.log('No bots found. State directory does not exist yet.');
            return;
        }
        try {
            const entries = await readdir(STATE_BASE_DIR, { withFileTypes: true });
            const bots = entries.filter(e => e.isDirectory()).map(e => e.name);
            if (bots.length === 0) {
                console.log('No bots found.');
            } else {
                console.log(`Available bots (${bots.length}):`);
                for (const bot of bots) {
                    const statusPath = join(STATE_BASE_DIR, bot, 'status.json');
                    let status = 'unknown';
                    let player = 'N/A';
                    if (existsSync(statusPath)) {
                        try {
                            const data = JSON.parse(await readFile(statusPath, 'utf-8'));
                            status = data.connected ? 'connected' : 'disconnected';
                            player = data.playerName || 'N/A';
                        } catch {}
                    }
                    console.log(`  ${bot}: ${status} (player: ${player})`);
                }
            }
        } catch (e) {
            console.error('Error listing bots:', e);
        }
        return;
    }

    // State reading commands
    switch (command) {
        case 'state': {
            const state = await readText('world.md');
            console.log(state || 'No state available. Is the sync service running?');
            return;
        }

        case 'status': {
            const status = await readJson('status.json');
            console.log(formatStatus(status));
            return;
        }

        case 'player': {
            const player = await readJson('player.json');
            console.log(formatPlayer(player));
            return;
        }

        case 'inventory': {
            const items = await readJson<any[]>('inventory.json');
            console.log(formatInventory(items || []));
            return;
        }

        case 'npcs': {
            const npcs = await readJson<any[]>('npcs.json');
            console.log(formatNpcs(npcs || []));
            return;
        }

        case 'locations':
        case 'locs':
        case 'objects': {
            const locs = await readJson<any[]>('locations.json');
            console.log(formatLocations(locs || []));
            return;
        }

        case 'ground':
        case 'items': {
            const items = await readJson<any[]>('ground-items.json');
            console.log(formatGroundItems(items || []));
            return;
        }

        case 'dialog': {
            const dialog = await readJson('dialog.json');
            console.log(formatDialog(dialog));
            return;
        }

        case 'messages': {
            const messages = await readJson<any[]>('messages.json');
            if (!messages || messages.length === 0) {
                console.log('No recent messages');
            } else {
                console.log('Recent Messages:');
                for (const msg of messages) {
                    const cleanText = msg.text.replace(/@\w+@/g, '');
                    if (msg.sender) {
                        console.log(`  ${msg.sender}: ${cleanText}`);
                    } else {
                        console.log(`  ${cleanText}`);
                    }
                }
            }
            return;
        }

        case 'skills': {
            const skills = await readJson<any[]>('skills.json');
            if (!skills) {
                console.log('Skills: Not available');
            } else {
                console.log('Skills:');
                for (const skill of skills) {
                    console.log(`  ${skill.name}: ${skill.level}/${skill.baseLevel} (${skill.experience.toLocaleString()} xp)`);
                }
            }
            return;
        }

        case 'shop': {
            const shop = await readJson<any>('shop.json');
            if (!shop || !shop.isOpen) {
                console.log('Shop: Not open');
            } else {
                console.log(`Shop: ${shop.title || 'Open'}`);
                console.log('');
                console.log('Shop Items (to buy):');
                if (!shop.shopItems || shop.shopItems.length === 0) {
                    console.log('  (Empty)');
                } else {
                    for (const item of shop.shopItems) {
                        console.log(`  [${item.slot}] ${item.name} x${item.count} (id: ${item.id})`);
                    }
                }
                console.log('');
                console.log('Your Items (to sell):');
                if (!shop.playerItems || shop.playerItems.length === 0) {
                    console.log('  (Empty)');
                } else {
                    for (const item of shop.playerItems) {
                        console.log(`  [${item.slot}] ${item.name} x${item.count} (id: ${item.id})`);
                    }
                }
            }
            return;
        }

        case 'combat':
        case 'combat-style':
        case 'style': {
            const combatStyle = await readJson<any>('combatStyle.json');
            if (!combatStyle) {
                console.log('Combat Style: Not available');
            } else {
                console.log(`Weapon: ${combatStyle.weaponName || 'Unarmed'}`);
                console.log(`Current Style: ${combatStyle.currentStyle}`);
                console.log('');
                console.log('Available Styles:');
                if (combatStyle.styles && combatStyle.styles.length > 0) {
                    for (const style of combatStyle.styles) {
                        const selected = style.index === combatStyle.currentStyle ? ' <-- SELECTED' : '';
                        console.log(`  [${style.index}] ${style.name} (${style.type}) - Trains: ${style.trainedSkill}${selected}`);
                    }
                } else {
                    console.log('  (None available)');
                }
            }
            return;
        }

        case 'queue': {
            const queue = await readJson<ActionQueue>('actions.json');
            if (!queue) {
                console.log('Action queue: Empty');
                return;
            }

            console.log('Action Queue:');
            if (queue.current) {
                console.log(`  Current: ${queue.current.action.type} (${queue.current.id}) - ${queue.current.status}`);
            } else {
                console.log('  Current: None');
            }
            console.log(`  Pending: ${queue.pending.length}`);
            for (const a of queue.pending) {
                console.log(`    - ${a.action.type} (${a.id})`);
            }
            console.log(`  Completed: ${queue.completed.length} (last 5):`);
            for (const a of queue.completed.slice(-5)) {
                const result = a.result ? (a.result.success ? 'OK' : 'FAIL') : '?';
                console.log(`    - ${a.action.type} (${a.id}): ${result}`);
            }
            return;
        }

        case 'clear': {
            const filepath = join(STATE_DIR, 'actions.json');
            const queue: ActionQueue = { pending: [], current: null, completed: [] };
            await writeFile(filepath, JSON.stringify(queue, null, 2));
            console.log('Action queue cleared');
            return;
        }

        case 'wait': {
            // Wait for last action or specific action
            const actionId = args[1];
            if (actionId) {
                console.log(`Waiting for action ${actionId}...`);
                const result = await waitForAction(actionId);
                if (result) {
                    console.log(`Action ${result.id}: ${result.status}`);
                    if (result.result) {
                        console.log(`  ${result.result.success ? 'Success' : 'Failed'}: ${result.result.message}`);
                    }
                } else {
                    console.log('Action not found or timed out');
                }
            } else {
                // Wait for any current/recent action
                const queue = await readJson<ActionQueue>('actions.json');
                if (queue?.current) {
                    console.log(`Waiting for current action ${queue.current.id}...`);
                    const result = await waitForAction(queue.current.id);
                    if (result) {
                        console.log(`Action ${result.id}: ${result.status}`);
                        if (result.result) {
                            console.log(`  ${result.result.success ? 'Success' : 'Failed'}: ${result.result.message}`);
                        }
                    } else {
                        console.log('Timed out waiting for action');
                    }
                } else {
                    console.log('No action in progress');
                }
            }
            return;
        }

        case 'action': {
            const actionType = args[1];
            if (!actionType) {
                console.log('Usage: rsbot action <type> [args...]');
                console.log('Run "rsbot help" for available action types');
                return;
            }

            let action: any;
            const reason = `CLI action: ${args.slice(1).join(' ')}`;

            switch (actionType) {
                case 'walk': {
                    const x = parseInt(args[2]);
                    const z = parseInt(args[3]);
                    const running = args.includes('--run') || args.includes('-r');
                    if (isNaN(x) || isNaN(z)) {
                        console.log('Usage: rsbot action walk <x> <z> [--run]');
                        return;
                    }
                    action = { type: 'walkTo', x, z, running, reason };
                    break;
                }

                case 'talk': {
                    const npcIndex = parseInt(args[2]);
                    if (isNaN(npcIndex)) {
                        console.log('Usage: rsbot action talk <npc_index>');
                        return;
                    }
                    action = { type: 'talkToNpc', npcIndex, reason };
                    break;
                }

                case 'interact-npc': {
                    const npcIndex = parseInt(args[2]);
                    const optionIndex = parseInt(args[3]);
                    if (isNaN(npcIndex) || isNaN(optionIndex)) {
                        console.log('Usage: rsbot action interact-npc <npc_index> <option_index>');
                        return;
                    }
                    action = { type: 'interactNpc', npcIndex, optionIndex, reason };
                    break;
                }

                case 'interact-loc':
                case 'loc': {
                    const x = parseInt(args[2]);
                    const z = parseInt(args[3]);
                    const locId = parseInt(args[4]);
                    const optionIndex = parseInt(args[5]) || 1;
                    if (isNaN(x) || isNaN(z) || isNaN(locId)) {
                        console.log('Usage: rsbot action interact-loc <x> <z> <loc_id> [option_index]');
                        return;
                    }
                    action = { type: 'interactLoc', x, z, locId, optionIndex, reason };
                    break;
                }

                case 'pickup': {
                    const x = parseInt(args[2]);
                    const z = parseInt(args[3]);
                    const itemId = parseInt(args[4]);
                    if (isNaN(x) || isNaN(z) || isNaN(itemId)) {
                        console.log('Usage: rsbot action pickup <x> <z> <item_id>');
                        return;
                    }
                    action = { type: 'pickupItem', x, z, itemId, reason };
                    break;
                }

                case 'use-item':
                case 'use': {
                    const slot = parseInt(args[2]);
                    const optionIndex = parseInt(args[3]) || 1;
                    if (isNaN(slot)) {
                        console.log('Usage: rsbot action use-item <slot> [option_index]');
                        return;
                    }
                    action = { type: 'useInventoryItem', slot, optionIndex, reason };
                    break;
                }

                case 'use-item-on-item':
                case 'item-on-item': {
                    const sourceSlot = parseInt(args[2]);
                    const targetSlot = parseInt(args[3]);
                    if (isNaN(sourceSlot) || isNaN(targetSlot)) {
                        console.log('Usage: rsbot action use-item-on-item <source_slot> <target_slot>');
                        console.log('  source_slot: the item being used (e.g., tinderbox)');
                        console.log('  target_slot: the item being used on (e.g., logs)');
                        console.log('');
                        console.log('Example:');
                        console.log('  rsbot action item-on-item 0 1    # Use item in slot 0 on item in slot 1');
                        return;
                    }
                    action = { type: 'useItemOnItem', sourceSlot, targetSlot, reason };
                    break;
                }

                case 'use-item-on-loc':
                case 'item-on-loc': {
                    const itemSlot = parseInt(args[2]);
                    const x = parseInt(args[3]);
                    const z = parseInt(args[4]);
                    const locId = parseInt(args[5]);
                    if (isNaN(itemSlot) || isNaN(x) || isNaN(z) || isNaN(locId)) {
                        console.log('Usage: rsbot action use-item-on-loc <item_slot> <x> <z> <loc_id>');
                        console.log('  item_slot: the inventory slot of the item to use');
                        console.log('  x, z: world coordinates of the location');
                        console.log('  loc_id: the ID of the location/object');
                        console.log('');
                        console.log('Example:');
                        console.log('  rsbot action item-on-loc 0 3200 3200 1234');
                        return;
                    }
                    action = { type: 'useItemOnLoc', itemSlot, x, z, locId, reason };
                    break;
                }

                case 'drop': {
                    const slot = parseInt(args[2]);
                    if (isNaN(slot)) {
                        console.log('Usage: rsbot action drop <slot>');
                        return;
                    }
                    action = { type: 'dropItem', slot, reason };
                    break;
                }

                case 'dialog': {
                    const optionIndex = parseInt(args[2]);
                    if (isNaN(optionIndex)) {
                        console.log('Usage: rsbot action dialog <option_index>');
                        console.log('  0 = click continue');
                        console.log('  1-5 = select dialog choice');
                        return;
                    }
                    action = { type: 'clickDialogOption', optionIndex, reason };
                    break;
                }

                case 'interface':
                case 'iface': {
                    const optionIndex = parseInt(args[2]);
                    if (isNaN(optionIndex) || optionIndex < 1) {
                        console.log('Usage: rsbot action interface <option_index>');
                        console.log('  1-N = select interface option (for crafting/fletching menus)');
                        console.log('  Use "rsbot state" to see available interface options');
                        return;
                    }
                    action = { type: 'clickInterfaceOption', optionIndex, reason };
                    break;
                }

                case 'design': {
                    action = { type: 'acceptCharacterDesign', reason };
                    break;
                }

                case 'skip-tutorial':
                case 'tutorial': {
                    action = { type: 'skipTutorial', reason };
                    break;
                }

                case 'wait': {
                    const ticks = parseInt(args[2]) || 1;
                    action = { type: 'wait', ticks, reason };
                    break;
                }

                case 'none': {
                    action = { type: 'none', reason };
                    break;
                }

                case 'shop-buy':
                case 'buy': {
                    const slot = parseInt(args[2]);
                    const amount = parseInt(args[3]) || 1;
                    if (isNaN(slot)) {
                        console.log('Usage: rsbot action shop-buy <slot> [amount]');
                        console.log('  amount: 1, 5, or 10 (default: 1)');
                        return;
                    }
                    action = { type: 'shopBuy', slot, amount, reason };
                    break;
                }

                case 'shop-sell':
                case 'sell': {
                    const slot = parseInt(args[2]);
                    const amount = parseInt(args[3]) || 1;
                    if (isNaN(slot)) {
                        console.log('Usage: rsbot action shop-sell <slot> [amount]');
                        console.log('  amount: 1, 5, or 10 (default: 1)');
                        return;
                    }
                    action = { type: 'shopSell', slot, amount, reason };
                    break;
                }

                case 'set-combat-style':
                case 'combat-style':
                case 'style': {
                    const style = parseInt(args[2]);
                    if (isNaN(style) || style < 0 || style > 3) {
                        console.log('Usage: rsbot action set-combat-style <style>');
                        console.log('  style: 0 = Accurate (Attack), 1 = Aggressive (Strength), 2 = Defensive (Defence), 3 = Controlled (Shared)');
                        console.log('');
                        console.log('Example:');
                        console.log('  rsbot action style 0    # Train Attack');
                        console.log('  rsbot action style 1    # Train Strength');
                        console.log('  rsbot action style 2    # Train Defence');
                        return;
                    }
                    action = { type: 'setCombatStyle', style, reason };
                    break;
                }

                case 'say':
                case 'chat': {
                    // Join remaining args as the message
                    const message = args.slice(2).join(' ');
                    if (!message) {
                        console.log('Usage: rsbot action say <message>');
                        console.log('');
                        console.log('Example:');
                        console.log('  rsbot action say Hello everyone!');
                        return;
                    }
                    action = { type: 'say', message, reason };
                    break;
                }

                default:
                    console.log(`Unknown action type: ${actionType}`);
                    console.log('Run "rsbot help" for available action types');
                    return;
            }

            const id = await queueAction(action);
            console.log(`Queued: ${action.type} (${id})`);

            // If --wait flag, wait for result
            if (args.includes('--wait') || args.includes('-w')) {
                console.log('Waiting for result...');
                const result = await waitForAction(id);
                if (result) {
                    console.log(`Result: ${result.status}`);
                    if (result.result) {
                        console.log(`  ${result.result.success ? 'Success' : 'Failed'}: ${result.result.message}`);
                    }
                } else {
                    console.log('Timed out waiting for action');
                }
            }
            return;
        }

        default:
            console.log(`Unknown command: ${command}`);
            console.log('Run "rsbot help" for available commands');
    }
}

main().catch(console.error);
