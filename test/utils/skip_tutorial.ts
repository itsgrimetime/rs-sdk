/**
 * Shared utility for bot setup and tutorial skip.
 * Returns a connected page ready for testing after tutorial.
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn } from 'child_process';
import { join } from 'path';

const CLI = join(import.meta.dir, '..', '..', 'agent', 'cli.ts');
const BOT_URL = 'http://localhost:8888/bot';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Simple rsbot that returns just stdout string */
export function createRsbot(botName: string) {
    return (...args: string[]) => new Promise<string>(resolve => {
        const proc = spawn('bun', [CLI, '--bot', botName, ...args], { cwd: join(import.meta.dir, '..', '..') });
        let out = '';
        proc.stdout.on('data', d => out += d);
        proc.on('close', () => resolve(out));
    });
}

/** Rsbot that returns {stdout, stderr, exitCode} for compatibility with existing tests */
export function createRsbotCompat(botName: string) {
    return (...args: string[]) => new Promise<{ stdout: string; stderr: string; exitCode: number }>(resolve => {
        const proc = spawn('bun', [CLI, '--bot', botName, ...args], { cwd: join(import.meta.dir, '..', '..') });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 }));
        proc.on('error', err => { stderr += err.message; resolve({ stdout, stderr, exitCode: 1 }); });
    });
}

export interface BotSession {
    browser: Browser;
    page: Page;
    botName: string;
    rsbot: (...args: string[]) => Promise<string>;
    rsbotCompat: (...args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    cleanup: () => Promise<void>;
}

export async function setupBot(botName?: string, headless = false): Promise<BotSession> {
    const name = botName || 'bot' + Math.random().toString(36).substring(2, 5);
    const rsbot = createRsbot(name);
    const rsbotCompat = createRsbotCompat(name);

    const browser = await puppeteer.launch({ headless, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    await page.goto(`${BOT_URL}?bot=${name}`, { waitUntil: 'networkidle2' });

    // Wait for client ready
    while (!await page.evaluate(() => (window as any).gameClient?.autoLogin)) {
        await sleep(200);
    }

    // Login
    await page.evaluate((u: string) => (window as any).gameClient.autoLogin(u, 'test'), name);

    // Wait for in-game
    while (!await page.evaluate(() => (window as any).gameClient?.ingame)) {
        await sleep(200);
    }

    // Wait for sync
    while (!(await rsbot('status')).includes('In Game: Yes')) {
        await sleep(200);
    }

    return {
        browser,
        page,
        botName: name,
        rsbot,
        rsbotCompat,
        cleanup: () => browser.close()
    };
}

export async function skipTutorial(rsbot: (...args: string[]) => Promise<string>, maxAttempts = 30): Promise<boolean> {
    // Accept design first
    await rsbot('action', 'design');

    const inTutorial = async () => {
        const m = (await rsbot('player')).match(/Position:\s*\((\d+)/);
        return !m || parseInt(m[1]) < 3200;
    };

    let n = 0;
    while (await inTutorial() && n++ < maxAttempts) {
        await rsbot('action', 'skip-tutorial', '--wait');
    }

    return !await inTutorial();
}

/** Full setup: connect bot and skip tutorial, returns session in Lumbridge */
export async function setupBotWithTutorialSkip(botName?: string, headless = false): Promise<BotSession> {
    const session = await setupBot(botName, headless);
    const success = await skipTutorial(session.rsbot);
    if (!success) {
        await session.cleanup();
        throw new Error('Failed to skip tutorial');
    }
    return session;
}
