/**
 * Agility Training Script
 *
 * Goal: Train Agility from level 1 to 10+ using the Gnome Stronghold Agility Course
 *
 * Route: Lumbridge -> Falador -> Members Gate -> White Wolf Mountain -> Gnome Stronghold
 *
 * The long pathfinding handles most navigation automatically. We only need manual
 * handling for the Falador-Taverley members gate, then pathfinder handles the rest
 * including White Wolf Mountain pass.
 *
 * Course obstacles (in order):
 * 1. Log balance (Walk-across) - 7.5 XP
 * 2. Obstacle net (Climb-over) - 7.5 XP
 * 3. Tree branch (Climb) - 5 XP
 * 4. Balancing rope (Walk-on) - 7.5 XP
 * 5. Tree branch (Climb-down) - 5 XP
 * 6. Obstacle net (Climb-over) - 7.5 XP
 * 7. Obstacle pipe (Squeeze-through) - 7.5 XP + 39 XP bonus for completing course
 *
 * Total per lap: ~86.5 XP
 * XP needed for level 10: 1,154 XP = ~14 laps
 */

import { runScript, TestPresets } from '../script-runner';
import type { ScriptContext } from '../script-runner';

// Gnome Stronghold Agility Course start location
const GNOME_AGILITY_START = { x: 2474, z: 3436 };

// Lumbridge spawn location (where we start with TestPresets.LUMBRIDGE_SPAWN)
const LUMBRIDGE = { x: 3222, z: 3218 };

// Goblins east of Lumbridge - accessible and low level
const GOBLIN_AREA = { x: 3244, z: 3244 }; // Just east of Lumbridge bridge

// XP requirements
const TARGET_LEVEL = 10;
const XP_FOR_LEVEL_10 = 1154;

// HP requirement for White Wolf Mountain (wolves hit 10-16 damage per hit!)
// Training at goblins first gives HP buffer for the dangerous journey
const MIN_HP_FOR_WOLVES = 25; // Need high HP buffer - wolves can one-shot at 18 HP

// Waypoints from Lumbridge to Gnome Stronghold
// With long pathfinding, we only need the members gate - pathfinder handles the rest
const WAYPOINTS_TO_GNOME = [
    // Walk to just before the Falador-Taverley gate (members gate)
    // The pathfinder handles getting through Falador
    { x: 2935, z: 3430, name: 'Falador north (near gate)' },
    // After manually passing through the gate, walk directly to the course
    // The pathfinder handles White Wolf Mountain pass
    { x: 2474, z: 3436, name: 'Gnome Agility Course' },
];

// Course obstacle definitions (in order around the course)
// The course is a loop, so after the pipe we return to the log
const COURSE_OBSTACLES = [
    { name: /log balance/i, option: /walk/i, description: 'Log balance' },
    { name: /obstacle net/i, option: /climb/i, description: 'First net' },
    { name: /tree branch/i, option: /^climb$/i, description: 'Tree branch up' },
    { name: /balancing rope/i, option: /walk/i, description: 'Balancing rope' },
    { name: /tree branch/i, option: /climb-down/i, description: 'Tree branch down' },
    { name: /obstacle net/i, option: /climb/i, description: 'Second net' },
    { name: /obstacle pipe/i, option: /squeeze/i, description: 'Obstacle pipe' },
];

/**
 * Calculate distance to a point
 */
