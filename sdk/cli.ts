#!/usr/bin/env bun
// SDK CLI - Dump world state for a connected bot
//
// Usage:
//   bun sdk/cli.ts <username> <password>                    # Uses default demo server
//   bun sdk/cli.ts <username> <password> --server <url>     # Custom server
//   SERVER=localhost USERNAME=mybot PASSWORD=pw bun sdk/cli.ts  # Via env vars
//
// Examples:
//   bun sdk/cli.ts mybot secret
//   bun sdk/cli.ts mybot secret --server localhost
//   SERVER=localhost USERNAME=mybot PASSWORD=secret bun sdk/cli.ts

import { BotSDK } from './index';
import { formatWorldState } from './formatter';

function printUsage() {
    console.log(`
SDK CLI - Dump world state for a connected bot

Usage:
  bun sdk/cli.ts <username> [password] [options]
  USERNAME=<user> bun sdk/cli.ts [options]

Options:
  --server <host>   Server hostname (default: rs-sdk-demo.fly.dev)
  --timeout <ms>    Connection timeout in ms (default: 5000)
  --help            Show this help

Environment Variables:
  USERNAME          Bot username
  PASSWORD          Bot password (required for remote servers)
  SERVER            Server hostname

Examples:
  bun sdk/cli.ts mybot --server localhost
  bun sdk/cli.ts mybot secret
  bun sdk/cli.ts mybot secret --server rs-sdk-demo.fly.dev
`.trim());
}

async function main() {
    const args = process.argv.slice(2);

    // Parse args
    let username = process.env.USERNAME || '';
    let password = process.env.PASSWORD || '';
    let server = process.env.SERVER || 'rs-sdk-demo.fly.dev';
    let timeout = 5000;

    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg === '--server' || arg === '-s') {
            server = args[++i] ?? server;
        } else if (arg === '--timeout' || arg === '-t') {
            timeout = parseInt(args[++i] ?? '5000', 10);
        } else if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }

    // Positional args: <username> <password>
    if (positional[0]) username = positional[0];
    if (positional[1]) password = positional[1];

    // Derive if local
    const isLocal = server === 'localhost' || server.startsWith('localhost:');

    if (!username) {
        console.error('Error: Username required');
        console.error('Usage: bun sdk/cli.ts <username> [password] [--server <host>]');
        process.exit(1);
    }

    if (!password && !isLocal) {
        console.error('Error: Password required for remote servers');
        console.error('Usage: bun sdk/cli.ts <username> <password> [--server <host>]');
        process.exit(1);
    }

    // Derive gateway URL
    const gatewayUrl = isLocal
        ? `ws://${server.includes(':') ? server : server + ':7780'}`
        : `wss://${server}/gateway`;

    // Create SDK
    const sdk = new BotSDK({
        botUsername: username,
        password,
        gatewayUrl,
        autoReconnect: false
    });

    // Connect with timeout
    try {
        const connectTimeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Connection timeout')), timeout);
        });

        await Promise.race([sdk.connect(), connectTimeout]);
    } catch (err: any) {
        console.error(`Error: Failed to connect to ${gatewayUrl}`);
        console.error(`  ${err.message}`);
        process.exit(1);
    }

    // Wait briefly for state
    try {
        await sdk.waitForCondition(s => s !== null, Math.min(timeout, 3000));
    } catch {
        // State may not arrive if bot isn't connected
    }

    const state = sdk.getState();

    if (!state) {
        console.error(`Error: No state received for '${username}'`);
        console.error(`  Bot may not be connected to the game server.`);
        console.error(`  Connect the bot first via the web client.`);
        sdk.disconnect();
        process.exit(1);
    }

    if (!state.inGame) {
        console.error(`Error: Bot '${username}' is not in-game`);
        console.error(`  inGame: ${state.inGame}, tick: ${state.tick}`);
        sdk.disconnect();
        process.exit(1);
    }

    // Output formatted state
    console.log(formatWorldState(state, sdk.getStateAge()));

    sdk.disconnect();
    process.exit(0);
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
