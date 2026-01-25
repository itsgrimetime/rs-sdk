/**
 * Combat Trainer Script
 *
 * Goal: Maximize Attack + Strength + Defence + Hitpoints levels over 10 minutes.
 *
 * Strategy:
 * - Phase 1: Kill cows at Lumbridge cow field, collect hides (~50 needed)
 * - Phase 2: Sell hides at Lumbridge general store for ~130gp
 * - Phase 3: Pass through Al Kharid gate (10gp toll), buy iron scimitar (112gp)
 * - Phase 4: Return to cow field and train with iron scimitar
 * - Cycle combat styles for balanced Attack/Strength/Defence training
 */

import { runScript, TestPresets } from '../script-runner';
import type { ScriptContext } from '../script-runner';
import type { NearbyNpc } from '../../agent/types';

// Combat style indices for swords (4 styles: Stab, Lunge, Slash, Block)
// See: https://oldschool.runescape.wiki/w/Combat_Options
const COMBAT_STYLES = {
    ACCURATE: 0,    // Stab - Trains Attack
    AGGRESSIVE: 1,  // Lunge - Trains Strength
    CONTROLLED: 2,  // Slash - Trains Attack+Strength+Defence evenly
    DEFENSIVE: 3,   // Block - Trains Defence only
};

// Training locations
const LOCATIONS = {
    COW_FIELD: { x: 3253, z: 3269 },           // Lumbridge cow field (east of castle)
    LUMBRIDGE_GENERAL_STORE: { x: 3211, z: 3247 },  // To sell hides
    ALKHARID_GATE: { x: 3268, z: 3228 },       // Gate to Al Kharid
    ALKHARID_SCIMITAR_SHOP: { x: 3287, z: 3186 },  // Zeke's shop
};

// Upgrade config
const IRON_SCIMITAR_PRICE = 112;
const GATE_TOLL = 10;
const COINS_NEEDED = IRON_SCIMITAR_PRICE + GATE_TOLL + 10;  // 132gp buffer
const HIDES_NEEDED = 50;  // ~2-3gp each = 100-150gp

// Track combat statistics
interface CombatStats {
    kills: number;
    damageDealt: number;
    damageTaken: number;
    startXp: { atk: number; str: number; def: number; hp: number };
    foodEaten: number;
    looted: number;
    hidesCollected: number;
    coinsCollected: number;
    weaponUpgraded: boolean;
    phase: 'farming' | 'selling' | 'buying' | 'training';  // Cow-based phases
    lastStatsLog: number;
}

/**
 * Find the best cow to attack.
 * Cows are level 2, easy targets that drop valuable hides.
 */
function findBestTarget(ctx: ScriptContext): NearbyNpc | null {
    const state = ctx.state();
    if (!state) return null;

    const targets = state.nearbyNpcs
        .filter(npc => /^cow$/i.test(npc.name))  // Only cows (not "cow calf")
        .filter(npc => npc.options.some(o => /attack/i.test(o)))
        // Filter out NPCs already fighting someone else
        .filter(npc => {
            if (npc.targetIndex === -1) return true;
            return !npc.inCombat;
        })
        .sort((a, b) => {
            // Prefer NPCs not in combat
            if (a.inCombat !== b.inCombat) {
                return a.inCombat ? 1 : -1;
            }
            // Then by distance
            return a.distance - b.distance;
        });

    return targets[0] ?? null;
}

/**
 * Check if we should eat food based on HP
 */
function shouldEat(ctx: ScriptContext): boolean {
    const state = ctx.state();
    if (!state) return false;

    const hp = state.skills.find(s => s.name === 'Hitpoints');
    if (!hp) return false;

    // Eat if below 50% HP
    return hp.level < hp.baseLevel * 0.5;
}

// Style rotation for 2:3:2 ratio (Attack:Strength:Defence)
// Strength-focused training for faster kills
const STYLE_ROTATION = [
    { style: COMBAT_STYLES.ACCURATE, name: 'Stab (Attack)' },
    { style: COMBAT_STYLES.ACCURATE, name: 'Stab (Attack)' },
    { style: COMBAT_STYLES.AGGRESSIVE, name: 'Lunge (Strength)' },
    { style: COMBAT_STYLES.AGGRESSIVE, name: 'Lunge (Strength)' },
    { style: COMBAT_STYLES.AGGRESSIVE, name: 'Lunge (Strength)' },
    { style: COMBAT_STYLES.DEFENSIVE, name: 'Block (Defence)' },
    { style: COMBAT_STYLES.DEFENSIVE, name: 'Block (Defence)' },
];

