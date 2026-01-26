# Walking & Navigation

Successful patterns for movement and pathfinding.

## Basic Walking

For short distances (<30 tiles), `bot.walkTo()` works directly:

```typescript
await ctx.bot.walkTo(3222, 3218);  // Walk to Lumbridge
```

## Long Distance Walking

For distances >30 tiles, use waypoints with 20-25 tile segments:

```typescript
const WAYPOINTS_TO_BANK = [
    { x: 3270, z: 3380 },  // Step 1
    { x: 3250, z: 3395 },  // Step 2
    { x: 3230, z: 3410 },  // Step 3
    { x: 3210, z: 3425 },  // Step 4
    { x: 3185, z: 3436 },  // Final destination
];

async function walkWaypoints(ctx, waypoints) {
    for (const wp of waypoints) {
        // Try up to 3 times per waypoint
        for (let attempt = 0; attempt < 3; attempt++) {
            await ctx.bot.walkTo(wp.x, wp.z);
            await new Promise(r => setTimeout(r, 500));

            const player = ctx.state()?.player;
            const dist = Math.sqrt(
                Math.pow(player.worldX - wp.x, 2) +
                Math.pow(player.worldZ - wp.z, 2)
            );

            if (dist <= 5) break;  // Close enough
        }
        ctx.progress();
    }
}
```

## Verifying Arrival

Always check if you actually arrived:

```typescript
const result = await ctx.bot.walkTo(targetX, targetZ);

const player = ctx.state()?.player;
const dist = Math.sqrt(
    Math.pow(player.worldX - targetX, 2) +
    Math.pow(player.worldZ - targetZ, 2)
);

if (dist > 5) {
    ctx.warn(`Walk failed: still ${dist.toFixed(0)} tiles away`);
}
```

## Known Routes

### Varrock Mine to Varrock West Bank (~100 tiles)

```typescript
const MINE_TO_BANK = [
    { x: 3270, z: 3380 },
    { x: 3250, z: 3395 },
    { x: 3230, z: 3410 },
    { x: 3210, z: 3425 },
    { x: 3185, z: 3436 },
];

const BANK_TO_MINE = [
    { x: 3210, z: 3425 },
    { x: 3230, z: 3410 },
    { x: 3250, z: 3395 },
    { x: 3270, z: 3380 },
    { x: 3285, z: 3365 },
];
```

## Opening Obstacles (CRITICAL!)

**MUST open doors/gates BEFORE attempting to walk through.** The pathfinder cannot handle closed gates and will get stuck.

```typescript
// WRONG - pathfinder gets stuck at closed gate
await ctx.bot.walkTo(3250, 3260);  // Will fail if gate is closed

// CORRECT - open gate first, then walk
await ctx.bot.openDoor(/gate/i);
await ctx.bot.walkTo(3250, 3260);  // Now works!
```





## Cow Field to Draynor Bank

Draynor Bank (3092, 3243) is the closest bank to Lumbridge cow field.

### DANGER: Dark Wizards
**AVOID** the area around (3220, 3220) - aggressive Dark Wizards here will attack and likely kill characters under combat level 20.

### Safe Route Strategy
Stay **north of z=3240** when walking west from cow field to Draynor. Use `walkTo` with intermediate points that curve north around the danger zone rather than walking in a straight line.

```typescript
// Safe: curve north around Dark Wizards
await ctx.bot.walkTo(3230, 3270);  // Go west, stay north
await ctx.bot.walkTo(3150, 3250);  // Continue west
await ctx.bot.walkTo(3092, 3243);  // Draynor Bank

// DANGEROUS: straight line cuts through wizard area!
await ctx.bot.walkTo(3092, 3243);  // May path through (3220, 3220)
```

## Key Coordinates

| Location | Coordinates |
|----------|-------------|
| Lumbridge spawn | (3222, 3218) |
| Lumbridge cows (field center) | (3253, 3290) |
| Cow field gate | (3253, 3270) |
| Draynor fishing | (3087, 3230) |
| Varrock West bank | (3185, 3436) |
| SE Varrock mine | (3285, 3365) |
| Al Kharid gate | (3268, 3228) |
| Lumbridge general store | (3212, 3247) |
| Lumbridge castle (thieving) | (3222, 3218) |


```
