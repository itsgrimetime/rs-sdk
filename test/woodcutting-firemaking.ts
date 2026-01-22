#!/usr/bin/env bun
/**
 * Woodcutting & Firemaking Test
 *
 * Tests woodcutting and firemaking flow via rsbot CLI:
 * 1. Skip tutorial if needed
 * 2. Find an axe in inventory (or spawn one if testing)
 * 3. Find nearby trees
 * 4. Chop trees to get logs
 * 5. Use tinderbox on logs to burn them (item-on-item)
 * 6. Repeat
 *
 * Uses Puppeteer to connect the bot, but all game interactions
 * go through the rsbot CLI via the sync service.
 *
 * Usage:
 *   bun run test/woodcutting-firemaking.ts
 *   BOT_NAME=woodcutter1 bun run test/woodcutting-firemaking.ts
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Configuration
const BOT_CLIENT_BASE_URL = 'http://localhost:8888/bot';
const TURN_DELAY_MS = 800;
const MAX_TURNS = 150;
const SEARCH_RADIUS = 20; // How far to search for trees

// CLI path
const RSBOT_CLI = join(import.meta.dir, '..', 'agent', 'cli.ts');

// Bot name from environment or generate one
const BOT_NAME = process.env.BOT_NAME || 'woodcut' + Math.random().toString(36).substring(2, 5);

// Create run directory for this test
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const RUN_DIR = join(import.meta.dir, '..', 'runs', `${RUN_TIMESTAMP}-woodcutting-firemaking-${BOT_NAME}`);
const SCREENSHOT_DIR = join(RUN_DIR, 'screenshots');

interface TestResult {
    botName: string;
    startTime: string;
    endTime: string;
    success: boolean;
    stats: {
        treesChopped: number;
        logsBurned: number;
        firesMade: number;
        woodcuttingXP: number;
        firemakingXP: number;
    };
    turns: TurnRecord[];
    error?: string;
}

interface TurnRecord {
    turn: number;
    timestamp: string;
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
        // [0] Bronze axe x1 (id: 1351) [1:Use, 2:Wield, 5:Drop]
        const match = line.match(/^\s*\[(\d+)\]\s*(.+?)\s*x(\d+)\s*\(id:\s*(\d+)\)(?:\s*\[(.+)\])?/);
        if (match) {
            const optionsWithIndex = parseOptionsWithIndex(match[5] || '');
            items.push({
                slot: parseInt(match[1]),
                name: match[2].trim(),
                count: parseInt(match[3]),
                id: parseInt(match[4]),
                options: optionsWithIndex.map(o => o.text),
                optionsWithIndex
            });
        }
    }
    return items;
}

// Get nearby locations (objects like trees) via CLI
async function getNearbyLocations(): Promise<any[]> {
    const result = await rsbot('locations');
    const locs: any[] = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
        // Format: "  Tree at (3200, 3220) - 5 tiles, id: 1276 [1:Chop down]"
        const match = line.match(/^\s*(.+?)\s+at\s+\((\d+),\s*(\d+)\)\s*-\s*(\d+)\s*tiles,\s*id:\s*(\d+)(?:\s*\[(.+)\])?/);
        if (match) {
            const optionsWithIndex = parseOptionsWithIndex(match[6] || '');
            locs.push({
                name: match[1].trim(),
                x: parseInt(match[2]),
                z: parseInt(match[3]),
                distance: parseInt(match[4]),
                id: parseInt(match[5]),
                options: optionsWithIndex.map(o => o.text),
                optionsWithIndex
            });
        }
    }
    return locs;
}

// Get recent messages
async function getMessages(): Promise<string[]> {
    const result = await rsbot('messages');
    return result.stdout.split('\n').filter(line => line.trim());
}

// Wait for firemaking to complete by monitoring messages
// Returns: { success: boolean, message: string }
async function waitForFiremaking(maxWaitMs: number = 10000): Promise<{ success: boolean; message: string }> {
    const startTime = Date.now();
    const checkInterval = 600; // Check every 600ms (roughly 1 game tick)

    while (Date.now() - startTime < maxWaitMs) {
        const messages = await getMessages();

        // Check for success messages
        for (const msg of messages) {
            const lower = msg.toLowerCase();
            if (lower.includes('fire catches') || lower.includes('logs begin to burn')) {
                return { success: true, message: 'Fire lit successfully!' };
            }
            // Check for failure messages
            if (lower.includes("can't light a fire here")) {
                return { success: false, message: "Can't light fire here" };
            }
            if (lower.includes('need a firemaking level')) {
                return { success: false, message: 'Firemaking level too low' };
            }
            if (lower.includes('need a tinderbox')) {
                return { success: false, message: 'No tinderbox' };
            }
        }

        // Also check if logs disappeared from inventory (fire was lit)
        const inventory = await getInventory();
        const logs = findItemByName(inventory, /logs/i);
        if (!logs) {
            // Logs gone - either burned or something else happened
            // Check messages one more time
            const finalMessages = await getMessages();
            for (const msg of finalMessages) {
                if (msg.toLowerCase().includes('fire catches') || msg.toLowerCase().includes('logs begin to burn')) {
                    return { success: true, message: 'Fire lit!' };
                }
            }
            // Logs gone but no fire message - assume success
            return { success: true, message: 'Logs consumed (fire assumed)' };
        }

        await sleep(checkInterval);
    }

    return { success: false, message: 'Timeout waiting for fire' };
}

// Find item in inventory by name pattern
function findItemByName(inventory: any[], pattern: string | RegExp): any | null {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    return inventory.find(item => regex.test(item.name)) || null;
}

// Find location by name pattern
function findLocByName(locations: any[], pattern: string | RegExp): any | null {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    return locations.find(loc => regex.test(loc.name)) || null;
}

// Find all locations matching a pattern
function findAllLocsByName(locations: any[], pattern: string | RegExp): any[] {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    return locations.filter(loc => regex.test(loc.name));
}

// Interact with a location (object)
async function interactLoc(x: number, z: number, locId: number, optionIndex: number): Promise<boolean> {
    const result = await rsbot('action', 'interact-loc', x.toString(), z.toString(), locId.toString(), optionIndex.toString(), '--wait');
    return result.stdout.includes('Success');
}

// Walk to a position
async function walkTo(x: number, z: number, run: boolean = true): Promise<boolean> {
    const args = ['action', 'walk', x.toString(), z.toString()];
    if (run) args.push('--run');
    args.push('--wait');
    const result = await rsbot(...args);
    return result.stdout.includes('Success');
}

// Walk in a random direction to explore for trees
async function walkToExplore(): Promise<{ success: boolean; direction: string }> {
    const pos = await getPlayerPosition();
    if (!pos) return { success: false, direction: 'unknown' };

    // Pick a random direction and walk 10-15 tiles
    const directions = [
        { name: 'north', dx: 0, dz: 1 },
        { name: 'south', dx: 0, dz: -1 },
        { name: 'east', dx: 1, dz: 0 },
        { name: 'west', dx: -1, dz: 0 },
        { name: 'northeast', dx: 1, dz: 1 },
        { name: 'northwest', dx: -1, dz: 1 },
        { name: 'southeast', dx: 1, dz: -1 },
        { name: 'southwest', dx: -1, dz: -1 }
    ];

    const dir = directions[Math.floor(Math.random() * directions.length)];
    const distance = 10 + Math.floor(Math.random() * 6); // 10-15 tiles

    const targetX = pos.x + (dir.dx * distance);
    const targetZ = pos.z + (dir.dz * distance);

    const success = await walkTo(targetX, targetZ, true);
    return { success, direction: dir.name };
}

// Use item on another item in inventory
async function useItemOnItem(sourceSlot: number, targetSlot: number): Promise<boolean> {
    const result = await rsbot('action', 'item-on-item', sourceSlot.toString(), targetSlot.toString(), '--wait');
    return result.stdout.includes('Success');
}

// Check if in tutorial area
async function isInTutorial(): Promise<boolean> {
    const pos = await getPlayerPosition();
    if (!pos) return true;
    return pos.x < 3200;
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
        if (client && client.autoLogin) {
            client.autoLogin(
                (document.getElementById('bot-username') as HTMLInputElement).value,
                (document.getElementById('bot-password') as HTMLInputElement).value
            );
        }
    });
}

// Accept character design via CLI
async function acceptDesign(): Promise<{ accepted: boolean; message: string }> {
    const result = await rsbot('action', 'design', '--wait');
    if (result.stdout.includes('Success')) {
        return { accepted: true, message: 'Character design accepted' };
    }
    return { accepted: false, message: result.stdout };
}

// Main test function
async function runTest(): Promise<void> {
    console.log(`\n=== Woodcutting & Firemaking Test ===`);
    console.log(`Bot Name: ${BOT_NAME}`);
    console.log(`Max Turns: ${MAX_TURNS}`);
    console.log(`Run Directory: ${RUN_DIR}`);
    console.log(`\nThis test uses Puppeteer to connect, but rsbot CLI for all actions.\n`);

    // Create directories
    await ensureDir(RUN_DIR);
    await ensureDir(SCREENSHOT_DIR);

    const result: TestResult = {
        botName: BOT_NAME,
        startTime: new Date().toISOString(),
        endTime: '',
        success: false,
        stats: {
            treesChopped: 0,
            logsBurned: 0,
            firesMade: 0,
            woodcuttingXP: 0,
            firemakingXP: 0
        },
        turns: [],
        error: undefined
    };

    let browser: Browser | null = null;

    try {
        // Launch browser in non-headless mode
        console.log('Launching browser (non-headless)...');
        browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: { width: 1024, height: 768 }
        });

        const page = await browser.newPage();

        // Enable console logging from the page
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[Client]') || text.includes('logs') || text.includes('fire') || text.includes('[Sync]')) {
                console.log(`[PAGE] ${text}`);
            }
        });

        page.on('pageerror', err => {
            console.error(`[PAGE ERROR] ${err.message}`);
        });

        // Navigate to bot client with bot name in URL
        const botClientUrl = `${BOT_CLIENT_BASE_URL}?bot=${BOT_NAME}`;
        console.log(`Navigating to ${botClientUrl}...`);
        await page.goto(botClientUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await takeScreenshot(page, '00-page-loaded');

        // Wait for client to initialize
        console.log('Waiting for client to initialize...');
        const clientReady = await waitForClientReady(page);
        if (!clientReady) {
            throw new Error('Client failed to initialize');
        }

        // Login
        console.log(`Logging in as: ${BOT_NAME}`);
        await login(page, BOT_NAME);
        await takeScreenshot(page, '01-login-started');

        // Wait for in-game
        console.log('Waiting to enter game...');
        const inGame = await waitForInGame(page);
        if (!inGame) {
            await takeScreenshot(page, 'error-not-ingame');
            throw new Error('Failed to enter game');
        }
        await takeScreenshot(page, '02-in-game');
        console.log('In game!');

        // Wait for game to settle
        await sleep(2000);

        // Wait for sync service to connect
        console.log('Waiting for sync service connection...');
        const syncConnected = await waitForSyncConnection();
        if (!syncConnected) {
            console.log('WARNING: Sync service not connected. CLI commands may fail.');
        } else {
            console.log('Sync service connected!');
        }

        // Accept character design via CLI
        const designResult = await acceptDesign();
        if (designResult.accepted) {
            console.log('Accepted character design (via CLI)');
            await sleep(1000);
        }
        await takeScreenshot(page, '03-after-design');

        // Skip tutorial via CLI
        console.log('\n--- Skipping Tutorial (via CLI) ---');
        let tutorialAttempts = 0;
        while (await isInTutorial() && tutorialAttempts < 20) {
            tutorialAttempts++;
            const skipResult = await skipTutorial();
            console.log(`Tutorial skip attempt ${tutorialAttempts}: ${skipResult.message}`);

            if (skipResult.success) {
                await sleep(1500);
            } else {
                await sleep(800);
            }
        }

        const stillInTutorial = await isInTutorial();
        console.log(`Tutorial skipped: ${!stillInTutorial}`);
        await takeScreenshot(page, '04-tutorial-done');

        // === Main Woodcutting/Firemaking Loop ===
        console.log('\n--- Starting Woodcutting & Firemaking ---');

        // Check for axe and tinderbox
        console.log('\n--- Step 1: Check Inventory ---');
        let inventory = await getInventory();
        console.log(`Inventory has ${inventory.length} items`);

        const axe = findItemByName(inventory, /axe/i);
        const tinderbox = findItemByName(inventory, /tinderbox/i);

        if (axe) {
            console.log(`Found axe: ${axe.name} at slot ${axe.slot}`);
        } else {
            console.log('WARNING: No axe found in inventory!');
        }

        if (tinderbox) {
            console.log(`Found tinderbox: ${tinderbox.name} at slot ${tinderbox.slot}`);
        } else {
            console.log('WARNING: No tinderbox found in inventory!');
        }

        // Main loop
        let isChopping = false;
        let previousLogCount = 0; // Track log count to detect when we get new logs

        for (let turn = 1; turn <= MAX_TURNS; turn++) {
            const turnRecord: TurnRecord = {
                turn,
                timestamp: new Date().toISOString(),
                action: '',
                result: ''
            };

            // Close any dialogs
            const dialog = await checkDialog();
            if (dialog.isOpen) {
                await closeDialog();
                turnRecord.action = 'Close dialog';
                turnRecord.result = 'Closed dialog';
                result.turns.push(turnRecord);
                await sleep(TURN_DELAY_MS);
                continue;
            }

            // Refresh inventory
            inventory = await getInventory();
            const logs = findItemByName(inventory, /logs/i);
            const currentTinderbox = findItemByName(inventory, /tinderbox/i);

            // Track log count changes to detect successful chops
            const currentLogCount = logs ? logs.count : 0;
            if (currentLogCount > previousLogCount && isChopping) {
                const logsGained = currentLogCount - previousLogCount;
                result.stats.treesChopped += logsGained;
                console.log(`Got ${logsGained} logs! (Total trees chopped: ${result.stats.treesChopped})`);
                isChopping = false;
            }
            previousLogCount = currentLogCount;

            // Priority 1: If we have logs and tinderbox, burn them
            // Note: Game expects "use logs ON tinderbox" (script is [opheldu,tinderbox])
            if (logs && currentTinderbox) {
                console.log(`Turn ${turn}: Using logs (slot ${logs.slot}) on tinderbox (slot ${currentTinderbox.slot})`);
                turnRecord.action = `Use logs on tinderbox`;

                const burnResult = await useItemOnItem(logs.slot, currentTinderbox.slot);
                if (burnResult) {
                    // Wait for firemaking to complete
                    console.log(`  Waiting for firemaking to complete...`);
                    const fireResult = await waitForFiremaking(12000); // 12 second timeout

                    if (fireResult.success) {
                        result.stats.firesMade++;
                        result.stats.logsBurned++;
                        turnRecord.result = `Fire lit! ${fireResult.message}`;
                        console.log(`  ${fireResult.message} (Total fires: ${result.stats.firesMade})`);
                        // Reset log count tracking since we consumed logs
                        previousLogCount = 0;
                    } else {
                        turnRecord.result = `Firemaking failed: ${fireResult.message}`;
                        console.log(`  Failed: ${fireResult.message}`);
                    }
                    isChopping = false;
                } else {
                    turnRecord.result = 'Failed to use logs on tinderbox';
                }
            }
            // Priority 2: Find and chop a tree
            else {
                const locations = await getNearbyLocations();
                const trees = findAllLocsByName(locations, /tree/i);

                // Filter to actual trees (not tree stumps, etc.)
                const chopableTrees = trees.filter(t =>
                    t.options && t.options.some((o: string) => o.toLowerCase().includes('chop'))
                );

                if (chopableTrees.length > 0) {
                    // Find closest tree
                    const nearestTree = chopableTrees.sort((a: any, b: any) => a.distance - b.distance)[0];

                    // Find the chop option
                    const chopOption = nearestTree.optionsWithIndex.find((o: any) =>
                        o.text.toLowerCase().includes('chop')
                    );
                    const optionIndex = chopOption ? chopOption.opIndex : 1;

                    console.log(`Turn ${turn}: Chopping ${nearestTree.name} at (${nearestTree.x}, ${nearestTree.z})`);
                    turnRecord.action = `Chop ${nearestTree.name}`;

                    const chopResult = await interactLoc(nearestTree.x, nearestTree.z, nearestTree.id, optionIndex);
                    if (chopResult) {
                        turnRecord.result = 'Chopping tree';
                        isChopping = true;
                    } else {
                        turnRecord.result = 'Failed to chop tree';
                    }
                } else {
                    // No trees found, walk to explore
                    console.log(`Turn ${turn}: No trees found nearby, walking to explore...`);
                    const exploreResult = await walkToExplore();
                    turnRecord.action = `Walk ${exploreResult.direction} to find trees`;
                    turnRecord.result = exploreResult.success ? `Walking ${exploreResult.direction}` : 'Failed to walk';
                }
            }

            result.turns.push(turnRecord);

            // Take screenshot every 20 turns
            if (turn % 20 === 0 || turn === 1) {
                await takeScreenshot(page, `turn-${turn.toString().padStart(3, '0')}`);
            }

            // Log progress every 10 turns
            if (turn % 10 === 0) {
                console.log(`Progress - Turn ${turn}: Trees chopped: ${result.stats.treesChopped}, Fires made: ${result.stats.firesMade}`);
            }

            await sleep(TURN_DELAY_MS);
        }

        // Final stats
        result.success = result.stats.treesChopped > 0 || result.stats.firesMade > 0;
        await takeScreenshot(page, '99-final');

        console.log(`\n--- Results ---`);
        console.log(`Trees Chopped: ${result.stats.treesChopped}`);
        console.log(`Logs Burned: ${result.stats.logsBurned}`);
        console.log(`Fires Made: ${result.stats.firesMade}`);
        console.log(`Success: ${result.success}`);

    } catch (error) {
        console.error('Test failed:', error);
        result.error = String(error);
        result.endTime = new Date().toISOString();
        throw error;
    } finally {
        result.endTime = new Date().toISOString();

        // Save results
        const resultPath = join(RUN_DIR, 'result.json');
        await writeFile(resultPath, JSON.stringify(result, null, 2));
        console.log(`\nResults saved to: ${resultPath}`);

        // Keep browser open for observation (close after 10 seconds)
        if (browser) {
            console.log('\nBrowser will close in 10 seconds...');
            await sleep(10000);
            await browser.close();
        }
    }
}

// Run the test
runTest().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
