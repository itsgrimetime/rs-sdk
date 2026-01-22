#!/usr/bin/env bun
// Woodcutting & Firemaking Test - gain 1 level in each, then exit immediately

import { setupBotWithTutorialSkip, sleep, BotSession } from './utils/skip_tutorial';

const BOT_NAME = process.env.BOT_NAME;

let rsbot: (...args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

async function getLevel(skill: string): Promise<number> {
    const result = await rsbot('skills');
    const match = result.stdout.match(new RegExp(`${skill}:\\s*(\\d+)\\/(\\d+)`, 'i'));
    return match ? parseInt(match[2]) : 1;
}

async function getInventory(): Promise<{ slot: number; name: string }[]> {
    const result = await rsbot('inventory');
    return [...result.stdout.matchAll(/^\s*\[(\d+)\]\s*(.+?)\s*x\d+/gm)]
        .map(m => ({ slot: parseInt(m[1]), name: m[2].trim() }));
}

async function findTree(): Promise<{ x: number; z: number; id: number } | null> {
    const result = await rsbot('locations');
    const match = result.stdout.match(/^\s*Tree\s+at\s+\((\d+),\s*(\d+)\).*id:\s*(\d+)/m);
    return match ? { x: parseInt(match[1]), z: parseInt(match[2]), id: parseInt(match[3]) } : null;
}

async function getGroundItems(): Promise<{ name: string; x: number; z: number; id: number }[]> {
    const result = await rsbot('ground');
    const items: { name: string; x: number; z: number; id: number }[] = [];
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^\s*(.+?)\s*x\d+\s+at\s+\((\d+),\s*(\d+)\).*\(id:\s*(\d+)\)/);
        if (match) items.push({ name: match[1].trim(), x: parseInt(match[2]), z: parseInt(match[3]), id: parseInt(match[4]) });
    }
    return items;
}

async function runTest(): Promise<boolean> {
    console.log('=== Woodcutting & Firemaking Test ===');

    let session: BotSession | null = null;
    try {
        session = await setupBotWithTutorialSkip(BOT_NAME);
        rsbot = session.rsbotCompat;
        console.log(`Bot ${session.botName} ready`);

        const initWc = await getLevel('Woodcutting');
        const initFm = await getLevel('Firemaking');
        console.log(`Initial: WC=${initWc}, FM=${initFm}`);

        for (let turn = 1; turn <= 200; turn++) {
            const wc = await getLevel('Woodcutting');
            const fm = await getLevel('Firemaking');

            // Exit immediately when both leveled
            if (wc > initWc && fm > initFm) {
                console.log(`Turn ${turn}: DONE - WC ${initWc}->${wc}, FM ${initFm}->${fm}`);
                return true;
            }

            const inv = await getInventory();
            const logs = inv.find(i => /logs/i.test(i.name));
            const tinder = inv.find(i => /tinderbox/i.test(i.name));

            // Priority 1: Get tinderbox if missing
            if (!tinder) {
                const ground = await getGroundItems();
                const groundTinder = ground.find(i => /tinderbox/i.test(i.name));
                if (groundTinder) {
                    await rsbot('action', 'pickup', groundTinder.x.toString(), groundTinder.z.toString(), groundTinder.id.toString(), '--wait');
                    if (turn % 10 === 0) console.log(`Turn ${turn}: Picking up tinderbox`);
                    continue;
                }
            }

            // Burn logs if we have them and need FM
            if (logs && tinder && fm === initFm) {
                await rsbot('action', 'item-on-item', tinder.slot.toString(), logs.slot.toString(), '--wait');
                // Wait for firemaking to complete
                for (let i = 0; i < 10; i++) {
                    await sleep(1000);
                    const newFm = await getLevel('Firemaking');
                    if (newFm > fm) break;
                }
            } else if (wc === initWc || !logs) {
                // Chop tree if need WC or no logs
                const tree = await findTree();
                if (tree) await rsbot('action', 'interact-loc', tree.x.toString(), tree.z.toString(), tree.id.toString(), '1', '--wait');
                await sleep(300);
            } else if (logs && tinder) {
                await rsbot('action', 'item-on-item', tinder.slot.toString(), logs.slot.toString(), '--wait');
                await sleep(5000);
            }

            if (turn % 20 === 0) console.log(`Turn ${turn}: WC ${initWc}->${wc}, FM ${initFm}->${fm}`);
        }

        return false;
    } finally {
        if (session) await session.cleanup();
    }
}

runTest()
    .then(ok => { console.log(ok ? '\n✓ PASSED' : '\n✗ FAILED'); process.exit(ok ? 0 : 1); })
    .catch(e => { console.error('Fatal:', e); process.exit(1); });
