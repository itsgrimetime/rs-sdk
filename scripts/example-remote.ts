#!/usr/bin/env bun
/**
 * Example Remote Script WIP
 *
 * This script demonstrates how to connect to a remote RS-Agent gateway
 * and control a bot. Run this from any machine that can reach the gateway.
 *
 * Usage:
 *   # Connect to localhost (default)
 *   bun scripts/example-remote.ts
 *
 *   # Connect to remote server
 *   GATEWAY_HOST=game.example.com bun scripts/example-remote.ts
 *
 *   # Control specific bot
 *   BOT_USERNAME=player1 bun scripts/example-remote.ts
 */

import { BotSDK, BotActions } from '../sdk/actions';

// Configuration from environment
const GATEWAY_HOST = process.env.GATEWAY_HOST || 'localhost';
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '7780');
const WEB_PORT = parseInt(process.env.WEB_PORT || '8888');
const BOT_USERNAME = process.env.BOT_USERNAME || 'default';

async function main() {
    console.log(`\n🎮 RS-Agent Remote Script`);
    console.log(`   Gateway: ws://${GATEWAY_HOST}:${GATEWAY_PORT}`);
    console.log(`   Bot: ${BOT_USERNAME}\n`);

    // Create SDK instance
    const sdk = new BotSDK({
        botUsername: BOT_USERNAME,
        host: GATEWAY_HOST,
        port: GATEWAY_PORT,
        webPort: WEB_PORT
    });

    // Set up connection monitoring
    sdk.onConnectionStateChange((state, attempt) => {
        if (state === 'connecting') {
            console.log('📡 Connecting to gateway...');
        } else if (state === 'connected') {
            console.log('✅ Connected to gateway');
        } else if (state === 'reconnecting') {
            console.log(`🔄 Reconnecting (attempt ${attempt})...`);
        } else if (state === 'disconnected') {
            console.log('❌ Disconnected from gateway');
        }
    });

    // Connect to gateway
    try {
        await sdk.connect();
    } catch (e) {
        console.error('Failed to connect:', e);
        process.exit(1);
    }

    // Wait for bot state
    console.log('⏳ Waiting for bot state...');
    try {
        await sdk.waitForCondition(s => s.inGame, 30000);
    } catch {
        console.error('Bot is not in game or not connected');
        process.exit(1);
    }

    const state = sdk.getState()!;
    const player = state.player!;
    console.log(`\n👤 Player: ${player.name} (Combat ${player.combatLevel})`);
    console.log(`📍 Position: (${player.worldX}, ${player.worldZ}) level ${player.level}`);

    // Create BotActions for high-level commands
    const bot = new BotActions(sdk);

    // Show skills
    console.log('\n📊 Skills:');
    for (const skill of state.skills.slice(0, 10)) {
        console.log(`   ${skill.name}: ${skill.baseLevel} (${skill.experience.toLocaleString()} XP)`);
    }

    // Show inventory
    console.log('\n🎒 Inventory:');
    const inventory = sdk.getInventory();
    if (inventory.length === 0) {
        console.log('   (empty)');
    } else {
        for (const item of inventory.slice(0, 10)) {
            console.log(`   ${item.name} x${item.count}`);
        }
        if (inventory.length > 10) {
            console.log(`   ... and ${inventory.length - 10} more items`);
        }
    }

    // Show nearby NPCs
    console.log('\n👾 Nearby NPCs:');
    const npcs = sdk.getNearbyNpcs();
    if (npcs.length === 0) {
        console.log('   (none)');
    } else {
        for (const npc of npcs.slice(0, 5)) {
            console.log(`   ${npc.name} (${npc.distance} tiles away) [${npc.options.join(', ')}]`);
        }
    }

    // Show nearby locations (objects)
    console.log('\n🏠 Nearby Objects:');
    const locs = sdk.getNearbyLocs();
    if (locs.length === 0) {
        console.log('   (none)');
    } else {
        for (const loc of locs.slice(0, 5)) {
            console.log(`   ${loc.name} (${loc.distance} tiles away) [${loc.options.join(', ')}]`);
        }
    }

    // Example: Simple actions
    console.log('\n🎯 Ready for commands. Examples:');
    console.log('   - Chop tree: await bot.chopTree()');
    console.log('   - Walk: await bot.walkTo(3200, 3200)');
    console.log('   - Attack: await bot.attackNpc("chicken")');
    console.log('   - Open shop: await bot.openShop("shopkeeper")');

    // Interactive REPL example
    console.log('\n💡 Try modifying this script to add your own automation!\n');

    // Example: Find and chop a tree if one exists
    const tree = sdk.findNearbyLoc(/^tree$/i);
    if (tree) {
        console.log(`🌳 Found a tree at (${tree.x}, ${tree.z}). Chopping...`);
        const result = await bot.chopTree(tree);
        console.log(`   Result: ${result.message}`);
    }

    // Keep script running to receive state updates
    console.log('\n⏳ Listening for state updates (Ctrl+C to exit)...\n');

    sdk.onStateUpdate(state => {
        // Log significant events
        for (const msg of state.gameMessages.slice(-3)) {
            if (msg.tick === state.tick) {
                console.log(`💬 ${msg.text}`);
            }
        }
    });

    // Keep process alive
    await new Promise(() => {});
}

main().catch(console.error);
