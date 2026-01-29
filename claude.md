# RS-Agent Bot Guide

You're here to play the mmo game through the progressive development of botting scripts, starting small then adapting to your desires and ideas.

## First Time Setup

**Create a new bot using the setup script:**

Ask the user for a bot name (max 12 chars, alphanumeric). If they skip, use the command without a username to auto-generate a random 9-character name.

```bash
# With custom username
bun scripts/create-bot.ts {username}

# Auto-generate random username
bun scripts/create-bot.ts
```

This automatically creates:
- `bots/{username}/bot.env` - Credentials with auto-generated password
- `bots/{username}/lab_log.md` - Session notes template
- `bots/{username}/script.ts` - Ready-to-run starter script

## MCP Integration (Interactive Mode)

The MCP server auto-discovers via `.mcp.json` when you open the project in Claude Code.

### Quick Start

1. Install dependencies: `cd mcp && bun install`
2. Open project in Claude Code — approve the MCP server when prompted
3. Control your bot:

```
Execute code on "mybot" to check the state
```

### Tools

| Tool | Description |
|------|-------------|
| `execute_code(bot_name, code)` | Run code on a bot. Auto-connects on first use. |
| `list_bots()` | List connected bots |
| `disconnect_bot(name)` | Disconnect a bot |

### Example

```typescript
// Just execute - auto-connects on first use
execute_code({
  bot_name: "mybot",
  code: `
    const state = sdk.getState();
    console.log('Position:', state.player.worldX, state.player.worldZ);

    // Chop trees for 1 minute
    const endTime = Date.now() + 60_000;
    while (Date.now() < endTime) {
      await bot.dismissBlockingUI();
      const tree = sdk.findNearbyLoc(/^tree$/i);
      if (tree) await bot.chopTree(tree);
    }

    return sdk.getInventory();
  `
})
```

### Multiple Bots

Control multiple bots simultaneously — each auto-connects on first use:

```typescript
execute_code({ bot_name: "woodcutter", code: "await bot.chopTree()" })
execute_code({ bot_name: "miner", code: "await bot.mineRock()" })
```

**When to use MCP vs Scripts:**
- **MCP**: Interactive exploration, quick tests, conversational bot control
- **Scripts**: Long-running automation, reproducible tasks, version control

See `mcp/README.md` for detailed API reference.

## Session Workflow

This is a **persistent character** - you don't restart fresh each time. The workflow is:

### 1. Check World State First

Before writing any script, check where the bot is and what it has:

```bash
cd bots/{username} && bun --env-file=bot.env ../../sdk/cli.ts
```

This shows: position, inventory, skills, nearby NPCs/objects, and more.

**Exception**: Skip this if you just created the character and know it's at spawn.

**Tutorial Check**: If the character is in the tutorial area, call `await sdk.sendSkipTutorial()` before running any other scripts. The tutorial blocks normal gameplay.

### 2. Write Your Script

Edit `bots/{username}/script.ts` with your goal. Keep scripts focused on one task.

### 3. Run the Script

```bash
cd bots/{username} && bun --env-file=bot.env script.ts
```

### 4. Observe and Iterate

Watch the output. After the script finishes (or fails), check state again:

```bash
cd bots/{username} && bun --env-file=bot.env ../../sdk/cli.ts
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
    ├── bot.env        # Credentials (BOT_USERNAME, PASSWORD, SERVER)
    ├── lab_log.md     # Session notes and observations
    └── script.ts      # Current script

sdk/
├── index.ts           # BotSDK (low-level)
├── actions.ts         # BotActions (high-level)
├── cli.ts             # CLI for checking state
└── types.ts           # Type definitions

mcp/
├── server.ts          # MCP server entry point
├── api/
│   ├── index.ts       # BotManager (multi-bot connections)
│   ├── bot.ts         # High-level API docs
│   └── sdk.ts         # Low-level API docs
└── README.md          # MCP setup guide

.mcp.json              # Claude Code auto-discovery config
```

## Troubleshooting

**"No state received"** - Bot isn't connected to game. Open browser first or use `autoLaunchBrowser: true`.

**Script stalls** - Check for open dialogs (`state.dialog.isOpen`). Level-ups block everything.

**"Can't reach"** - Path is blocked. Try walking closer first, or find a different target.

**Wrong target** - Use more specific regex patterns: `/^tree$/i` not `/tree/i` (which matches "tree stump").
