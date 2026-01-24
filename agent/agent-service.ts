#!/usr/bin/env bun
// rsbot Agent SDK Service - Persistent agent with code execution MCP tool
// Replaces CLI-based rsbot-agent.ts with direct SDK integration

import { query, createSdkMcpServer, tool, type Query, type SDKMessage, type SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { BotSDK } from './sdk';
import { BotActions } from './bot-actions';
import type { BotWorldState } from './types';

// ============ Types ============

interface BotSession {
    username: string;
    sdk: BotSDK;
    bot: BotActions;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    currentQuery: Query | null;
    isRunning: boolean;
    controllerWs: any | null;  // WebSocket to send updates back to controller
    hasInjectedInitialState: boolean;  // Track if we've shown initial state
}

interface ControllerMessage {
    type: 'start' | 'message' | 'stop' | 'status';
    username: string;
    goal?: string;
    message?: string;
}

interface AgentLogEntry {
    timestamp: number;
    type: 'thinking' | 'action' | 'result' | 'error' | 'system' | 'code';
    content: string;
}

// ============ State Delta Types ============

interface StateDelta {
    skillLevelUps: Array<{ skill: string; oldLevel: number; newLevel: number }>;
    skillXpGains: Array<{ skill: string; xpGained: number }>;
    itemsGained: Array<{ name: string; count: number }>;
    itemsLost: Array<{ name: string; count: number }>;
    equipmentChanged: Array<{ slot: string; from?: string; to?: string }>;
    hpChanged?: { from: number; to: number };
    positionChanged?: { distance: number; to: { x: number; z: number } };
    dialogOpened: boolean;
    dialogClosed: boolean;
    shopOpened: boolean;
    shopClosed: boolean;
    newMessages: string[];
    // Nearby entities (sorted by distance)
    npcsNearby: Array<{ name: string; distance: number; combatLevel: number; options: string[] }>;
    locsNearby: Array<{ name: string; distance: number; options: string[] }>;
    groundItems: Array<{ name: string; count: number; distance: number }>;
    npcKills: string[];  // NPCs that disappeared (likely killed)
}

// ============ State Delta Computation ============

function computeStateDelta(prev: BotWorldState, curr: BotWorldState): StateDelta {
    const delta: StateDelta = {
        skillLevelUps: [],
        skillXpGains: [],
        itemsGained: [],
        itemsLost: [],
        equipmentChanged: [],
        dialogOpened: false,
        dialogClosed: false,
        shopOpened: false,
        shopClosed: false,
        newMessages: [],
        npcsNearby: [],
        locsNearby: [],
        groundItems: [],
        npcKills: []
    };

    // Skill level-ups and XP gains
    for (const currSkill of curr.skills) {
        const prevSkill = prev.skills.find(s => s.name === currSkill.name);
        if (prevSkill) {
            if (currSkill.baseLevel > prevSkill.baseLevel) {
                delta.skillLevelUps.push({
                    skill: currSkill.name,
                    oldLevel: prevSkill.baseLevel,
                    newLevel: currSkill.baseLevel
                });
            }
            const xpGained = currSkill.experience - prevSkill.experience;
            if (xpGained >= 10) {
                delta.skillXpGains.push({ skill: currSkill.name, xpGained });
            }
        }
    }

    // Inventory changes - aggregate by item name
    const prevInvCounts = new Map<string, number>();
    const currInvCounts = new Map<string, number>();
    for (const item of prev.inventory) {
        prevInvCounts.set(item.name, (prevInvCounts.get(item.name) || 0) + item.count);
    }
    for (const item of curr.inventory) {
        currInvCounts.set(item.name, (currInvCounts.get(item.name) || 0) + item.count);
    }

    // Items gained
    currInvCounts.forEach((currCount, name) => {
        const prevCount = prevInvCounts.get(name) || 0;
        if (currCount > prevCount) {
            delta.itemsGained.push({ name, count: currCount - prevCount });
        }
    });
    // Items lost
    prevInvCounts.forEach((prevCount, name) => {
        const currCount = currInvCounts.get(name) || 0;
        if (prevCount > currCount) {
            delta.itemsLost.push({ name, count: prevCount - currCount });
        }
    });

    // Equipment changes - compare by slot
    const equipSlots = ['Head', 'Cape', 'Neck', 'Weapon', 'Body', 'Shield', 'Legs', 'Hands', 'Feet', 'Ring', 'Ammo'];
    for (let i = 0; i < equipSlots.length; i++) {
        const prevItem = prev.equipment[i];
        const currItem = curr.equipment[i];
        const prevName = prevItem?.name || null;
        const currName = currItem?.name || null;
        if (prevName !== currName) {
            delta.equipmentChanged.push({
                slot: equipSlots[i],
                from: prevName || undefined,
                to: currName || undefined
            });
        }
    }

    // HP changes
    const prevHp = prev.skills.find(s => s.name === 'Hitpoints');
    const currHp = curr.skills.find(s => s.name === 'Hitpoints');
    if (prevHp && currHp && prevHp.level !== currHp.level) {
        delta.hpChanged = { from: prevHp.level, to: currHp.level };
    }

    // Position changes (threshold: > 2 tiles)
    if (prev.player && curr.player) {
        const dx = curr.player.worldX - prev.player.worldX;
        const dz = curr.player.worldZ - prev.player.worldZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 2) {
            delta.positionChanged = {
                distance: Math.round(dist),
                to: { x: curr.player.worldX, z: curr.player.worldZ }
            };
        }
    }

    // UI state changes
    if (!prev.dialog.isOpen && curr.dialog.isOpen) delta.dialogOpened = true;
    if (prev.dialog.isOpen && !curr.dialog.isOpen) delta.dialogClosed = true;
    if (!prev.shop.isOpen && curr.shop.isOpen) delta.shopOpened = true;
    if (prev.shop.isOpen && !curr.shop.isOpen) delta.shopClosed = true;

    // New game messages (filter by tick, skip noise)
    const prevMaxTick = Math.max(0, ...prev.gameMessages.map(m => m.tick));
    const noisePatterns = [/^Welcome to RuneScape/i, /^You can access/i];
    delta.newMessages = curr.gameMessages
        .filter(m => m.tick > prevMaxTick)
        .filter(m => !noisePatterns.some(p => p.test(m.text)))
        .slice(0, 3)
        .map(m => m.text);

    // Nearby NPCs (sorted by distance, with interactions)
    delta.npcsNearby = curr.nearbyNpcs
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 8)  // Limit to avoid noise
        .map(npc => ({
            name: npc.name,
            distance: Math.round(npc.distance),
            combatLevel: npc.combatLevel,
            options: npc.options.filter(o => o && o !== 'hidden')
        }));

    // Nearby objects/locs (sorted by distance, with interactions)
    delta.locsNearby = curr.nearbyLocs
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 8)  // Limit to avoid noise
        .map(loc => ({
            name: loc.name,
            distance: Math.round(loc.distance),
            options: loc.options.filter(o => o && o !== 'hidden')
        }));

    // Ground items (sorted by distance)
    delta.groundItems = curr.groundItems
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 8)
        .map(item => ({
            name: item.name,
            count: item.count,
            distance: Math.round(item.distance)
        }));

    // Track NPCs that disappeared (likely killed)
    const currNpcIndices = new Set(curr.nearbyNpcs.map(n => n.index));
    for (const prevNpc of prev.nearbyNpcs) {
        if (prevNpc.distance <= 10 && !currNpcIndices.has(prevNpc.index)) {
            delta.npcKills.push(prevNpc.name);
        }
    }

    return delta;
}

