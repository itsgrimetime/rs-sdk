# RS-Agent Bot Guide

You're here to play the mmo game through the progressive development of botting scripts, starting small then adapting to your desires and ideas.

## First Time Setup

**Step 1: Create an account**

Ask the user for a bot name (max 12 chars, alphanumeric). If they skip, generate a random alphanumeric 9 character string.


**Step 2: Create a bot folder (or cd into an existing one)**

```bash
mkdir -p bots/{username}
```

Create three files:

**bots/{username}/bot.env**
```bash
USERNAME={username}
PASSWORD={random 12-char alphanumeric}
SERVER=rs-sdk-demo.fly.dev
```

**bots/{username}/lab_log.md**
```markdown
# {username} Lab Log

## Session 1 

### Goals
-

### Observations
-

### Next Steps

### Possible SDK Bugs or Improvements:
-
```

**bots/{username}/script.ts**
```typescript
#!/usr/bin/env bun
import { BotSDK, BotActions } from '../../sdk/actions';

// Load config from environment (set by bot.env)
const USERNAME = process.env.USERNAME!;
const PASSWORD = process.env.PASSWORD!;
const SERVER = process.env.SERVER || 'rs-sdk-demo.fly.dev';

const GATEWAY_URL = SERVER === 'localhost'
    ? `ws://${SERVER}:7780`
    : `wss://${SERVER}/gateway`;

async function main() {
    const sdk = new BotSDK({
        botUsername: USERNAME,
        password: PASSWORD,
        gatewayUrl: GATEWAY_URL,
        autoLaunchBrowser: true,
    });

    sdk.onConnectionStateChange((state) => {
        console.log(`Connection: ${state}`);
    });

    await sdk.connect();
    await sdk.waitForCondition(s => s.inGame, 60000);

    const bot = new BotActions(sdk);
    const state = sdk.getState()!;
    console.log(`In-game as ${state.player?.name} at (${state.player?.worldX}, ${state.player?.worldZ})`);

    // === YOUR SCRIPT LOGIC BELOW ===

    // Example: chop a tree
    const tree = sdk.findNearbyLoc(/^tree$/i);
    if (tree) {
        console.log(`Found tree at (${tree.x}, ${tree.z})`);
        const result = await bot.chopTree(tree);
        console.log(result.message);
    }

    // === END SCRIPT LOGIC ===

    // Keep running for 60 seconds (adjust as needed)
    await new Promise(r => setTimeout(r, 60_000));
    await sdk.disconnect();
}

main().catch(console.error);
```

## Session Workflow

This is a **persistent character** - you don't restart fresh each time. The workflow is:

### 1. Check World State First

Before writing any script, check where the bot is and what it has:

```bash
source bots/{username}/bot.env && bun sdk/cli.ts
```

This shows: position, inventory, skills, nearby NPCs/objects, and more.

**Exception**: Skip this if you just created the character and know it's at spawn.

### 2. Write Your Script

Edit `bots/{username}/script.ts` with your goal. Keep scripts focused on one task.

### 3. Run the Script

```bash
source bots/{username}/bot.env && bun bots/{username}/script.ts
```

### 4. Observe and Iterate

Watch the output. After the script finishes (or fails), check state again:

```bash
source bots/{username}/bot.env && bun sdk/cli.ts
```

Record observations in `lab_log.md`, then improve the script.

## Script Duration Guidelines

**Start short, extend as you gain confidence:**

| Duration | Use When |
|----------|----------|
| **30-60s** | New script, untested logic, debugging |
| **2-5 min** | Validated approach, building confidence |
| **10+ min** | Proven strategy, grinding runs |

A failed 10-minute run wastes more time than five 1-minute diagnostic runs. **Fail fast.**

Timeouts in scripts:
```typescript
// Short run for testing
await new Promise(r => setTimeout(r, 60_000));  // 60 seconds

// Longer run once proven
await new Promise(r => setTimeout(r, 5 * 60_000));  // 5 minutes
```

## SDK Quick Reference

### Checking State

```typescript
const state = sdk.getState();           // Full world state
const skill = sdk.getSkill('Woodcutting');
const item = sdk.findInventoryItem(/logs/i);
const npc = sdk.findNearbyNpc(/chicken/i);
const loc = sdk.findNearbyLoc(/tree/i);
const loot = sdk.findGroundItem(/bones/i);
```

### High-Level Actions (BotActions)

These wait for the effect to complete:

```typescript
await bot.walkTo(x, z);           // Pathfinding + arrival
await bot.chopTree();             // Waits for logs in inventory
await bot.attackNpc(/chicken/i);  // Engage in combat
await bot.pickupItem(/bones/i);   // Walk + pickup
await bot.openShop(/keeper/i);    // Find NPC, trade
await bot.equipItem(/sword/i);    // Equip from inventory
await bot.eatFood(/shrimp/i);     // Eat food
```

### Low-Level Actions (BotSDK)

These resolve when the server acknowledges, not when complete:

```typescript
await sdk.sendWalk(x, z, running);
await sdk.sendInteractNpc(npcIndex, optionIndex);
await sdk.sendInteractLoc(x, z, locId, optionIndex);
await sdk.sendPickup(x, z, itemId);
```

### Waiting for Conditions

```typescript
await sdk.waitForCondition(s => s.inventory.length > 5, 10000);
await sdk.waitForCondition(s => !s.dialog.isOpen, 5000);
await bot.waitForSkillLevel('Woodcutting', 10, 60000);
```

## Common Patterns

### Dismiss Level-Up Dialogs

Level-up dialogs block all actions. Always handle them:

```typescript
// In your main loop
if (sdk.getState()?.dialog.isOpen) {
    await sdk.sendClickDialog(0);
    await new Promise(r => setTimeout(r, 300));
}

// Or use the helper
await bot.dismissBlockingUI();
```

### Main Loop with Timeout

```typescript
const DURATION = 60_000;  // 60 seconds
const startTime = Date.now();

while (Date.now() - startTime < DURATION) {
    // Dismiss any blocking dialogs
    await bot.dismissBlockingUI();

    // Your logic here
    const tree = sdk.findNearbyLoc(/^tree$/i);
    if (tree) {
        await bot.chopTree(tree);
    }

    await new Promise(r => setTimeout(r, 500));
}
```

### Error Handling

```typescript
const result = await bot.chopTree();
if (!result.success) {
    console.log(`Failed: ${result.message}`);
    // Handle failure - maybe walk somewhere else, wait, etc.
}
```

## Project Structure

```
bots/
└── {username}/
    ├── bot.env        # Credentials (USERNAME, PASSWORD, SERVER)
    ├── lab_log.md     # Session notes and observations
    └── script.ts      # Current script

sdk/
├── index.ts           # BotSDK (low-level)
├── actions.ts         # BotActions (high-level)
├── cli.ts             # CLI for checking state
└── types.ts           # Type definitions
```

## Troubleshooting

**"No state received"** - Bot isn't connected to game. Open browser first or use `autoLaunchBrowser: true`.

**Script stalls** - Check for open dialogs (`state.dialog.isOpen`). Level-ups block everything.

**"Can't reach"** - Path is blocked. Try walking closer first, or find a different target.

**Wrong target** - Use more specific regex patterns: `/^tree$/i` not `/tree/i` (which matches "tree stump").