// Track style cycling - initialized in resetStyleCycling()
let lastStyleChange = 0;
let currentStyleIndex = 0;
const STYLE_CYCLE_MS = 20_000;  // Change every 20 seconds (full rotation = 140s)

// Track which style we last SET (not what the game reports)
let lastSetStyle = -1;

/**
 * Reset style cycling state - call at start of training
 */
function resetStyleCycling(): void {
    lastStyleChange = Date.now();
    currentStyleIndex = 0;
    lastSetStyle = -1;
}

/**
 * Cycle combat style for 2:3:2 Attack:Strength:Defence ratio.
 * Time-based cycling since kill counting is unreliable.
 * IMPORTANT: Always set the style, don't rely on game state reporting correctly.
 */
async function cycleCombatStyle(ctx: ScriptContext): Promise<void> {
    // Check if it's time to switch styles
    const now = Date.now();
    if (now - lastStyleChange >= STYLE_CYCLE_MS) {
        currentStyleIndex = (currentStyleIndex + 1) % STYLE_ROTATION.length;
        lastStyleChange = now;
    }

    const target = STYLE_ROTATION[currentStyleIndex]!;

    // Always set style if it differs from what we last set (don't trust game state)
    if (lastSetStyle !== target.style) {
        ctx.log(`Setting ${target.name} style (slot ${currentStyleIndex}/7)`);
        await ctx.sdk.sendSetCombatStyle(target.style);
        lastSetStyle = target.style;
        ctx.progress();
    }
}

/**
 * Wait for current combat to complete (NPC dies or we need to heal)
 * Uses multiple detection methods: XP gains, combatCycle, and NPC disappearance.
 */
async function waitForCombatEnd(
    ctx: ScriptContext,
    targetNpc: NearbyNpc,
    stats: CombatStats
): Promise<'kill' | 'fled' | 'lost_target' | 'need_heal'> {
    let lastSeenTick = ctx.state()?.tick ?? 0;
    let combatStarted = false;
    let ticksSinceCombatEnded = 0;
    let loopCount = 0;

    // Track starting XP to detect combat via XP gains
    const startState = ctx.state();
    const startXp = {
        def: startState?.skills.find(s => s.name === 'Defence')?.experience ?? 0,
        hp: startState?.skills.find(s => s.name === 'Hitpoints')?.experience ?? 0,
    };

    // Wait up to 30 seconds for combat to resolve
    const maxWaitMs = 30000;
    const startTime = Date.now();

    // Initial delay to let combat actually start (attack animation takes time)
    await new Promise(r => setTimeout(r, 800));

    while (Date.now() - startTime < maxWaitMs) {
        await new Promise(r => setTimeout(r, 400));
        loopCount++;
        const state = ctx.state();
        if (!state) return 'lost_target';

        const currentTick = state.tick;

        // Check if we need to heal
        if (shouldEat(ctx)) {
            return 'need_heal';
        }

        // Check XP gains as combat indicator (most reliable!)
        const currentXp = {
            def: state.skills.find(s => s.name === 'Defence')?.experience ?? 0,
            hp: state.skills.find(s => s.name === 'Hitpoints')?.experience ?? 0,
        };
        const xpGained = (currentXp.def - startXp.def) + (currentXp.hp - startXp.hp);
        if (xpGained > 0) {
            combatStarted = true;  // XP gain = definitely in combat
        }

        // Find our target NPC
        const target = state.nearbyNpcs.find(n => n.index === targetNpc.index);

        if (!target) {
            // NPC disappeared - count as kill if we gained XP or waited a bit
            if (combatStarted || xpGained > 0 || loopCount >= 2) {
                stats.kills++;
                return 'kill';
            }
            return 'lost_target';
        }

        // Check NPC health - if 0, it died (only valid once maxHp > 0)
        if (target.maxHp > 0 && target.hp === 0) {
            stats.kills++;
            return 'kill';
        }

        // Track combat events
        for (const event of state.combatEvents) {
            if (event.tick > lastSeenTick) {
                if (event.type === 'damage_dealt' && event.targetIndex === targetNpc.index) {
                    stats.damageDealt += event.damage;
                    combatStarted = true;
                }
                if (event.type === 'damage_taken') {
                    stats.damageTaken += event.damage;
                    combatStarted = true;
                }
            }
        }
        lastSeenTick = currentTick;

        // Check combat status via combatCycle
        const npcInCombat = target.combatCycle > currentTick;
        const playerInCombat = state.player?.combat?.inCombat ?? false;
        const inActiveCombat = playerInCombat || npcInCombat || xpGained > 0;

        if (inActiveCombat) {
            combatStarted = true;
            ticksSinceCombatEnded = 0;
        } else if (combatStarted) {
            ticksSinceCombatEnded++;
            if (ticksSinceCombatEnded >= 4) {
                return 'fled';
            }
        } else if (loopCount >= 8) {
            // Combat never started after ~4 seconds
            return 'lost_target';
        }

        ctx.progress();
    }

    return 'lost_target';
}

