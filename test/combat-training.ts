#!/usr/bin/env bun
/**
 * Combat Training Test
 *
 * Tests combat training flow via rsbot CLI:
 * 1. Skip tutorial if needed
 * 2. Equip sword and shield
 * 3. Set combat style (auto-balance: trains lowest stat)
 * 4. Find and attack rats or humans (men/women)
 * 5. Monitor health and eat food when damaged
 * 6. Pick up bones dropped by killed men and bury them for Prayer XP
 *
 * Usage:
 *   bun run test/combat-training.ts
 *   BOT_NAME=fighter1 bun run test/combat-training.ts
 */

import { Page } from 'puppeteer';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { setupBotWithTutorialSkip, sleep, BotSession } from './utils/skip_tutorial';

// Configuration
const TURN_DELAY_MS = 600;
const MAX_COMBAT_TURNS = 500;
const EAT_HEALTH_THRESHOLD = 10; // Eat when health drops below this
const STYLE_SWITCH_INTERVAL = 10; // Switch combat styles every N turns
const DEFENCE_WEIGHT = 1.5; // Defence needs to be this much lower to be trained

// Training style: auto-balance trains lowest stat with 2:1 preference for Atk/Str over Def
const TRAIN_STYLE = 'auto';

// Combat style indices
const COMBAT_STYLES = {
    attack: 0,      // Accurate - trains Attack
    strength: 1,    // Aggressive - trains Strength
    defence: 2,     // Defensive - trains Defence
    controlled: 3   // Controlled - trains all (shared)
} as const;

// Bot name from environment or generate one
const BOT_NAME = process.env.BOT_NAME;

// Run directory will be set after we know the bot name
let RUN_DIR: string;
let SCREENSHOT_DIR: string;

interface CombatResult {
    botName: string;
    startTime: string;
    endTime: string;
    success: boolean;
    equipped: { sword: boolean; shield: boolean };
    combatStyle: {
        trainMode: string;
        styleChanges: number;
        attackTurns: number;
        strengthTurns: number;
        defenceTurns: number;
    };
    combatStats: {
        totalKills: number;
        ratsKilled: number;
        humansKilled: number;
        foodEaten: number;
        damageTaken: number;
        bonesPickedUp: number;
        bonesBuried: number;
    };
    skillLevels: {
        initialAttack: number;
        initialStrength: number;
        initialDefence: number;
        finalAttack: number;
        finalStrength: number;
        finalDefence: number;
        gainedAttackLevel: boolean;
        gainedStrengthLevel: boolean;
        gainedDefenceLevel: boolean;
    };
    turns: TurnRecord[];
    error?: string;
}

interface TurnRecord {
    turn: number;
    timestamp: string;
    health: number;
    action: string;
    result: string;
}

async function ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
    const filename = join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: filename });
    return filename;
}

// rsbot function - will be set from session
let rsbot: (...args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

// Get player position via CLI
async function getPlayerPosition(): Promise<{ x: number; z: number } | null> {
    const result = await rsbot('player');
    if (result.exitCode !== 0 || result.stdout.includes('Not logged in')) {
        return null;
    }
    const match = result.stdout.match(/Position:\s*\((\d+),\s*(\d+)\)/);
    if (match) {
        return { x: parseInt(match[1]), z: parseInt(match[2]) };
    }
    return null;
}

// Get player health via CLI
async function getPlayerHealth(): Promise<{ current: number; max: number } | null> {
    const result = await rsbot('player');
    if (result.exitCode !== 0 || result.stdout.includes('Not logged in')) {
        return null;
    }
    // Parse output like "Health: 10/10" or "HP: 10/10"
    const match = result.stdout.match(/(?:Health|HP):\s*(\d+)\/(\d+)/i);
    if (match) {
        return { current: parseInt(match[1]), max: parseInt(match[2]) };
    }
    return null;
}

// Check if player is in combat
async function isInCombat(): Promise<boolean> {
    const result = await rsbot('player');
    return result.stdout.includes('In Combat: Yes') || result.stdout.includes('Fighting:');
}

// Wait for sync connection
async function waitForSyncConnection(timeout = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const result = await rsbot('status');
        if (result.stdout.includes('Connected: Yes') && result.stdout.includes('In Game: Yes')) {
            return true;
        }
        await sleep(500);
    }
    return false;
}

// Check dialog state via CLI
async function checkDialog(): Promise<{ isOpen: boolean; hasOptions: boolean }> {
    const result = await rsbot('dialog');
    const isOpen = result.stdout.includes('Dialog: OPEN');
    const hasOptions = result.stdout.includes('Options:');
    return { isOpen, hasOptions };
}