function formatDelta(delta: StateDelta): string | null {
    const lines: string[] = [];

    // Level-ups (most important)
    if (delta.skillLevelUps.length > 0) {
        const ups = delta.skillLevelUps.map(s => `**${s.skill}** ${s.oldLevel} -> ${s.newLevel}`).join(', ');
        lines.push(`LEVEL UP: ${ups}`);
    }

    // HP changes
    if (delta.hpChanged) {
        const diff = delta.hpChanged.to - delta.hpChanged.from;
        const sign = diff > 0 ? '+' : '';
        lines.push(`HP: ${delta.hpChanged.from} -> ${delta.hpChanged.to} (${sign}${diff})`);
    }

    // Equipment changes
    for (const eq of delta.equipmentChanged) {
        if (eq.to && eq.from) {
            lines.push(`EQUIPPED: ${eq.to} (was ${eq.from})`);
        } else if (eq.to) {
            lines.push(`EQUIPPED: ${eq.to}`);
        } else if (eq.from) {
            lines.push(`UNEQUIPPED: ${eq.from}`);
        }
    }

    // Inventory changes
    if (delta.itemsGained.length > 0) {
        const gained = delta.itemsGained.map(i => i.count > 1 ? `${i.name} x${i.count}` : i.name).join(', ');
        lines.push(`+INV: ${gained}`);
    }
    if (delta.itemsLost.length > 0) {
        const lost = delta.itemsLost.map(i => i.count > 1 ? `${i.name} x${i.count}` : i.name).join(', ');
        lines.push(`-INV: ${lost}`);
    }

    // XP gains (summarize)
    if (delta.skillXpGains.length > 0) {
        const xp = delta.skillXpGains.map(s => `${s.skill} +${s.xpGained}xp`).join(', ');
        lines.push(`XP: ${xp}`);
    }

    // Position
    if (delta.positionChanged) {
        lines.push(`MOVED: ${delta.positionChanged.distance} tiles to (${delta.positionChanged.to.x}, ${delta.positionChanged.to.z})`);
    }

    // UI changes
    if (delta.dialogOpened) lines.push('Dialog opened');
    if (delta.dialogClosed) lines.push('Dialog closed');
    if (delta.shopOpened) lines.push('Shop opened');
    if (delta.shopClosed) lines.push('Shop closed');

    // Messages
    if (delta.newMessages.length > 0) {
        const msgs = delta.newMessages.map(m => `"${m}"`).join('; ');
        lines.push(`MSG: ${msgs}`);
    }

    // Nearby NPCs (compact: name[lvl]@dist: options)
    if (delta.npcsNearby.length > 0) {
        const npcs = delta.npcsNearby.map(n => {
            const opts = n.options.length > 0 ? `, actions: [${n.options.join('/')}]` : '';
            return `${n.name}[${n.combatLevel}] ${n.distance} tiles away${opts}`;
        }).join(', ');
        lines.push(`NPCs: ${npcs}`);
    }

    // Nearby objects (compact: name@dist: options)
    if (delta.locsNearby.length > 0) {
        const locs = delta.locsNearby.map(l => {
            const opts = l.options.length > 0 ? `, actions: [${l.options.join('/')}]` : '';
            return `${l.name} ${l.distance} tiles away${opts}`;
        }).join(', ');
        lines.push(`Locs: ${locs}`);
    }

    // Ground items (compact: name@dist or namex count@dist)
    if (delta.groundItems.length > 0) {
        const items = delta.groundItems.map(i => {
            const countStr = i.count > 1 ? ` x${i.count}` : '';
            return `${i.name}${countStr} ${i.distance} tiles away`;
        }).join(', ');
        lines.push(`Ground: ${items}`);
    }

    // NPC kills
    if (delta.npcKills.length > 0) {
        lines.push(`Killed: ${delta.npcKills.join(', ')}`);
    }

    if (lines.length === 0) return null;
    return `[WORLD UPDATE]\n${lines.join('\n')}`;
}

