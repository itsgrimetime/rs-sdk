#!/usr/bin/env bun
/**
 * Attack Out of Reach Test (SDK)
 * Tests the attackNpc failure mode when trying to attack an NPC through an obstacle.
 *
 * Scenario:
 * - Position the player outside the Lumbridge cow field gate
 * - Try to attack a cow inside the fenced area
 * - Verify that attackNpc returns success: false with reason: 'out_of_reach'
 *
 * This tests the waitForCombat option of bot.attackNpc() which detects
 * "I can't reach that!" messages from the server.
 */

import { launchBotWithSDK, sleep, type SDKSession } from './utils/browser';
import { generateSave, Locations } from './utils/save-generator';

const BOT_NAME = process.env.BOT_NAME ?? `reach${Math.random().toString(36).slice(2, 5)}`;

// Position outside the cow field fence (south of the gate)
// The cows are inside the fenced area to the north
// Fence is at z: 3255, so z: 3254 is outside
const OUTSIDE_COW_FIELD = { x: 3253, z: 3254 };

async function runTest(): Promise<boolean> {
    console.log('=== Attack Out of Reach Test (SDK) ===');
    console.log('Goal: Verify attackNpc detects "can\'t reach" failure when attacking through fence');

    // Create save outside the cow field
    console.log(`Creating save file for '${BOT_NAME}' at position outside cow field...`);
    await generateSave(BOT_NAME, {
        position: { ...OUTSIDE_COW_FIELD, level: 0 },
    });

    let session: SDKSession | null = null;

    try {
        session = await launchBotWithSDK(BOT_NAME, { skipTutorial: false });
        const { sdk, bot } = session;

        // Wait for state to fully load
        await sdk.waitForCondition(s => s.player?.worldX > 0, 10000);
        await sleep(1000);

        console.log(`Bot '${session.botName}' ready!`);

        const startState = sdk.getState();
        console.log(`Player position: (${startState?.player?.worldX}, ${startState?.player?.worldZ})`);

        // Find a cow nearby (should be visible through the fence)
        const nearbyNpcs = sdk.getNearbyNpcs();
        console.log(`Nearby NPCs: ${nearbyNpcs.map(n => `${n.name}(dist=${n.distance})`).join(', ')}`);

        const cow = nearbyNpcs.find(n => /cow/i.test(n.name));
        if (!cow) {
            console.log('ERROR: No cow found nearby. Test cannot proceed.');
            console.log('This might mean the spawn position is wrong or cows haven\'t spawned yet.');
            // Try walking closer to the cow field and check again
            console.log('Walking north towards cow field...');
            await bot.walkTo(OUTSIDE_COW_FIELD.x, OUTSIDE_COW_FIELD.z + 5);
            await sleep(1000);

            const retryNpcs = sdk.getNearbyNpcs();
            console.log(`Nearby NPCs after walk: ${retryNpcs.map(n => `${n.name}(dist=${n.distance})`).join(', ')}`);

            const retryCow = retryNpcs.find(n => /cow/i.test(n.name));
            if (!retryCow) {
                console.log('Still no cow found. Test FAILED - cannot find target NPC.');
                return false;
            }
        }

        const targetCow = sdk.getNearbyNpcs().find(n => /cow/i.test(n.name))!;
        console.log(`Found cow: ${targetCow.name} at distance ${targetCow.distance}`);

        // Attempt to attack the cow with waitForCombat=true
        // This should fail with "can't reach" since there's a fence between us
        console.log('\n--- Attempting to attack cow through fence ---');
        console.log('Using: bot.attackNpc(cow, { waitForCombat: true })');

        const attackResult = await bot.attackNpc(targetCow, 15000);  // 15s timeout - pathfinding takes time before "can't reach"

        console.log(`\nAttack result:`);
        console.log(`  success: ${attackResult.success}`);
        console.log(`  message: ${attackResult.message}`);
        console.log(`  reason: ${attackResult.reason ?? 'none'}`);

        // Check for expected failure
        if (!attackResult.success && attackResult.reason === 'out_of_reach') {
            console.log('\nSUCCESS: Attack correctly failed with "out_of_reach" reason!');
            console.log('The fence blocked the attack as expected.');
            return true;
        }

        // If attack succeeded, we might have found a path or the fence isn't blocking
        if (attackResult.success) {
            console.log('\nUNEXPECTED: Attack succeeded!');
            console.log('Either the player found a path to the cow, or the fence is not blocking.');
            console.log('This could happen if:');
            console.log('  - The gate was open');
            console.log('  - The spawn position was inside the cow field');
            console.log('  - The pathfinding found a way around');

            // This isn't necessarily a test failure - just unexpected
            // The point is to verify the failure detection works
            return false;
        }

        // Other failure reasons
        console.log(`\nFAILED: Attack failed but with unexpected reason: ${attackResult.reason}`);
        return false;

    } finally {
        if (session) {
            await session.cleanup();
        }
    }
}

runTest()
    .then(ok => {
        console.log(ok ? '\nPASSED' : '\nFAILED');
        process.exit(ok ? 0 : 1);
    })
    .catch(e => {
        console.error('Fatal:', e);
        process.exit(1);
    });