// Close dialog via CLI
async function closeDialog(): Promise<boolean> {
    const dialog = await checkDialog();
    if (!dialog.isOpen) return false;
    await rsbot('action', 'dialog', '0', '--wait');
    return true;
}

// Parse options with indices from CLI output
function parseOptionsWithIndex(optStr: string): { opIndex: number; text: string }[] {
    if (!optStr) return [];
    return optStr.split(',').map(s => {
        const trimmed = s.trim();
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
            return {
                opIndex: parseInt(trimmed.substring(0, colonIdx)),
                text: trimmed.substring(colonIdx + 1)
            };
        }
        return { opIndex: 1, text: trimmed };
    });
}

// Get inventory via CLI
async function getInventory(): Promise<any[]> {
    const result = await rsbot('inventory');
    const items: any[] = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
        // [0] Bronze dagger x1 (id: 1205)
        const match = line.match(/^\s*\[(\d+)\]\s*(.+?)\s*x(\d+)\s*\(id:\s*(\d+)\)/);
        if (match) {
            items.push({
                slot: parseInt(match[1]),
                name: match[2].trim(),
                count: parseInt(match[3]),
                id: parseInt(match[4])
            });
        }
    }
    return items;
}

// Get nearby NPCs via CLI
async function getNearbyNpcs(): Promise<any[]> {
    const result = await rsbot('npcs');
    const npcs: any[] = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
        // #1234: Rat (Lvl 1) - 3 tiles [1:Attack]
        const match = line.match(/^\s*#(\d+):\s*(.+?)(?:\s*\(Lvl (\d+)\))?\s*-\s*(\d+) tiles(?:\s*\[(.+)\])?/);
        if (match) {
            const optionsWithIndex = parseOptionsWithIndex(match[5] || '');
            npcs.push({
                index: parseInt(match[1]),
                name: match[2].trim(),
                level: match[3] ? parseInt(match[3]) : 0,
                distance: parseInt(match[4]),
                options: optionsWithIndex.map(o => o.text),
                optionsWithIndex
            });
        }
    }
    return npcs;
}

// Equip item from inventory via CLI (option 2 = Wield/Wear)
async function equipItem(slot: number): Promise<boolean> {
    const result = await rsbot('action', 'use-item', slot.toString(), '2', '--wait');
    return result.stdout.includes('Success');
}

// Use item from inventory (for eating food) via CLI (option 1 = Eat)
async function useItem(slot: number): Promise<boolean> {
    const result = await rsbot('action', 'use-item', slot.toString(), '1', '--wait');
    return result.stdout.includes('Success');
}

// Interact with NPC via CLI
async function interactNpc(npcIndex: number, optionIndex: number): Promise<boolean> {
    const result = await rsbot('action', 'interact-npc', npcIndex.toString(), optionIndex.toString(), '--wait');
    return result.stdout.includes('Success');
}

// Get current combat style via CLI
async function getCombatStyle(): Promise<{ currentStyle: number; styles: any[] } | null> {
    const result = await rsbot('combat');
    if (result.stdout.includes('Not available')) {
        return null;
    }

    // Parse current style
    const styleMatch = result.stdout.match(/Current Style:\s*(\d+)/);
    const currentStyle = styleMatch ? parseInt(styleMatch[1]) : 0;

    // Parse available styles
    const styles: any[] = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
        // [0] Punch (Accurate) - Trains: Attack
        const match = line.match(/^\s*\[(\d+)\]\s*(.+?)\s*\((.+?)\)\s*-\s*Trains:\s*(.+?)(?:\s*<--)?/);
        if (match) {
            styles.push({
                index: parseInt(match[1]),
                name: match[2].trim(),
                type: match[3].trim(),
                trainedSkill: match[4].trim()
            });
        }
    }

    return { currentStyle, styles };
}

// Set combat style via CLI
async function setCombatStyle(style: number): Promise<boolean> {
    const result = await rsbot('action', 'style', style.toString(), '--wait');
    return result.stdout.includes('Success');
}

// Get combat skill levels via CLI
async function getCombatStats(): Promise<{ attack: number; strength: number; defence: number } | null> {
    const result = await rsbot('skills');
    if (result.exitCode !== 0 || result.stdout.includes('Not available')) {
        return null;
    }

    const stats = { attack: 1, strength: 1, defence: 1 };
    const lines = result.stdout.split('\n');

    for (const line of lines) {
        // Parse lines like "  Attack: 10/10 (1,154 xp)"
        const match = line.match(/^\s*(Attack|Strength|Defence):\s*(\d+)\/(\d+)/i);
        if (match) {
            const skill = match[1].toLowerCase();
            const baseLevel = parseInt(match[3]); // Use base level, not boosted
            if (skill === 'attack') stats.attack = baseLevel;
            else if (skill === 'strength') stats.strength = baseLevel;
            else if (skill === 'defence') stats.defence = baseLevel;
        }
    }

    return stats;
}

