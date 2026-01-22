#!/usr/bin/env bun
/**
 * Walk North CLI Test
 *
 * A test that starts Puppeteer to connect a bot, but communicates
 * via the rsbot CLI through the sync service instead of direct JS calls.
 *
 * This tests the CLI/sync service pathway rather than direct page.evaluate().
 *
 * Usage:
 *   bun run test/walk-north-cli-test.ts
 *   BOT_NAME=walker1 bun run test/walk-north-cli-test.ts
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Configuration
const BOT_CLIENT_BASE_URL = 'http://localhost:8888/bot';
const MAX_TURNS = 50;
const TURN_DELAY_MS = 600;
const WALK_STEP = 15;

// CLI path
const RSBOT_CLI = join(import.meta.dir, '..', 'agent', 'cli.ts');

// Bot name from environment or generate one
const BOT_NAME = process.env.BOT_NAME || 'cli' + Math.random().toString(36).substring(2, 5);

// Create run directory for this test
const RUN_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const RUN_DIR = join(import.meta.dir, '..', 'runs', `${RUN_TIMESTAMP}-walk-north-cli-${BOT_NAME}`);
const SCREENSHOT_DIR = join(RUN_DIR, 'screenshots');

interface TurnRecord {
    turn: number;
    timestamp: string;
    position: { x: number; z: number } | null;
    action: string;
    result: string;
}

interface TestResult {
    botName: string;
    startTime: string;
    endTime: string;
    totalTurns: number;
    startPosition: { x: number; z: number } | null;
    endPosition: { x: number; z: number } | null;
    totalNorthDistance: number;
    tutorialSkipped: boolean;
    turns: TurnRecord[];
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

// Get player position from CLI
async function getPlayerPosition(): Promise<{ x: number; z: number } | null> {
    const result = await rsbot('player');
    if (result.exitCode !== 0 || result.stdout.includes('Not logged in')) {
        return null;
    }

    // Parse output like "Position: (3222, 3218)"
    const match = result.stdout.match(/Position:\s*\((\d+),\s*(\d+)\)/);
    if (match) {
        return { x: parseInt(match[1]), z: parseInt(match[2]) };
    }
    return null;
}

// Check if bot is connected via sync service
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

// Check for open dialog via CLI
async function checkDialog(): Promise<{ isOpen: boolean; hasOptions: boolean }> {
    const result = await rsbot('dialog');
    const isOpen = result.stdout.includes('Dialog: OPEN');
    const hasOptions = result.stdout.includes('Options:');
    return { isOpen, hasOptions };
}

// Close dialog if open via CLI
async function closeDialog(): Promise<{ closed: boolean; message: string }> {
    const dialog = await checkDialog();
    if (!dialog.isOpen) {
        return { closed: false, message: 'No dialog open' };
    }

    const result = await rsbot('action', 'dialog', '0', '--wait');
    if (result.stdout.includes('Success')) {
        return { closed: true, message: 'Dialog closed' };
    }
    return { closed: true, message: result.stdout };
}

// Accept character design via CLI
async function acceptDesign(): Promise<{ accepted: boolean; message: string }> {
    const result = await rsbot('action', 'design', '--wait');
    if (result.stdout.includes('Success')) {
        return { accepted: true, message: 'Character design accepted' };
    }
    return { accepted: false, message: result.stdout };
}

// Walk north via CLI
async function walkNorth(tiles: number): Promise<{ success: boolean; message: string }> {
    // First check for dialogs
    const dialog = await checkDialog();
    if (dialog.isOpen) {
        await closeDialog();
        return { success: false, message: 'Closed dialog, will walk next turn' };
    }

    // Get current position
    const pos = await getPlayerPosition();
    if (!pos) {
        return { success: false, message: 'Could not get player position' };
    }

    // Calculate target (north = positive Z)
    const targetZ = pos.z + tiles;

    // Execute walk command via CLI
    const result = await rsbot('action', 'walk', pos.x.toString(), targetZ.toString(), '--run', '--wait');

    if (result.stdout.includes('Success')) {
        return { success: true, message: `Walk to (${pos.x}, ${targetZ}): Success` };
    } else if (result.stdout.includes('Failed')) {
        return { success: false, message: `Walk to (${pos.x}, ${targetZ}): ${result.stdout}` };
    }

    return { success: true, message: `Walk queued to (${pos.x}, ${targetZ})` };
}

// Check if in tutorial area
async function isInTutorial(): Promise<boolean> {
    const pos = await getPlayerPosition();
    if (!pos) return true;
    return pos.x < 3200;
}

// === Puppeteer helpers for initial login (still needed to connect the bot) ===

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

// Skip tutorial via CLI
async function skipTutorial(): Promise<{ success: boolean; message: string }> {
    const result = await rsbot('action', 'skip-tutorial', '--wait');
    if (result.stdout.includes('Success')) {
        // Extract the message from output
        const msgMatch = result.stdout.match(/Success:\s*(.+)/);
        return { success: true, message: msgMatch?.[1] || 'Tutorial step completed' };
    }
    const msgMatch = result.stdout.match(/Failed:\s*(.+)/);
    return { success: false, message: msgMatch?.[1] || result.stdout };
}

async function runTest(): Promise<void> {
    console.log(`\n=== Walk North CLI Test ===`);
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
        totalTurns: 0,
        startPosition: null,
        endPosition: null,
        totalNorthDistance: 0,
        tutorialSkipped: false,
        turns: []
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
            if (text.includes('[Walk]') || text.includes('Tutorial') || text.includes('MOVE') || text.includes('[Sync]')) {
                console.log(`[PAGE] ${text}`);
            }
        });

        page.on('pageerror', err => {
            console.error(`[PAGE ERROR] ${err.message}`);
        });

        // Navigate to bot client with bot name in URL (required for sync service identity)
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
        result.tutorialSkipped = !stillInTutorial;
        console.log(`Tutorial skipped: ${result.tutorialSkipped}`);
        await takeScreenshot(page, '04-tutorial-done');

        // Get starting position via CLI
        result.startPosition = await getPlayerPosition();
        console.log(`\nStarting position (via CLI): (${result.startPosition?.x}, ${result.startPosition?.z})`);

        // Main walk loop - all via CLI
        console.log(`\n--- Walking North via CLI (${MAX_TURNS} turns) ---`);

        for (let turn = 1; turn <= MAX_TURNS; turn++) {
            const turnRecord: TurnRecord = {
                turn,
                timestamp: new Date().toISOString(),
                position: null,
                action: '',
                result: ''
            };

            // Get current position via CLI
            turnRecord.position = await getPlayerPosition();

            // Walk north via CLI
            const walkResult = await walkNorth(WALK_STEP);
            turnRecord.action = `rsbot action walk --run (${WALK_STEP} north)`;
            turnRecord.result = walkResult.message;

            result.turns.push(turnRecord);

            // Log progress every 10 turns
            if (turn % 10 === 0 || turn === 1) {
                console.log(`Turn ${turn}: pos=(${turnRecord.position?.x}, ${turnRecord.position?.z}) - ${walkResult.message}`);
                await takeScreenshot(page, `turn-${turn.toString().padStart(3, '0')}`);
            }

            await sleep(TURN_DELAY_MS);
        }

        // Final state via CLI
        result.endPosition = await getPlayerPosition();
        result.totalTurns = MAX_TURNS;

        if (result.startPosition && result.endPosition) {
            result.totalNorthDistance = result.endPosition.z - result.startPosition.z;
        }

        await takeScreenshot(page, '99-final');

        console.log(`\n--- Results ---`);
        console.log(`Start Position: (${result.startPosition?.x}, ${result.startPosition?.z})`);
        console.log(`End Position: (${result.endPosition?.x}, ${result.endPosition?.z})`);
        console.log(`Total North Distance: ${result.totalNorthDistance} tiles`);

    } catch (error) {
        console.error('Test failed:', error);
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
