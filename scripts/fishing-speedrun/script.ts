/**
 * Fishing + Cooking Speedrun Script
 *
 * Goal: Maximize combined Fishing+Cooking level in 10 minutes starting at Draynor.
 *
 * Strategy:
 * - Fish at Draynor fishing spots (shrimp/anchovies)
 * - When inventory is nearly full, light a fire and cook all fish
 * - Drop cooked fish to make space
 * - Repeat the cycle: fish → fire → cook → drop
 */

import { runScript, type ScriptContext, StallError, TestPresets } from '../script-runner';
import type { NearbyNpc, NearbyLoc, InventoryItem } from '../../agent/types';

// Draynor Village fishing spots
const DRAYNOR_FISHING = { x: 3087, z: 3230 };

// How many fish before we cook
const COOK_THRESHOLD = 18;  // Leave room for logs

// Stuckness detection config
const STUCK_CONFIG = {
    noProgressTimeoutMs: 20_000,
    checkIntervalMs: 1000,
};

interface Stats {
    fishCaught: number;
    fishCooked: number;
    fishBurned: number;
    firesLit: number;
    startFishingXp: number;
    startCookingXp: number;
    startTime: number;
    lastProgressTime: number;
}

// ============ Helper Functions ============

/**
 * Helper to mark progress for both script runner and our stats
 */
function markProgress(ctx: ScriptContext, stats: Stats): void {
    stats.lastProgressTime = Date.now();
    ctx.progress();
}

function getFishingXp(ctx: ScriptContext): number {
    return ctx.state()?.skills.find(s => s.name === 'Fishing')?.experience ?? 0;
}

function getFishingLevel(ctx: ScriptContext): number {
    return ctx.state()?.skills.find(s => s.name === 'Fishing')?.baseLevel ?? 1;
}

function getCookingXp(ctx: ScriptContext): number {
    return ctx.state()?.skills.find(s => s.name === 'Cooking')?.experience ?? 0;
}

function getCookingLevel(ctx: ScriptContext): number {
    return ctx.state()?.skills.find(s => s.name === 'Cooking')?.baseLevel ?? 1;
}

function getCombinedLevel(ctx: ScriptContext): number {
    return getFishingLevel(ctx) + getCookingLevel(ctx);
}

/**
 * Find the nearest fishing spot suitable for level 1 fishing
 * Prefer "Net, Bait" spots (small net fishing - no level req)
 */
function findFishingSpot(ctx: ScriptContext): NearbyNpc | null {
    const state = ctx.state();
    if (!state) return null;

    const allFishingSpots = state.nearbyNpcs
        .filter(npc => /fishing\s*spot/i.test(npc.name))
        .filter(npc => npc.options.some(opt => /^net$/i.test(opt)));

    // Prefer "Net, Bait" spots (small net fishing - no level req)
    const smallNetSpots = allFishingSpots
        .filter(npc => npc.options.some(opt => /^bait$/i.test(opt)))
        .sort((a, b) => a.distance - b.distance);

    if (smallNetSpots.length > 0) {
        return smallNetSpots[0];
    }

    return allFishingSpots.sort((a, b) => a.distance - b.distance)[0] ?? null;
}

/**
 * Count raw fish in inventory (shrimps, anchovies, etc.)
 */
function countRawFish(ctx: ScriptContext): number {
    const state = ctx.state();
    if (!state) return 0;

    return state.inventory
        .filter(item => /^raw\s/i.test(item.name))
        .reduce((sum, item) => sum + item.count, 0);
}

/**
 * Get all raw fish items in inventory
 */
function getRawFishItems(ctx: ScriptContext): InventoryItem[] {
    const state = ctx.state();
    if (!state) return [];

    return state.inventory.filter(item => /^raw\s/i.test(item.name));
}

/**
 * Count cooked fish in inventory
 */
function countCookedFish(ctx: ScriptContext): number {
    const state = ctx.state();
    if (!state) return 0;

    // Cooked fish don't have "raw" prefix - shrimps, anchovies, etc.
    return state.inventory
        .filter(item =>
            /shrimp|anchov/i.test(item.name) &&
            !/^raw\s/i.test(item.name))
        .reduce((sum, item) => sum + item.count, 0);
}