function distanceTo(ctx: ScriptContext, x: number, z: number): number {
    const state = ctx.state();
    if (!state?.player) return Infinity;
    const dx = x - state.player.worldX;
    const dz = z - state.player.worldZ;
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Check if we've arrived at the Gnome Stronghold agility course
 */
function isAtGnomeStronghold(ctx: ScriptContext): boolean {
    const dist = distanceTo(ctx, GNOME_AGILITY_START.x, GNOME_AGILITY_START.z);
    return dist < 25;  // Close enough to see obstacles
}

/**
 * Check if we're truly past Taverley gate into Taverley
 * The gate is at x=2935. To be truly past it we need to be well west of it.
 */
function isPastTaverleyGate(ctx: ScriptContext): boolean {
    const state = ctx.state();
    if (!state?.player) return false;
    const x = state.player.worldX;
    // Must be significantly west of the gate (x=2935) to be truly in Taverley
    // x < 2920 ensures we're past the gate boundary, not just at it
    return x < 2920;
}

/**
 * Search for and interact with a gate/door/passage to pass through
 * Returns true if we successfully passed through, false otherwise
 */
async function findAndUseGate(ctx: ScriptContext): Promise<boolean> {
    const locs = ctx.sdk.getNearbyLocs();

    // Log all nearby locs for debugging
    ctx.log(`Searching for gates/passages among ${locs.length} nearby locations...`);

    // Look for gate, door, passage, or similar
    const gateKeywords = /gate|door|passage|entrance|exit|barrier/i;
    const potentialGates = locs.filter(loc => gateKeywords.test(loc.name));

    if (potentialGates.length > 0) {
        ctx.log(`Found ${potentialGates.length} potential gates/doors:`);
        for (const g of potentialGates) {
            ctx.log(`  - ${g.name} at (${g.x}, ${g.z}) dist=${g.distance.toFixed(1)} opts=[${g.options.join(', ')}]`);
        }
    } else {
        // Log ALL locs if no gates found, to help debug what's actually there
        ctx.log(`No gates found. All nearby locs:`);
        for (const loc of locs.slice(0, 15)) {
            ctx.log(`  - ${loc.name} at (${loc.x}, ${loc.z}) opts=[${loc.options.join(', ')}]`);
        }
    }

    // Try to find a gate we can open/use
    for (const gate of potentialGates) {
        // Look for Open, Enter, Pass, or similar options
        const useOpt = gate.optionsWithIndex.find(o =>
            /open|enter|pass|use|go|through/i.test(o.text)
        );

        if (!useOpt) {
            ctx.log(`  ${gate.name} has no usable option, trying default...`);
            // Some gates might just have a default "use" as first option
            if (gate.optionsWithIndex.length > 0) {
                const firstOpt = gate.optionsWithIndex[0];
                ctx.log(`  Trying first option: ${firstOpt?.text}`);
            }
            continue;
        }

        ctx.log(`Attempting to use ${gate.name} (${useOpt.text}) at (${gate.x}, ${gate.z})...`);

        // Walk closer if needed
        if (gate.distance > 3) {
            ctx.log(`  Walking closer to gate (dist=${gate.distance.toFixed(1)})...`);
            await ctx.bot.walkTo(gate.x, gate.z, 2);
            await new Promise(r => setTimeout(r, 500));
        }

        // Record position before interaction
        const posBefore = ctx.state()?.player;
        const xBefore = posBefore?.worldX ?? 0;
        const zBefore = posBefore?.worldZ ?? 0;

        // Click the gate
        await ctx.sdk.sendInteractLoc(gate.x, gate.z, gate.id, useOpt.opIndex);
        await new Promise(r => setTimeout(r, 800));

        // Check if a dialog appeared (some gates have dialogs)
        const stateAfterClick = ctx.state();
        if (stateAfterClick?.dialog.isOpen) {
            ctx.log(`  Dialog appeared, handling...`);
            // Click through dialogs
            for (let i = 0; i < 10; i++) {
                const s = ctx.state();
                if (!s?.dialog.isOpen) break;

                // Look for "yes" or continue options
                const yesOpt = s.dialog.options.find(o => /yes|continue|ok|pass/i.test(o.text));
                if (yesOpt) {
                    await ctx.sdk.sendClickDialog(yesOpt.index);
                } else {
                    await ctx.sdk.sendClickDialog(0); // Click to continue
                }
                await new Promise(r => setTimeout(r, 300));
            }
            await new Promise(r => setTimeout(r, 500));
        }

        // Try to walk through after clicking
        ctx.log(`  Attempting to walk through after clicking gate...`);
        // Walk a bit further in the direction we want to go (northwest toward Taverley)
        await ctx.bot.walkTo(gate.x - 5, gate.z + 5, 3);
        await new Promise(r => setTimeout(r, 600));

        // Check if position changed significantly
        const posAfter = ctx.state()?.player;
        const xAfter = posAfter?.worldX ?? 0;
        const zAfter = posAfter?.worldZ ?? 0;
        const dx = Math.abs(xAfter - xBefore);
        const dz = Math.abs(zAfter - zBefore);

        ctx.log(`  Position change: (${xBefore}, ${zBefore}) -> (${xAfter}, ${zAfter}) [dx=${dx}, dz=${dz}]`);

        if (dx > 3 || dz > 3) {
            ctx.log(`  Successfully passed through ${gate.name}!`);
            ctx.progress();
            return true;
        }
    }

    // If no gates found with keywords, try openDoor as fallback
    ctx.log(`Trying openDoor fallback...`);
    const doorResult = await ctx.bot.openDoor(/gate|door/i);
    if (doorResult.success) {
        ctx.log(`  openDoor succeeded!`);
        ctx.progress();
        return true;
    }

    return false;
}

/**
 * Navigate through the Falador-Taverley gate area manually
 * This is needed because the pathfinder can't handle this passage
 */
async function navigateFaladorToTaverley(ctx: ScriptContext): Promise<boolean> {
    ctx.log('=== MANUAL GATE NAVIGATION: Falador -> Taverley ===');

    const state = ctx.state();
    if (!state?.player) return false;

    const startX = state.player.worldX;
    const startZ = state.player.worldZ;
    ctx.log(`Starting position: (${startX}, ${startZ})`);

    // The Taverley gate area is roughly around (2934, 3450)
    // We need to walk northwest from Falador center (2946, 3407)

    const GATE_AREA_WAYPOINTS = [
        { x: 2940, z: 3420, name: 'North Falador' },
        { x: 2935, z: 3435, name: 'Near Taverley gate' },
        { x: 2934, z: 3450, name: 'Taverley gate area' },
        { x: 2925, z: 3455, name: 'Through gate' },
        { x: 2910, z: 3455, name: 'Into Taverley' },  // Well west of gate
    ];

    for (const wp of GATE_AREA_WAYPOINTS) {
        ctx.log(`\nWalking to ${wp.name} (${wp.x}, ${wp.z})...`);

        // Try regular walking first
        const walkResult = await ctx.bot.walkTo(wp.x, wp.z, 8);

        const pos = ctx.state()?.player;
        const dist = distanceTo(ctx, wp.x, wp.z);
        ctx.log(`  After walk: pos=(${pos?.worldX}, ${pos?.worldZ}), dist=${dist.toFixed(0)}`);

        // If walk failed or we're still far, look for gates
        if (!walkResult.success || dist > 15) {
            ctx.log(`  Walk blocked or incomplete, searching for gates...`);

            // Search for gates and try to use them
            const gateSuccess = await findAndUseGate(ctx);

            if (gateSuccess) {
                ctx.log(`  Gate passage successful!`);
                // Try walking again after using gate
                await ctx.bot.walkTo(wp.x, wp.z, 8);
            }
        }

        // Check if we've made it past the gate area
        if (isPastTaverleyGate(ctx)) {
            ctx.log(`Successfully passed Taverley gate area!`);
            return true;
        }

        ctx.progress();
    }

    // Final check
    const finalPos = ctx.state()?.player;
    ctx.log(`Final position after gate navigation: (${finalPos?.worldX}, ${finalPos?.worldZ})`);

    return isPastTaverleyGate(ctx);
}

/**
 * Walk to a waypoint with retries
 */
/**
 * Eat food if HP is below a threshold
 */
async function eatIfLow(ctx: ScriptContext, threshold: number = 0): Promise<boolean> {
    const state = ctx.state();
    if (!state?.player) return false;

    const hpSkill = state.skills.find(s => s.name === 'Hitpoints');
    const hp = hpSkill?.level ?? 10;
    const maxHp = hpSkill?.baseLevel ?? 10;
    // Default threshold: eat if taken ANY damage
    const eatThreshold = threshold > 0 ? threshold : maxHp;

    if (hp < eatThreshold) {
        const inv = ctx.sdk.getInventory();
        const food = inv.find(item => /shrimp|bread/i.test(item.name));
        if (food) {
            ctx.log(`HP ${hp}/${maxHp}, eating ${food.name}...`);
            const eatOpt = food.optionsWithIndex.find(o => /eat/i.test(o.text));
            if (eatOpt) {
                await ctx.sdk.sendUseItem(food.slot, eatOpt.opIndex);
            }
            await new Promise(r => setTimeout(r, 1200));
            ctx.progress();
            return true;
        }
    }
    return false;
}

/**
 * Eat food until HP is full
 */
async function eatToFull(ctx: ScriptContext): Promise<void> {
    let ateAny = false;
    for (let i = 0; i < 10; i++) { // Max 10 foods
        const state = ctx.state();
        if (!state?.player) return;

        const hpSkill = state.skills.find(s => s.name === 'Hitpoints');
        const hp = hpSkill?.level ?? 10;
        const maxHp = hpSkill?.baseLevel ?? 10;

        if (hp >= maxHp) {
            if (ateAny) ctx.log(`HP full at ${hp}/${maxHp}`);
            return;
        }

        const inv = ctx.sdk.getInventory();
        const food = inv.find(item => /shrimp|bread/i.test(item.name));
        if (!food) {
            ctx.log(`No more food! HP ${hp}/${maxHp}`);
            return;
        }

        if (!ateAny) ctx.log(`Eating to full HP (${hp}/${maxHp})...`);
        ateAny = true;

        const eatOpt = food.optionsWithIndex.find(o => /eat/i.test(o.text));
        if (eatOpt) {
            await ctx.sdk.sendUseItem(food.slot, eatOpt.opIndex);
        }
        await new Promise(r => setTimeout(r, 1800)); // Eating delay
        ctx.progress();
    }
}

/**
 * Check if we're in the dangerous White Wolf Mountain area
 */
function isInWolfZone(ctx: ScriptContext): boolean {
    const state = ctx.state();
    if (!state?.player) return false;
    const x = state.player.worldX;
    const z = state.player.worldZ;
    // Wolf mountain pass is roughly x between 2830-2870 and z between 3480-3510
    // The actual dangerous area with wolves
    return x >= 2830 && x <= 2870 && z >= 3480 && z <= 3510;
}

async function walkToWaypoint(
    ctx: ScriptContext,
    x: number,
    z: number,
    name: string,
    tolerance: number = 10
): Promise<boolean> {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Check if in wolf zone - if so, SPRINT without stopping
        const inWolfZone = isInWolfZone(ctx);

        // Eat before walking (unless in wolf zone - stopping there gets you killed)
        if (!inWolfZone) {
            await eatIfLow(ctx);
        }

        const dist = distanceTo(ctx, x, z);
        if (dist <= tolerance) {
            return true;
        }

        ctx.log(`Walking to ${name} (${x}, ${z}) - attempt ${attempt}/${MAX_ATTEMPTS}`);

        // In wolf zone: SPRINT through without stopping - wolves hit 10+ damage!
        // Stopping to eat just gives them more time to attack
        if (inWolfZone) {
            ctx.log(`  [WOLF ZONE] Sprinting through!`);
            await ctx.bot.walkTo(x, z, tolerance);
            // After the sprint, immediately eat to recover
            await eatToFull(ctx);
        } else {
            // Normal walking with HP checks for safe areas
            const result = await ctx.bot.walkTo(x, z, tolerance);
            await eatIfLow(ctx);

            if (!result.success) {
                ctx.warn(`Walk attempt ${attempt} failed: ${result.message}`);
            }
        }

        const newDist = distanceTo(ctx, x, z);
        if (newDist <= tolerance) {
            ctx.progress();
            return true;
        }
    }

    const finalDist = distanceTo(ctx, x, z);
    ctx.warn(`Could not reach ${name} - distance: ${finalDist.toFixed(0)} tiles`);
    return finalDist <= tolerance * 2;
}

