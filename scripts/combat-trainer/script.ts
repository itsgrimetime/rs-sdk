/**
 * Combat Training Script v3
 *
 * Goal: Maximize (Attack + Strength + Defence + Hitpoints) levels in 5 minutes
 *
 * Strategy v3:
 * - Rotate between combat styles to train Attack, Strength, and Defence
 * - Track XP gain as the primary success signal
 * - Stay at chicken coop for consistent spawns
 */

import { runScript, TestPresets, type ScriptContext } from '../script-runner';

// Configuration
const HP_EAT_THRESHOLD = 0.4;
const COMBAT_REATTACK_MS = 4000;
const STYLE_ROTATE_KILLS = 3; // Rotate style every 3 kills for better balance
const CHICKEN_COOP = { x: 3231, z: 3295 };

// Calculate value function
function calculateValue(ctx: ScriptContext): number {
    const state = ctx.state();
    if (!state) return 0;

    const getLevel = (name: string) =>
        state.skills.find(s => s.name.toLowerCase() === name.toLowerCase())?.baseLevel ?? 1;

    return getLevel('Attack') + getLevel('Strength') + getLevel('Defence') + getLevel('Hitpoints');
}

// Get total combat XP
function getCombatXP(ctx: ScriptContext): number {
    const state = ctx.state();
    if (!state) return 0;

    const getXp = (name: string) =>
        state.skills.find(s => s.name.toLowerCase() === name.toLowerCase())?.experience ?? 0;

    return getXp('Attack') + getXp('Strength') + getXp('Defence') + getXp('Hitpoints');
}

// Log current combat stats
function logStats(ctx: ScriptContext, label: string): void {
    const state = ctx.state();
    if (!state) return;

    const getLevel = (name: string) =>
        state.skills.find(s => s.name.toLowerCase() === name.toLowerCase())?.baseLevel ?? 1;
    const getXp = (name: string) =>
        state.skills.find(s => s.name.toLowerCase() === name.toLowerCase())?.experience ?? 0;

    const attack = getLevel('Attack');
    const strength = getLevel('Strength');
    const defence = getLevel('Defence');
    const hitpoints = getLevel('Hitpoints');
    const value = attack + strength + defence + hitpoints;

    ctx.log(`[${label}] Value=${value} | Atk=${attack} Str=${strength} Def=${defence} HP=${hitpoints}`);
    ctx.log(`  XP: Atk=${getXp('Attack')} Str=${getXp('Strength')} Def=${getXp('Defence')} HP=${getXp('Hitpoints')}`);
}

