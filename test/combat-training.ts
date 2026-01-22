#!/usr/bin/env bun
/**
 * Combat Training Test
 *
 * Tests combat training flow via rsbot CLI:
 * 1. Skip tutorial if needed
 * 2. Equip sword and shield
 * 3. Set combat style to cycle through Attack/Strength/Defence training
 * 4. Find and attack rats or humans (men/women)
 * 5. Monitor health and eat food when damaged
 *
 * Uses Puppeteer to connect the bot, but all game interactions
 * go through the rsbot CLI via the sync service.
 *
 * Usage:
 *   bun run test/combat-training.ts
 *   BOT_NAME=fighter1 bun run test/combat-training.ts
 *   TRAIN_STYLE=strength bun run test/combat-training.ts
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Configuration
const BOT_CLIENT_BASE_URL = 'http://localhost:8888/bot';
const TURN_DELAY_MS = 600;
const MAX_COMBAT_TURNS = 200;
const EAT_HEALTH_THRESHOLD = 10; // Eat when health drops below this
const STYLE_SWITCH_INTERVAL = 50; // Switch combat styles every N turns

// Training style from environment: attack, strength, defence, or cycle (default)
const TRAIN_STYLE = (process.env.TRAIN_STYLE || 'cycle').toLowerCase();

// Combat style indices
const COMBAT_STYLES = {
    attack: 0,      // Accurate - trains Attack
    strength: 1,    // Aggressive - trains Strength
    defence: 2,     // Defensive - trains Defence
    controlled: 3   // Controlled - trains all (shared)
} as const;

// CLI path
const RSBOT_CLI = join(import.meta.dir, '..', 'agent', 'cli.ts');

// Bot name from environment or generate one
const BOT_NAME = process.env.BOT_NAME || 'fighter' + Math.random().toString(36).substring(2, 5);

// Create run directory for this test
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const RUN_DIR = join(import.meta.dir, '..', 'runs', `${RUN_TIMESTAMP}-combat-training-${BOT_NAME}`);
const SCREENSHOT_DIR = join(RUN_DIR, 'screenshots');

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

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

// Execute rsbot CLI command and return output
async function rsbot(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        const proc = spawn('bun', [RSBOT_CLI, '--bot', BOT_NAME, ...args], {
            cwd: join(import.meta.dir, '..'),
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
        });

        proc.on('error', (err) => {
            stderr += err.message;
            resolve({ stdout, stderr, exitCode: 1 });
        });
    });
}

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

// Get the style index for the desired training mode
function getStyleForTraining(trainMode: string, turnCount: number): number {
    switch (trainMode) {
        case 'attack':
            return COMBAT_STYLES.attack;
        case 'strength':
            return COMBAT_STYLES.strength;
        case 'defence':
        case 'defense':
            return COMBAT_STYLES.defence;
        case 'controlled':
        case 'shared':
            return COMBAT_STYLES.controlled;
        case 'cycle':
        default:
            // Cycle through attack -> strength -> defence every STYLE_SWITCH_INTERVAL turns
            const cyclePosition = Math.floor(turnCount / STYLE_SWITCH_INTERVAL) % 3;
            return cyclePosition; // 0 = attack, 1 = strength, 2 = defence
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

// Find attackable NPCs (rats or humans)
function findAttackableNpc(npcs: any[]): any | null {
    const targetNames = ['rat', 'man', 'woman', 'guard', 'goblin', 'chicken'];

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

async function runCombatTraining(): Promise<void> {
    console.log(`\n=== Combat Training Test (CLI) ===`);
    console.log(`Bot Name: ${BOT_NAME}`);
    console.log(`Training Style: ${TRAIN_STYLE}`);
    console.log(`Max Combat Turns: ${MAX_COMBAT_TURNS}`);
    console.log(`Style Switch Interval: ${STYLE_SWITCH_INTERVAL} turns`);
    console.log(`Eat Health Threshold: ${EAT_HEALTH_THRESHOLD}`);
    console.log(`Run Directory: ${RUN_DIR}`);
    console.log(`\nThis test uses Puppeteer to connect, but rsbot CLI for all actions.\n`);

    await ensureDir(RUN_DIR);
    await ensureDir(SCREENSHOT_DIR);

    const result: CombatResult = {
        botName: BOT_NAME,
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
            damageTaken: 0
        },
        turns: []
    };

    let browser: Browser | null = null;
    let lastHealth = 10;
    let currentCombatStyle = 0;

    try {
        // Launch browser
        console.log('Launching browser (non-headless)...');
        browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: { width: 1024, height: 768 }
        });

        const page = await browser.newPage();
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[Combat]') || text.includes('[Attack]') || text.includes('[Sync]')) {
                console.log(`[PAGE] ${text}`);
            }
        });

        // Navigate with bot name in URL
        const botClientUrl = `${BOT_CLIENT_BASE_URL}?bot=${BOT_NAME}`;
        console.log(`Navigating to ${botClientUrl}...`);
        await page.goto(botClientUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await takeScreenshot(page, '00-loaded');

        if (!await waitForClientReady(page)) throw new Error('Client failed to initialize');

        console.log(`Logging in as: ${BOT_NAME}`);
        await login(page, BOT_NAME);

        if (!await waitForInGame(page)) throw new Error('Failed to enter game');
        await takeScreenshot(page, '01-ingame');
        console.log('In game!');

        await sleep(2000);

        // Wait for sync service
        console.log('Waiting for sync service connection...');
        if (!await waitForSyncConnection()) {
            console.log('WARNING: Sync service not connected');
        } else {
            console.log('Sync service connected!');
        }

        // Skip tutorial if needed
        if (await isInTutorial()) {
            console.log('\n--- Skipping Tutorial (via CLI) ---');
            if (await acceptDesign()) {
                console.log('Accepted character design (via CLI)');
                await sleep(1000);
            }

            let tutorialTurns = 0;
            while (await isInTutorial() && tutorialTurns < 30) {
                const skipResult = await skipTutorial();
                console.log(`  Tutorial skip attempt ${tutorialTurns + 1}: ${skipResult.message}`);
                await sleep(1000);
                tutorialTurns++;
            }

            if (await isInTutorial()) {
                throw new Error('Failed to skip tutorial');
            }
            console.log('Tutorial completed!');
        } else {
            console.log('\n--- Already past Tutorial Island ---');
        }
        await takeScreenshot(page, '02-tutorial-done');

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
        console.log(`\n--- Step 2: Setting Combat Style ---`);
        const desiredStyle = getStyleForTraining(TRAIN_STYLE, 0);
        const styleNames = ['Accurate (Attack)', 'Aggressive (Strength)', 'Defensive (Defence)', 'Controlled (Shared)'];
        console.log(`  Desired style: ${styleNames[desiredStyle]}`);

        const styleSet = await setCombatStyle(desiredStyle);
        if (styleSet) {
            currentCombatStyle = desiredStyle;
            result.combatStyle.styleChanges++;
            console.log(`  Combat style set!`);
        } else {
            console.log(`  Warning: Could not set combat style`);
        }
        await takeScreenshot(page, '04-combat-style-set');

        // Step 3: Combat training loop
        console.log(`\n--- Step 3: Combat Training (${MAX_COMBAT_TURNS} turns max) ---`);

        let currentTarget: string | null = null;

        for (let turn = 1; turn <= MAX_COMBAT_TURNS; turn++) {
            const turnRecord: TurnRecord = {
                turn,
                timestamp: new Date().toISOString(),
                health: lastHealth,
                action: '',
                result: ''
            };

            // Track style turns
            if (currentCombatStyle === 0) result.combatStyle.attackTurns++;
            else if (currentCombatStyle === 1) result.combatStyle.strengthTurns++;
            else if (currentCombatStyle === 2) result.combatStyle.defenceTurns++;

            // Check if we need to switch combat style (for cycling mode)
            if (TRAIN_STYLE === 'cycle') {
                const newStyle = getStyleForTraining(TRAIN_STYLE, turn);
                if (newStyle !== currentCombatStyle) {
                    console.log(`  Turn ${turn}: Switching combat style to ${styleNames[newStyle]}`);
                    const switched = await setCombatStyle(newStyle);
                    if (switched) {
                        currentCombatStyle = newStyle;
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

            // Not in combat - find a new target
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

        // Final stats
        result.success = result.combatStats.totalKills > 0 || result.equipped.sword || result.equipped.shield;

        console.log(`\n--- Combat Training Complete ---`);
        console.log(`Equipped: Sword=${result.equipped.sword}, Shield=${result.equipped.shield}`);
        console.log(`Total Kills: ${result.combatStats.totalKills}`);
        console.log(`  Rats: ${result.combatStats.ratsKilled}`);
        console.log(`  Humans: ${result.combatStats.humansKilled}`);
        console.log(`Food Eaten: ${result.combatStats.foodEaten}`);
        console.log(`Damage Taken: ${result.combatStats.damageTaken}`);
        console.log(`\nCombat Style Training:`);
        console.log(`  Training Mode: ${result.combatStyle.trainMode}`);
        console.log(`  Style Changes: ${result.combatStyle.styleChanges}`);
        console.log(`  Attack Turns: ${result.combatStyle.attackTurns}`);
        console.log(`  Strength Turns: ${result.combatStyle.strengthTurns}`);
        console.log(`  Defence Turns: ${result.combatStyle.defenceTurns}`);

        await takeScreenshot(page, '99-final');

    } catch (error) {
        console.error('Combat training failed:', error);
        result.error = String(error);
    } finally {
        result.endTime = new Date().toISOString();

        // Save results
        const resultPath = join(RUN_DIR, 'result.json');
        await writeFile(resultPath, JSON.stringify(result, null, 2));
        console.log(`\nResults saved to: ${resultPath}`);

        if (browser) {
            console.log('\nBrowser will close in 10 seconds...');
            await sleep(10000);
            await browser.close();
        }
    }
}

// Run the test
runCombatTraining().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
