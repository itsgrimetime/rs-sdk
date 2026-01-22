#!/usr/bin/env bun
// Tutorial Exit Test - succeeds when reaching Lumbridge (x >= 3200)

import { setupBot, skipTutorial } from './utils/skip_tutorial';

const BOT_NAME = process.env.BOT_NAME;

async function runTest(): Promise<boolean> {
    const session = await setupBot(BOT_NAME);
    console.log(`Tutorial Exit Test - Bot: ${session.botName}`);

    try {
        const success = await skipTutorial(session.rsbot);
        console.log(success ? '✓ PASSED' : '✗ FAILED');
        return success;
    } finally {
        await session.cleanup();
    }
}

runTest().then(ok => process.exit(ok ? 0 : 1)).catch(() => process.exit(1));
