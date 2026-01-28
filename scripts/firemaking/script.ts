/**
 * Firemaking Training Script
 *
 * Goal: Train Firemaking from level 1 to level 10+ starting from Lumbridge.
 *
 * Strategy:
 * 1. Start at Lumbridge (preset has tinderbox)
 * 2. Chop trees to get logs
 * 3. Burn logs using tinderbox
 * 4. Repeat until level 10
 *
 * Notes:
 * - LUMBRIDGE_SPAWN preset includes a tinderbox
 * - Trees respawn quickly in Lumbridge
 * - Fire lighting can fail if standing on a fire or blocked tile
 */

import { runScript, type ScriptContext, StallError, TestPresets } from '../script-runner';
import type { NearbyLoc, InventoryItem } from '../../sdk/types';

// Lumbridge tree locations (near castle)
const LUMBRIDGE_TREES_AREA = { x: 3200, z: 3230 };

interface Stats {
    logsCut: number;
    logsBurned: number;
    startFiremakingXp: number;
    startWoodcuttingXp: number;
    startTime: number;
    lastProgressTime: number;
}

// ============ Helper Functions ============

function markProgress(ctx: ScriptContext, stats: Stats): void {
    stats.lastProgressTime = Date.now();
    ctx.progress();
}

function getFiremakingXp(ctx: ScriptContext): number {
    return ctx.state()?.skills.find(s => s.name === 'Firemaking')?.experience ?? 0;
}

function getFiremakingLevel(ctx: ScriptContext): number {
    return ctx.state()?.skills.find(s => s.name === 'Firemaking')?.baseLevel ?? 1;
}

function getWoodcuttingXp(ctx: ScriptContext): number {
    return ctx.state()?.skills.find(s => s.name === 'Woodcutting')?.experience ?? 0;
}

function getWoodcuttingLevel(ctx: ScriptContext): number {
    return ctx.state()?.skills.find(s => s.name === 'Woodcutting')?.baseLevel ?? 1;
}

function getPlayerPos(ctx: ScriptContext): { x: number; z: number } | null {
    const state = ctx.state();
    if (!state?.player) return null;
    return { x: state.player.worldX, z: state.player.worldZ };
}

function countLogs(ctx: ScriptContext): number {
    const state = ctx.state();
    if (!state) return 0;
    return state.inventory.filter(item => /^logs$/i.test(item.name)).reduce((sum, i) => sum + i.count, 0);
}

function hasTinderbox(ctx: ScriptContext): boolean {
    const state = ctx.state();
    if (!state) return false;
    return state.inventory.some(item => /tinderbox/i.test(item.name));
}

function hasAxe(ctx: ScriptContext): boolean {
    const state = ctx.state();
    if (!state) return false;
    // Check inventory and equipment for any axe
    const inInv = state.inventory.some(item => /axe/i.test(item.name));
    const equipped = state.equipment.some(item => item && /axe/i.test(item.name));
    return inInv || equipped;
}

function findTree(ctx: ScriptContext): NearbyLoc | null {
    const state = ctx.state();
    if (!state) return null;

    // Find regular trees (not oak, willow, etc. - those require higher levels)
    const trees = state.nearbyLocs
        .filter(loc => /^tree$/i.test(loc.name))
        .filter(loc => loc.options.some(opt => /^chop/i.test(opt)))
        .sort((a, b) => a.distance - b.distance);

    return trees[0] ?? null;
}

function getInventoryCount(ctx: ScriptContext): number {
    return ctx.state()?.inventory.length ?? 0;
}

/**
 * Dismiss dialogs (level-up dialogs, etc.)
 */
async function dismissDialogs(ctx: ScriptContext, stats: Stats, maxCount: number = 3): Promise<number> {
    let dismissed = 0;
    while (ctx.state()?.dialog.isOpen && dismissed < maxCount) {
        await ctx.sdk.sendClickDialog(0);
        await new Promise(r => setTimeout(r, 200));
        dismissed++;
        markProgress(ctx, stats);
    }
    return dismissed;
}

// ============ Main Phases ============

/**
 * Phase 1: Chop trees until we have some logs
 */
async function chopTrees(ctx: ScriptContext, stats: Stats, targetLogs: number = 5): Promise<void> {
    ctx.log(`Chopping trees until we have ${targetLogs} logs...`);
    let attempts = 0;
    let noTreeCount = 0;

    while (countLogs(ctx) < targetLogs && getInventoryCount(ctx) < 28) {
        attempts++;
        if (attempts % 10 === 0) markProgress(ctx, stats);

        // Dismiss any dialogs (level-up, etc.)
        if (await dismissDialogs(ctx, stats) > 0) continue;

        // Find a tree
        const tree = findTree(ctx);
        if (!tree) {
            noTreeCount++;
            if (noTreeCount % 20 === 0) {
                ctx.log('Waiting for tree to respawn...');
                // Walk around a bit to find more trees
                const pos = getPlayerPos(ctx);
                if (pos) {
                    const offsetX = (Math.random() - 0.5) * 10;
                    const offsetZ = (Math.random() - 0.5) * 10;
                    await ctx.sdk.sendWalk(pos.x + offsetX, pos.z + offsetZ, true);
                }
            }
            await new Promise(r => setTimeout(r, 200));
            continue;
        }

        noTreeCount = 0;

        // Chop the tree
        const logsBefore = countLogs(ctx);
        const result = await ctx.bot.chopTree(tree);
        markProgress(ctx, stats);

        if (result.success) {
            const logsAfter = countLogs(ctx);
            if (logsAfter > logsBefore) {
                stats.logsCut += logsAfter - logsBefore;
                ctx.log(`Got logs! Total: ${stats.logsCut} (inventory: ${logsAfter})`);
            }
        }

        await new Promise(r => setTimeout(r, 200));
    }

    ctx.log(`Finished chopping: ${countLogs(ctx)} logs in inventory`);
}

