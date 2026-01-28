#!/usr/bin/env bun
/**
 * Woodcutter Script
 *
 * Connects to the demo server and continuously chops trees.
 *
 * Usage:
 *   bun scripts/woodcutter.ts
 */

import { BotSDK, BotActions } from '../sdk/actions';
import puppeteer from 'puppeteer';

// Demo server defaults (rs-sdk-demo.fly.dev)
const DEMO_SERVER = 'rs-sdk-demo.fly.dev';
const GATEWAY_URL = process.env.GATEWAY_URL || `wss://${DEMO_SERVER}/gateway`;
const WEB_HOST = process.env.WEB_HOST || DEMO_SERVER;
const BOT_USERNAME = process.env.BOT_USERNAME || 'woodcutter';
const USE_HTTPS = !GATEWAY_URL.startsWith('ws://');

async function main() {
    const protocol = USE_HTTPS ? 'https' : 'http';
    const clientUrl = `${protocol}://${WEB_HOST}/bot?bot=${BOT_USERNAME}&password=test`;

    console.log(`\nWoodcutter Script`);
    console.log(`Gateway: ${GATEWAY_URL}`);
    console.log(`Client: ${clientUrl}\n`);

    // 1. Open browser with game client
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto(clientUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Browser opened, waiting for client to fully load...');
    // Give the browser client extra time to connect to game server
    await new Promise(r => setTimeout(r, 10000));
    console.log('Client should be ready\n');

    // 2. Create SDK and connect (use gatewayUrl for path-based routing)
    const sdk = new BotSDK({
        botUsername: BOT_USERNAME,
        gatewayUrl: GATEWAY_URL
    });

    sdk.onConnectionStateChange((state, attempt) => {
        if (state === 'connecting') {
            console.log('Connecting to gateway...');
        } else if (state === 'connected') {
            console.log('Connected to gateway');
        } else if (state === 'reconnecting') {
            console.log(`Reconnecting (attempt ${attempt})...`);
        } else if (state === 'disconnected') {
            console.log('Disconnected from gateway');
        }
    });

    try {
        await sdk.connect();
    } catch (e) {
        console.error('Failed to connect:', e);
        process.exit(1);
    }

    // 3. Wait for bot to be in-game
    console.log('Waiting for bot to be in-game...');
    try {
        await sdk.waitForCondition(s => s.inGame, 30000);
    } catch {
        console.error('Bot is not in game');
        process.exit(1);
    }

    // Give the connection a moment to stabilize (browser client needs time to connect)
    console.log('Waiting for connection to stabilize...');
    await new Promise(r => setTimeout(r, 5000));

    // Test if actions work by sending a simple wait command
    console.log('Testing connection...');
    try {
        await sdk.sendWait(1);
        console.log('Connection test passed!');
    } catch (e: any) {
        console.log(`Connection test failed: ${e.message}`);
        console.log('Waiting more and retrying...');
        await new Promise(r => setTimeout(r, 10000));
        try {
            await sdk.sendWait(1);
            console.log('Connection test passed on retry!');
        } catch {
            console.log('Connection still not working, proceeding anyway...');
        }
    }

    const state = sdk.getState()!;
    const player = state.player!;
    console.log(`\nPlayer: ${player.name} at (${player.worldX}, ${player.worldZ})`);

    // 4. Create BotActions for high-level commands
    const bot = new BotActions(sdk);

    // Show initial woodcutting level
    const wcSkill = sdk.getSkill('Woodcutting');
    if (wcSkill) {
        console.log(`Woodcutting: Level ${wcSkill.baseLevel} (${wcSkill.experience} XP)`);
    }

    // Check inventory for axe
    const inventory = sdk.getInventory();
    console.log(`Inventory (${inventory.length} items):`);
    for (const item of inventory.slice(0, 10)) {
        console.log(`  - ${item.name} x${item.count}`);
    }

    let axe = inventory.find(i => /axe/i.test(i.name));
    if (axe) {
        console.log(`\nHave axe: ${axe.name}`);
    } else {
        console.log('\nNo axe in inventory. Looking for a shop...');

        // Look for shop NPCs
        const npcs = sdk.getNearbyNpcs();
        const shopkeeper = npcs.find(npc =>
            /shop/i.test(npc.name) ||
            npc.options.some(opt => /trade|shop/i.test(opt))
        );

        if (shopkeeper) {
            console.log(`Found shopkeeper: ${shopkeeper.name}`);
            try {
                const shopResult = await bot.openShop(shopkeeper);
                if (shopResult.success) {
                    console.log('Shop opened!');

                    // Look for axe in shop
                    const shopState = sdk.getState()?.shop;
                    if (shopState?.shopItems) {
                        console.log(`Shop has ${shopState.shopItems.length} items`);
                        const shopAxe = shopState.shopItems.find((i: { name: string }) => /axe/i.test(i.name));
                        if (shopAxe) {
                            console.log(`Found ${shopAxe.name} in shop, buying...`);
                            await sdk.sendShopBuy(shopAxe.slot, 1);
                            await new Promise(r => setTimeout(r, 500));
                            await sdk.sendCloseShop();
                        }
                    }
                }
            } catch (e: any) {
                console.log(`Could not open shop: ${e.message}`);
            }
        }

        // Check again for axe
        axe = sdk.getInventory().find(i => /axe/i.test(i.name));
        if (!axe) {
            console.log('\nCould not get an axe. Need to find one manually.');
            console.log('Try spawning near a shop or with starting equipment.');
            console.log('Proceeding anyway - will attempt to chop...\n');
        } else {
            console.log(`\nGot axe: ${axe.name}`);
        }
    }

    // 5. Main woodcutting loop
    console.log('Starting woodcutting loop...\n');
    let treesChopped = 0;

    while (true) {
        // Check for blocking dialogs (level-up, etc.)
        const currentState = sdk.getState();
        if (currentState?.dialog?.isOpen) {
            console.log('Dismissing dialog...');
            try {
                await sdk.sendClickDialog(0);
            } catch {
                // Ignore errors dismissing dialogs
            }
            await new Promise(r => setTimeout(r, 500));
            continue;
        }

        // Find all nearby trees and try them in order
        const trees = sdk.getNearbyLocs().filter(loc => /^tree$/i.test(loc.name));

        if (trees.length === 0) {
            console.log('No trees nearby, waiting...');
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        let chopped = false;
        for (const tree of trees.slice(0, 5)) { // Try up to 5 trees
            const currentPlayer = sdk.getState()?.player;
            const dist = currentPlayer ? Math.hypot(tree.x - currentPlayer.worldX, tree.z - currentPlayer.worldZ) : 0;

            if (dist > 15) continue; // Skip trees that are too far

            console.log(`Trying tree at (${tree.x}, ${tree.z}), distance: ${dist.toFixed(1)} tiles`);

            try {
                // Walk closer first if needed (only if we're far)
                if (dist > 3) {
                    console.log('Walking closer...');
                    const walkResult = await bot.walkTo(tree.x, tree.z, 2);
                    if (!walkResult.success && walkResult.message.includes('No path')) {
                        console.log('No path to tree, trying another...');
                        continue; // Try next tree
                    }
                    console.log(`Walk: ${walkResult.message}`);
                    await new Promise(r => setTimeout(r, 500));
                }

                console.log('Chopping...');
                const result = await bot.chopTree(tree);

                if (result.success) {
                    treesChopped++;
                    const skill = sdk.getSkill('Woodcutting');
                    console.log(`Chopped tree #${treesChopped} - WC Level: ${skill?.baseLevel || '?'} (${skill?.experience || 0} XP)`);
                    chopped = true;
                    break; // Success, move on
                } else {
                    console.log(`Failed: ${result.message}`);
                    // If timed out, tree might be unreachable - try next
                    if (result.message.includes('Timed out')) {
                        continue;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (e: any) {
                console.log(`Error: ${e.message}`);
                if (e.message.includes('not connected')) {
                    console.log('Waiting for connection...');
                    await new Promise(r => setTimeout(r, 5000));
                    break; // Stop trying trees on connection error
                }
            }
        }

        if (!chopped) {
            console.log('Could not chop any tree, waiting...');
            await new Promise(r => setTimeout(r, 2000));
        }

        // Check if inventory is full
        const inventory = sdk.getInventory();
        if (inventory.length >= 28) {
            console.log('\nInventory full! Dropping logs...');
            // Drop all logs
            for (const item of inventory) {
                if (/logs/i.test(item.name)) {
                    try {
                        await sdk.sendDropItem(item.slot);
                        await new Promise(r => setTimeout(r, 300));
                    } catch {
                        // Ignore drop errors
                    }
                }
            }
            console.log('Logs dropped, continuing...\n');
        }

        // Small delay between iterations
        await new Promise(r => setTimeout(r, 100));
    }
}

main().catch(console.error);
