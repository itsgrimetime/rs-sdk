#!/usr/bin/env bun
/**
 * Fishing Test (SDK)
 * Catch fish at a fishing spot to gain Fishing XP.
 *
 * Success criteria: Fishing XP gained (fish caught)
 */

import { launchBotWithSDK, sleep, type SDKSession } from './utils/browser';
import { generateSave, TestPresets } from './utils/save-generator';

const BOT_NAME = process.env.BOT_NAME ?? `fish${Math.random().toString(36).slice(2, 5)}`;
const MAX_TURNS = 100;

async function runTest(): Promise<boolean> {
    console.log('=== Fishing Test (SDK) ===');
    console.log('Goal: Catch fish to gain Fishing XP');

    // Spawn at Al Kharid fishing spot with net (safe from dark wizards)
    await generateSave(BOT_NAME, TestPresets.FISHER_AT_ALKHARID);

    let session: SDKSession | null = null;

    try {
        session = await launchBotWithSDK(BOT_NAME, { skipTutorial: false });
        const { sdk, bot } = session;

        await sdk.waitForCondition(s => s.player?.worldX > 0 && s.inventory.length > 0, 10000);
        await sleep(500);

        console.log(`Bot '${session.botName}' ready!`);

        const state = sdk.getState();
        console.log(`Position: (${state?.player?.worldX}, ${state?.player?.worldZ})`);

        const initialXp = sdk.getSkill('Fishing')?.experience ?? 0;
        console.log(`Initial Fishing XP: ${initialXp}`);

        const net = sdk.findInventoryItem(/net/i);
        if (!net) {
            console.log('ERROR: No fishing net in inventory');
            return false;
        }
        console.log(`Have ${net.name}`);

        let fishCaught = 0;

        for (let turn = 1; turn <= MAX_TURNS; turn++) {
            const currentXp = sdk.getSkill('Fishing')?.experience ?? 0;

            // Success: XP gained
            if (currentXp > initialXp) {
                console.log(`Turn ${turn}: SUCCESS - Fishing XP gained (${initialXp} -> ${currentXp})`);
                console.log(`Fish caught: ${fishCaught}`);
                return true;
            }

            if (turn % 20 === 0) {
                console.log(`Turn ${turn}: Fishing XP=${currentXp}, fish caught=${fishCaught}`);
            }

            // Handle dialogs
            const currentState = sdk.getState();
            if (currentState?.dialog.isOpen) {
                await sdk.sendClickDialog(0);
                await sleep(300);
                continue;
            }

            // Find fishing spot (fishing spots are NPCs)
            const fishingSpot = sdk.findNearbyNpc(/fishing spot/i);

            if (fishingSpot) {
                // Get net fishing option
                const netOption = fishingSpot.optionsWithIndex.find(o => /small net|net/i.test(o.text));
                if (netOption) {
                    if (turn === 1) {
                        console.log(`Found ${fishingSpot.name} at distance ${fishingSpot.distance}`);
                        console.log(`Using option: ${netOption.text}`);
                    }

                    const invBefore = sdk.getInventory().length;
                    await sdk.sendInteractNpc(fishingSpot.index, netOption.opIndex);

                    // Wait for fish or spot to move
                    try {
                        await sdk.waitForCondition(s => {
                            if (s.inventory.length > invBefore) return true;
                            if (!s.nearbyNpcs.find(n => n.index === fishingSpot.index)) return true;
                            if (s.dialog.isOpen) return true;
                            return false;
                        }, 10000);

                        if (sdk.getInventory().length > invBefore) {
                            fishCaught++;
                        }
                    } catch {
                        // Timeout - continue
                    }
                    continue;
                }
            } else {
                // Walk around to find spot
                if (turn % 5 === 0) {
                    const px = currentState?.player?.worldX ?? 3086;
                    const pz = currentState?.player?.worldZ ?? 3230;
                    const dx = Math.floor(Math.random() * 6) - 3;
                    const dz = Math.floor(Math.random() * 6) - 3;
                    await bot.walkTo(px + dx, pz + dz);
                }
            }

            await sleep(600);
        }

        const finalXp = sdk.getSkill('Fishing')?.experience ?? 0;
        console.log(`Final Fishing XP: ${finalXp} (+${finalXp - initialXp})`);
        console.log(`Fish caught: ${fishCaught}`);
        return finalXp > initialXp;

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