/**
 * Check if we're in the Falador center area where pathfinder fails
 */
function isInFaladorGateZone(ctx: ScriptContext): boolean {
    const state = ctx.state();
    if (!state?.player) return false;
    const x = state.player.worldX;
    const z = state.player.worldZ;
    // Falador center is around (2946, 3407)
    // We're in the "gate zone" if we're in north Falador but not yet past Taverley
    return x >= 2920 && x <= 2960 && z >= 3400 && z <= 3450;
}

/**
 * Check if player died (respawned at Lumbridge)
 */
function hasDied(ctx: ScriptContext): boolean {
    const state = ctx.state();
    if (!state?.player) return false;
    const x = state.player.worldX;
    const z = state.player.worldZ;
    // Lumbridge spawn is around (3222, 3218)
    return x > 3200 && x < 3240 && z > 3200 && z < 3240;
}

/**
 * Travel from Lumbridge to Gnome Stronghold
 * With long pathfinding, we only need to handle the members gate manually
 */
async function travelToGnomeStronghold(ctx: ScriptContext): Promise<boolean> {
    ctx.log('Starting journey to Gnome Stronghold Agility Course...');
    ctx.log(`Distance: ~${Math.round(distanceTo(ctx, GNOME_AGILITY_START.x, GNOME_AGILITY_START.z))} tiles`);

    if (isAtGnomeStronghold(ctx)) {
        ctx.log('Already at Gnome Stronghold!');
        return true;
    }

    // Step 1: Walk to the gate area (pathfinder handles getting through Falador)
    const gateWaypoint = WAYPOINTS_TO_GNOME[0]!;
    ctx.log(`\nPhase 1: Walking to members gate area...`);
    const gateSuccess = await walkToWaypoint(ctx, gateWaypoint.x, gateWaypoint.z, gateWaypoint.name);

    if (!gateSuccess && !isInFaladorGateZone(ctx)) {
        ctx.warn(`Could not reach gate area`);
        return false;
    }

    // Step 2: Handle the members gate manually
    if (!isPastTaverleyGate(ctx)) {
        ctx.log(`\nPhase 2: Navigating through members gate...`);
        const passedGate = await navigateFaladorToTaverley(ctx);

        if (!passedGate) {
            ctx.warn(`Failed to pass through members gate`);
            const locs = ctx.sdk.getNearbyLocs();
            ctx.log(`Nearby locations (${locs.length} total):`);
            for (const loc of locs.slice(0, 10)) {
                ctx.log(`  ${loc.name} at (${loc.x}, ${loc.z}) opts=[${loc.options.join(', ')}]`);
            }
            return false;
        }
    }

    // Step 3: Eat to full HP before the long walk (goes through wolf zone)
    ctx.log(`\nPhase 3: Preparing for wolf zone...`);
    await eatToFull(ctx);

    // Step 4: Walk directly to Gnome Stronghold (pathfinder handles wolf mountain)
    const gnomeWaypoint = WAYPOINTS_TO_GNOME[1]!;
    ctx.log(`\nPhase 4: Walking to Gnome Stronghold...`);
    await walkToWaypoint(ctx, gnomeWaypoint.x, gnomeWaypoint.z, gnomeWaypoint.name, 15);

    // Check for death during wolf zone
    if (hasDied(ctx)) {
        ctx.warn('Died during journey (likely wolves)!');
        return false;
    }

    // Step 5: Walk to exact course start position (may need multiple attempts)
    const COURSE_START = { x: 2474, z: 3436 };
    ctx.log(`\nPhase 5: Walking to course start...`);
    for (let attempt = 1; attempt <= 3; attempt++) {
        const dist = distanceTo(ctx, COURSE_START.x, COURSE_START.z);
        if (dist < 10) break;

        ctx.log(`  Walk to course start attempt ${attempt}/3 (dist=${dist.toFixed(0)})`);
        await ctx.bot.walkTo(COURSE_START.x, COURSE_START.z, 5);
        await new Promise(r => setTimeout(r, 500));
    }

    if (isAtGnomeStronghold(ctx)) {
        ctx.log('Arrived at Gnome Stronghold!');
        return true;
    }

    return isAtGnomeStronghold(ctx);
}

