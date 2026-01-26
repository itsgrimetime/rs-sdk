# Banking

Successful patterns for bank interactions.

## Opening the Bank

Banker NPCs are more reliable than bank booths:

```typescript
// Find banker NPC
const banker = ctx.sdk.findNearbyNpc(/banker/i);
if (banker) {
    const bankOpt = banker.optionsWithIndex.find(o => /bank/i.test(o.text));
    await ctx.sdk.sendInteractNpc(banker.index, bankOpt.opIndex);
}

// Wait for bank interface to open
for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (ctx.state()?.interface?.isOpen) {
        ctx.log('Bank opened!');
        break;
    }
    ctx.progress();
}
```

## Depositing Items

```typescript
// Deposit specific item
const ore = ctx.state()?.inventory.find(i => /ore$/i.test(i.name));
if (ore) {
    await ctx.sdk.sendBankDeposit(ore.slot, ore.count);
    await new Promise(r => setTimeout(r, 200));
}

// Deposit all of a type
const ores = ctx.state()?.inventory.filter(i => /ore$/i.test(i.name)) ?? [];
for (const ore of ores) {
    await ctx.sdk.sendBankDeposit(ore.slot, ore.count);
    await new Promise(r => setTimeout(r, 200));
}
```

## Deposit All of an Item

Use `-1` as the quantity to deposit all of an item type: (tested for stacked items, not sure about non-stacking items, if you figure out please update!)

```typescript
// WRONG - deposits only 1 item if count=1
await ctx.sdk.sendBankDeposit(slot, count);

// CORRECT - deposits ALL items of that type
await ctx.sdk.sendBankDeposit(slot, -1);

// Verify the deposit worked
for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 300));
    const inv = ctx.state()?.inventory ?? [];
    if (!inv.some(i => /coins/i.test(i.name))) break;
}
```

## Withdrawing Items

```typescript
// bankSlot is the position in the bank, not inventory
await ctx.sdk.sendBankWithdraw(bankSlot, count);
```

## Closing the Bank

```typescript
await ctx.bot.closeShop();  // Works for bank interface too
// Or wait for interface to close
await new Promise(r => setTimeout(r, 500));
```

## Bank Locations (THERE IS NOT BANK IN LUMBRIDGE in 2004scape)

| Bank | Coordinates | Notes |
|------|-------------|-------|
| Varrock West | (3185, 3436) | Close to GE |
| Draynor | (3092, 3243) | Ground floor |
| Al Kharid | (3269, 3167) | Requires toll or quest |
... others

## Full Banking Loop Pattern

```typescript
async function bankTrip(ctx, itemPattern, bankCoords, returnCoords) {
    // Walk to bank
    await walkWaypoints(ctx, WAYPOINTS_TO_BANK);

    // Open bank
    const banker = ctx.sdk.findNearbyNpc(/banker/i);
    const bankOpt = banker?.optionsWithIndex.find(o => /bank/i.test(o.text));
    if (banker && bankOpt) {
        await ctx.sdk.sendInteractNpc(banker.index, bankOpt.opIndex);
    }

    // Wait for bank
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (ctx.state()?.interface?.isOpen) break;
        ctx.progress();
    }

    // Deposit items
    const items = ctx.state()?.inventory.filter(i => itemPattern.test(i.name)) ?? [];
    for (const item of items) {
        await ctx.sdk.sendBankDeposit(item.slot, item.count);
        await new Promise(r => setTimeout(r, 200));
    }

    // Close bank and return
    await ctx.bot.closeShop();
    await walkWaypoints(ctx, WAYPOINTS_TO_RESOURCE);
}
```


### Key Learnings from Cowhide Banking
1. **Gate exit threshold**: Use `z < 3268` not `z < 3265` for cow field
2. **Always open gate first**: `openDoor(/gate/i)` before walking through
3. **Use sendWalk for gate traversal**: More reliable than pathfinder
4. **Banking works at Varrock West**: (3185, 3436) confirmed working
