# RS-Agent Remote Script Guide

How to write scripts that connect to the demo server using the SDK and open the client in the browser.

## Quick Start

```bash
# Run script (connects to demo server by default)
USERNAME=mybot bun scripts/example-remote.ts

# Connect to localhost instead (for local dev)
SERVER=localhost USERNAME=mybot bun scripts/example-remote.ts
```

## Writing a Remote Script

Create a new script in `scripts/`:

```typescript
#!/usr/bin/env bun
import { BotSDK, BotActions } from '../sdk/actions';
import puppeteer from 'puppeteer';

// Config - defaults to demo server
const SERVER = process.env.SERVER || 'rs-sdk-demo.fly.dev';
const USERNAME = process.env.USERNAME || 'mybot';
const IS_LOCAL = SERVER === 'localhost';

// Derive URLs from server
const CLIENT_URL = IS_LOCAL
    ? `http://${SERVER}:8888/bot?bot=${USERNAME}&password=test`
    : `https://${SERVER}/bot?bot=${USERNAME}&password=test`;
const GATEWAY_URL = IS_LOCAL
    ? `ws://${SERVER}:7780`
    : `wss://${SERVER}/gateway`;

async function main() {
    // 1. Open browser with game client
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto(CLIENT_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // 2. Create SDK and connect
    const sdk = new BotSDK({
        botUsername: USERNAME,
        gatewayUrl: GATEWAY_URL
    });

    sdk.onConnectionStateChange((state) => {
        console.log(`Connection: ${state}`);
    });

    await sdk.connect();

    // 3. Wait for bot to be in-game
    await sdk.waitForCondition(s => s.inGame, 30000);

    // 4. Use high-level BotActions
    const bot = new BotActions(sdk);

    // Your automation logic here
    const tree = sdk.findNearbyLoc(/^tree$/i);
    if (tree) {
        await bot.chopTree(tree);
    }

    // Keep running
    await new Promise(() => {});
}

main().catch(console.error);
```

## SDK Layers

**BotSDK** (low-level) - Resolves when game acknowledges action:
```typescript
await sdk.sendWalk(x, z, running);
await sdk.sendInteractNpc(npcIndex, optionIndex);
await sdk.sendInteractLoc(x, z, locId, optionIndex);
await sdk.sendPickup(x, z, itemId);
```

**BotActions** (high-level) - Resolves when effect completes:
```typescript
await bot.walkTo(x, z);           // Pathfinding + arrival
await bot.chopTree();             // Waits for logs in inventory
await bot.attackNpc(/chicken/);   // Combat with timeout
await bot.openShop('shopkeeper'); // Find, interact, verify
await bot.pickupItem('logs');     // Walk, pickup, verify
```

## Querying State

```typescript
const state = sdk.getState();          // Full world state
const skill = sdk.getSkill('Woodcutting');
const item = sdk.findInventoryItem(/logs/i);
const npc = sdk.findNearbyNpc(/chicken/i);
const tree = sdk.findNearbyLoc(/tree/i);
const loot = sdk.findGroundItem(/bones/i);

// Wait for conditions
await sdk.waitForCondition(s => s.inventory.length > 5, 10000);
```

## Browser URL Parameters

```
https://rs-sdk-demo.fly.dev/bot?bot=NAME&password=test&fps=15&tst=1
```

| Param | Description |
|-------|-------------|
| `bot` | Bot username (required) |
| `password` | Auth password (use `test`) |
| `fps` | Frame rate (optional) |
| `tst` | Test mode - hides UI panels (optional) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER` | `rs-sdk-demo.fly.dev` | Server host (demo or localhost) |
| `USERNAME` | `mybot` | Bot name (max 12 chars) |

## Connection Config

```typescript
// Demo server (path-based routing)
const sdk = new BotSDK({
    botUsername: 'mybot',
    gatewayUrl: 'wss://rs-sdk-demo.fly.dev/gateway'
});

// Local development (port-based)
const sdk = new BotSDK({
    botUsername: 'mybot',
    host: 'localhost',
    port: 7780
});
```

## Project Structure

```
scripts/
├── example-remote.ts     # Reference implementation
├── script-runner.ts      # Structured test runner
└── <your-script>/
    └── script.ts         # Your automation

sdk/
├── index.ts              # BotSDK (low-level)
├── actions.ts            # BotActions (high-level)
└── types.ts              # Type definitions
```

## See Also

- `scripts/example-remote.ts` - Full working example
- `scripts/CLAUDE.md` - Script improvement methodology
- `sdk/types.ts` - All available types and options
