#!/usr/bin/env bun
/**
 * Shop Benchmark Test
 *
 * Tests the full shop interaction flow via rsbot CLI:
 * 1. Navigate to shop location (3212, 3246)
 * 2. Open door if needed
 * 3. Trade with shopkeeper
 * 4. Sell bronze dagger
 * 5. Buy hammer
 *
 * Uses Puppeteer to connect the bot, but all game interactions
 * go through the rsbot CLI via the sync service.
 *
 * Usage:
 *   bun run test/shop-benchmark.ts
 *   BOT_NAME=shopper1 bun run test/shop-benchmark.ts
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Configuration
const BOT_CLIENT_BASE_URL = 'http://localhost:8888/bot';
const SHOP_LOCATION = { x: 3212, z: 3246 };
const TURN_DELAY_MS = 600;
const MAX_ATTEMPTS = 100;

// CLI path
const RSBOT_CLI = join(import.meta.dir, '..', 'agent', 'cli.ts');

// Bot name from environment or generate one
const BOT_NAME = process.env.BOT_NAME || 'shop' + Math.random().toString(36).substring(2, 5);

// Create run directory for this test
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const RUN_DIR = join(import.meta.dir, '..', 'runs', `${RUN_TIMESTAMP}-shop-benchmark-${BOT_NAME}`);
const SCREENSHOT_DIR = join(RUN_DIR, 'screenshots');

interface BenchmarkResult {
    botName: string;
    startTime: string;
    endTime: string;
    success: boolean;
    steps: StepResult[];
    finalPosition: { x: number; z: number } | null;
    error?: string;
}

interface StepResult {
    step: string;
    success: boolean;
    message: string;
    timestamp: string;
    turns: number;
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
// Format: "1:Open, 2:Close" -> [{ opIndex: 1, text: "Open" }, { opIndex: 2, text: "Close" }]
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
        // Fallback for old format without index
        return { opIndex: 1, text: trimmed };
    });
}

// Get nearby locations via CLI
async function getNearbyLocations(): Promise<any[]> {
    const result = await rsbot('locations');
    // Parse the output format (new with indices):
    //   Door at (3211, 3246) - 2 tiles, id: 1533 [1:Open, 2:Close]
    const locs: any[] = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
        const match = line.match(/^\s*(.+?) at \((\d+),\s*(\d+)\)\s*-\s*(\d+) tiles,\s*id:\s*(\d+)\s*\[(.+)\]/);
        if (match) {
            const optionsWithIndex = parseOptionsWithIndex(match[6]);
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

// Get nearby NPCs via CLI
async function getNearbyNpcs(): Promise<any[]> {
    const result = await rsbot('npcs');
    // Parse the output format (new with indices):
    //   #1234: Shop keeper (Lvl 0) - 3 tiles [1:Talk-to, 3:Trade]
    const npcs: any[] = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
        const match = line.match(/^\s*#(\d+):\s*(.+?)(?:\s*\(Lvl \d+\))?\s*-\s*(\d+) tiles(?:\s*\[(.+)\])?/);
        if (match) {
            const optionsWithIndex = parseOptionsWithIndex(match[4] || '');
            npcs.push({
                index: parseInt(match[1]),
                name: match[2].trim(),
                distance: parseInt(match[3]),
                options: optionsWithIndex.map(o => o.text),
                optionsWithIndex
            });
        }
    }
    return npcs;
}

// Check if shop is open via CLI
async function isShopOpen(): Promise<boolean> {
    const result = await rsbot('shop');
    return !result.stdout.includes('Shop: Not open');
}

// Get shop state via CLI
async function getShopState(): Promise<{ shopItems: any[]; playerItems: any[] } | null> {
    const result = await rsbot('shop');
    if (result.stdout.includes('Shop: Not open')) {
        return null;
    }

    // Parse shop items
    const shopItems: any[] = [];
    const playerItems: any[] = [];

    const lines = result.stdout.split('\n');
    let section = '';
    for (const line of lines) {
        if (line.includes('Shop Items (to buy)')) {
            section = 'shop';
        } else if (line.includes('Your Items (to sell)')) {
            section = 'player';
        } else {
            // Parse item line: [0] Bronze dagger x1 (id: 1205)
            const match = line.match(/^\s*\[(\d+)\]\s*(.+?)\s*x(\d+)\s*\(id:\s*(\d+)\)/);
            if (match) {
                const item = {
                    slot: parseInt(match[1]),
                    name: match[2].trim(),
                    count: parseInt(match[3]),
                    id: parseInt(match[4])
                };
                if (section === 'shop') {
                    shopItems.push(item);
                } else if (section === 'player') {
                    playerItems.push(item);
                }
            }
        }
    }

    return { shopItems, playerItems };
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

// Walk to location via CLI
async function walkTo(x: number, z: number): Promise<boolean> {
    const result = await rsbot('action', 'walk', x.toString(), z.toString(), '--run', '--wait');
    return result.stdout.includes('Success');
}

// Interact with location via CLI
async function interactLoc(x: number, z: number, locId: number, optionIndex: number): Promise<boolean> {
    const result = await rsbot('action', 'interact-loc', x.toString(), z.toString(), locId.toString(), optionIndex.toString(), '--wait');
    return result.stdout.includes('Success');
}

// Interact with NPC via CLI
async function interactNpc(npcIndex: number, optionIndex: number): Promise<boolean> {
    const result = await rsbot('action', 'interact-npc', npcIndex.toString(), optionIndex.toString(), '--wait');
    return result.stdout.includes('Success');
}

// Buy from shop via CLI
async function shopBuy(slot: number, amount: number = 1): Promise<boolean> {
    const result = await rsbot('action', 'shop-buy', slot.toString(), amount.toString(), '--wait');
    return result.stdout.includes('Success');
}

// Sell to shop via CLI
async function shopSell(slot: number, amount: number = 1): Promise<boolean> {
    const result = await rsbot('action', 'shop-sell', slot.toString(), amount.toString(), '--wait');
    return result.stdout.includes('Success');
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

async function runBenchmark(): Promise<void> {
    console.log(`\n=== Shop Benchmark (CLI) ===`);
    console.log(`Bot Name: ${BOT_NAME}`);
    console.log(`Shop Location: (${SHOP_LOCATION.x}, ${SHOP_LOCATION.z})`);
    console.log(`Run Directory: ${RUN_DIR}`);
    console.log(`\nThis test uses Puppeteer to connect, but rsbot CLI for all actions.\n`);

    await ensureDir(RUN_DIR);
    await ensureDir(SCREENSHOT_DIR);

    const result: BenchmarkResult = {
        botName: BOT_NAME,
        startTime: new Date().toISOString(),
        endTime: '',
        success: false,
        steps: [],
        finalPosition: null
    };

    let browser: Browser | null = null;
    let totalTurns = 0;

    const addStep = (step: string, success: boolean, message: string, turns: number) => {
        result.steps.push({
            step,
            success,
            message,
            timestamp: new Date().toISOString(),
            turns
        });
        console.log(`[${step}] ${success ? 'OK' : 'FAIL'}: ${message} (${turns} turns)`);
    };

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
            if (text.includes('[Walk]') || text.includes('[Shop]') || text.includes('[Sync]')) {
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

    
        // Skip tutorial (only if on Tutorial Island)
        let tutorialTurns = 0;
        if (await isInTutorial()) {
            console.log('\n--- Skipping Tutorial (via CLI) ---');
                // Accept character design via CLI
        if (await acceptDesign()) {
            console.log('Accepted character design (via CLI)');
            await sleep(1000);
        }

        
            while (await isInTutorial() && tutorialTurns < 30) {
                const skipResult = await skipTutorial();
                console.log(`  Tutorial skip attempt ${tutorialTurns + 1}: ${skipResult.message}`);
                await sleep(1000);
                tutorialTurns++;
                totalTurns++;
            }

            if (await isInTutorial()) {
                throw new Error('Failed to skip tutorial');
            }
            addStep('Skip Tutorial', true, 'Tutorial completed', tutorialTurns);
        } else {
            console.log('\n--- Already past Tutorial Island, skipping ---');
            addStep('Skip Tutorial', true, 'Already past tutorial', 0);
        }
        await takeScreenshot(page, '02-tutorial-done');

        // Step 1: Navigate to shop via CLI
        console.log('\n--- Step 1: Navigate to Shop (via CLI) ---');
        let navTurns = 0;
        let arrived = false;

        while (!arrived && navTurns < 150) {
            // Close any dialogs first
            if (await closeDialog()) {
                await sleep(TURN_DELAY_MS);
                navTurns++;
                totalTurns++;
                continue;
            }

            const pos = await getPlayerPosition();
            if (pos) {
                const dist = Math.abs(pos.x - SHOP_LOCATION.x) + Math.abs(pos.z - SHOP_LOCATION.z);
                if (dist <= 3) {
                    arrived = true;
                    break;
                }

                await walkTo(SHOP_LOCATION.x, SHOP_LOCATION.z);
            }

            await sleep(TURN_DELAY_MS);
            navTurns++;
            totalTurns++;

            if (navTurns % 10 === 0) {
                const pos = await getPlayerPosition();
                console.log(`  Navigation turn ${navTurns}: pos=(${pos?.x}, ${pos?.z})`);
                await takeScreenshot(page, `03-nav-${navTurns}`);
            }
        }

        if (!arrived) {
            throw new Error(`Failed to reach shop after ${navTurns} turns`);
        }
        addStep('Navigate to Shop', true, 'Arrived at shop location', navTurns);
        await takeScreenshot(page, '04-at-shop');

        // Step 2: Check for door and open if needed via CLI
        console.log('\n--- Step 2: Check/Open Door (via CLI) ---');
        let doorTurns = 0;
        const locs = await getNearbyLocations();

        const doors = locs.filter(loc => loc.name.toLowerCase().includes('door'));
        if (doors.length > 0) {
            console.log(`  Found ${doors.length} door(s) nearby:`);
            doors.forEach(d => console.log(`    - ${d.name} at (${d.x}, ${d.z}), options: ${JSON.stringify(d.optionsWithIndex)}`));
        }

        // Find a door with an "Open" option
        const closedDoor = locs.find(loc =>
            loc.name.toLowerCase().includes('door') &&
            loc.optionsWithIndex?.some((opt: any) => opt.text.toLowerCase() === 'open')
        );

        if (closedDoor) {
            // Get the correct opIndex for "Open"
            const openOption = closedDoor.optionsWithIndex.find((opt: any) => opt.text.toLowerCase() === 'open');
            const opIndex = openOption?.opIndex || 1;
            console.log(`  Opening door at (${closedDoor.x}, ${closedDoor.z}), id=${closedDoor.id}, opIndex=${opIndex}...`);
            await interactLoc(closedDoor.x, closedDoor.z, closedDoor.id, opIndex);
            await sleep(1500);
            doorTurns++;
            totalTurns++;
            addStep('Open Door', true, `Opened door at (${closedDoor.x}, ${closedDoor.z})`, doorTurns);
        } else {
            addStep('Open Door', true, 'No closed door found (already open or inside)', 0);
        }
        await takeScreenshot(page, '05-door-handled');

        // Step 3: Find and trade with shopkeeper via CLI
        console.log('\n--- Step 3: Trade with Shopkeeper (via CLI) ---');
        let tradeTurns = 0;
        let shopOpened = false;

        while (!shopOpened && tradeTurns < 20) {
            // Close dialogs
            if (await closeDialog()) {
                await sleep(TURN_DELAY_MS);
                tradeTurns++;
                totalTurns++;
                continue;
            }

            // Check if shop is already open
            if (await isShopOpen()) {
                shopOpened = true;
                break;
            }

            // Find shopkeeper
            const npcs = await getNearbyNpcs();
            const shopkeeper = npcs.find(npc =>
                npc.name.toLowerCase().includes('shopkeeper') ||
                npc.name.toLowerCase().includes('shop keeper')
            );

            if (shopkeeper) {
                // Find Trade option with correct opIndex
                const tradeOption = shopkeeper.optionsWithIndex?.find((opt: any) =>
                    opt.text.toLowerCase() === 'trade'
                );

                if (tradeOption) {
                    console.log(`  Found shopkeeper #${shopkeeper.index}, trading (opIndex ${tradeOption.opIndex})...`);
                    await interactNpc(shopkeeper.index, tradeOption.opIndex);
                } else {
                    console.log(`  Found shopkeeper #${shopkeeper.index}, no Trade option, talking (opIndex 1)...`);
                    console.log(`  Available options: ${JSON.stringify(shopkeeper.optionsWithIndex)}`);
                    await interactNpc(shopkeeper.index, 1);
                }

                // Wait for the shop to actually open (state sync takes time)
                for (let wait = 0; wait < 15; wait++) {
                    await sleep(200);
                    if (await isShopOpen()) {
                        console.log('  Shop opened!');
                        shopOpened = true;
                        break;
                    }
                }
                if (shopOpened) break;
            }

            await sleep(TURN_DELAY_MS);
            tradeTurns++;
            totalTurns++;
        }

        if (!shopOpened) {
            shopOpened = await isShopOpen();
        }

        if (!shopOpened) {
            throw new Error(`Failed to open shop after ${tradeTurns} turns`);
        }
        addStep('Trade with Shopkeeper', true, 'Shop interface opened', tradeTurns);
        await takeScreenshot(page, '06-shop-open');

        // Step 4: Sell bronze dagger via CLI
        console.log('\n--- Step 4: Sell Bronze Dagger (via CLI) ---');
        let sellTurns = 0;
        let soldDagger = false;

        const shopState = await getShopState();
        if (shopState?.playerItems) {
            const daggerItem = shopState.playerItems.find(item =>
                item.name.toLowerCase().includes('bronze dagger') ||
                item.name.toLowerCase() === 'dagger'
            );

            if (daggerItem) {
                console.log(`  Found bronze dagger at slot ${daggerItem.slot}, selling...`);
                await shopSell(daggerItem.slot, 1);
                await sleep(TURN_DELAY_MS);
                sellTurns++;
                totalTurns++;
                soldDagger = true;
                addStep('Sell Bronze Dagger', true, `Sold from slot ${daggerItem.slot}`, sellTurns);
            } else {
                addStep('Sell Bronze Dagger', false, 'No bronze dagger found in inventory', 0);
            }
        }
        await takeScreenshot(page, '07-after-sell');

        // Step 5: Buy hammer via CLI
        console.log('\n--- Step 5: Buy Hammer (via CLI) ---');
        let buyTurns = 0;
        let boughtHammer = false;

        await sleep(500);
        const updatedShopState = await getShopState();
        if (updatedShopState?.shopItems) {
            const hammerItem = updatedShopState.shopItems.find(item =>
                item.name.toLowerCase() === 'hammer'
            );

            if (hammerItem) {
                console.log(`  Found hammer at slot ${hammerItem.slot}, buying...`);
                await shopBuy(hammerItem.slot, 1);
                await sleep(TURN_DELAY_MS);
                buyTurns++;
                totalTurns++;
                boughtHammer = true;
                addStep('Buy Hammer', true, `Bought from slot ${hammerItem.slot}`, buyTurns);
            } else {
                addStep('Buy Hammer', false, 'No hammer found in shop', 0);
            }
        }
        await takeScreenshot(page, '08-after-buy');

        // Final results
        result.success = soldDagger || boughtHammer;
        result.finalPosition = await getPlayerPosition();

        console.log(`\n--- Benchmark Complete ---`);
        console.log(`Total turns: ${totalTurns}`);
        console.log(`Success: ${result.success}`);
        console.log(`Steps completed: ${result.steps.filter(s => s.success).length}/${result.steps.length}`);

    } catch (error) {
        console.error('Benchmark failed:', error);
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

// Run the benchmark
runBenchmark().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
