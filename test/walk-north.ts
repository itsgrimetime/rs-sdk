#!/usr/bin/env bun
// Walk North Test - walk at least 100 tiles north

import { setupBotWithTutorialSkip, sleep, BotSession } from './utils/skip_tutorial';

const BOT_NAME = process.env.BOT_NAME;
const MIN_NORTH_DISTANCE = 100;
const WALK_STEP = 15;

let rsbot: (...args: string[]) => Promise<string>;

async function getPosition(): Promise<{ x: number; z: number } | null> {
    const result = await rsbot('player');
    const match = result.match(/Position:\s*\((\d+),\s*(\d+)\)/);
    return match ? { x: parseInt(match[1]), z: parseInt(match[2]) } : null;
}

async function runTest(): Promise<boolean> {
    console.log('=== Walk North Test ===');
    console.log(`Success: Walk ${MIN_NORTH_DISTANCE}+ tiles north`);

    let session: BotSession | null = null;
    try {
        session = await setupBotWithTutorialSkip(BOT_NAME);
        rsbot = session.rsbot;
        console.log(`Bot ${session.botName} ready!`);

        const startPos = await getPosition();
        if (!startPos) throw new Error('Could not get position');
        console.log(`Start: (${startPos.x}, ${startPos.z})`);

        let currentPos = startPos;
        let totalNorth = 0;

        while (totalNorth < MIN_NORTH_DISTANCE) {
            const targetZ = currentPos.z + WALK_STEP;
            await rsbot('action', 'walk', currentPos.x.toString(), targetZ.toString(), '--run', '--wait');
            await sleep(300);

            const newPos = await getPosition();
            if (newPos) {
                const moved = newPos.z - currentPos.z;
                if (moved > 0) totalNorth += moved;
                currentPos = newPos;
            }

            if (totalNorth % 30 < WALK_STEP) {
                console.log(`Progress: ${totalNorth}/${MIN_NORTH_DISTANCE} tiles north`);
            }
        }

        console.log(`Final: (${currentPos.x}, ${currentPos.z}), walked ${totalNorth} tiles north`);
        return totalNorth >= MIN_NORTH_DISTANCE;
    } finally {
        if (session) await session.cleanup();
    }
}

runTest()
    .then(ok => {
        console.log(ok ? '\n✓ PASSED' : '\n✗ FAILED');
        process.exit(ok ? 0 : 1);
    })
    .catch(e => { console.error('Fatal:', e); process.exit(1); });