function formatCurrentState(state: BotWorldState): string {
    const lines: string[] = ['[INITIAL STATE - Full Overview]'];

    // Player identity and position
    if (state.player) {
        const floorDesc = state.player.level === 0 ? 'ground floor' :
                          state.player.level === 1 ? '1st floor (upstairs)' :
                          state.player.level === 2 ? '2nd floor' : '3rd floor';
        lines.push(`Player: ${state.player.name} | Combat Level: ${state.player.combatLevel}`);
        lines.push(`Position: (${state.player.worldX}, ${state.player.worldZ}) on ${floorDesc}`);
    }

    // HP and Run energy
    const hp = state.skills.find(s => s.name === 'Hitpoints');
    if (hp && state.player) {
        lines.push(`HP: ${hp.level}/${hp.baseLevel} | Run Energy: ${Math.round(state.player.runEnergy)}% | Weight: ${state.player.runWeight}kg`);
    }

    // All skills grouped by category
    const combatSkillNames = ['Attack', 'Strength', 'Defence', 'Hitpoints', 'Ranged', 'Magic', 'Prayer'];
    const gatheringSkillNames = ['Woodcutting', 'Mining', 'Fishing'];
    const artisanSkillNames = ['Firemaking', 'Cooking', 'Smithing', 'Crafting', 'Fletching', 'Runecraft'];
    const otherSkillNames = ['Agility', 'Herblore', 'Thieving', 'Slayer', 'Farming', 'Construction', 'Hunter'];

    const formatSkillGroup = (names: string[], label: string) => {
        const skills = state.skills
            .filter(s => names.includes(s.name))
            .map(s => `${s.name}: ${s.baseLevel}`);
        if (skills.length > 0) {
            lines.push(`${label}: ${skills.join(', ')}`);
        }
    };

    lines.push('');
    lines.push('=== Skills ===');
    formatSkillGroup(combatSkillNames, 'Combat');
    formatSkillGroup(gatheringSkillNames, 'Gathering');
    formatSkillGroup(artisanSkillNames, 'Artisan');
    formatSkillGroup(otherSkillNames, 'Other');

    // Equipment (non-empty slots)
    lines.push('');
    lines.push('=== Equipment ===');
    const equipped = state.equipment.filter(e => e && e.name).map(e => e.name);
    if (equipped.length > 0) {
        lines.push(equipped.join(', '));
    } else {
        lines.push('(none equipped)');
    }

    // Full inventory
    lines.push('');
    lines.push('=== Inventory ===');
    const invCount = state.inventory.length;
    if (invCount === 0) {
        lines.push('(empty)');
    } else {
        // Group identical items and show all
        const itemCounts = new Map<string, number>();
        for (const item of state.inventory) {
            const existing = itemCounts.get(item.name) || 0;
            itemCounts.set(item.name, existing + item.count);
        }
        const invItems = Array.from(itemCounts.entries())
            .map(([name, count]) => count > 1 ? `${name} x${count}` : name);
        lines.push(`${invCount}/28 slots used: ${invItems.join(', ')}`);
    }

    // Combat style if available
    if (state.combatStyle) {
        lines.push('');
        lines.push('=== Combat Style ===');
        lines.push(`Weapon: ${state.combatStyle.weaponName}`);
        const currentStyle = state.combatStyle.styles.find(s => s.index === state.combatStyle!.currentStyle);
        if (currentStyle) {
            lines.push(`Current Style: ${currentStyle.name} (${currentStyle.type}, trains ${currentStyle.trainedSkill})`);
        }
        const otherStyles = state.combatStyle.styles
            .filter(s => s.index !== state.combatStyle!.currentStyle)
            .map(s => `${s.name} (${s.trainedSkill})`);
        if (otherStyles.length > 0) {
            lines.push(`Available: ${otherStyles.join(', ')}`);
        }
    }

    // Nearby NPCs (sorted by distance)
    lines.push('');
    lines.push('=== Nearby NPCs ===');
    if (state.nearbyNpcs.length > 0) {
        const npcs = state.nearbyNpcs
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 12)
            .map(n => {
                const opts = n.options.filter(o => o && o !== 'hidden');
                const optsStr = opts.length > 0 ? ` [${opts.join('/')}]` : '';
                const lvl = n.combatLevel > 0 ? ` (lvl ${n.combatLevel})` : '';
                return `- ${n.name}${lvl} ${Math.round(n.distance)} tiles away${optsStr}`;
            });
        lines.push(...npcs);
    } else {
        lines.push('(none nearby)');
    }

    // Nearby players
    if (state.nearbyPlayers && state.nearbyPlayers.length > 0) {
        lines.push('');
        lines.push('=== Nearby Players ===');
        const players = state.nearbyPlayers
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 8)
            .map(p => `- ${p.name} (lvl ${p.combatLevel}) ${Math.round(p.distance)} tiles away`);
        lines.push(...players);
    }

    // Nearby objects (sorted by distance)
    lines.push('');
    lines.push('=== Nearby Objects ===');
    if (state.nearbyLocs.length > 0) {
        const locs = state.nearbyLocs
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 12)
            .map(l => {
                const opts = l.options.filter(o => o && o !== 'hidden');
                const optsStr = opts.length > 0 ? ` [${opts.join('/')}]` : '';
                return `- ${l.name} ${Math.round(l.distance)} tiles away${optsStr}`;
            });
        lines.push(...locs);
    } else {
        lines.push('(none nearby)');
    }

    // Ground items (sorted by distance)
    if (state.groundItems.length > 0) {
        lines.push('');
        lines.push('=== Ground Items ===');
        const items = state.groundItems
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 10)
            .map(i => {
                const countStr = i.count > 1 ? ` x${i.count}` : '';
                return `- ${i.name}${countStr} ${Math.round(i.distance)} tiles away`;
            });
        lines.push(...items);
    }

    // Dialog state if open
    if (state.dialog.isOpen) {
        lines.push('');
        lines.push('=== Active Dialog ===');
        if (state.dialog.isWaiting) {
            lines.push('(Waiting for click to continue)');
        } else if (state.dialog.options.length > 0) {
            lines.push('Options:');
            for (const opt of state.dialog.options) {
                lines.push(`  ${opt.index}: ${opt.text}`);
            }
        }
    }

    // Shop state if open
    if (state.shop.isOpen) {
        lines.push('');
        lines.push(`=== Shop Open: ${state.shop.title} ===`);
        const shopItems = state.shop.shopItems
            .filter(i => i.name)
            .slice(0, 10)
            .map(i => i.count > 1 ? `${i.name} x${i.count}` : i.name);
        if (shopItems.length > 0) {
            lines.push(`For sale: ${shopItems.join(', ')}`);
        }
    }

    lines.push('');
    lines.push('---');

    return lines.join('\n');
}

