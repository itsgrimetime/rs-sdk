# SDK Design Notes

## Architecture: Plumbing vs Porcelain

The SDK has two layers, inspired by Git's architecture:

### Plumbing (`index.ts` - BotSDK)
- Low-level API that maps to the game protocol
- Actions resolve when the game **acknowledges** the command (fast)
- No domain knowledge - just sends commands and receives results

```typescript
await sdk.sendInteractLoc(tree.x, tree.z, tree.id, 1);
await sdk.sendWalk(x, z, running);
```

### Porcelain (`actions.ts` - BotActions)
- High-level, domain-aware API that wraps plumbing
- Actions resolve when the **effect is complete** (slower, but reliable)
- Encodes domain knowledge and handles edge cases

```typescript
await bot.chopTree();  // Waits for logs in inventory
await bot.walkTo(x, z); // Pathfinding + arrival confirmation
```

## Key Learnings

### 1. Game Messages Persist in Buffer
Old messages like "You can't light a fire here" persist. Filter by tick:

```typescript
const startTick = this.sdk.getState()?.tick || 0;
// Only check messages where msg.tick > startTick
```

### 2. Level-Up Dialogs Are Multi-Page
Keep clicking every few ticks while open:

```typescript
if (state.dialog.isOpen && (state.tick - lastClick) >= 3) {
    this.sdk.sendClickDialog(0).catch(() => {});
}
```

### 3. Choose the Right Success Signal

| Action | Reliable Signal |
|--------|-----------------|
| Firemaking | XP gain |
| Woodcutting | Logs in inventory OR tree disappears |
| Pickup | Item in inventory |
| Walking | Player position matches destination |
| Shop Buy | Item appears in inventory |
| Equip | Item leaves inventory |

### 4. Interface Components: buttonType vs iop
- `interface.options` has entries → use `sendClickInterface(optionIndex)`
- `debugInfo` shows `iop=[...]` → use `sendClickInterfaceComponent(componentId, optionIndex)`

## Available BotActions Methods

### Movement & Interaction
| Method | Description |
|--------|-------------|
| `walkTo(x, z, tolerance?)` | Pathfinding + arrival |
| `talkTo(target)` | Talk to NPC, opens dialog |
| `openDoor(target?)` | Opens a door |
| `navigateDialog(choices)` | Click through dialog options |

### Skills & Resources
| Method | Description |
|--------|-------------|
| `chopTree(target?)` | Chops tree, waits for logs |
| `burnLogs(target?)` | Burns logs with tinderbox |
| `pickupItem(target)` | Picks up ground item |
| `fletchLogs(product?)` | Fletches logs into items |
| `craftLeather(product?)` | Crafts leather items |

### Shop & Bank
| Method | Description |
|--------|-------------|
| `openShop(target?)` | Opens shop interface |
| `buyFromShop(target, amount?)` | Buys from shop |
| `sellToShop(target, amount?)` | Sells to shop |
| `closeShop()` | Closes shop interface |
| `openBank()` | Opens bank interface |
| `depositItem(target, amount?)` | Deposits to bank |
| `withdrawItem(slot, amount?)` | Withdraws from bank |
| `closeBank()` | Closes bank interface |

### Equipment & Combat
| Method | Description |
|--------|-------------|
| `equipItem(target)` | Equips from inventory |
| `unequipItem(target)` | Unequips item |
| `eatFood(target)` | Eats food |
| `attackNpc(target, timeout?)` | Attacks NPC |
| `castSpellOnNpc(target, spell, timeout?)` | Casts spell on NPC |

### Helpers
| Method | Description |
|--------|-------------|
| `dismissBlockingUI()` | Closes dialogs/modals |
| `waitForSkillLevel(skill, level)` | Waits for skill level |
| `waitForInventoryItem(pattern)` | Waits for item |
| `waitForDialogClose()` | Waits for dialog to close |
| `waitForIdle()` | Waits for player to be idle |

## Files

| File | Purpose |
|------|---------|
| `sdk/index.ts` | BotSDK - low-level WebSocket API |
| `sdk/actions.ts` | BotActions - high-level domain actions |
| `sdk/types.ts` | Type definitions |
| `sdk/pathfinding.ts` | Pathfinding utilities |
