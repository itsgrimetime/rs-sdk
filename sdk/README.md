# @rs-agent/sdk

Standalone SDK for controlling RS-Agent bots remotely.

## Installation

```
### Requirements

- [Bun](https://bun.sh) runtime (recommended) or Node.js 18+
- TypeScript 5+

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash
```

## Quick Start

Create a new script file (e.g., `my-bot.ts`):

```typescript
import { BotSDK } from './rs-sdk/index';
import { BotActions } from './rs-sdk/actions';

// Connect to the public demo server (ephemeral save files!)
const sdk = new BotSDK({
    botUsername: 'mybot123',
    gatewayUrl: 'wss://rs-sdk-demo.fly.dev/gateway'
});

await sdk.connect();
console.log('Connected!');

// Wait for game state
await sdk.waitForCondition(s => s.inGame, 30000);

// Create high-level bot actions wrapper
const bot = new BotActions(sdk);

// Get player info
const player = sdk.getState()!.player!;
console.log(`Player: ${player.name} at (${player.worldX}, ${player.worldZ})`);

// High-level actions (wait for effects to complete)
await bot.chopTree();     // Waits for logs in inventory
await bot.burnLogs();     // Waits for Firemaking XP
await bot.walkTo(3200, 3200);  // Uses pathfinding, waits for arrival

// Low-level actions (return on game acknowledgment)
await sdk.sendWalk(3200, 3200, true);
await sdk.sendInteractNpc(npc.index, 1);
```

Run with Bun:
```bash
bun my-bot.ts
```

### Opening a Browser Client

To actually see your bot in-game, open a browser to the bot client URL:

```
https://rs-sdk-demo.fly.dev/bot?bot=mybot123&password=test
```

Or launch programmatically with Puppeteer:

```typescript
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();
await page.goto('https://rs-sdk-demo.fly.dev/bot?bot=mybot123&password=test');
```

## Connection Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `botUsername` | required | Bot to control (max 12 chars) |
| `gatewayUrl` | - | Full WebSocket URL (e.g. `wss://server.com/gateway`) |
| `host` | `'localhost'` | Gateway hostname (ignored if gatewayUrl set) |
| `port` | `7780` | Gateway port (ignored if gatewayUrl set) |
| `actionTimeout` | `30000` | Action timeout in ms |
| `autoReconnect` | `true` | Auto-reconnect on disconnect |



## Two-Layer API

### Plumbing (BotSDK)

Low-level protocol mapping. Actions resolve when the game **acknowledges** them.

```typescript
await sdk.sendWalk(x, z, running);
await sdk.sendInteractLoc(x, z, locId, option);
await sdk.sendInteractNpc(npcIndex, option);
await sdk.sendShopBuy(slot, amount);
```

### Porcelain (BotActions)

Domain-aware API. Actions resolve when the **effect** is complete.

```typescript
await bot.chopTree();      // Waits for logs OR tree disappears
await bot.burnLogs();      // Waits for Firemaking XP
await bot.buyFromShop();   // Waits for item in inventory
await bot.walkTo(x, z);    // Uses pathfinding, waits for arrival
```

## State Access

```typescript
// Full state
const state = sdk.getState();

// Specific queries
const skill = sdk.getSkill('Woodcutting');
const item = sdk.findInventoryItem(/logs/i);
const npc = sdk.findNearbyNpc(/chicken/i);
const tree = sdk.findNearbyLoc(/^tree$/i);

// Subscribe to updates
sdk.onStateUpdate(state => {
    console.log('Tick:', state.tick);
});

// Wait for conditions
await sdk.waitForCondition(s => s.inventory.length > 5);
```

## Connection Monitoring

```typescript
sdk.onConnectionStateChange((state, attempt) => {
    if (state === 'reconnecting') {
        console.log(`Reconnecting (attempt ${attempt})...`);
    }
});

// Wait for connection
await sdk.waitForConnection(60000);
```

## Architecture

```
┌─────────────────┐       ┌─────────────────┐
│  Your Script    │       │  Remote Server  │
│  ┌───────────┐  │       │  ┌───────────┐  │
│  │ BotActions│  │       │  │  Gateway  │  │
│  └─────┬─────┘  │       │  │   :7780   │  │
│        │        │       │  └─────┬─────┘  │
│  ┌─────┴─────┐  │ ws:// │        │        │
│  │  BotSDK   │──┼───────┼────────┤        │
│  └───────────┘  │       │  ┌─────┴─────┐  │
└─────────────────┘       │  │ Web Client│  │
                          │  └───────────┘  │
                          └─────────────────┘
```

## Example Script

See `scripts/example-remote.ts` for a complete example.

```bash
# Run locally
bun scripts/example-remote.ts

# Connect to remote server
GATEWAY_HOST=game.example.com BOT_USERNAME=player1 bun scripts/example-remote.ts
```