/**
 * Count logs in inventory
 */
function countLogs(ctx: ScriptContext): number {
    const state = ctx.state();
    if (!state) return 0;

    return state.inventory
        .filter(item => /^logs$/i.test(item.name))
        .reduce((sum, item) => sum + item.count, 0);
}

/**
 * Find logs in inventory
 */
function findLogs(ctx: ScriptContext): InventoryItem | null {
    const state = ctx.state();
    if (!state) return null;

    return state.inventory.find(item => /^logs$/i.test(item.name)) ?? null;
}

/**
 * Find tinderbox in inventory
 */
function findTinderbox(ctx: ScriptContext): InventoryItem | null {
    const state = ctx.state();
    if (!state) return null;

    return state.inventory.find(item => /tinderbox/i.test(item.name)) ?? null;
}

/**
 * Find a fire nearby
 */
function findFire(ctx: ScriptContext): NearbyLoc | null {
    const state = ctx.state();
    if (!state) return null;

    return state.nearbyLocs
        .filter(loc => /^fire$/i.test(loc.name))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

/**
 * Drop all cooked/burned fish from inventory
 */
async function dropAllCookedFish(ctx: ScriptContext, stats: Stats): Promise<number> {
    const state = ctx.state();
    if (!state) return 0;

    let dropped = 0;
    const cookedItems = state.inventory
        .filter(item =>
            (/shrimp|anchov/i.test(item.name) && !/^raw\s/i.test(item.name)) ||
            /^burnt\s/i.test(item.name));

    for (const item of cookedItems) {
        ctx.log(`Dropping ${item.name} x${item.count}`);
        await ctx.sdk.sendDropItem(item.slot);
        dropped += item.count;
        markProgress(ctx, stats);
        await new Promise(r => setTimeout(r, 100));
    }

    return dropped;
}

/**
 * Chop a tree to get logs
 */
async function chopTreeForLogs(ctx: ScriptContext, stats: Stats): Promise<boolean> {
    // Already have logs?
    if (findLogs(ctx)) {
        return true;
    }

    ctx.log('Chopping tree for logs...');
    markProgress(ctx, stats);

    // Try up to 3 times to get logs
    for (let attempt = 0; attempt < 3; attempt++) {
        // Use the high-level bot.chopTree
        const result = await ctx.bot.chopTree(/^tree$/i);
        markProgress(ctx, stats);

        if (result.success && findLogs(ctx)) {
            ctx.log(`Got logs! ${result.message}`);
            return true;
        }

        // Wait a bit and check again
        await new Promise(r => setTimeout(r, 500));
        if (findLogs(ctx)) {
            ctx.log('Logs appeared in inventory');
            return true;
        }
    }

    ctx.warn('Could not get logs after 3 attempts');
    return false;
}

/**
 * Light a fire using tinderbox and logs - simple direct approach
 */
async function lightFire(ctx: ScriptContext, stats: Stats): Promise<boolean> {
    const tinderbox = findTinderbox(ctx);
    let logs = findLogs(ctx);

    // If no logs, try to chop a tree
    if (!logs) {
        const chopped = await chopTreeForLogs(ctx, stats);
        if (!chopped) {
            ctx.warn('Could not get logs');
            return false;
        }
        logs = findLogs(ctx);
    }

    if (!tinderbox || !logs) {
        ctx.warn(`Cannot light fire: tinderbox=${!!tinderbox}, logs=${!!logs}`);
        return false;
    }

    ctx.log('Lighting fire...');
    markProgress(ctx, stats);

    const fmXpBefore = ctx.state()?.skills.find(s => s.name === 'Firemaking')?.experience ?? 0;

    // Use tinderbox on logs directly
    await ctx.sdk.sendUseItemOnItem(tinderbox.slot, logs.slot);

    // Wait for fire to be lit (check for XP gain or fire nearby)
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        markProgress(ctx, stats);

        // Dismiss any dialogs
        if (ctx.state()?.dialog.isOpen) {
            await ctx.sdk.sendClickDialog(0);
        }

        // Check for XP gain
        const fmXp = ctx.state()?.skills.find(s => s.name === 'Firemaking')?.experience ?? 0;
        if (fmXp > fmXpBefore) {
            stats.firesLit++;
            ctx.log(`Fire lit! XP gained: ${fmXp - fmXpBefore} (${stats.firesLit} total fires)`);
            return true;
        }

        // Check if fire appeared nearby
        if (findFire(ctx)) {
            stats.firesLit++;
            ctx.log(`Fire lit! (${stats.firesLit} total fires)`);
            return true;
        }
    }

    ctx.warn('Timeout waiting for fire');
    return false;
}

