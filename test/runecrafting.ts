#!/usr/bin/env bun
/**
 * Runecrafting Test (SDK)
 * Craft runes at an altar to gain Runecrafting XP.
 *
 * Tests the runecrafting mechanic:
 * 1. Use air talisman on mysterious ruins to enter altar
 * 2. Craft air runes from rune essence at the altar
 * 3. Verify Runecrafting XP gained
 *
 * Success criteria: Runecrafting XP gained (runes crafted)
 */

import { launchBotWithSDK, sleep, type SDKSession } from './utils/browser';
import { generateSave, Items } from './utils/save-generator';

const BOT_NAME = process.env.BOT_NAME ?? `rc${Math.random().toString(36).slice(2, 5)}`;
const MAX_TURNS = 150;

// Air altar ruins location (south of Falador)
const AIR_ALTAR_RUINS = { x: 2985, z: 3293 };

async function runTest(): Promise<boolean> {
    console.log('=== Runecrafting Test (SDK) ===');
    console.log('Goal: Craft air runes to gain Runecrafting XP');

    // Generate save file at air altar with talisman and essence
    console.log(`Creating save file for '${BOT_NAME}'...`);
    await generateSave(BOT_NAME, {
        position: AIR_ALTAR_RUINS,
        skills: { Runecraft: 1 },
        inventory: [
            { id: Items.AIR_TALISMAN, count: 1 },
            { id: Items.RUNE_ESSENCE, count: 1 },
        ],
    });

    let session: SDKSession | null = null;

    try {
        session = await launchBotWithSDK(BOT_NAME, { skipTutorial: false });
        const { sdk, bot } = session;

        // Wait for state to fully load
        await sdk.waitForCondition(s => s.player?.worldX > 0 && s.inventory.length > 0, 10000);
        await sleep(500);

        console.log(`Bot '${session.botName}' ready!`);

        const state = sdk.getState();
        console.log(`Position: (${state?.player?.worldX}, ${state?.player?.worldZ})`);

        const initialLevel = sdk.getSkill('Runecraft')?.baseLevel ?? 1;
        const initialXp = sdk.getSkill('Runecraft')?.experience ?? 0;
        console.log(`Initial Runecraft: level ${initialLevel}, xp ${initialXp}`);

        // Check inventory
        const talisman = sdk.findInventoryItem(/talisman/i);
        const essence = sdk.findInventoryItem(/essence/i);
        console.log(`Inventory: talisman=${talisman?.name ?? 'none'}, essence=${essence?.name ?? 'none'}`);

        if (!talisman || !essence) {
            console.log('FAILED: Missing talisman or essence');
            return false;
        }

        let enteredAltar = false;
        let craftAttempted = false;

        for (let turn = 1; turn <= MAX_TURNS; turn++) {
            const currentState = sdk.getState();
            const currentX = currentState?.player?.worldX ?? 0;

            // Check for success - XP gain
            const currentXp = sdk.getSkill('Runecraft')?.experience ?? 0;
            if (currentXp > initialXp) {
                console.log(`Turn ${turn}: SUCCESS - Runecrafting XP gained! (${initialXp} -> ${currentXp})`);
                return true;
            }

            // Check if we have air runes (crafted successfully)
            const airRunes = sdk.findInventoryItem(/^air rune$/i);
            if (airRunes && airRunes.count > 0) {
                console.log(`Turn ${turn}: SUCCESS - Crafted air runes!`);
                return true;
            }

            // Progress logging
            if (turn % 30 === 0) {
                console.log(`Turn ${turn}: Runecraft xp ${currentXp}, pos (${currentX}, ${currentState?.player?.worldZ})`);
            }

            // Handle dialogs
            if (currentState?.dialog.isOpen) {
                await sdk.sendClickDialog(0);
                await sleep(300);
                continue;
            }

            // Check if we're inside the altar (position changes significantly when entering)
            // Air altar interior is in a different area
            if (currentX < 2900 || currentX > 3200) {
                enteredAltar = true;
                if (turn % 10 === 1) {
                    console.log(`Turn ${turn}: Inside altar area (${currentX})`);
                }
            }

            const locs = sdk.getNearbyLocs();
            if (turn === 1 || turn % 40 === 0) {
                const uniqueNames = [...new Set(locs.map(l => l.name))].slice(0, 15);
                console.log(`Turn ${turn}: Nearby locs: ${uniqueNames.join(', ')}`);
            }

            // If inside altar, find and use the altar to craft
            if (enteredAltar) {
                const altar = locs.find(loc =>
                    /altar/i.test(loc.name) &&
                    loc.optionsWithIndex.some(o => /craft/i.test(o.text))
                );

                if (altar && !craftAttempted) {
                    const craftOpt = altar.optionsWithIndex.find(o => /craft/i.test(o.text));
                    if (craftOpt) {
                        console.log(`Turn ${turn}: Crafting at ${altar.name}`);
                        await sdk.sendInteractLoc(altar.x, altar.z, altar.id, craftOpt.opIndex);
                        craftAttempted = true;

                        // Wait for XP gain
                        try {
                            await sdk.waitForCondition(s => {
                                const xp = s.skills.find(sk => sk.name === 'Runecraft')?.experience ?? 0;
                                return xp > initialXp;
                            }, 10000);
                        } catch {
                            craftAttempted = false;
                        }
                        continue;
                    }
                }

                // Try clicking on any altar-like object
                const anyAltar = locs.find(loc => /altar/i.test(loc.name));
                if (anyAltar && anyAltar.optionsWithIndex.length > 0) {
                    const opt = anyAltar.optionsWithIndex[0];
                    if (turn % 10 === 1) {
                        console.log(`Turn ${turn}: Trying ${anyAltar.name} - ${opt.text}`);
                    }
                    await sdk.sendInteractLoc(anyAltar.x, anyAltar.z, anyAltar.id, opt.opIndex);
                    await sleep(2000);
                    continue;
                }
            }

            // Outside altar - find mysterious ruins and enter
            const ruins = locs.find(loc =>
                /mysterious ruins|ruins/i.test(loc.name)
            );

            if (ruins && !enteredAltar) {
                if (turn === 1) {
                    console.log(`Turn ${turn}: Found ${ruins.name} at (${ruins.x}, ${ruins.z})`);
                    console.log(`  Options: ${ruins.optionsWithIndex.map(o => `${o.opIndex}:${o.text}`).join(', ')}`);
                }

                // Try using talisman on ruins
                const currentTalisman = sdk.findInventoryItem(/talisman/i);
                if (currentTalisman) {
                    console.log(`Turn ${turn}: Using talisman on ruins`);
                    await sdk.sendUseItemOnLoc(currentTalisman.slot, ruins.x, ruins.z, ruins.id);

                    // Wait for position change (entering altar)
                    try {
                        await sdk.waitForCondition(s => {
                            const x = s.player?.worldX ?? 0;
                            return x < 2900 || x > 3200;
                        }, 10000);
                        enteredAltar = true;
                        console.log('Entered altar!');
                    } catch {
                        console.log('Failed to enter altar, trying again...');
                    }
                    continue;
                }

                // Or try "Enter" option if available
                const enterOpt = ruins.optionsWithIndex.find(o => /enter/i.test(o.text));
                if (enterOpt) {
                    console.log(`Turn ${turn}: Entering ruins`);
                    await sdk.sendInteractLoc(ruins.x, ruins.z, ruins.id, enterOpt.opIndex);
                    await sleep(3000);
                    continue;
                }
            }

            // Walk toward altar location if nothing found
            if (turn % 20 === 0 && !ruins && !enteredAltar) {
                console.log(`Turn ${turn}: Walking toward altar ruins...`);
                await bot.walkTo(AIR_ALTAR_RUINS.x, AIR_ALTAR_RUINS.z);
            }

            await sleep(600);
        }

        // Final check
        const finalXp = sdk.getSkill('Runecraft')?.experience ?? 0;
        const finalLevel = sdk.getSkill('Runecraft')?.baseLevel ?? 1;

        console.log(`\n=== Results ===`);
        console.log(`Runecraft: level ${initialLevel} -> ${finalLevel}, xp +${finalXp - initialXp}`);

        if (finalXp > initialXp) {
            console.log('SUCCESS: Crafted runes!');
            return true;
        } else {
            console.log('FAILED: No XP gained');
            return false;
        }

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
