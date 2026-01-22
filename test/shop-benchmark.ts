#!/usr/bin/env bun
// Shop Test - buy a hammer from the general store

import { setupBotWithTutorialSkip, sleep, BotSession } from './utils/skip_tutorial';

const BOT_NAME = process.env.BOT_NAME;
const SHOP_LOCATION = { x: 3212, z: 3246 };

let rsbot: (...args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

async function getPosition(): Promise<{ x: number; z: number } | null> {
    const result = await rsbot('player');
    const match = result.stdout.match(/Position:\s*\((\d+),\s*(\d+)\)/);
    return match ? { x: parseInt(match[1]), z: parseInt(match[2]) } : null;
}

async function getInventory(): Promise<any[]> {
    const result = await rsbot('inventory');
    const items: any[] = [];
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^\s*\[(\d+)\]\s*(.+?)\s*x(\d+)\s*\(id:\s*(\d+)\)/);
        if (match) items.push({ slot: parseInt(match[1]), name: match[2].trim(), id: parseInt(match[4]) });
    }
    return items;
}

async function getNpcs(): Promise<any[]> {
    const result = await rsbot('npcs');
    const npcs: any[] = [];
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^\s*\[(\d+)\]\s*(.+?)\s+at.*?-\s*(\d+)\s*tiles/);
        if (match) npcs.push({ index: parseInt(match[1]), name: match[2].trim(), distance: parseInt(match[3]) });
    }
    return npcs;
}

async function isShopOpen(): Promise<boolean> {
    const result = await rsbot('shop');
    return result.stdout.includes('Shop:') && !result.stdout.includes('not open');
}

async function runTest(): Promise<boolean> {
    console.log('=== Shop Test ===');

    let session: BotSession | null = null;
    try {
        session = await setupBotWithTutorialSkip(BOT_NAME);
        rsbot = session.rsbotCompat;
        console.log(`Bot ${session.botName} ready!`);

        // Check if we already have a hammer
        let inventory = await getInventory();
        if (inventory.find(i => /hammer/i.test(i.name))) {
            console.log('Already have hammer!');
            return true;
        }

        // Walk to shop
        console.log('Walking to shop...');
        await rsbot('action', 'walk', SHOP_LOCATION.x.toString(), SHOP_LOCATION.z.toString(), '--run', '--wait');
        await sleep(1000);

        // Find and trade with shopkeeper
        for (let attempt = 0; attempt < 20; attempt++) {
            const npcs = await getNpcs();
            const shopkeeper = npcs.find(n => /shopkeeper|shop keeper/i.test(n.name));

            if (shopkeeper) {
                console.log('Trading with shopkeeper...');
                await rsbot('action', 'interact-npc', shopkeeper.index.toString(), '3', '--wait'); // Trade option
                await sleep(500);

                if (await isShopOpen()) {
                    console.log('Shop opened!');
                    // Buy hammer (usually slot 4 or 5 in general store)
                    for (let slot = 0; slot < 10; slot++) {
                        await rsbot('action', 'shop-buy', slot.toString(), '1', '--wait');
                        inventory = await getInventory();
                        if (inventory.find(i => /hammer/i.test(i.name))) {
                            console.log('Bought hammer!');
                            return true;
                        }
                    }
                }
            }
            await sleep(500);
        }

        inventory = await getInventory();
        const hasHammer = inventory.some(i => /hammer/i.test(i.name));
        console.log(`Final: hasHammer=${hasHammer}`);
        return hasHammer;
    } finally {
        if (session) await session.cleanup();
    }
}

runTest()
    .then(ok => {
        console.log(ok ? '\n✓ PASSED: Bought hammer!' : '\n✗ FAILED');
        process.exit(ok ? 0 : 1);
    })
    .catch(e => { console.error('Fatal:', e); process.exit(1); });