/**
 * Sell cow hides at Lumbridge general store.
 */
async function sellHides(ctx: ScriptContext, stats: CombatStats): Promise<boolean> {
    ctx.log('=== Selling Cow Hides ===');
    stats.phase = 'selling';

    const hides = ctx.sdk.findInventoryItem(/^cowhide$/i);
    if (!hides || hides.count === 0) {
        ctx.warn('No cow hides to sell!');
        stats.phase = 'farming';
        return false;
    }

    ctx.log(`Walking to Lumbridge general store with ${hides.count} hides...`);
    await ctx.bot.walkTo(LOCATIONS.LUMBRIDGE_GENERAL_STORE.x, LOCATIONS.LUMBRIDGE_GENERAL_STORE.z);
    ctx.progress();

    const shopResult = await ctx.bot.openShop(/shop.?keeper/i);
    if (!shopResult.success) {
        ctx.warn('Failed to open general store');
        stats.phase = 'farming';
        return false;
    }

    // Sell all hides
    const sellResult = await ctx.bot.sellToShop(/^cowhide$/i, hides.count);
    if (!sellResult.success) {
        ctx.warn(`Failed to sell hides: ${sellResult.message}`);
        await ctx.bot.closeShop();
        stats.phase = 'farming';
        return false;
    }

    ctx.log(`Sold ${hides.count} cow hides!`);
    await ctx.bot.closeShop();
    ctx.progress();

    // Check coins
    const coins = ctx.sdk.findInventoryItem(/^coins$/i);
    const coinCount = coins?.count ?? 0;
    ctx.log(`Total coins: ${coinCount}`);

    return true;
}

/**
 * Buy iron scimitar from Al Kharid.
 * 1. Pass through toll gate (10gp)
 * 2. Buy iron scimitar from Zeke (112gp)
 * 3. Return to cow field
 */
