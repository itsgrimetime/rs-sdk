#!/usr/bin/env bun
/**
 * Agility Test (SDK)
 * Complete agility obstacles to gain Agility XP.
 *
 * Uses the Gnome Stronghold agility course - the simplest course for level 1.
 * Tests the ability to interact with agility obstacles.
 *
 * Success criteria: Gain Agility XP (complete at least one obstacle)
 */

import { launchBotWithSDK, sleep, type SDKSession } from './utils/browser';
import { generateSave } from './utils/save-generator';

const BOT_NAME = process.env.BOT_NAME ?? `agil${Math.random().toString(36).slice(2, 5)}`;
const MAX_TURNS = 150;

// Gnome Stronghold agility course start (log balance)
const GNOME_AGILITY_START = { x: 2474, z: 3436 };

async function runTest(): Promise<boolean> {
    console.log('=== Agility Test (SDK) ===');
    console.log('Goal: Complete agility obstacles to gain Agility XP');

    // Generate save file at Gnome Stronghold agility course
    console.log(`Creating save file for '${BOT_NAME}'...`);
    await generateSave(BOT_NAME, {
        position: GNOME_AGILITY_START,
        skills: { Agility: 1 },
    });

    let session: SDKSession | null = null;

    try {
        session = await launchBotWithSDK(BOT_NAME, { skipTutorial: false });
        const { sdk, bot } = session;

        // Wait for state to fully load
        await sdk.waitForCondition(s => s.player?.worldX > 0, 10000);
        await sleep(500);

        console.log(`Bot '${session.botName}' ready!`);

        const state = sdk.getState();
        console.log(`Position: (${state?.player?.worldX}, ${state?.player?.worldZ})`);

        const initialLevel = sdk.getSkill('Agility')?.baseLevel ?? 1;
        const initialXp = sdk.getSkill('Agility')?.experience ?? 0;
        console.log(`Initial Agility: level ${initialLevel}, xp ${initialXp}`);

        let obstaclesCompleted = 0;

        for (let turn = 1; turn <= MAX_TURNS; turn++) {
            const currentState = sdk.getState();

            // Check for success - XP gain
            const currentXp = sdk.getSkill('Agility')?.experience ?? 0;
            if (currentXp > initialXp) {
                console.log(`Turn ${turn}: SUCCESS - Agility XP gained! (${initialXp} -> ${currentXp})`);
                return true;
            }

            // Progress logging
            if (turn % 30 === 0) {
                console.log(`Turn ${turn}: Agility xp ${currentXp}, obstacles ${obstaclesCompleted}`);
                console.log(`  Position: (${currentState?.player?.worldX}, ${currentState?.player?.worldZ})`);
            }

            // Handle dialogs
            if (currentState?.dialog.isOpen) {
                await sdk.sendClickDialog(0);
                await sleep(300);
                continue;
            }

            // Find agility obstacles
            const locs = sdk.getNearbyLocs();
            if (turn === 1 || turn % 40 === 0) {
                const uniqueNames = [...new Set(locs.map(l => l.name))].slice(0, 15);
                console.log(`Turn ${turn}: Nearby locs: ${uniqueNames.join(', ')}`);
            }

            // Look for agility obstacles with walk/climb/cross/jump options
            const agilityObstacle = locs.find(loc =>
                loc.optionsWithIndex.some(o =>
                    /walk|climb|cross|jump|balance|squeeze|swing/i.test(o.text)
                )
            );

            if (agilityObstacle) {
                const agilityOpt = agilityObstacle.optionsWithIndex.find(o =>
                    /walk|climb|cross|jump|balance|squeeze|swing/i.test(o.text)
                );

                if (agilityOpt) {
                    if (turn === 1 || turn % 20 === 1) {
                        console.log(`Turn ${turn}: Found ${agilityObstacle.name} with option: ${agilityOpt.text}`);
                        console.log(`  At (${agilityObstacle.x}, ${agilityObstacle.z})`);
                    }

                    await sdk.sendInteractLoc(agilityObstacle.x, agilityObstacle.z, agilityObstacle.id, agilityOpt.opIndex);
                    obstaclesCompleted++;

                    // Wait for XP gain or position change (obstacle completion)
                    const startX = currentState?.player?.worldX ?? 0;
                    const startZ = currentState?.player?.worldZ ?? 0;

                    try {
                        await sdk.waitForCondition(state => {
                            // XP gain
                            const xp = state.skills.find(s => s.name === 'Agility')?.experience ?? 0;
                            if (xp > initialXp) return true;

                            // Position changed significantly (moved across obstacle)
                            const dx = Math.abs((state.player?.worldX ?? 0) - startX);
                            const dz = Math.abs((state.player?.worldZ ?? 0) - startZ);
                            if (dx > 3 || dz > 3) return true;

                            // Dialog opened
                            if (state.dialog.isOpen) return true;

                            return false;
                        }, 15000);
                    } catch {
                        // Timeout - might be stuck
                        console.log(`Turn ${turn}: Obstacle interaction timed out`);
                    }
                    continue;
                }
            }

            // If no obstacle found, look for common agility course objects by name
            const namedObstacle = locs.find(loc =>
                /log|net|rope|branch|pipe|wall|ledge|hurdle|plank/i.test(loc.name)
            );

            if (namedObstacle && namedObstacle.optionsWithIndex.length > 0) {
                const opt = namedObstacle.optionsWithIndex[0];
                if (turn % 15 === 1) {
                    console.log(`Turn ${turn}: Trying ${namedObstacle.name} with option: ${opt.text}`);
                }
                await sdk.sendInteractLoc(namedObstacle.x, namedObstacle.z, namedObstacle.id, opt.opIndex);
                await sleep(3000);
                continue;
            }

            // Walk around to find obstacles
            if (turn % 20 === 0) {
                const px = currentState?.player?.worldX ?? GNOME_AGILITY_START.x;
                const pz = currentState?.player?.worldZ ?? GNOME_AGILITY_START.z;
                const dx = Math.floor(Math.random() * 16) - 8;
                const dz = Math.floor(Math.random() * 16) - 8;
                console.log(`Turn ${turn}: No obstacles found, exploring...`);
                await bot.walkTo(px + dx, pz + dz);
            }

            await sleep(600);
        }

        // Final results
        const finalXp = sdk.getSkill('Agility')?.experience ?? 0;
        const finalLevel = sdk.getSkill('Agility')?.baseLevel ?? 1;

        console.log(`\n=== Results ===`);
        console.log(`Agility: level ${initialLevel} -> ${finalLevel}, xp +${finalXp - initialXp}`);
        console.log(`Obstacles attempted: ${obstaclesCompleted}`);

        if (finalXp > initialXp) {
            console.log('SUCCESS: Gained Agility XP!');
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
