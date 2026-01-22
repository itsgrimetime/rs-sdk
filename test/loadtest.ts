#!/usr/bin/env bun
/**
 * Load Test
 *
 * Spawns 10 firemaking bots and 10 combat bots concurrently.
 *
 * Usage:
 *   bun run test/loadtest.ts
 */

import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

const FIREMAKING_COUNT = 2;
const COMBAT_COUNT = 2;

const TEST_DIR = import.meta.dir;

interface BotProcess {
    name: string;
    type: 'firemaking' | 'combat';
    process: ChildProcess;
}

const bots: BotProcess[] = [];

function spawnBot(type: 'firemaking' | 'combat', index: number): BotProcess {
    const botName = type === 'firemaking'
        ? `fire${index.toString().padStart(2, '0')}`
        : `combat${index.toString().padStart(2, '0')}`;

    const script = type === 'firemaking'
        ? join(TEST_DIR, 'woodcutting-firemaking.ts')
        : join(TEST_DIR, 'combat-training.ts');

    console.log(`Starting ${type} bot: ${botName}`);

    const proc = spawn('bun', ['run', script], {
        env: { ...process.env, BOT_NAME: botName },
        cwd: join(TEST_DIR, '..'),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
            console.log(`[${botName}] ${line}`);
        }
    });

    proc.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
            console.error(`[${botName}] ${line}`);
        }
    });

    proc.on('exit', (code) => {
        console.log(`[${botName}] Exited with code ${code}`);
    });

    return { name: botName, type, process: proc };
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log(`\n=== Load Test ===`);
    console.log(`Firemaking bots: ${FIREMAKING_COUNT}`);
    console.log(`Combat bots: ${COMBAT_COUNT}`);
    console.log(`Total bots: ${FIREMAKING_COUNT + COMBAT_COUNT}`);
    console.log(`\nStarting bots with 500ms stagger...\n`);

    // Spawn firemaking bots
    for (let i = 1; i <= FIREMAKING_COUNT; i++) {
        bots.push(spawnBot('firemaking', i));
        await sleep(500); // Stagger spawns to avoid overwhelming the server
    }

    // Spawn combat bots
    for (let i = 1; i <= COMBAT_COUNT; i++) {
        bots.push(spawnBot('combat', i));
        await sleep(500);
    }

    console.log(`\nAll ${bots.length} bots started!`);
    console.log(`Press Ctrl+C to stop all bots.\n`);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\nShutting down all bots...');
        for (const bot of bots) {
            bot.process.kill('SIGTERM');
        }
        process.exit(0);
    });

    // Wait for all processes to complete
    await Promise.all(bots.map(bot =>
        new Promise<void>(resolve => {
            bot.process.on('exit', () => resolve());
        })
    ));

    console.log('\nAll bots have finished.');
}

main().catch(error => {
    console.error('Load test failed:', error);
    process.exit(1);
});