// Get the best style for auto-balancing with 2:1 preference for atk/str over def
async function getAutoBalanceStyle(): Promise<{ style: number; reason: string }> {
    const stats = await getCombatStats();
    if (!stats) {
        return { style: COMBAT_STYLES.strength, reason: 'Stats unavailable, defaulting to Strength' };
    }

    // Apply weight to defence - it needs to be significantly lower to be trained
    // With DEFENCE_WEIGHT = 2.0, defence at level 5 is treated like level 10 for comparison
    const effectiveDefence = stats.defence * DEFENCE_WEIGHT;

    // Find the lowest stat (with defence weighted)
    const effectiveLevels = {
        attack: stats.attack,
        strength: stats.strength,
        defence: effectiveDefence
    };

    const minEffective = Math.min(effectiveLevels.attack, effectiveLevels.strength, effectiveLevels.defence);

    // Determine which stat(s) are at the minimum
    const atMin = {
        attack: effectiveLevels.attack === minEffective,
        strength: effectiveLevels.strength === minEffective,
        defence: effectiveLevels.defence === minEffective
    };

    // Priority: if multiple are tied, prefer strength > attack > defence
    let style: number;
    let reason: string;

    if (atMin.strength) {
        style = COMBAT_STYLES.strength;
        reason = `Training Strength (lowest: Atk=${stats.attack}, Str=${stats.strength}, Def=${stats.defence})`;
    } else if (atMin.attack) {
        style = COMBAT_STYLES.attack;
        reason = `Training Attack (lowest: Atk=${stats.attack}, Str=${stats.strength}, Def=${stats.defence})`;
    } else {
        style = COMBAT_STYLES.defence;
        reason = `Training Defence (lowest after 2:1 weight: Atk=${stats.attack}, Str=${stats.strength}, Def=${stats.defence})`;
    }

    return { style, reason };
}

// Get the style index for the desired training mode
async function getStyleForTraining(trainMode: string, turnCount: number): Promise<{ style: number; reason: string }> {
    switch (trainMode) {
        case 'attack':
            return { style: COMBAT_STYLES.attack, reason: 'Training Attack (fixed)' };
        case 'strength':
            return { style: COMBAT_STYLES.strength, reason: 'Training Strength (fixed)' };
        case 'defence':
        case 'defense':
            return { style: COMBAT_STYLES.defence, reason: 'Training Defence (fixed)' };
        case 'controlled':
        case 'shared':
            return { style: COMBAT_STYLES.controlled, reason: 'Training Controlled (shared)' };
        case 'cycle': {
            // Cycle through attack -> strength -> defence every STYLE_SWITCH_INTERVAL turns
            const cyclePosition = Math.floor(turnCount / STYLE_SWITCH_INTERVAL) % 3;
            const styleName = ['Attack', 'Strength', 'Defence'][cyclePosition];
            return { style: cyclePosition, reason: `Cycling: ${styleName}` };
        }
        case 'auto':
        case 'balance':
        default:
            return await getAutoBalanceStyle();
    }
}

// Check if in tutorial area
async function isInTutorial(): Promise<boolean> {
    const pos = await getPlayerPosition();
    if (!pos) return true;
    return pos.x < 3200;
}

// === Puppeteer helpers for initial connection ===

async function waitForClientReady(page: Page, timeout = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const ready = await page.evaluate(() => {
            const client = (window as any).gameClient;
            return client && typeof client.autoLogin === 'function';
        });
        if (ready) return true;
        await sleep(500);
    }
    return false;
}

async function waitForInGame(page: Page, timeout = 45000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const inGame = await page.evaluate(() => {
            const client = (window as any).gameClient;
            return client && client.ingame === true;
        });
        if (inGame) return true;
        await sleep(500);
    }
    return false;
}

async function login(page: Page, username: string): Promise<void> {
    await page.evaluate((user: string) => {
        (document.getElementById('bot-username') as HTMLInputElement).value = user;
        (document.getElementById('bot-password') as HTMLInputElement).value = 'test';
    }, username);

    await page.evaluate(() => {
        const client = (window as any).gameClient;
        if (client?.autoLogin) {
            client.autoLogin(
                (document.getElementById('bot-username') as HTMLInputElement).value,
                (document.getElementById('bot-password') as HTMLInputElement).value
            );
        }
    });
}