// ============ Session Management ============

const sessions = new Map<string, BotSession>();
const controllerClients = new Set<any>();

function getOrCreateSession(username: string): BotSession | null {
    return sessions.get(username) || null;
}

// ============ System Prompt ============

const SYSTEM_PROMPT = `You are an AI agent controlling a RuneScape 2 (2004 era) character via TypeScript code.

## How It Works
Use the execute_code tool to run TypeScript. Two objects are available:
- \`sdk\`: Low-level SDK (BotSDK) - fast, acknowledges immediately
- \`bot\`: High-level actions (BotActions) - smart, waits for completion

Always return a value from your code so you can see what happened.

## State Queries (instant, cached)
\`\`\`typescript
sdk.getState()                    // Full world state
sdk.getInventory()                // All inventory items
sdk.findInventoryItem(/logs/i)    // Find item by name pattern
sdk.findNearbyNpc(/guard/i)       // Find NPC by name pattern
sdk.findNearbyLoc(/^tree$/i)      // Find location/object by name
sdk.getSkill('Woodcutting')       // Get skill info {level, baseLevel, experience}
sdk.getNearbyNpcs()               // All nearby NPCs
sdk.getNearbyLocs()               // All nearby locations
sdk.getGroundItems()              // All ground items
sdk.getDialog()                   // Current dialog state

// Player position includes floor level:
const state = sdk.getState();
state.player.worldX               // X coordinate
state.player.worldZ               // Z coordinate
state.player.level                // Floor: 0=ground, 1=upstairs, 2=2nd floor, 3=3rd floor
\`\`\`

## Navigation Tips
- If you can't walk somewhere, check \`player.level\` - you may need stairs/ladders!
- Look for locs with names like: "Staircase", "Ladder", "Trapdoor"
- Stairs options: "Climb-up", "Climb-down", "Climb"
- Ladder options: "Climb-up", "Climb-down", "Climb"
- Buildings often have shops/NPCs on upper floors

## Smart Actions (wait for completion)
These handle dialogs, wait for XP/items, and return \`{success, message, reason?}\`.
**ALWAYS check result.success** - actions can fail due to obstacles, distance, etc.
Accept either a pattern (\`/sword/i\`) OR an object from \`sdk.find*()\`:
\`\`\`typescript
await bot.chopTree()              // Chops tree, waits for logs
await bot.chopTree(/oak/i)        // Chops specific tree type
await bot.burnLogs()              // Burns logs with tinderbox, waits for XP
await bot.walkTo(3200, 3200)      // Walk to coordinates using pathfinding
await bot.talkTo(/guide/i)        // Talk to NPC, wait for dialog
await bot.pickupItem(/coins/i)    // Pick up item, wait for inventory
await bot.equipItem(/sword/i)     // Equip item from inventory
await bot.eatFood(/bread/i)       // Eat food item
await bot.attackNpc(/chicken/i)   // Attack NPC, waits for combat to start
await bot.openDoor()              // Open nearest closed door/gate
await bot.openDoor(/gate/i)       // Open door/gate matching pattern
await bot.openShop()              // Open shop (finds shopkeeper)
await bot.openShop(/shop keeper/i)   // Open shop by NPC name
await bot.openShop(npc)           // Open shop with NPC object
await bot.buyFromShop(/hammer/i)  // Buy from open shop by name
await bot.sellToShop(/dagger/i)   // Sell to open shop by name
await bot.sellToShop(item)        // Sell item object (from inventory or shop.playerItems)
await bot.navigateDialog([0, 1])  // Click dialog options in sequence
await bot.dismissBlockingUI()     // Close level-up dialogs etc.
\`\`\`

## Low-Level Actions (for special cases only)
These send packets without waiting for completion. Prefer bot.* methods when available:
\`\`\`typescript
await sdk.sendClickDialog(0)                // Click dialog (0=continue, 1-5=choice)
await sdk.sendUseItem(slot, 1)              // Use inventory item (option 1-5)
await sdk.sendUseItemOnItem(srcSlot, tgtSlot)  // Item on item (e.g., tinderbox on logs)
await sdk.sendUseItemOnLoc(slot, x, z, locId)  // Item on location
await sdk.sendDropItem(slot)                // Drop inventory item
await sdk.sendSetCombatStyle(0-3)           // Set combat style (0=accurate, 1=aggressive, 2=defensive, 3=controlled)
\`\`\`

## Waiting for Conditions
\`\`\`typescript
// Wait for any condition with timeout
await sdk.waitForCondition(state => {
    return state.inventory.length > 5;
}, 30000);

// Wait for next state update
await sdk.waitForStateChange(5000);
\`\`\`

## Example: Combat Loop with Error Handling
\`\`\`typescript
// Kill cows, handling gates/fences that block the path
let kills = 0;
const targetKills = 10;

while (kills < targetKills) {
    const cow = sdk.findNearbyNpc(/cow/i);
    if (!cow) {
        return { error: 'No cows found', kills };
    }

    // Attack and check for errors
    const attackResult = await bot.attackNpc(cow);
    if (!attackResult.success) {
        if (attackResult.reason === 'out_of_reach') {
            // Gate/fence blocking - open it and retry
            const doorResult = await bot.openDoor(/gate/i);
            if (!doorResult.success) {
                return { error: 'Blocked by obstacle, cannot open gate', kills };
            }
            continue;  // Retry the attack
        }
        return { error: attackResult.message, kills };
    }

    // Wait for the kill by polling until we're no longer in combat
    // (interactingEntity becomes null when target dies or runs away)
    await sdk.waitForCondition(state => {
        return state.player.interactingEntity === null;
    }, 60000);

    kills++;

    // Pick up any loot (bones, hides, etc.)
    const loot = sdk.findGroundItem(/bones|hide|coins/i);
    if (loot) {
        await bot.pickupItem(loot);
    }
}

return { success: true, kills };
\`\`\`

## Example: Train Woodcutting
\`\`\`typescript
const startLevel = sdk.getSkill('Woodcutting')?.baseLevel || 1;
const targetLevel = startLevel + 1;

while (sdk.getSkill('Woodcutting')?.baseLevel < targetLevel) {
    const tree = sdk.findNearbyLoc(/^tree$/i);
    if (!tree) {
        return { error: 'No trees nearby', currentLevel: sdk.getSkill('Woodcutting')?.baseLevel };
    }
    const result = await bot.chopTree(tree);
    if (!result.success) {
        return { error: result.message };
    }
}
return { success: true, newLevel: sdk.getSkill('Woodcutting')?.baseLevel };
\`\`\`

## Example: Firemaking
\`\`\`typescript
const logs = sdk.findInventoryItem(/logs/i);
if (!logs) {
    return { error: 'No logs in inventory' };
}
const result = await bot.burnLogs(logs);
if (!result.success) {
    return { error: result.message };
}
return { success: true, xpGained: result.xpGained };
\`\`\`

## Rules
1. **ALWAYS check result.success** on bot.* methods - they return errors, not exceptions
2. Use \`bot.*\` methods for all actions - they wait for completion and detect failures
3. Use \`sdk.*\` only for queries (getState, findNearbyNpc, etc.) or special low-level needs
4. Always return results from your code so you know what happened
5. If a dialog is open, handle it before doing other actions
6. **NEVER ask for clarification** - you are in full autonomous mode. Make your best judgment and act. If something fails, try a different approach. The user cannot respond to questions.

## Handling Blocked Paths
When \`bot.attackNpc()\` or \`bot.pickupItem()\` returns \`reason: 'out_of_reach'\`, there's an obstacle (gate, door, fence) blocking the path:
\`\`\`typescript
const result = await bot.attackNpc(target);
if (!result.success && result.reason === 'out_of_reach') {
    // Open the blocking gate/door
    await bot.openDoor(/gate/i);
    // Retry the original action
    const retry = await bot.attackNpc(target);
}
\`\`\`
**Door state**: A door with "Open" option is CLOSED. A door with "Close" option is already OPEN.

## Be Opportunistic
Don't just blindly follow the main goal - notice opportunities as they arise:
- **Pick up valuable drops** - If you see coins, equipment, or useful items on the ground, grab them. Check \`sdk.getGroundItems()\` periodically.
- **Loot your kills** - After killing enemies, pick up their drops before moving on.
- **Upgrade gear** - If you find better equipment than what you're wearing, equip it.

## Random Events
NPCs may suddenly appear near you (random events). Handle them:
- **Friendly NPCs** (e.g., Genie, Mystery Box) - Talk to them for rewards. They usually have "Talk-to" or "Dismiss" options.
- **Hostile/High-level NPCs** - If an aggressive NPC appears that's much stronger than you, run away! Walk to a safe distance before resuming your task.
- **Strange plant, Rock Golem, etc.** - These attack you if ignored. Either fight back (if your level is sufficient) or flee.

## Responding to User
When the user sends a message, respond conversationally AND take appropriate action.
If they ask you to do something, do it. If they ask a question, answer it.
You can execute code to check game state and inform your response.
`;