async function buyIronScimitar(ctx: ScriptContext, stats: CombatStats): Promise<boolean> {
    ctx.log('=== Buying Iron Scimitar ===');
    stats.phase = 'buying';

    // Check we have enough coins
    let coins = ctx.sdk.findInventoryItem(/^coins$/i);
    let coinCount = coins?.count ?? 0;

    if (coinCount < COINS_NEEDED) {
        ctx.warn(`Not enough coins (${coinCount}/${COINS_NEEDED})`);
        stats.phase = 'farming';
        return false;
    }

    // Walk to Al Kharid gate
    ctx.log('Walking to Al Kharid gate...');
    await ctx.bot.walkTo(LOCATIONS.ALKHARID_GATE.x, LOCATIONS.ALKHARID_GATE.z);
    ctx.progress();

    // Handle toll gate
    ctx.log('Opening toll gate...');
    const gate = ctx.state()?.nearbyLocs.find(l => /gate/i.test(l.name));
    if (gate) {
        const openOpt = gate.optionsWithIndex.find(o => /open/i.test(o.text));
        if (openOpt) {
            await ctx.sdk.sendInteractLoc(gate.x, gate.z, gate.id, openOpt.opIndex);
            await new Promise(r => setTimeout(r, 800));
        }
    }

    // Handle gate dialog
    for (let i = 0; i < 20; i++) {
        const s = ctx.state();
        if (!s?.dialog.isOpen) {
            await new Promise(r => setTimeout(r, 150));
            continue;
        }
        const yesOpt = s.dialog.options.find(o => /yes/i.test(o.text));
        if (yesOpt) {
            ctx.log('Paying 10gp toll...');
            await ctx.sdk.sendClickDialog(yesOpt.index);
            break;
        }
        await ctx.sdk.sendClickDialog(0);
        await new Promise(r => setTimeout(r, 200));
    }
    ctx.progress();

    // Walk through gate
    await new Promise(r => setTimeout(r, 1000));
    for (let i = 0; i < 10; i++) {
        const state = ctx.state();
        if ((state?.player?.worldX ?? 0) >= 3270) {
            ctx.log('Entered Al Kharid!');
            break;
        }
        if (state?.dialog.isOpen) {
            await ctx.sdk.sendClickDialog(0);
            await new Promise(r => setTimeout(r, 200));
            continue;
        }
        await ctx.bot.walkTo(3277, 3227);
        await new Promise(r => setTimeout(r, 800));
        ctx.progress();
    }

    // Verify in Al Kharid
    if ((ctx.state()?.player?.worldX ?? 0) < 3270) {
        ctx.warn('Failed to enter Al Kharid');
        stats.phase = 'farming';
        return false;
    }

    // Walk to Zeke's shop
    ctx.log('Walking to Zeke\'s Scimitar Shop...');
    await ctx.bot.walkTo(LOCATIONS.ALKHARID_SCIMITAR_SHOP.x, LOCATIONS.ALKHARID_SCIMITAR_SHOP.z);
    ctx.progress();

    // Buy iron scimitar
    const scimitarShop = await ctx.bot.openShop(/zeke/i);
    if (!scimitarShop.success) {
        ctx.warn('Failed to open scimitar shop');
        stats.phase = 'training';
        return false;
    }

    const buyScim = await ctx.bot.buyFromShop(/iron scimitar/i, 1);
    if (buyScim.success) {
        ctx.log('*** IRON SCIMITAR PURCHASED! ***');
        stats.weaponUpgraded = true;
    } else {
        ctx.warn(`Failed to buy scimitar: ${buyScim.message}`);
    }
    await ctx.bot.closeShop();
    ctx.progress();

    // Equip the scimitar
    const scimitar = ctx.sdk.findInventoryItem(/iron scimitar/i);
    if (scimitar) {
        ctx.log('Equipping iron scimitar...');
        await ctx.bot.equipItem(scimitar);
        ctx.progress();
    }

    // Return to cow field
    ctx.log('Returning to cow field...');
    // Walk back through gate (no toll to exit)
    await ctx.bot.walkTo(3267, 3227);  // Outside gate
    await new Promise(r => setTimeout(r, 500));
    await ctx.bot.walkTo(LOCATIONS.COW_FIELD.x, LOCATIONS.COW_FIELD.z);
    ctx.progress();

    stats.phase = 'training';
    ctx.log('=== Ready to train with Iron Scimitar! ===');
    return true;
}

/**
 * Main combat training loop - Cow Hide Strategy
 */
