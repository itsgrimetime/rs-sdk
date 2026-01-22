#!/usr/bin/env bun
// Fletching Test - gain 1 level in Fletching

import { setupBotWithTutorialSkip, sleep, BotSession } from './utils/skip_tutorial';

const BOT_NAME = process.env.BOT_NAME;
const MAX_TURNS = 200;

let rsbot: (...args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

async function getSkillLevel(skill: string): Promise<number> {
    const result = await rsbot('skills');
    const match = result.stdout.match(new RegExp(`${skill}:\\s*(\\d+)\\/(\\d+)`, 'i'));
    return match ? parseInt(match[2]) : 1;
}

async function getInventory(): Promise<any[]> {
    const result = await rsbot('inventory');
    const items: any[] = [];
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^\s*\[(\d+)\]\s*(.+?)\s*x(\d+)\s*\(id:\s*(\d+)\)/);
        if (match) items.push({ slot: parseInt(match[1]), name: match[2].trim(), count: parseInt(match[3]), id: parseInt(match[4]) });
    }
    return items;
}

async function getLocations(): Promise<any[]> {
    const result = await rsbot('locations');
    const locs: any[] = [];
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^\s*(.+?)\s+at\s+\((\d+),\s*(\d+)\)\s*-\s*(\d+)\s*tiles,\s*id:\s*(\d+)/);
        if (match) locs.push({ name: match[1].trim(), x: parseInt(match[2]), z: parseInt(match[3]), distance: parseInt(match[4]), id: parseInt(match[5]) });
    }
    return locs;
}

async function getGroundItems(): Promise<any[]> {
    const result = await rsbot('ground');
    const items: any[] = [];
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^\s*(.+?)\s*x(\d+)\s+at\s+\((\d+),\s*(\d+)\)\s*-\s*(\d+)\s*tiles\s*\(id:\s*(\d+)\)/);
        if (match) items.push({ name: match[1].trim(), x: parseInt(match[3]), z: parseInt(match[4]), id: parseInt(match[6]) });
    }
    return items;
}

async function checkDialog(): Promise<{ isOpen: boolean; hasOptions: boolean }> {
    const result = await rsbot('dialog');
    return { isOpen: result.stdout.includes('Dialog: OPEN'), hasOptions: result.stdout.includes('Options:') };
}

async function runTest(): Promise<boolean> {
    console.log('=== Fletching Test ===');

    let session: BotSession | null = null;
    try {
        session = await setupBotWithTutorialSkip(BOT_NAME);
        rsbot = session.rsbotCompat;
        console.log(`Bot ${session.botName} ready!`);

        const initialLevel = await getSkillLevel('Fletching');
        console.log(`Initial Fletching level: ${initialLevel}`);

        let state: 'find_knife' | 'chop' | 'fletch' = 'find_knife';

        for (let turn = 1; turn <= MAX_TURNS; turn++) {
            // Check for early exit
            if (turn % 10 === 0) {
                const level = await getSkillLevel('Fletching');
                if (level > initialLevel) {
                    console.log(`Turn ${turn}: SUCCESS - Gained Fletching level: ${initialLevel} -> ${level}`);
                    return true;
                }
            }

            // Handle dialogs
            const dialog = await checkDialog();
            if (dialog.isOpen) {
                if (dialog.hasOptions) {
                    await rsbot('action', 'dialog', '2', '--wait'); // Select arrow shafts
                } else {
                    await rsbot('action', 'dialog', '0', '--wait'); // Continue
                }
                continue;
            }

            const inventory = await getInventory();
            const knife = inventory.find(i => /knife/i.test(i.name));
            const logs = inventory.find(i => /logs/i.test(i.name));

            if (state === 'find_knife' && !knife) {
                const ground = await getGroundItems();
                const groundKnife = ground.find(i => /knife/i.test(i.name));
                if (groundKnife) {
                    await rsbot('action', 'pickup', groundKnife.x.toString(), groundKnife.z.toString(), groundKnife.id.toString(), '--wait');
                    if (turn % 10 === 0) console.log(`Turn ${turn}: Picking up knife`);
                }
            } else if (!logs || state === 'chop') {
                state = 'chop';
                const locs = await getLocations();
                const tree = locs.find(l => /^tree$/i.test(l.name));
                if (tree) {
                    await rsbot('action', 'interact-loc', tree.x.toString(), tree.z.toString(), tree.id.toString(), '1', '--wait');
                    if (turn % 10 === 0) console.log(`Turn ${turn}: Chopping tree`);
                }
                if (logs) state = 'fletch';
            } else if (knife && logs) {
                state = 'fletch';
                await rsbot('action', 'item-on-item', knife.slot.toString(), logs.slot.toString(), '--wait');
                if (turn % 10 === 0) console.log(`Turn ${turn}: Fletching logs`);
            }

            await sleep(600);
        }

        const finalLevel = await getSkillLevel('Fletching');
        console.log(`Final Fletching level: ${finalLevel}`);
        return finalLevel > initialLevel;
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