// Skip tutorial via CLI
async function skipTutorial(): Promise<{ success: boolean; message: string }> {
    const result = await rsbot('action', 'skip-tutorial', '--wait');
    if (result.stdout.includes('Success')) {
        const msgMatch = result.stdout.match(/Success:\s*(.+)/);
        return { success: true, message: msgMatch?.[1] || 'Tutorial step completed' };
    }
    const msgMatch = result.stdout.match(/Failed:\s*(.+)/);
    return { success: false, message: msgMatch?.[1] || result.stdout };
}

// Accept character design via CLI
async function acceptDesign(): Promise<boolean> {
    const result = await rsbot('action', 'design', '--wait');
    return result.stdout.includes('Success');
}

// Find food items in inventory
function findFoodItems(inventory: any[]): any[] {
    const foodNames = [
        'bread', 'meat', 'chicken', 'beef', 'shrimp', 'anchovies',
        'sardine', 'herring', 'trout', 'salmon', 'tuna', 'lobster',
        'swordfish', 'cake', 'pie', 'pizza', 'cheese', 'cabbage',
        'potato', 'onion', 'tomato', 'apple', 'banana', 'orange',
        'cooked'
    ];

    return inventory.filter(item =>
        foodNames.some(food => item.name.toLowerCase().includes(food))
    );
}

// Find sword items in inventory
function findSwordItem(inventory: any[]): any | null {
    const swordNames = ['sword', 'scimitar', 'longsword', 'shortsword', 'dagger'];
    return inventory.find(item =>
        swordNames.some(sword => item.name.toLowerCase().includes(sword))
    );
}

// Find shield items in inventory
function findShieldItem(inventory: any[]): any | null {
    const shieldNames = ['shield', 'kiteshield', 'sq shield', 'defender'];
    return inventory.find(item =>
        shieldNames.some(shield => item.name.toLowerCase().includes(shield))
    );
}

// Debug flag for ground items logging
let groundItemsDebugLogged = false;

// Get nearby ground items via CLI
async function getGroundItems(): Promise<any[]> {
    const result = await rsbot('ground');
    const items: any[] = [];
    const lines = result.stdout.split('\n');

    // Debug: log raw output on first call when items found
    if (!groundItemsDebugLogged && result.stdout && !result.stdout.includes('No ground items')) {
        console.log(`  [DEBUG] Ground items raw output: ${result.stdout.substring(0, 300)}`);
        groundItemsDebugLogged = true;
    }

    for (const line of lines) {
        // Format: "  Bones x1 at (3222, 3218) - 2 tiles (id: 526)"
        const match = line.match(/^\s*(.+?)\s+x(\d+)\s+at\s+\((\d+),\s*(\d+)\)\s+-\s+(\d+)\s+tiles\s+\(id:\s*(\d+)\)/);
        if (match) {
            items.push({
                name: match[1].trim(),
                count: parseInt(match[2]),
                x: parseInt(match[3]),
                z: parseInt(match[4]),
                distance: parseInt(match[5]),
                id: parseInt(match[6])
            });
        }
    }
    return items;
}

// Pick up ground item via CLI
async function pickupItem(x: number, z: number, itemId: number): Promise<boolean> {
    const result = await rsbot('action', 'pickup', x.toString(), z.toString(), itemId.toString(), '--wait');
    return result.stdout.includes('Success');
}

// Find bones on the ground
function findBonesOnGround(groundItems: any[]): any | null {
    // Look for bones items - bones have id 526 (regular bones)
    return groundItems.find(item =>
        item.name.toLowerCase().includes('bones') && item.distance <= 10
    );
}

// Find bones in inventory
function findBonesInInventory(inventory: any[]): any | null {
    return inventory.find(item => item.name.toLowerCase().includes('bones'));
}

// Bury bones from inventory (option 1 = Bury)
async function buryBones(slot: number): Promise<boolean> {
    const result = await rsbot('action', 'use-item', slot.toString(), '1', '--wait');
    return result.stdout.includes('Success');
}

// Find attackable NPCs (prioritize men for bones)
function findAttackableNpc(npcs: any[]): any | null {
    const targetNames = ['man', 'woman', 'rat', 'guard', 'goblin', 'chicken'];

    // Prioritize by name, then by distance
    for (const targetName of targetNames) {
        const target = npcs.find(npc => {
            const name = npc.name.toLowerCase();
            const hasAttack = npc.optionsWithIndex?.some((opt: any) =>
                opt.text.toLowerCase() === 'attack'
            );
            return name.includes(targetName) && hasAttack;
        });
        if (target) return target;
    }

    // Fallback: any NPC with attack option
    return npcs.find(npc =>
        npc.optionsWithIndex?.some((opt: any) => opt.text.toLowerCase() === 'attack')
    );
}