async function combatTrainingLoop(ctx: ScriptContext): Promise<void> {
    const state = ctx.state();
    if (!state) throw new Error('No initial state');

    // Initialize stats tracking
    const stats: CombatStats = {
        kills: 0,
        damageDealt: 0,
        damageTaken: 0,
        startXp: {
            atk: state.skills.find(s => s.name === 'Attack')?.experience ?? 0,
            str: state.skills.find(s => s.name === 'Strength')?.experience ?? 0,
            def: state.skills.find(s => s.name === 'Defence')?.experience ?? 0,
            hp: state.skills.find(s => s.name === 'Hitpoints')?.experience ?? 0,
        },
        foodEaten: 0,
        looted: 0,
        hidesCollected: 0,
        coinsCollected: 0,
        weaponUpgraded: false,
        phase: 'farming',  // Start farming cow hides
        lastStatsLog: 0,
    };

    ctx.log('=== Combat Trainer - Cow Hide Strategy ===');
    ctx.log(`Goal: Collect ${HIDES_NEEDED} cow hides → Sell → Buy Iron Scimitar → Train`);
    ctx.log(`Starting XP - Atk: ${stats.startXp.atk}, Str: ${stats.startXp.str}, Def: ${stats.startXp.def}, HP: ${stats.startXp.hp}`);

    // Initialize style cycling timer now (not at module load)
    resetStyleCycling();

    // Equip starting gear
    const sword = ctx.sdk.findInventoryItem(/bronze sword/i);
    if (sword) {
        ctx.log(`Equipping ${sword.name}...`);
        await ctx.bot.equipItem(sword);
        ctx.progress();
    }

    const shield = ctx.sdk.findInventoryItem(/wooden shield/i);
    if (shield) {
        ctx.log(`Equipping ${shield.name}...`);
        await ctx.bot.equipItem(shield);
        ctx.progress();
    }

    // Walk to cow field
    ctx.log('Walking to cow field...');
    await ctx.bot.walkTo(LOCATIONS.COW_FIELD.x, LOCATIONS.COW_FIELD.z);
    ctx.progress();

    // Main training loop
    while (true) {
        const currentState = ctx.state();
        if (!currentState) {
            ctx.warn('Lost game state');
            break;
        }

        // Dismiss any blocking dialogs
        if (currentState.dialog.isOpen) {
            await ctx.sdk.sendClickDialog(0);
            ctx.progress();
            continue;
        }

        // Log periodic stats
        if (stats.kills > 0 && stats.kills % 5 === 0 && stats.kills !== stats.lastStatsLog) {
            stats.lastStatsLog = stats.kills;
            logStats(ctx, stats);
        }

        // Cycle combat style for balanced training (time-based)
        await cycleCombatStyle(ctx);

        // Check current resources
        const hides = ctx.sdk.findInventoryItem(/^cowhide$/i);
        const coins = ctx.sdk.findInventoryItem(/^coins$/i);
        const hideCount = hides?.count ?? 0;
        const coinCount = coins?.count ?? 0;

        // Phase logic: farming → selling → buying → training
        if (stats.phase === 'farming' && !stats.weaponUpgraded) {
            // Check if we have enough hides to sell
            if (hideCount >= HIDES_NEEDED) {
                ctx.log(`Collected ${hideCount} hides! Time to sell and buy scimitar!`);
                await sellHides(ctx, stats);
                continue;
            }

            // Also check if we already have enough coins (from previous attempts or loot)
            if (coinCount >= COINS_NEEDED) {
                ctx.log(`Already have ${coinCount} coins! Skipping to buy scimitar!`);
                await buyIronScimitar(ctx, stats);
                continue;
            }
        }

        if (stats.phase === 'selling') {
            // After selling, try to buy
            const newCoins = ctx.sdk.findInventoryItem(/^coins$/i);
            if ((newCoins?.count ?? 0) >= COINS_NEEDED) {
                await buyIronScimitar(ctx, stats);
            } else {
                ctx.log(`Only ${newCoins?.count ?? 0} coins, need ${COINS_NEEDED}. Collecting more hides...`);
                stats.phase = 'farming';
            }
            continue;
        }

        // Pick up loot - prioritize cowhides!
        const loot = ctx.sdk.getGroundItems()
            .filter(i => /cow\s?hide|cowhide|bones|coins/i.test(i.name))
            .filter(i => i.distance <= 5)
            .sort((a, b) => {
                // Priority: hides > coins > bones
                const priority = (name: string) => {
                    if (/cow\s?hide|cowhide/i.test(name)) return 0;
                    if (/coins/i.test(name)) return 1;
                    return 2;
                };
                return priority(a.name) - priority(b.name) || a.distance - b.distance;
            });

        if (loot.length > 0) {
            const item = loot[0]!;
            const result = await ctx.bot.pickupItem(item);
            if (result.success) {
                stats.looted++;
                if (/cow\s?hide|cowhide/i.test(item.name)) {
                    stats.hidesCollected += item.count ?? 1;
                    const totalHides = (ctx.sdk.findInventoryItem(/cow\s?hide|cowhide/i)?.count ?? 0);
                    ctx.log(`Picked up cowhide (${totalHides}/${HIDES_NEEDED})`);
                } else if (/coins/i.test(item.name)) {
                    stats.coinsCollected += item.count ?? 1;
                }
            }
            ctx.progress();
        }

        // Find a cow to attack
        const target = findBestTarget(ctx);
        if (!target) {
            ctx.log('No cows nearby - walking to cow field...');
            await ctx.bot.walkTo(LOCATIONS.COW_FIELD.x, LOCATIONS.COW_FIELD.z);
            ctx.progress();
            continue;
        }

        // Check if already fighting
        const playerCombat = currentState.player?.combat;
        if (playerCombat?.inCombat && playerCombat.targetIndex === target.index) {
            const result = await waitForCombatEnd(ctx, target, stats);
            ctx.progress();
            continue;
        }

        // Attack the cow
        const attackResult = await ctx.bot.attackNpc(target);
        if (!attackResult.success) {
            ctx.warn(`Attack failed: ${attackResult.message}`);
            // Try opening gate if blocked
            if (attackResult.reason === 'out_of_reach') {
                await ctx.bot.openDoor(/gate/i);
            }
            ctx.progress();
            continue;
        }

        // Wait for combat to complete
        const combatResult = await waitForCombatEnd(ctx, target, stats);
        if (combatResult === 'kill') {
            ctx.log(`Kill #${stats.kills}! (Hides: ${hideCount}/${HIDES_NEEDED})`);
        }
        ctx.progress();
    }
}