runScript({
    name: 'combat-trainer',
    goal: 'Maximize Attack+Strength+Defence+Hitpoints levels',
    preset: TestPresets.COMBAT_TRAINER,
    timeLimit: 5 * 60 * 1000,
    stallTimeout: 60_000,
}, async (ctx) => {
    const { bot, sdk, log, progress } = ctx;

    // Log initial state
    logStats(ctx, 'START');

    // Equip weapon and shield
    const sword = sdk.findInventoryItem(/sword|dagger/i);
    if (sword) {
        log('Equipping weapon...');
        await bot.equipItem(sword);
        progress();
    }

    const shield = sdk.findInventoryItem(/shield/i);
    if (shield) {
        log('Equipping shield...');
        await bot.equipItem(shield);
        progress();
    }

    // Check and log available combat styles
    await new Promise(r => setTimeout(r, 500)); // Wait for state to update
    const combatState = ctx.state()?.combatStyle;
    if (combatState) {
        log(`Weapon: ${combatState.weaponName}`);
        log(`Available styles: ${combatState.styles.map(s => `${s.index}:${s.name}(${s.trainedSkill})`).join(', ')}`);
    } else {
        log('WARNING: No combat style info available');
    }

    // Walk to chicken coop
    log('Walking to chicken coop...');
    await bot.walkTo(CHICKEN_COOP.x, CHICKEN_COOP.z);
    progress();

    // Open gate if nearby
    const gate = sdk.findNearbyLoc(/gate/i);
    if (gate && gate.options.includes('Open')) {
        log('Opening gate...');
        await bot.openDoor(gate);
        progress();
    }

    // Main combat loop
    let killCount = 0;
    let lastXpTotal = getCombatXP(ctx);
    let lastAttackTime = 0;
    let currentTarget: { index: number; name: string } | null = null;
    let currentStyleIndex = 0;

    // Get styles that train individual combat skills for rotation
    const getTrainingStyles = () => {
        const state = ctx.state();
        if (!state?.combatStyle?.styles) return [0, 1, 3]; // Default fallback
        // Get styles that train Attack, Strength, or Defence
        const melee = state.combatStyle.styles.filter(s =>
            ['Attack', 'Strength', 'Defence'].includes(s.trainedSkill)
        );
        return melee.length > 0 ? melee.map(s => s.index) : [0, 1, 3];
    };

    // Use rotation through Attack, Strength, Defence styles
    // (Shared/Controlled style doesn't actually train all 3 on this server)
    const styles = getTrainingStyles();
    log(`Training styles: ${styles.join(', ')}`);

    if (styles.length > 0) {
        // Start with first style (Attack)
        await sdk.sendSetCombatStyle(styles[0]);
        currentStyleIndex = 0;
        const styleName = ctx.state()?.combatStyle?.styles.find(s => s.index === styles[0]);
        log(`Starting with style: ${styleName?.name ?? styles[0]} (${styleName?.trainedSkill ?? '?'})`);
    }

    while (true) {
        const state = ctx.state();
        if (!state?.player) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        // Dismiss dialogs
        if (state.dialog.isOpen) {
            await sdk.sendClickDialog(0);
            await new Promise(r => setTimeout(r, 300));
            progress();
            continue;
        }

        // Check HP and eat if needed
        const hpPercent = state.player.currentHitpoints / state.player.maxHitpoints;
        if (hpPercent < HP_EAT_THRESHOLD) {
            const food = sdk.findInventoryItem(/bread|shrimp|meat|fish|chicken/i);
            if (food) {
                log(`HP low (${state.player.currentHitpoints}/${state.player.maxHitpoints}), eating ${food.name}...`);
                await bot.eatFood(food);
                progress();
                continue;
            }
        }

        // Check for XP gain
        const currentXpTotal = getCombatXP(ctx);
        if (currentXpTotal > lastXpTotal) {
            const xpGained = currentXpTotal - lastXpTotal;
            killCount++;
            log(`XP gained: +${xpGained} (Kill #${killCount})`);
            lastXpTotal = currentXpTotal;
            currentTarget = null;
            progress();

            // Rotate combat style every N kills
            if (killCount % STYLE_ROTATE_KILLS === 0) {
                const availableStyles = getTrainingStyles();
                currentStyleIndex = (currentStyleIndex + 1) % availableStyles.length;
                const newStyle = availableStyles[currentStyleIndex];
                await sdk.sendSetCombatStyle(newStyle);
                const styleName = state.combatStyle?.styles.find(s => s.index === newStyle);
                log(`Rotated to style: ${styleName?.name ?? newStyle} (${styleName?.trainedSkill ?? '?'})`);
            }

            // Log stats every 6 kills (2 full rotation cycles)
            if (killCount % 6 === 0) {
                logStats(ctx, `KILL #${killCount}`);
            }

            // Quick loot pickup
            const loot = sdk.findGroundItem(/bones|feather/i);
            if (loot && loot.distance < 3) {
                await bot.pickupItem(loot);
            }
        }

        // Find and attack chicken
        const now = Date.now();
        const shouldReattack = now - lastAttackTime > COMBAT_REATTACK_MS;

        if (!currentTarget || shouldReattack) {
            const chicken = sdk.findNearbyNpc(/chicken/i);

            if (!chicken) {
                if (now - lastAttackTime > 10000) {
                    log('No chickens found, returning to coop...');
                    await bot.walkTo(CHICKEN_COOP.x, CHICKEN_COOP.z);
                    progress();
                    lastAttackTime = now;
                }
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            const attackResult = await bot.attackNpc(chicken);
            lastAttackTime = now;

            if (attackResult.success) {
                currentTarget = { index: chicken.index, name: chicken.name };
                // Only log occasionally to reduce noise
                if (killCount % 10 === 0 || killCount < 3) {
                    log(`Attacking ${chicken.name} (dist: ${chicken.distance.toFixed(1)})`);
                }
            } else if (attackResult.reason === 'out_of_reach') {
                const nearbyGate = sdk.findNearbyLoc(/gate/i);
                if (nearbyGate) {
                    await bot.openDoor(nearbyGate);
                    progress();
                }
            }

            progress();
        }

        await new Promise(r => setTimeout(r, 600));
    }
});