async function runCombatTraining(): Promise<boolean> {
    console.log(`\n=== Combat Training Test ===`);
    console.log(`Training Style: ${TRAIN_STYLE}`);
    console.log(`Max Combat Turns: ${MAX_COMBAT_TURNS}`);

    const result: CombatResult = {
        botName: '',
        startTime: new Date().toISOString(),
        endTime: '',
        success: false,
        equipped: { sword: false, shield: false },
        combatStyle: {
            trainMode: TRAIN_STYLE,
            styleChanges: 0,
            attackTurns: 0,
            strengthTurns: 0,
            defenceTurns: 0
        },
        combatStats: {
            totalKills: 0,
            ratsKilled: 0,
            humansKilled: 0,
            foodEaten: 0,
            damageTaken: 0,
            bonesPickedUp: 0,
            bonesBuried: 0
        },
        skillLevels: {
            initialAttack: 1,
            initialStrength: 1,
            initialDefence: 1,
            finalAttack: 1,
            finalStrength: 1,
            finalDefence: 1,
            gainedAttackLevel: false,
            gainedStrengthLevel: false,
            gainedDefenceLevel: false
        },
        turns: []
    };

    let lastHealth = 10;
    let currentCombatStyle = 0;
    let session: BotSession | null = null;

    try {
        // Setup bot and skip tutorial
        console.log('Setting up bot and skipping tutorial...');
        session = await setupBotWithTutorialSkip(BOT_NAME);
        rsbot = session.rsbotCompat;
        const page = session.page;
        result.botName = session.botName;

        // Now set up run directory with actual bot name
        const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        RUN_DIR = join(import.meta.dir, '..', 'runs', `${RUN_TIMESTAMP}-combat-training-${session.botName}`);
        SCREENSHOT_DIR = join(RUN_DIR, 'screenshots');
        await ensureDir(RUN_DIR);
        await ensureDir(SCREENSHOT_DIR);

        console.log(`Bot ${session.botName} ready in Lumbridge!`);

        // Record initial combat skill levels
        const initialStats = await getCombatStats();
        if (initialStats) {
            result.skillLevels.initialAttack = initialStats.attack;
            result.skillLevels.initialStrength = initialStats.strength;
            result.skillLevels.initialDefence = initialStats.defence;
            console.log(`Initial Combat Levels: Attack=${initialStats.attack}, Strength=${initialStats.strength}, Defence=${initialStats.defence}`);
        }

        // Step 1: Equip sword and shield
        console.log('\n--- Step 1: Equip Sword and Shield (via CLI) ---');

        const inventory = await getInventory();
        console.log(`  Inventory has ${inventory.length} items`);

        const swordItem = findSwordItem(inventory);
        if (swordItem) {
            console.log(`  Found sword: ${swordItem.name} at slot ${swordItem.slot}`);
            const equipped = await equipItem(swordItem.slot);
            if (equipped) {
                result.equipped.sword = true;
                console.log(`  Equipped ${swordItem.name}!`);
            } else {
                console.log(`  Failed to equip sword`);
            }
        } else {
            console.log('  No sword found in inventory');
        }

        await sleep(500);

        // Re-fetch inventory after equipping sword
        const inventory2 = await getInventory();
        const shieldItem = findShieldItem(inventory2);
        if (shieldItem) {
            console.log(`  Found shield: ${shieldItem.name} at slot ${shieldItem.slot}`);
            const equipped = await equipItem(shieldItem.slot);
            if (equipped) {
                result.equipped.shield = true;
                console.log(`  Equipped ${shieldItem.name}!`);
            } else {
                console.log(`  Failed to equip shield`);
            }
        } else {
            console.log('  No shield found in inventory');
        }

        await takeScreenshot(page, '03-equipped');

        // Get initial health
        const initialHealth = await getPlayerHealth();
        if (initialHealth) {
            lastHealth = initialHealth.current;
            console.log(`\nStarting health: ${initialHealth.current}/${initialHealth.max}`);
        }

        // Step 2: Set initial combat style
        console.log(`\n--- Step 2: Setting Combat Style (mode: ${TRAIN_STYLE}) ---`);
        const styleNames = ['Accurate (Attack)', 'Aggressive (Strength)', 'Defensive (Defence)', 'Controlled (Shared)'];
        const initialStyleResult = await getStyleForTraining(TRAIN_STYLE, 0);
        console.log(`  ${initialStyleResult.reason}`);
        console.log(`  Desired style: ${styleNames[initialStyleResult.style]}`);

        const styleSet = await setCombatStyle(initialStyleResult.style);
        if (styleSet) {
            currentCombatStyle = initialStyleResult.style;
            result.combatStyle.styleChanges++;
            console.log(`  Combat style set!`);
        } else {
            console.log(`  Warning: Could not set combat style`);
        }
        await takeScreenshot(page, '04-combat-style-set');

        // Step 3: Combat training loop
        console.log(`\n--- Step 3: Combat Training (${MAX_COMBAT_TURNS} turns max) ---`);

        let currentTarget: string | null = null;
        let lastKillTurn = 0; // Track when we last started an attack (potential kill)

        for (let turn = 1; turn <= MAX_COMBAT_TURNS; turn++) {
            const turnRecord: TurnRecord = {
                turn,
                timestamp: new Date().toISOString(),
                health: lastHealth,
                action: '',
                result: ''
            };

            // Check for early exit - if all 3 combat skills gained a level
            if (turn % 10 === 0) {
                const currentStats = await getCombatStats();
                if (currentStats) {
                    const gainedAtk = currentStats.attack > result.skillLevels.initialAttack;
                    const gainedStr = currentStats.strength > result.skillLevels.initialStrength;
                    const gainedDef = currentStats.defence > result.skillLevels.initialDefence;
                    if (gainedAtk && gainedStr && gainedDef) {
                        console.log(`  Turn ${turn}: SUCCESS - Gained levels in all 3 combat skills!`);
                        console.log(`    Attack: ${result.skillLevels.initialAttack} -> ${currentStats.attack}`);
                        console.log(`    Strength: ${result.skillLevels.initialStrength} -> ${currentStats.strength}`);
                        console.log(`    Defence: ${result.skillLevels.initialDefence} -> ${currentStats.defence}`);
                        break;
                    }
                }
            }

            // Track style turns
            if (currentCombatStyle === 0) result.combatStyle.attackTurns++;
            else if (currentCombatStyle === 1) result.combatStyle.strengthTurns++;
            else if (currentCombatStyle === 2) result.combatStyle.defenceTurns++;

            // Check if we need to switch combat style
            // For cycle mode: switch at fixed intervals
            // For auto/balance mode: re-check stats periodically to train lowest
            const shouldCheckStyle = (TRAIN_STYLE === 'cycle' && turn % STYLE_SWITCH_INTERVAL === 0) ||
                                    ((TRAIN_STYLE === 'auto' || TRAIN_STYLE === 'balance') && turn % 10 === 0);

            if (shouldCheckStyle) {
                const styleResult = await getStyleForTraining(TRAIN_STYLE, turn);
                if (styleResult.style !== currentCombatStyle) {
                    console.log(`  Turn ${turn}: ${styleResult.reason}`);
                    console.log(`  Switching to ${styleNames[styleResult.style]}`);
                    const switched = await setCombatStyle(styleResult.style);
                    if (switched) {
                        currentCombatStyle = styleResult.style;
                        result.combatStyle.styleChanges++;
                    }
                }
            }

            // Close any dialogs
            if (await closeDialog()) {
                turnRecord.action = 'Close dialog';
                turnRecord.result = 'Dialog closed';
                result.turns.push(turnRecord);
                await sleep(TURN_DELAY_MS);
                continue;
            }

            // Check health and eat if needed
            const health = await getPlayerHealth();
            if (health) {
                turnRecord.health = health.current;

                // Track damage taken
                if (health.current < lastHealth) {
                    result.combatStats.damageTaken += (lastHealth - health.current);
                }
                lastHealth = health.current;

                // Eat food if health is low
                if (health.current < EAT_HEALTH_THRESHOLD) {
                    const currentInventory = await getInventory();
                    const foodItems = findFoodItems(currentInventory);

                    if (foodItems.length > 0) {
                        const food = foodItems[0];
                        console.log(`  Turn ${turn}: Health low (${health.current}), eating ${food.name}...`);
                        const ate = await useItem(food.slot);
                        if (ate) {
                            result.combatStats.foodEaten++;
                            turnRecord.action = `Eat ${food.name}`;
                            turnRecord.result = 'Food eaten';
                        } else {
                            turnRecord.action = `Eat ${food.name}`;
                            turnRecord.result = 'Failed to eat';
                        }
                        result.turns.push(turnRecord);
                        await sleep(TURN_DELAY_MS);
                        continue;
                    } else {
                        console.log(`  Turn ${turn}: Health low (${health.current}) but no food!`);
                    }
                }
            }

            // Check if already in combat
            if (await isInCombat()) {
                turnRecord.action = 'In combat';
                turnRecord.result = `Fighting ${currentTarget || 'enemy'}`;
                result.turns.push(turnRecord);

                if (turn % 20 === 0) {
                    console.log(`  Turn ${turn}: In combat with ${currentTarget || 'enemy'}, health: ${turnRecord.health}`);
                    await takeScreenshot(page, `turn-${turn.toString().padStart(3, '0')}-combat`);
                }

                await sleep(TURN_DELAY_MS);
                continue;
            }

            // Not in combat - check for bones to pick up or bury first
            // Step 1: Check if there are bones on the ground to pick up
            const groundItems = await getGroundItems();
            const bonesOnGround = findBonesOnGround(groundItems);

            // Debug: log ground items periodically
            if (turn % 10 === 1 && groundItems.length > 0) {
                console.log(`  Turn ${turn}: Found ${groundItems.length} ground items: ${groundItems.map(i => i.name).join(', ')}`);
            }

            if (bonesOnGround) {
                console.log(`  Turn ${turn}: Picking up ${bonesOnGround.name} at (${bonesOnGround.x}, ${bonesOnGround.z})`);
                const pickedUp = await pickupItem(bonesOnGround.x, bonesOnGround.z, bonesOnGround.id);
                if (pickedUp) {
                    result.combatStats.bonesPickedUp++;
                    turnRecord.action = `Pick up ${bonesOnGround.name}`;
                    turnRecord.result = 'Bones picked up';
                } else {
                    turnRecord.action = `Pick up ${bonesOnGround.name}`;
                    turnRecord.result = 'Failed to pick up';
                }
                result.turns.push(turnRecord);
                await sleep(TURN_DELAY_MS);
                continue;
            }

            // Step 2: Check if we have bones in inventory to bury
            const currentInv = await getInventory();
            const bonesInInv = findBonesInInventory(currentInv);

            if (bonesInInv) {
                console.log(`  Turn ${turn}: Burying ${bonesInInv.name} from slot ${bonesInInv.slot}`);
                const buried = await buryBones(bonesInInv.slot);
                if (buried) {
                    result.combatStats.bonesBuried++;
                    turnRecord.action = `Bury ${bonesInInv.name}`;
                    turnRecord.result = 'Bones buried';
                } else {
                    turnRecord.action = `Bury ${bonesInInv.name}`;
                    turnRecord.result = 'Failed to bury';
                }
                result.turns.push(turnRecord);
                await sleep(TURN_DELAY_MS);
                continue;
            }

            // Step 3: Find a new target to attack
            const npcs = await getNearbyNpcs();
            const target = findAttackableNpc(npcs);

            if (target) {
                // Find Attack option
                const attackOption = target.optionsWithIndex?.find((opt: any) =>
                    opt.text.toLowerCase() === 'attack'
                );

                if (attackOption) {
                    console.log(`  Turn ${turn}: Attacking ${target.name} #${target.index} (opIndex ${attackOption.opIndex})`);
                    const attacked = await interactNpc(target.index, attackOption.opIndex);

                    if (attacked) {
                        currentTarget = target.name;
                        turnRecord.action = `Attack ${target.name}`;
                        turnRecord.result = 'Attack started';
                        lastKillTurn = turn; // Mark potential kill for bone checking

                        // Track kills (simplistic - assume kill if we attacked and target disappears)
                        if (target.name.toLowerCase().includes('rat')) {
                            result.combatStats.ratsKilled++;
                        } else if (target.name.toLowerCase().includes('man') ||
                                   target.name.toLowerCase().includes('woman')) {
                            result.combatStats.humansKilled++;
                        }
                        result.combatStats.totalKills++;
                    } else {
                        turnRecord.action = `Attack ${target.name}`;
                        turnRecord.result = 'Attack failed';
                    }
                } else {
                    turnRecord.action = 'Find target';
                    turnRecord.result = `Found ${target.name} but no Attack option`;
                }
            } else {
                turnRecord.action = 'Find target';
                turnRecord.result = 'No attackable NPCs nearby';

                // Maybe walk around to find targets
                if (turn % 10 === 0) {
                    const pos = await getPlayerPosition();
                    if (pos) {
                        // Random walk in search of targets
                        const dx = Math.floor(Math.random() * 10) - 5;
                        const dz = Math.floor(Math.random() * 10) - 5;
                        await rsbot('action', 'walk', (pos.x + dx).toString(), (pos.z + dz).toString(), '--wait');
                        console.log(`  Turn ${turn}: No targets, walking to (${pos.x + dx}, ${pos.z + dz})`);
                    }
                }
            }

            result.turns.push(turnRecord);

            // Log progress
            if (turn % 20 === 0 || turn === 1) {
                console.log(`  Turn ${turn}: health=${turnRecord.health}, kills=${result.combatStats.totalKills}, food eaten=${result.combatStats.foodEaten}`);
                await takeScreenshot(page, `turn-${turn.toString().padStart(3, '0')}`);
            }

            await sleep(TURN_DELAY_MS);
        }

        // Get final skill levels
        const finalStats = await getCombatStats();
        if (finalStats) {
            result.skillLevels.finalAttack = finalStats.attack;
            result.skillLevels.finalStrength = finalStats.strength;
            result.skillLevels.finalDefence = finalStats.defence;
            result.skillLevels.gainedAttackLevel = finalStats.attack > result.skillLevels.initialAttack;
            result.skillLevels.gainedStrengthLevel = finalStats.strength > result.skillLevels.initialStrength;
            result.skillLevels.gainedDefenceLevel = finalStats.defence > result.skillLevels.initialDefence;
        }

        // Success criteria: gain at least 1 level in ALL combat skills (Attack, Strength, AND Defence)
        result.success = result.skillLevels.gainedAttackLevel &&
                        result.skillLevels.gainedStrengthLevel &&
                        result.skillLevels.gainedDefenceLevel;

        console.log(`\n--- Combat Training Complete ---`);
        console.log(`Equipped: Sword=${result.equipped.sword}, Shield=${result.equipped.shield}`);
        console.log(`Total Kills: ${result.combatStats.totalKills}`);
        console.log(`  Rats: ${result.combatStats.ratsKilled}`);
        console.log(`  Humans: ${result.combatStats.humansKilled}`);
        console.log(`Food Eaten: ${result.combatStats.foodEaten}`);
        console.log(`Damage Taken: ${result.combatStats.damageTaken}`);
        console.log(`Bones Picked Up: ${result.combatStats.bonesPickedUp}`);
        console.log(`Bones Buried: ${result.combatStats.bonesBuried}`);
        console.log(`\nCombat Style Training:`);
        console.log(`  Training Mode: ${result.combatStyle.trainMode}`);
        console.log(`  Style Changes: ${result.combatStyle.styleChanges}`);
        console.log(`  Attack Turns: ${result.combatStyle.attackTurns}`);
        console.log(`  Strength Turns: ${result.combatStyle.strengthTurns}`);
        console.log(`  Defence Turns: ${result.combatStyle.defenceTurns}`);
        console.log(`\nSkill Progress:`);
        console.log(`  Attack: ${result.skillLevels.initialAttack} -> ${result.skillLevels.finalAttack} (Gained level: ${result.skillLevels.gainedAttackLevel})`);
        console.log(`  Strength: ${result.skillLevels.initialStrength} -> ${result.skillLevels.finalStrength} (Gained level: ${result.skillLevels.gainedStrengthLevel})`);
        console.log(`  Defence: ${result.skillLevels.initialDefence} -> ${result.skillLevels.finalDefence} (Gained level: ${result.skillLevels.gainedDefenceLevel})`);
        console.log(`\nSuccess Criteria: Gain at least 1 level in Attack, Strength, AND Defence`);
        console.log(`Success: ${result.success}`);

        await takeScreenshot(page, '99-final');

        return result.success;

    } catch (error) {
        console.error('Combat training failed:', error);
        result.error = String(error);
        result.endTime = new Date().toISOString();

        // Save results
        const resultPath = join(RUN_DIR, 'result.json');
        await writeFile(resultPath, JSON.stringify(result, null, 2));
        console.log(`\nResults saved to: ${resultPath}`);

        if (session) await session.cleanup();
        return false;
    }

    result.endTime = new Date().toISOString();

    // Save results
    const resultPath = join(RUN_DIR, 'result.json');
    await writeFile(resultPath, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to: ${resultPath}`);

    if (session) await session.cleanup();
    return result.success;
}

// Run the test
runCombatTraining()
    .then(success => {
        if (success) {
            console.log('\n✓ Test PASSED: Gained a level in Attack, Strength, AND Defence!');
            process.exit(0);
        } else {
            console.log('\n✗ Test FAILED: Did not gain all 3 combat levels');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