/**
 * Cook all raw fish on a fire
 */
async function cookAllFish(ctx: ScriptContext, stats: Stats): Promise<void> {
    const fire = findFire(ctx);
    if (!fire) {
        ctx.warn('No fire found nearby');
        return;
    }

    const rawFish = getRawFishItems(ctx);
    if (rawFish.length === 0) {
        ctx.log('No raw fish to cook');
        return;
    }

    ctx.log(`Cooking ${rawFish.length} stacks of raw fish...`);
    markProgress(ctx, stats);

    for (const fish of rawFish) {
        // Check if fire still exists
        const currentFire = findFire(ctx);
        if (!currentFire) {
            ctx.log('Fire went out before cooking all fish');
            break;
        }

        const cookingXpBefore = getCookingXp(ctx);

        // Use fish on fire
        await ctx.sdk.sendUseItemOnLoc(fish.slot, currentFire.x, currentFire.z, currentFire.id);
        markProgress(ctx, stats);

        // Wait for cooking to start/complete
        try {
            await ctx.sdk.waitForCondition(state => {
                // Check for cooking XP gain
                const cookXp = state.skills.find(s => s.name === 'Cooking')?.experience ?? 0;
                if (cookXp > cookingXpBefore) return true;

                // Check for interface (cooking selection)
                if (state.interface?.isOpen) return true;

                // Dismiss any dialogs (level-up)
                if (state.dialog.isOpen) {
                    ctx.sdk.sendClickDialog(0).catch(() => {});
                }

                return false;
            }, 5000);

            // If cooking interface opened, click to cook all
            const iface = ctx.state()?.interface;
            if (iface?.isOpen && iface.options.length > 0) {
                ctx.log(`Cooking interface opened with ${iface.options.length} options`);
                // Click the first option (usually "Cook All" or just "Cook")
                const option = iface.options[0];
                await ctx.sdk.sendClickInterface(option.index);
            }

            // Wait for cooking to complete (all fish cooked or XP stops increasing)
            let lastXp = getCookingXp(ctx);
            let noChangeCount = 0;
            while (noChangeCount < 8) {  // Wait a bit longer for cooking
                await new Promise(r => setTimeout(r, 600));
                markProgress(ctx, stats);

                const currentXp = getCookingXp(ctx);
                if (currentXp === lastXp) {
                    noChangeCount++;
                } else {
                    lastXp = currentXp;
                    noChangeCount = 0;
                }

                // Dismiss any dialogs (level-up, etc.)
                if (ctx.state()?.dialog.isOpen) {
                    await ctx.sdk.sendClickDialog(0);
                }

                // Check if fire went out
                const fireStillThere = findFire(ctx);
                if (!fireStillThere) {
                    ctx.log('Fire went out');
                    break;
                }

                // Check if no more raw fish
                if (countRawFish(ctx) === 0) {
                    ctx.log('All raw fish cooked');
                    break;
                }
            }

            // Count results
            const cookingXpGained = getCookingXp(ctx) - cookingXpBefore;
            const fishCooked = Math.floor(cookingXpGained / 30); // ~30 XP per shrimp
            stats.fishCooked += Math.max(0, fishCooked);

            ctx.log(`Cooked fish batch (XP gained: ${cookingXpGained})`);
            markProgress(ctx, stats);

        } catch (e) {
            ctx.warn(`Cooking timeout or error: ${e}`);
        }
    }
}

/**
 * Main fishing loop - fish until we have enough to cook
 */