/**
 * Find the next agility obstacle to interact with
 */
function findNextObstacle(ctx: ScriptContext, courseIndex: number) {
    const locs = ctx.sdk.getNearbyLocs();
    const target = COURSE_OBSTACLES[courseIndex % COURSE_OBSTACLES.length];

    if (!target) return null;

    // Find obstacle matching this course position
    const obstacle = locs.find(loc =>
        target.name.test(loc.name) &&
        loc.optionsWithIndex.some(o => target.option.test(o.text))
    );

    // Debug: if not found, log nearby agility-like obstacles
    if (!obstacle && courseIndex === 0) {
        const agilityLocs = locs.filter(loc =>
            loc.optionsWithIndex.some(o =>
                /walk|climb|squeeze|balance|cross/i.test(o.text)
            )
        );
        if (agilityLocs.length > 0) {
            ctx.log(`Nearby agility objects: ${agilityLocs.map(l => `${l.name}@(${l.x},${l.z})`).join(', ')}`);
        }
    }

    return obstacle;
}

/**
 * Complete one obstacle
 */
async function completeObstacle(ctx: ScriptContext, courseIndex: number): Promise<boolean> {
    const xpBefore = ctx.sdk.getSkill('Agility')?.experience ?? 0;
    const target = COURSE_OBSTACLES[courseIndex % COURSE_OBSTACLES.length];
    const startTick = ctx.state()?.tick ?? 0;

    const obstacle = findNextObstacle(ctx, courseIndex);
    if (!obstacle) {
        ctx.warn(`Could not find obstacle: ${target?.description}`);
        return false;
    }

    const opt = obstacle.optionsWithIndex.find(o => target!.option.test(o.text));
    if (!opt) {
        ctx.warn(`No matching option on ${obstacle.name}`);
        return false;
    }

    ctx.log(`Attempting: ${obstacle.name} (${opt.text})`);

    // Walk closer if needed
    if (obstacle.distance > 3) {
        await ctx.bot.walkTo(obstacle.x, obstacle.z, 2);
    }

    // Interact with obstacle
    await ctx.sdk.sendInteractLoc(obstacle.x, obstacle.z, obstacle.id, opt.opIndex);

    // Wait for XP gain or significant position change
    const startX = ctx.state()?.player?.worldX ?? 0;
    const startZ = ctx.state()?.player?.worldZ ?? 0;

    try {
        await ctx.sdk.waitForCondition(state => {
            // Dismiss dialogs (level-up messages)
            if (state.dialog.isOpen) {
                ctx.sdk.sendClickDialog(0).catch(() => {});
                return false;
            }

            // XP gain
            const xpNow = state.skills.find(s => s.name === 'Agility')?.experience ?? 0;
            if (xpNow > xpBefore) return true;

            // Significant position change (obstacle completed)
            const dx = Math.abs((state.player?.worldX ?? 0) - startX);
            const dz = Math.abs((state.player?.worldZ ?? 0) - startZ);
            if (dx > 4 || dz > 4) return true;

            // Check for "can not do that from here" message
            for (const msg of state.gameMessages) {
                if (msg.tick > startTick && msg.text.toLowerCase().includes('can not do that')) {
                    return true;
                }
            }

            return false;
        }, 20000);

        const xpAfter = ctx.sdk.getSkill('Agility')?.experience ?? 0;
        if (xpAfter > xpBefore) {
            ctx.log(`  XP gained: +${xpAfter - xpBefore}`);
            ctx.progress();
            return true;
        }

        // Position changed but no XP - might need to re-attempt
        const endX = ctx.state()?.player?.worldX ?? 0;
        const endZ = ctx.state()?.player?.worldZ ?? 0;
        if (Math.abs(endX - startX) > 4 || Math.abs(endZ - startZ) > 4) {
            ctx.log(`  Position changed - obstacle may be complete`);
            ctx.progress();
            return true;
        }

        ctx.warn(`  Obstacle did not complete`);
        return false;

    } catch {
        ctx.warn(`  Timeout waiting for obstacle completion`);
        return false;
    }
}