/**
 * Phase 2: Burn all logs
 */
async function burnLogs(ctx: ScriptContext, stats: Stats): Promise<void> {
    ctx.log('Burning logs...');

    while (countLogs(ctx) > 0) {
        // Dismiss any dialogs
        if (await dismissDialogs(ctx, stats) > 0) continue;

        const logsBefore = countLogs(ctx);
        const fmXpBefore = getFiremakingXp(ctx);

        const result = await ctx.bot.burnLogs();
        markProgress(ctx, stats);

        if (result.success) {
            stats.logsBurned++;
            ctx.log(`Burned log! FM XP: +${result.xpGained}, Level: ${getFiremakingLevel(ctx)}`);
        } else {
            ctx.warn(`Failed to burn log: ${result.message}`);
            // If we failed, try moving to a different spot
            const pos = getPlayerPos(ctx);
            if (pos && result.message.includes('location')) {
                ctx.log('Moving to find a better spot...');
                const offsetX = (Math.random() - 0.5) * 6;
                const offsetZ = (Math.random() - 0.5) * 6;
                await ctx.sdk.sendWalk(pos.x + offsetX, pos.z + offsetZ, true);
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Check if we're already at target level
        if (getFiremakingLevel(ctx) >= 10) {
            ctx.log('Reached level 10!');
            return;
        }

        await new Promise(r => setTimeout(r, 200));
    }
}

/**
 * Log final statistics
 */
function logFinalStats(ctx: ScriptContext, stats: Stats) {
    const state = ctx.state();
    const firemaking = state?.skills.find(s => s.name === 'Firemaking');
    const woodcutting = state?.skills.find(s => s.name === 'Woodcutting');

    const fmXpGained = (firemaking?.experience ?? 0) - stats.startFiremakingXp;
    const wcXpGained = (woodcutting?.experience ?? 0) - stats.startWoodcuttingXp;
    const duration = (Date.now() - stats.startTime) / 1000;

    ctx.log('');
    ctx.log('=== Final Results ===');
    ctx.log(`Duration: ${Math.round(duration)}s`);
    ctx.log(`--- Woodcutting ---`);
    ctx.log(`  Level: ${woodcutting?.baseLevel ?? '?'}`);
    ctx.log(`  XP Gained: ${wcXpGained}`);
    ctx.log(`  Logs Cut: ${stats.logsCut}`);
    ctx.log(`--- Firemaking ---`);
    ctx.log(`  Level: ${firemaking?.baseLevel ?? '?'}`);
    ctx.log(`  XP Gained: ${fmXpGained}`);
    ctx.log(`  Logs Burned: ${stats.logsBurned}`);
}

/**
 * Main loop: chop → burn → repeat until level 10
 */
async function mainLoop(ctx: ScriptContext, stats: Stats): Promise<void> {
    ctx.log('=== Firemaking Training Script ===');
    ctx.log(`Starting levels: Firemaking ${getFiremakingLevel(ctx)}, Woodcutting ${getWoodcuttingLevel(ctx)}`);
    ctx.log(`Position: (${ctx.state()?.player?.worldX}, ${ctx.state()?.player?.worldZ})`);

    // Verify we have the required items
    if (!hasTinderbox(ctx)) {
        throw new Error('No tinderbox in inventory!');
    }
    if (!hasAxe(ctx)) {
        throw new Error('No axe in inventory or equipped!');
    }
    ctx.log('Tinderbox and axe confirmed.');

    await ctx.bot.dismissBlockingUI();
    markProgress(ctx, stats);

    let cycle = 0;
    while (getFiremakingLevel(ctx) < 10) {
        cycle++;
        ctx.log(`\n--- Cycle ${cycle} ---`);
        ctx.log(`Current FM Level: ${getFiremakingLevel(ctx)}`);

        // Phase 1: Chop trees to get logs
        await chopTrees(ctx, stats, 5);

        // Phase 2: Burn all logs
        await burnLogs(ctx, stats);

        markProgress(ctx, stats);
    }

    ctx.log('\n*** GOAL ACHIEVED: Firemaking Level 10+ ***');
}

// Run the script
runScript({
    name: 'firemaking',
    goal: 'Train Firemaking from level 1 to level 10+',
    preset: TestPresets.LUMBRIDGE_SPAWN,
    timeLimit: 10 * 60 * 1000,      // 10 minutes
    stallTimeout: 45_000,            // 45 seconds (tree chopping can take time)
    screenshotInterval: 15_000,
}, async (ctx) => {
    const stats: Stats = {
        logsCut: 0,
        logsBurned: 0,
        startFiremakingXp: getFiremakingXp(ctx),
        startWoodcuttingXp: getWoodcuttingXp(ctx),
        startTime: Date.now(),
        lastProgressTime: Date.now(),
    };

    try {
        await mainLoop(ctx, stats);
    } catch (e) {
        if (e instanceof StallError) {
            ctx.error(`Script aborted: ${e.message}`);
        } else {
            throw e;
        }
    } finally {
        logFinalStats(ctx, stats);
    }
});
