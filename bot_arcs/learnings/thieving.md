# Thieving

Successful patterns for thieving training.

## Pickpocketing Men (Level 1-40)

Men at Lumbridge castle are excellent for early thieving. Proven: 1 → 43 in ~10 minutes.

### Location

| Target | Coordinates | Notes |
|--------|-------------|-------|
| Men at Lumbridge castle | (3222, 3218) | Multiple men, "Pickpocket" option |

### Basic Pickpocket Pattern

```typescript
// Find a man to pickpocket
const man = ctx.state()?.nearbyNpcs.find(n => /^man$/i.test(n.name));
if (!man) {
    ctx.log('No man found nearby');
    return;
}

// Find the Pickpocket option
const pickpocketOpt = man.optionsWithIndex.find(o => /pickpocket/i.test(o.text));
if (!pickpocketOpt) {
    ctx.log('No pickpocket option on this NPC');
    return;
}

// Execute pickpocket
await ctx.sdk.sendInteractNpc(man.index, pickpocketOpt.opIndex);
await new Promise(r => setTimeout(r, 1500));  // Wait for result
```

### XP and Gold Rates

| Outcome | GP Gained | XP |
|---------|-----------|-----|
| Success | 3 GP | 8 XP |
| Success (bonus) | 6 GP | 8 XP |
| Stunned | 0 GP | 0 XP |

- ~52 successful pickpockets = 200+ GP and level 43
- Stun recovery takes ~5 seconds

### Handling Stuns

When caught, the character is stunned for ~5 seconds:

```typescript
// Check for stun (player can't act)
const messages = ctx.state()?.gameMessages ?? [];
const wasStunned = messages.some(m => /stunned|caught/i.test(m.text));

if (wasStunned) {
    ctx.log('Stunned! Waiting for recovery...');
    await new Promise(r => setTimeout(r, 5000));  // 5 second stun
}
```

### Full Thieving Loop

```typescript
async function pickpocketLoop(ctx: ScriptContext, duration: number) {
    const startTime = Date.now();
    let successCount = 0;

    while (Date.now() - startTime < duration) {
        // Dismiss any dialogs first
        if (ctx.state()?.dialog.isOpen) {
            await ctx.sdk.sendClickDialog(0);
            continue;
        }

        // Find target
        const man = ctx.state()?.nearbyNpcs.find(n => /^man$/i.test(n.name));
        if (!man) {
            // Walk to Lumbridge castle
            await ctx.bot.walkTo(3222, 3218);
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        // Pickpocket
        const opt = man.optionsWithIndex.find(o => /pickpocket/i.test(o.text));
        if (opt) {
            await ctx.sdk.sendInteractNpc(man.index, opt.opIndex);
            await new Promise(r => setTimeout(r, 1500));
            successCount++;
        }

        ctx.progress();
    }

    ctx.log(`Completed ${successCount} pickpocket attempts`);
}
```

## Thieving + Banking Loop

Bank when you hit 200-500 GP to avoid losing progress on disconnect:

```typescript
const GP_BANK_THRESHOLD = 500;

// Check GP in inventory
const coins = ctx.state()?.inventory.find(i => /coins/i.test(i.name));
const gp = coins?.count ?? 0;

if (gp >= GP_BANK_THRESHOLD) {
    ctx.log(`Have ${gp} GP - banking!`);
    await bankTrip(ctx);  // Walk to Draynor, deposit
}
```

Draynor Bank is closest to Lumbridge thieving spot.

## Why Thieving for Money?

Thieving requires no tools or equipment - making it ideal for:
- Early game gold farming
- Recovery after death (lost all items)
- Characters with no starting capital

With Attack 70+ you could easily farm goblins for drops, but thieving works from level 1 with nothing in inventory.