/**
 * Complete one full lap of the course
 */
async function completeLap(ctx: ScriptContext): Promise<boolean> {
    ctx.log('Starting new lap...');

    for (let i = 0; i < COURSE_OBSTACLES.length; i++) {
        const success = await completeObstacle(ctx, i);
        if (!success) {
            // Try to find any nearby obstacle and continue
            const locs = ctx.sdk.getNearbyLocs();
            const anyObstacle = locs.find(loc =>
                loc.optionsWithIndex.some(o =>
                    /walk|climb|squeeze|balance/i.test(o.text)
                )
            );

            if (anyObstacle) {
                ctx.log(`Found alternate obstacle: ${anyObstacle.name}`);
                const opt = anyObstacle.optionsWithIndex.find(o =>
                    /walk|climb|squeeze|balance/i.test(o.text)
                );
                if (opt) {
                    await ctx.sdk.sendInteractLoc(anyObstacle.x, anyObstacle.z, anyObstacle.id, opt.opIndex);
                    try {
                        await ctx.sdk.waitForStateChange(5000);
                    } catch { /* ignore */ }
                }
            }
        }
    }

    return true;
}

/**
 * Find any agility obstacle nearby (for exploration mode)
 */
function findAnyObstacle(ctx: ScriptContext) {
    const locs = ctx.sdk.getNearbyLocs();
    return locs.find(loc =>
        loc.optionsWithIndex.some(o =>
            /walk-across|walk-on|climb|squeeze|balance/i.test(o.text)
        )
    );
}