async function fishUntilFull(ctx: ScriptContext, stats: Stats): Promise<void> {
    let lastFishCount = countRawFish(ctx);
    let consecutiveNoSpotCount = 0;
    let fishingAttempts = 0;

    while (countRawFish(ctx) < COOK_THRESHOLD) {
        fishingAttempts++;
        const currentState = ctx.state();
        if (!currentState) {
            ctx.warn('Lost game state');
            break;
        }

        // Always mark progress in the loop to prevent stalls
        if (fishingAttempts % 10 === 0) {
            markProgress(ctx, stats);
        }

        // Dismiss any blocking dialogs
        if (currentState.dialog.isOpen) {
            ctx.log('Dismissing dialog...');
            await ctx.sdk.sendClickDialog(0);
            await new Promise(r => setTimeout(r, 300));
            markProgress(ctx, stats);
            continue;
        }

        // Check for inventory nearly full (leave space for some fish)
        const invSlots = currentState.inventory.length;
        if (invSlots >= 27) {
            ctx.log('Inventory nearly full');
            break;
        }

        // Check if we caught more fish
        const currentFishCount = countRawFish(ctx);
        if (currentFishCount > lastFishCount) {
            const newFish = currentFishCount - lastFishCount;
            stats.fishCaught += newFish;
            ctx.log(`Caught fish! Raw: ${currentFishCount}, Total caught: ${stats.fishCaught}`);
            markProgress(ctx, stats);
        }
        lastFishCount = currentFishCount;

        // Find a fishing spot
        const spot = findFishingSpot(ctx);

        if (!spot) {
            consecutiveNoSpotCount++;
            markProgress(ctx, stats);  // Keep marking progress while waiting for spot

            // If we've waited too long, walk back to fishing area
            if (consecutiveNoSpotCount >= 100) {
                const player = ctx.state()?.player;
                if (player) {
                    const dist = Math.sqrt(
                        Math.pow(player.worldX - DRAYNOR_FISHING.x, 2) +
                        Math.pow(player.worldZ - DRAYNOR_FISHING.z, 2)
                    );
                    if (dist > 5) {
                        ctx.log(`Walking back to fishing area (dist: ${dist.toFixed(0)})...`);
                        // Use simple walk with timeout to avoid stalls
                        await ctx.sdk.sendWalk(DRAYNOR_FISHING.x, DRAYNOR_FISHING.z);
                        markProgress(ctx, stats);
                        // Wait a bit for movement
                        for (let i = 0; i < 20; i++) {
                            await new Promise(r => setTimeout(r, 500));
                            markProgress(ctx, stats);
                            // Check if we arrived
                            const p = ctx.state()?.player;
                            if (p) {
                                const d = Math.sqrt(
                                    Math.pow(p.worldX - DRAYNOR_FISHING.x, 2) +
                                    Math.pow(p.worldZ - DRAYNOR_FISHING.z, 2)
                                );
                                if (d < 10) break;
                            }
                        }
                    }
                }
                consecutiveNoSpotCount = 0;
            } else if (consecutiveNoSpotCount % 50 === 0) {
                ctx.log(`Waiting for fishing spot... (${consecutiveNoSpotCount} attempts)`);
            }

            await new Promise(r => setTimeout(r, 100));
            continue;
        }

        consecutiveNoSpotCount = 0;

        // Find the "Net" option
        const netOpt = spot.optionsWithIndex.find(o => /^net$/i.test(o.text));
        if (!netOpt) {
            ctx.warn(`Fishing spot has no Net option: ${spot.options.join(', ')}`);
            await new Promise(r => setTimeout(r, 300));
            continue;
        }

        // Start fishing
        await ctx.sdk.sendInteractNpc(spot.index, netOpt.opIndex);
        markProgress(ctx, stats);
        await new Promise(r => setTimeout(r, 200));
    }
}

/**
 * Log final statistics
 */