// ============ MCP Tool Definition ============

function createExecuteCodeTool(session: BotSession) {
    return tool(
        'execute_code',
        'Execute TypeScript code with sdk and bot objects available. Returns the result of the code execution, followed by a world state delta showing what changed.',
        {
            code: z.string().describe('TypeScript code to execute. Must return a value.')
        },
        async ({ code }) => {
            try {
                // Capture state BEFORE execution
                const stateBefore = session.sdk.getState();

                // Create async function with SDK in scope
                // We wrap the code in an async IIFE to support await
                const wrappedCode = `return (async () => { ${code} })()`;
                const fn = new Function('sdk', 'bot', wrappedCode);

                // Execute with timeout
                const timeoutMs = 60000;  // 60 second timeout for long operations
                const result = await Promise.race([
                    fn(session.sdk, session.bot),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Code execution timed out after 60s')), timeoutMs)
                    )
                ]);

                // Capture state AFTER execution
                const stateAfter = session.sdk.getState();

                // Format result
                const resultStr = result === undefined
                    ? 'undefined (no return value)'
                    : JSON.stringify(result, null, 2);

                // Broadcast the return value to UI
                console.log();
                console.log(`${colors.cyan}${colors.bold}▸ Returned${colors.reset}`);
                console.log(`${colors.cyan}  ${resultStr.split('\n').join('\n  ')}${colors.reset}`);
                broadcastToController(session.username, {
                    type: 'result',
                    content: resultStr
                });

                // Compute and format delta
                let deltaStr = '';
                if (stateBefore && stateAfter) {
                    const delta = computeStateDelta(stateBefore, stateAfter);
                    const formatted = formatDelta(delta);
                    if (formatted) {
                        deltaStr = '\n\n' + formatted;
                        // Log to console with nice formatting
                        console.log();
                        console.log(`${colors.magenta}${colors.bold}▸ World Delta${colors.reset}`);
                        for (const line of formatted.split('\n')) {
                            console.log(`${colors.magenta}  ${line}${colors.reset}`);
                        }
                        // Broadcast to controller for run recording
                        broadcastToController(session.username, {
                            type: 'state',
                            content: formatted
                        });
                    }
                }

                return {
                    content: [{ type: 'text' as const, text: resultStr + deltaStr }]
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }]
                };
            }
        }
    );
}