/**
 * Log current training statistics
 */
function logStats(ctx: ScriptContext, stats: CombatStats): void {
    const state = ctx.state();
    if (!state) return;

    const currentXp = {
        atk: state.skills.find(s => s.name === 'Attack')?.experience ?? 0,
        str: state.skills.find(s => s.name === 'Strength')?.experience ?? 0,
        def: state.skills.find(s => s.name === 'Defence')?.experience ?? 0,
        hp: state.skills.find(s => s.name === 'Hitpoints')?.experience ?? 0,
    };

    const xpGained = {
        atk: currentXp.atk - stats.startXp.atk,
        str: currentXp.str - stats.startXp.str,
        def: currentXp.def - stats.startXp.def,
        hp: currentXp.hp - stats.startXp.hp,
    };

    const totalXp = xpGained.atk + xpGained.str + xpGained.def + xpGained.hp;
    const hides = ctx.sdk.findInventoryItem(/^cowhide$/i)?.count ?? 0;

    ctx.log(`--- Stats after ${stats.kills} kills (Phase: ${stats.phase}) ---`);
    ctx.log(`XP: Atk +${xpGained.atk}, Str +${xpGained.str}, Def +${xpGained.def}, HP +${xpGained.hp} (Total: +${totalXp})`);
    ctx.log(`Hides: ${hides}/${HIDES_NEEDED}, Coins: ${stats.coinsCollected}`);
    ctx.log(`Weapon: ${stats.weaponUpgraded ? 'IRON SCIMITAR!' : 'Bronze Sword'}`);
}

// Run the script with standard tutorial-complete items
runScript({
    name: 'combat-trainer',
    goal: 'Kill cows for hides, sell for coins, buy iron scimitar, train combat',
    preset: TestPresets.LUMBRIDGE_SPAWN,
    timeLimit: 10 * 60 * 1000,  // 10 minutes
    stallTimeout: 90_000,       // 90 seconds (for shop/gate interactions)
}, async (ctx) => {
    try {
        await combatTrainingLoop(ctx);
    } finally {
        // Log final stats
        const state = ctx.state();
        if (state) {
            const skills = state.skills;
            const atk = skills.find(s => s.name === 'Attack');
            const str = skills.find(s => s.name === 'Strength');
            const def = skills.find(s => s.name === 'Defence');
            const hp = skills.find(s => s.name === 'Hitpoints');
            const scimitar = ctx.sdk.findInventoryItem(/iron scimitar/i) ||
                            state.equipment?.find(e => /iron scimitar/i.test(e.name));

            ctx.log('=== Final Results ===');
            ctx.log(`Combat Level: ${state.player?.combatLevel ?? '?'}`);
            ctx.log(`Attack: Level ${atk?.baseLevel} (${atk?.experience} XP)`);
            ctx.log(`Strength: Level ${str?.baseLevel} (${str?.experience} XP)`);
            ctx.log(`Defence: Level ${def?.baseLevel} (${def?.experience} XP)`);
            ctx.log(`Hitpoints: Level ${hp?.baseLevel} (${hp?.experience} XP)`);
            ctx.log(`Iron Scimitar: ${scimitar ? 'YES!' : 'No'}`);
            ctx.log(`Position: (${state.player?.worldX}, ${state.player?.worldZ})`);
        }
    }
});