function logFinalStats(ctx: ScriptContext, stats: Stats) {
    const state = ctx.state();
    const fishing = state?.skills.find(s => s.name === 'Fishing');
    const cooking = state?.skills.find(s => s.name === 'Cooking');

    const fishingXpGained = (fishing?.experience ?? 0) - stats.startFishingXp;
    const cookingXpGained = (cooking?.experience ?? 0) - stats.startCookingXp;
    const duration = (Date.now() - stats.startTime) / 1000;

    ctx.log('');
    ctx.log('=== Final Results ===');
    ctx.log(`Duration: ${Math.round(duration)}s`);
    ctx.log(`--- Fishing ---`);
    ctx.log(`  Level: ${fishing?.baseLevel ?? '?'}`);
    ctx.log(`  XP Gained: ${fishingXpGained}`);
    ctx.log(`  Fish Caught: ${stats.fishCaught}`);
    ctx.log(`--- Cooking ---`);
    ctx.log(`  Level: ${cooking?.baseLevel ?? '?'}`);
    ctx.log(`  XP Gained: ${cookingXpGained}`);
    ctx.log(`  Fish Cooked: ${stats.fishCooked}`);
    ctx.log(`  Fish Burned: ${stats.fishBurned}`);
    ctx.log(`  Fires Lit: ${stats.firesLit}`);
    ctx.log(`--- Combined ---`);
    ctx.log(`  COMBINED LEVEL: ${(fishing?.baseLevel ?? 1) + (cooking?.baseLevel ?? 1)}`);
}

/**
 * Main loop: fish → fire → cook → drop → repeat
 */
async function mainLoop(ctx: ScriptContext, stats: Stats): Promise<void> {
    ctx.log('=== Fishing + Cooking Speedrun Started ===');
    ctx.log(`Starting levels: Fishing ${getFishingLevel(ctx)}, Cooking ${getCookingLevel(ctx)}`);
    ctx.log(`Combined: ${getCombinedLevel(ctx)}`);
    ctx.log(`Position: (${ctx.state()?.player?.worldX}, ${ctx.state()?.player?.worldZ})`);
    ctx.log(`Has axe for chopping trees: ${ctx.state()?.inventory.some(i => /axe/i.test(i.name)) ? 'yes' : 'no'}`);

    await ctx.bot.dismissBlockingUI();
    markProgress(ctx, stats);

    while (true) {
        ctx.log(`\n--- Cycle Start ---`);
        ctx.log(`Current levels: Fishing ${getFishingLevel(ctx)}, Cooking ${getCookingLevel(ctx)} = ${getCombinedLevel(ctx)}`);

        // Phase 1: Fish until we have enough
        ctx.log('Phase 1: Fishing...');
        await fishUntilFull(ctx, stats);

        const rawFishCount = countRawFish(ctx);
        ctx.log(`Have ${rawFishCount} raw fish`);

        // Phase 2: Chop tree for logs and light fire
        if (rawFishCount > 0) {
            ctx.log('Phase 2: Getting logs and lighting fire...');
            const fireSuccess = await lightFire(ctx, stats);

            if (fireSuccess) {
                // Give time for character to move away from fire
                await new Promise(r => setTimeout(r, 500));

                // Phase 3: Cook all fish
                ctx.log('Phase 3: Cooking...');
                await cookAllFish(ctx, stats);
            } else {
                ctx.warn('Failed to light fire, will drop fish instead');
            }
        }

        // Phase 4: Drop cooked/burned fish to make space
        ctx.log('Phase 4: Clearing inventory...');
        const dropped = await dropAllCookedFish(ctx, stats);
        if (dropped > 0) {
            ctx.log(`Dropped ${dropped} cooked/burned fish`);
        }

        // Also drop any remaining raw fish (if fire failed)
        const state = ctx.state();
        if (state) {
            for (const item of state.inventory) {
                if (/^raw\s/i.test(item.name)) {
                    await ctx.sdk.sendDropItem(item.slot);
                    markProgress(ctx, stats);
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }

        markProgress(ctx, stats);
    }
}

// Run the script
runScript({
    name: 'fishing-speedrun',
    goal: 'Maximize combined Fishing+Cooking level in 10 minutes at Draynor',
    preset: TestPresets.FISHER_COOK_AT_DRAYNOR,
    timeLimit: 10 * 60 * 1000,      // 10 minutes
    stallTimeout: 25_000,           // 25 seconds
    screenshotInterval: 15_000,
}, async (ctx) => {
    const stats: Stats = {
        fishCaught: 0,
        fishCooked: 0,
        fishBurned: 0,
        firesLit: 0,
        startFishingXp: getFishingXp(ctx),
        startCookingXp: getCookingXp(ctx),
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
