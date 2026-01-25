# SDK Combat State Tracking - Problem Spec

## Problem

The SDK lacks explicit combat state, forcing scripts to approximate it through indirect signals.

## Current Workarounds

```typescript
// Hacky combat detection via interactingIndex
const isInCombat = (): boolean => {
    const state = sdk.getState();
    return state?.player?.interactingIndex !== undefined
        && state.player.interactingIndex !== -1;
};

// Parsing game messages to detect "someone else is fighting"
const fightingMsg = state?.gameMessages.find((m: any) =>
    m.text.toLowerCase().includes("someone else is fighting") ||
    m.text.toLowerCase().includes("already under attack")
);

// Manually tracking blocked NPCs with tick-based cooldowns
const blockedNpcs = new Map<number, number>(); // npcIndex -> tick
if (fightingMsg && fightingMsg.tick > currentTick - 3) {
    blockedNpcs.set(lastNpc.index, currentTick);
}

// Using XP gain as kill detection (only reliable method currently)
const lastXpTotal = getCombatXP();
// ... after combat ...
if (getCombatXP() > lastXpTotal) {
    killCount++; // Inferred kill from XP gain
}
```

## What Went Wrong

### Gap Detection Failures
In combat training runs, GAP logs showed:
```
[197s] ⚠️ GAP: reward=102 (no change) | inCombat=false | nearbyTargets=14
[203s] ⚠️ GAP: reward=102 (no change) | inCombat=false | nearbyTargets=14
```

`inCombat=false` with 14 nearby targets. We couldn't distinguish:
- Are we between attacks (normal)?
- Did our target die and we're idle (problem)?
- Are we stuck on pathing (problem)?
- Did combat get interrupted (problem)?

### Kill Detection Required XP Inference
No direct "target died" signal. Scripts must track XP before/after to detect kills, which:
- Conflates multiple kills if they happen quickly
- Can't attribute kills to specific targets
- Doesn't work for zero-XP scenarios (PvP, etc.)

### NPC Target State Unknown
Can't tell who an NPC is fighting:
- Is this chicken already being attacked by another player?
- Should I attack the goblin fighting someone else?
- Will my attack even land?

### Combat Style XP Distribution Unclear
`trainedSkill: "Shared"` returned for Lunge style, but XP only went to Strength. Need clarity on actual XP distribution per style.

---

## Proposed SDK Additions

### 1. Player Combat State (on PlayerState)

```typescript
interface PlayerState {
    // ... existing fields ...

    combat: {
        /** Currently engaged in combat */
        inCombat: boolean;

        /** Index of NPC/player we're targeting (-1 if none) */
        targetIndex: number;

        /** Tick of our last attack animation */
        lastAttackTick: number;

        /** Tick we last took damage */
        lastDamageTick: number;

        /** Tick we last dealt damage */
        lastHitTick: number;
    };
}
```

### 2. NPC Health & Combat State (on NearbyNpc)

```typescript
interface NearbyNpc {
    // ... existing fields ...

    /** Health as percentage 0-100 (if visible/known) */
    healthPercent: number | null;

    /** Index of who this NPC is fighting (-1 if none, null if unknown) */
    targetIndex: number | null;

    /** Is this NPC currently in combat with anyone? */
    inCombat: boolean;
}
```

### 3. Combat Events (new event type in state)

```typescript
interface CombatEvent {
    tick: number;
    type: 'attack' | 'hit' | 'block' | 'kill' | 'death';

    /** Who initiated (player index, npc index, or -1 for self) */
    sourceIndex: number;
    sourceType: 'player' | 'npc';

    /** Who received (player index, npc index, or -1 for self) */
    targetIndex: number;
    targetType: 'player' | 'npc';

    /** Damage dealt (for hit events) */
    damage?: number;

    /** XP gained (for kill events, broken down by skill) */
    xpGained?: { skill: string; amount: number }[];
}

interface BotWorldState {
    // ... existing fields ...
    combatEvents: CombatEvent[];  // Recent combat events (last ~50 ticks)
}
```

### 4. Combat Style Clarification (on CombatStyleOption)

```typescript
interface CombatStyleOption {
    index: number;
    name: string;
    type: string;  // 'accurate', 'aggressive', 'defensive', 'controlled'

    /** Which skills receive XP and at what ratio */
    xpDistribution: {
        skill: string;   // 'Attack', 'Strength', 'Defence', 'Hitpoints'
        ratio: number;   // 1.0 = full XP, 0.33 = 1/3 XP
    }[];
}
```

---

## Usage Examples

### Smarter Target Selection
```typescript
// Finish low-HP targets instead of switching
const npcs = sdk.getNearbyNpcs();
const lowHpTarget = npcs.find(n =>
    n.healthPercent !== null &&
    n.healthPercent < 30 &&
    n.targetIndex === -1  // Not fighting someone else
);

// Avoid NPCs already in combat
const available = npcs.filter(n => !n.inCombat);
```

### Reliable Idle Detection
```typescript
const player = state.player;
const ticksSinceAction = currentTick - Math.max(
    player.combat.lastAttackTick,
    player.combat.lastHitTick
);

if (!player.combat.inCombat && ticksSinceAction > 5) {
    // Actually idle, not just between attack animations
    findNewTarget();
}
```

### Kill Attribution
```typescript
// Subscribe to combat events
for (const event of state.combatEvents) {
    if (event.type === 'kill' && event.sourceType === 'player') {
        console.log(`Killed NPC ${event.targetIndex}`);
        console.log(`XP: ${event.xpGained?.map(x => `${x.skill}:${x.amount}`).join(', ')}`);
    }
}
```

### Combat Style Verification
```typescript
const style = state.combatStyle.styles[currentStyleIndex];
const trainsAllMelee = style.xpDistribution.some(x =>
    ['Attack', 'Strength', 'Defence'].includes(x.skill) && x.ratio > 0
);
```

---

## Implementation Notes

**Server-side data availability:**
- Player combat state: Server tracks this for combat calculations
- NPC health: Server knows exact HP, just needs to expose percentage
- NPC target: Server tracks for multi-combat rules
- Combat events: Server already calculates damage/XP, just needs to emit events

**Backward compatibility:**
- All additions are new fields, no breaking changes
- Scripts not using combat features unaffected
- `combatEvents` array can be empty if server doesn't support yet

**Performance:**
- `combatEvents` should be bounded (last 50 ticks) to avoid memory growth
- `healthPercent` only needs to update when HP changes, not every tick
- NPC `targetIndex` only relevant for nearby NPCs already being tracked