// ============ Session Functions ============

async function startSession(username: string, goal: string, controllerWs: any) {
    console.log(`[Agent] Starting session for ${username} with goal: ${goal}`);

    // Get or create session
    let session = sessions.get(username);

    if (!session) {
        // Create new SDK connection
        const sdk = new BotSDK({ botUsername: username });

        try {
            await sdk.connect();
            console.log(`[Agent] SDK connected for ${username}`);

            // Wait for game to be ready
            await sdk.waitForCondition(s => s.inGame, 30000);
            console.log(`[Agent] Game ready for ${username}`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Agent] Failed to connect SDK for ${username}:`, errorMsg);
            broadcastToController(username, {
                type: 'error',
                content: `Failed to connect: ${errorMsg}`
            });
            return;
        }

        session = {
            username,
            sdk,
            bot: new BotActions(sdk),
            conversationHistory: [],
            currentQuery: null,
            isRunning: false,
            controllerWs,
            hasInjectedInitialState: false
        };
        sessions.set(username, session);
    } else {
        session.controllerWs = controllerWs;
    }

    // Start with the goal
    session.conversationHistory = [{ role: 'user', content: goal }];
    await runAgentLoop(session);
}

async function handleUserMessage(username: string, message: string) {
    const session = sessions.get(username);
    if (!session) {
        console.log(`[Agent] No session for ${username}, ignoring message`);
        return;
    }

    console.log(`[Agent] User message for ${username}: ${message}`);

    // Interrupt current query if running
    if (session.currentQuery && session.isRunning) {
        console.log(`[Agent] Interrupting current query for ${username}`);
        try {
            await session.currentQuery.interrupt();
        } catch (e) {
            // Ignore interrupt errors
        }
    }

    // Add message to history
    session.conversationHistory.push({ role: 'user', content: message });

    // Start new agent loop with updated history
    await runAgentLoop(session);
}

async function stopSession(username: string) {
    const session = sessions.get(username);
    if (!session) return;

    console.log(`[Agent] Stopping session for ${username}`);

    // Interrupt current query
    if (session.currentQuery && session.isRunning) {
        try {
            await session.currentQuery.interrupt();
        } catch (e) {
            // Ignore
        }
    }

    session.isRunning = false;

    broadcastToController(username, {
        type: 'status',
        status: 'stopped'
    });
}

async function cleanupSession(username: string) {
    const session = sessions.get(username);
    if (!session) return;

    await stopSession(username);

    // Disconnect SDK
    try {
        await session.sdk.disconnect();
    } catch (e) {
        // Ignore
    }

    sessions.delete(username);
    console.log(`[Agent] Cleaned up session for ${username}`);
}

// ============ Agent Loop ============

async function runAgentLoop(session: BotSession) {
    if (session.isRunning) {
        console.log(`[Agent] Already running for ${session.username}, skipping`);
        return;
    }

    session.isRunning = true;

    broadcastToController(session.username, {
        type: 'status',
        status: 'running'
    });

    try {
        // On first turn only, inject current state summary
        // (Subsequent turns get deltas via tool results)
        let contextPrefix = '';
        if (!session.hasInjectedInitialState) {
            const currentState = session.sdk.getState();
            if (currentState) {
                contextPrefix = formatCurrentState(currentState) + '\n\n';
                session.hasInjectedInitialState = true;
                // Log to console
                console.log();
                console.log(`${colors.magenta}${colors.bold}▸ Initial State${colors.reset}`);
                for (const line of formatCurrentState(currentState).split('\n')) {
                    console.log(`${colors.magenta}  ${line}${colors.reset}`);
                }
            }
        }

        // Build prompt from conversation history with context prefix on first user message
        const historyWithContext = session.conversationHistory.map((m, i) => {
            // Prefix context to the first user message (the initial goal)
            if (m.role === 'user' && i === 0 && contextPrefix) {
                return { role: m.role, content: contextPrefix + m.content };
            }
            return m;
        });

        const prompt = historyWithContext
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n');

        // Create MCP server with execute_code tool for this session
        const mcpServer = createSdkMcpServer({
            name: 'rsbot',
            version: '1.0.0',
            tools: [createExecuteCodeTool(session)]
        });

        // Start query
        const queryInstance = query({
            prompt,
            options: {
                systemPrompt: SYSTEM_PROMPT,
                mcpServers: {
                    rsbot: mcpServer
                },
                allowedTools: ['mcp__rsbot__execute_code', 'TodoRead', 'TodoWrite'],
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                maxTurns: 100,
                persistSession: false  // We manage our own session state
            }
        });

        session.currentQuery = queryInstance;

        // Process messages
        for await (const message of queryInstance) {
            if (!session.isRunning) break;

            processAgentMessage(session, message);
        }

    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log(`[Agent] Query aborted for ${session.username}`);
        } else {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Agent] Error for ${session.username}:`, errorMsg);
            broadcastToController(session.username, {
                type: 'error',
                content: errorMsg
            });
        }
    } finally {
        session.isRunning = false;
        session.currentQuery = null;

        broadcastToController(session.username, {
            type: 'status',
            status: 'idle'
        });
    }
}