/**
 * Train combat stats at Lumbridge goblins until HP is high enough for wolves
 * Training attack/str/def gives HP XP as a byproduct
 */
async function trainCombatForHP(ctx: ScriptContext): Promise<void> {
    const hpSkill = ctx.sdk.getSkill('Hitpoints');
    const currentMaxHP = hpSkill?.baseLevel ?? 10;
    if (currentMaxHP >= MIN_HP_FOR_WOLVES) {
        ctx.log(`HP already at ${currentMaxHP}, sufficient for wolves`);
        return;
    }

    ctx.log(`\n=== Training Combat at Lumbridge Goblins ===`);
    ctx.log(`Current max HP: ${currentMaxHP}, Need: ${MIN_HP_FOR_WOLVES}`);

    // Equip bronze sword for better DPS
    const inv = ctx.sdk.getInventory();
    const sword = inv.find(item => /bronze sword/i.test(item.name));
    if (sword) {
        ctx.log(`Equipping Bronze sword...`);
        const wieldOpt = sword.optionsWithIndex.find(o => /wield|equip/i.test(o.text));
        if (wieldOpt) {
            await ctx.sdk.sendUseItem(sword.slot, wieldOpt.opIndex);
            await new Promise(r => setTimeout(r, 600));
        }
    }

    // Walk to goblin area east of Lumbridge
    ctx.log(`Walking to goblin area...`);
    await ctx.bot.walkTo(GOBLIN_AREA.x, GOBLIN_AREA.z, 10);
    ctx.progress();

    // Train until HP is high enough (time-based with HP check)
    const startTime = Date.now();
    const MAX_TRAINING_TIME = 10 * 60 * 1000; // 10 minutes max
    let lastLogHP = 0;

    while (Date.now() - startTime < MAX_TRAINING_TIME) {
        const hp = ctx.sdk.getSkill('Hitpoints')?.baseLevel ?? 10;
        const atk = ctx.sdk.getSkill('Attack')?.baseLevel ?? 1;
        const str = ctx.sdk.getSkill('Strength')?.baseLevel ?? 1;
        const def = ctx.sdk.getSkill('Defence')?.baseLevel ?? 1;

        if (hp >= MIN_HP_FOR_WOLVES) {
            ctx.log(`HP reached ${hp}! Ready for wolves.`);
            break;
        }

        // Only log every HP level change to reduce spam
        if (hp !== lastLogHP) {
            // Find the lowest skill and train that
            const minLevel = Math.min(atk, str, def);
            let targetSkill = 'Attack';
            if (str === minLevel && str <= atk) targetSkill = 'Strength';
            else if (def === minLevel && def <= atk && def <= str) targetSkill = 'Defence';

            ctx.log(`Training... HP:${hp}/${MIN_HP_FOR_WOLVES} Atk:${atk} Str:${str} Def:${def} [${targetSkill}]`);
            lastLogHP = hp;

            // Get actual combat styles from game state
            const combatState = ctx.state()?.combatStyle;
            if (combatState?.styles) {
                const targetStyle = combatState.styles.find(s =>
                    s.trainedSkill.toLowerCase() === targetSkill.toLowerCase()
                );
                if (targetStyle && combatState.currentStyle !== targetStyle.index) {
                    ctx.log(`  Switching to style ${targetStyle.index} (${targetStyle.name}) for ${targetSkill}`);
                    await ctx.sdk.sendSetCombatStyle(targetStyle.index);
                    await new Promise(r => setTimeout(r, 300));
                }
            }
        }

        // Dismiss level-up dialogs first
        if (ctx.state()?.dialog.isOpen) {
            await ctx.sdk.sendClickDialog(0);
            await new Promise(r => setTimeout(r, 500));
            continue;
        }

        // Check if player is already in combat (has target or is attacking)
        const state = ctx.state();
        const isInCombat = state?.player?.animId &&
            [412, 390, 386, 393, 395, 451, 406, 407].includes(state.player.animId);

        if (isInCombat) {
            // Wait for combat to finish
            ctx.progress();
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        // Find a goblin nearby and attack
        const goblin = ctx.sdk.getNearbyNpcs().find(n => /goblin/i.test(n.name));
        if (goblin) {
            await ctx.bot.attackNpc(goblin);
            ctx.progress();
            // Wait for attack to complete
            await new Promise(r => setTimeout(r, 3000));
        } else {
            // Walk around to find goblins
            const offsetX = Math.floor(Math.random() * 10 - 5);
            const offsetZ = Math.floor(Math.random() * 10 - 5);
            await ctx.bot.walkTo(GOBLIN_AREA.x + offsetX, GOBLIN_AREA.z + offsetZ, 3);
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    const finalHP = ctx.sdk.getSkill('Hitpoints')?.baseLevel ?? 10;
    const finalAtk = ctx.sdk.getSkill('Attack')?.baseLevel ?? 1;
    const finalStr = ctx.sdk.getSkill('Strength')?.baseLevel ?? 1;
    const finalDef = ctx.sdk.getSkill('Defence')?.baseLevel ?? 1;
    ctx.log(`Combat training complete!`);
    ctx.log(`HP: ${currentMaxHP} -> ${finalHP}`);
    ctx.log(`Attack: ${finalAtk}, Strength: ${finalStr}, Defence: ${finalDef}`);
}

/**
 * Main training function
 */
async function trainAgility(ctx: ScriptContext): Promise<void> {
    const state = ctx.state();
    if (!state?.player) throw new Error('No initial state');

    const startXp = ctx.sdk.getSkill('Agility')?.experience ?? 0;
    const startLevel = ctx.sdk.getSkill('Agility')?.baseLevel ?? 1;

    ctx.log(`=== Agility Training ===`);
    ctx.log(`Starting Level: ${startLevel}`);
    ctx.log(`Starting XP: ${startXp}`);
    ctx.log(`Target: Level ${TARGET_LEVEL} (${XP_FOR_LEVEL_10} XP)`);
    ctx.log(`Position: (${state.player.worldX}, ${state.player.worldZ})`);

    // Step 0: Train combat at rats first (wolves hit 10+ damage!)
    // HP comes from the Hitpoints skill - baseLevel is max HP
    const hpSkill = ctx.sdk.getSkill('Hitpoints');
    const currentMaxHP = hpSkill?.baseLevel ?? 10;
    ctx.log(`HP check: maxHP=${currentMaxHP}, need=${MIN_HP_FOR_WOLVES}, training=${currentMaxHP < MIN_HP_FOR_WOLVES}`);
    if (currentMaxHP < MIN_HP_FOR_WOLVES) {
        ctx.log(`\nPhase 0: HP too low (${currentMaxHP}), training combat at goblins first...`);
        await trainCombatForHP(ctx);
    }

    // Step 1: Travel to Gnome Stronghold if not there
    if (!isAtGnomeStronghold(ctx)) {
        ctx.log('\nPhase 1: Traveling to Gnome Stronghold...');
        const arrived = await travelToGnomeStronghold(ctx);

        if (!arrived) {
            ctx.warn('\nCould not reach Gnome Stronghold!');
            ctx.warn('The area may be members-only or blocked on this server.');

            // Document where we got stuck
            const pos = ctx.state()?.player;
            ctx.log(`Final position: (${pos?.worldX}, ${pos?.worldZ})`);
            ctx.log(`Distance to course: ${distanceTo(ctx, GNOME_AGILITY_START.x, GNOME_AGILITY_START.z).toFixed(0)} tiles`);

            throw new Error('Cannot reach Gnome Stronghold - area may be inaccessible');
        }
    }

    // Step 2: Train at the agility course
    ctx.log('\nPhase 2: Training at Gnome Agility Course...');

    let lapsCompleted = 0;
    const MAX_LAPS = 20; // Safety limit

    while (lapsCompleted < MAX_LAPS) {
        const currentXp = ctx.sdk.getSkill('Agility')?.experience ?? 0;
        const currentLevel = ctx.sdk.getSkill('Agility')?.baseLevel ?? 1;

        // Check if we've reached our goal
        if (currentLevel >= TARGET_LEVEL) {
            ctx.log(`\nGoal reached! Level ${currentLevel}`);
            break;
        }

        ctx.log(`\n--- Lap ${lapsCompleted + 1} ---`);
        ctx.log(`Level: ${currentLevel}, XP: ${currentXp}/${XP_FOR_LEVEL_10}`);

        // Always walk to the course START (Log balance location) before each lap
        // The log balance is the first obstacle - we need to be there to start
        const LOG_BALANCE_LOCATION = { x: 2474, z: 3438 };  // Start of course
        const distToStart = distanceTo(ctx, LOG_BALANCE_LOCATION.x, LOG_BALANCE_LOCATION.z);

        if (distToStart > 10) {
            ctx.log(`Walking to course start (Log balance)...`);
            await ctx.bot.walkTo(LOG_BALANCE_LOCATION.x, LOG_BALANCE_LOCATION.z, 5);
            await new Promise(r => setTimeout(r, 500));
        }

        await completeLap(ctx);
        lapsCompleted++;

        // Dismiss any level-up dialogs
        await ctx.bot.dismissBlockingUI();
    }

    // Final summary
    const finalXp = ctx.sdk.getSkill('Agility')?.experience ?? 0;
    const finalLevel = ctx.sdk.getSkill('Agility')?.baseLevel ?? 1;

    ctx.log('\n=== Training Complete ===');
    ctx.log(`Level: ${startLevel} -> ${finalLevel}`);
    ctx.log(`XP: ${startXp} -> ${finalXp} (+${finalXp - startXp})`);
    ctx.log(`Laps completed: ${lapsCompleted}`);

    if (finalLevel < TARGET_LEVEL) {
        ctx.warn(`Did not reach target level ${TARGET_LEVEL}`);
    }
}

// Run the script
runScript({
    name: 'agility',
    goal: `Train Agility from level 1 to ${TARGET_LEVEL} at Gnome Stronghold`,
    preset: TestPresets.LUMBRIDGE_SPAWN,
    timeLimit: 20 * 60 * 1000,  // 20 minutes (combat training + long travel + agility training)
    stallTimeout: 60_000,       // 1 min - position changes now count as progress
}, async (ctx) => {
    await trainAgility(ctx);
});