// ============ In-Game Chat Narration ============

// Truncate message to fit RS chat limit (80 chars)
function truncateChat(msg: string): string {
    return msg.length > 80 ? msg.substring(0, 77) + '...' : msg;
}

// Send terse status to in-game chat
async function narrateStatus(session: BotSession, status: string): Promise<void> {
    try {
        const msg = truncateChat(status);
        await session.sdk.sendSay(msg);
    } catch {
        // Ignore chat errors - non-critical
    }
}

// Generate terse summary from thinking/action
function terseSummary(text: string): string {
    // Remove common filler words and compress
    let summary = text
        .replace(/^(I'll |I will |Let me |Going to |Now |First, |Next, )/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Take first sentence or clause
    const endIdx = summary.search(/[.!?]|\s(and|then|so|because)\s/i);
    if (endIdx > 0 && endIdx < 60) {
        summary = summary.substring(0, endIdx);
    }

    return truncateChat(summary);
}

// ============ Terminal Formatting Helpers ============

const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    // Foreground
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    // Background
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
};

function formatTime(): string {
    return new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function printDivider(char: string = '─', length: number = 60): void {
    console.log(colors.dim + char.repeat(length) + colors.reset);
}

function printHeader(title: string, color: string = colors.cyan): void {
    console.log();
    printDivider('═');
    console.log(`${color}${colors.bold}  ${title}${colors.reset}`);
    printDivider('═');
}

function printSection(title: string, color: string = colors.blue): void {
    console.log();
    console.log(`${color}${colors.bold}▸ ${title}${colors.reset}`);
    printDivider('─', 40);
}

function printCode(code: string): void {
    console.log(`${colors.dim}┌${'─'.repeat(58)}┐${colors.reset}`);
    const lines = code.split('\n');
    for (const line of lines) {
        const displayLine = line.length > 56 ? line.substring(0, 53) + '...' : line;
        console.log(`${colors.dim}│${colors.reset} ${colors.yellow}${displayLine}${colors.reset}`);
    }
    console.log(`${colors.dim}└${'─'.repeat(58)}┘${colors.reset}`);
}

function printResult(result: string, isError: boolean = false): void {
    const color = isError ? colors.red : colors.green;
    const icon = isError ? '✗' : '✓';
    const lines = result.split('\n');
    for (const line of lines) {
        console.log(`${color}  ${icon} ${line}${colors.reset}`);
    }
}

function printThinking(text: string): void {
    // Wrap long lines for readability
    const maxWidth = 70;
    const words = text.split(' ');
    let currentLine = '';

    for (const word of words) {
        if (currentLine.length + word.length + 1 > maxWidth) {
            console.log(`${colors.cyan}  ${currentLine}${colors.reset}`);
            currentLine = word;
        } else {
            currentLine = currentLine ? `${currentLine} ${word}` : word;
        }
    }
    if (currentLine) {
        console.log(`${colors.cyan}  ${currentLine}${colors.reset}`);
    }
}

function processAgentMessage(session: BotSession, message: SDKMessage) {
    if (!('type' in message)) return;

    switch (message.type) {
        case 'system':
            if (message.subtype === 'init') {
                printHeader(`Session: ${message.session_id}`, colors.green);
                broadcastToController(session.username, {
                    type: 'system',
                    content: `Session started: ${message.session_id}`
                });
            }
            break;

        case 'assistant':
            if (message.message?.content) {
                for (const block of message.message.content) {
                    if (block.type === 'text') {
                        // Save assistant response to history
                        session.conversationHistory.push({ role: 'assistant', content: block.text });

                        // Print nicely formatted thinking
                        printSection('Claude', colors.cyan);
                        printThinking(block.text);

                        broadcastToController(session.username, {
                            type: 'thinking',
                            content: block.text
                        });

                        // Narrate key thoughts to in-game chat (skip short/trivial responses)
                        if (block.text.length > 20 && !block.text.toLowerCase().includes('let me check')) {
                            narrateStatus(session, terseSummary(block.text));
                        }
                    } else if (block.type === 'tool_use') {
                        const input = block.input as Record<string, unknown>;
                        if (block.name === 'mcp__rsbot__execute_code' && input.code) {
                            const codeStr = String(input.code);

                            // Print code in terminal
                            printSection('Executing Code', colors.yellow);
                            printCode(codeStr);

                            // Send full code to UI (let UI handle display)
                            broadcastToController(session.username, {
                                type: 'code',
                                content: codeStr
                            });
                        } else if (block.name === 'TodoWrite' && input.todos) {
                            // Broadcast todo updates to UI
                            const todos = input.todos as Array<{ content: string; status: string; activeForm?: string }>;
                            console.log(`${colors.blue}  ▸ Tasks: ${todos.filter(t => t.status !== 'completed').length} active${colors.reset}`);
                            broadcastToController(session.username, {
                                type: 'todos',
                                todos: todos
                            });
                        } else {
                            // Skip logging other internal tools
                        }
                    }
                }
            }
            break;

        case 'user':
            // Tool results
            if (message.message?.content) {
                for (const block of message.message.content) {
                    if (typeof block !== 'string' && block.type === 'tool_result') {
                        const content = block.content;
                        if (typeof content === 'string' && content.length > 0) {
                            // Print result in terminal
                            const isError = content.toLowerCase().startsWith('error');
                            printSection('Result', isError ? colors.red : colors.green);

                            // Try to pretty-print JSON and extract key info for narration
                            let narrateMsg = '';
                            try {
                                const parsed = JSON.parse(content);
                                console.log(colors.dim + JSON.stringify(parsed, null, 2) + colors.reset);

                                // Build terse narration from result
                                if (parsed.error) {
                                    narrateMsg = `ERR: ${parsed.error}`;
                                } else if (parsed.success !== undefined) {
                                    if (parsed.newLevel) {
                                        narrateMsg = `Level up! Now ${parsed.newLevel}`;
                                    } else if (parsed.message) {
                                        narrateMsg = parsed.success ? `OK: ${parsed.message}` : `FAIL: ${parsed.message}`;
                                    } else {
                                        narrateMsg = parsed.success ? 'Done' : 'Failed';
                                    }
                                }
                            } catch {
                                printResult(content, isError);
                                narrateMsg = isError ? content.substring(0, 60) : '';
                            }

                            // Note: execute_code broadcasts its own results, so we skip here
                            // to avoid duplicates. The result + delta are already sent.

                            // Narrate significant results to chat
                            if (narrateMsg && narrateMsg.length > 3) {
                                narrateStatus(session, narrateMsg);
                            }
                        }
                    }
                }
            }
            break;

        case 'result':
            if (message.subtype === 'success') {
                const successMsg = message as SDKResultSuccess;
                printHeader('Task Completed', colors.green);
                if (successMsg.result) {
                    console.log(`${colors.green}  ${successMsg.result}${colors.reset}`);
                }
                broadcastToController(session.username, {
                    type: 'system',
                    content: `Completed: ${successMsg.result || 'Done'}`
                });
            }
            break;
    }
}

// ============ Communication with Controller ============

function broadcastToController(username: string, entry: { type: string; content?: string; status?: string }) {
    const data = JSON.stringify({
        username,
        ...entry,
        timestamp: Date.now()
    });

    for (const ws of controllerClients) {
        try {
            ws.send(data);
        } catch (e) {
            // Client disconnected
        }
    }
}

// ============ WebSocket Server ============

const AGENT_SERVICE_PORT = parseInt(process.env.AGENT_SERVICE_PORT || '7782');

const server = Bun.serve({
    port: AGENT_SERVICE_PORT,

    fetch(req, server) {
        const url = new URL(req.url);

        // Upgrade WebSocket connections
        if (req.headers.get('upgrade') === 'websocket') {
            const upgraded = server.upgrade(req);
            if (upgraded) return undefined;
            return new Response('WebSocket upgrade failed', { status: 400 });
        }

        // Health check endpoint
        if (url.pathname === '/health') {
            const sessionList = Array.from(sessions.entries()).map(([username, session]) => ({
                username,
                isRunning: session.isRunning,
                historyLength: session.conversationHistory.length
            }));

            return new Response(JSON.stringify({
                status: 'ok',
                sessions: sessionList,
                port: AGENT_SERVICE_PORT
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(`rsbot Agent Service\n\nWebSocket: ws://localhost:${AGENT_SERVICE_PORT}\nHealth: GET /health`, {
            headers: { 'Content-Type': 'text/plain' }
        });
    },

    websocket: {
        open(ws) {
            console.log('[Agent] Controller connected');
            controllerClients.add(ws);
        },

        async message(ws, data) {
            try {
                const msg: ControllerMessage = JSON.parse(String(data));

                switch (msg.type) {
                    case 'start':
                        if (msg.username && msg.goal) {
                            await startSession(msg.username, msg.goal, ws);
                        }
                        break;

                    case 'message':
                        if (msg.username && msg.message) {
                            await handleUserMessage(msg.username, msg.message);
                        }
                        break;

                    case 'stop':
                        if (msg.username) {
                            await stopSession(msg.username);
                        }
                        break;

                    case 'status':
                        if (msg.username) {
                            const session = sessions.get(msg.username);
                            ws.send(JSON.stringify({
                                type: 'status',
                                username: msg.username,
                                exists: !!session,
                                isRunning: session?.isRunning || false,
                                historyLength: session?.conversationHistory.length || 0
                            }));
                        }
                        break;
                }
            } catch (e) {
                console.error('[Agent] Error processing message:', e);
            }
        },

        close(ws) {
            console.log('[Agent] Controller disconnected');
            controllerClients.delete(ws);
        }
    }
});

console.log(`[Agent] rsbot Agent Service running on port ${AGENT_SERVICE_PORT}`);
console.log(`[Agent] WebSocket: ws://localhost:${AGENT_SERVICE_PORT}`);
console.log(`[Agent] Health: http://localhost:${AGENT_SERVICE_PORT}/health`);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[Agent] Shutting down...');
    for (const [username] of sessions) {
        await cleanupSession(username);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[Agent] Shutting down...');
    for (const [username] of sessions) {
        await cleanupSession(username);
    }
    process.exit(0);
});
