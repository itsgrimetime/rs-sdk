# Bot Arcs Methodology

A persistent character progression approach to automation experiments.

## Overview

Unlike the `scripts/` methodology which resets character state between runs, **Bot Arcs** maintain a single persistent character across many script executions. The goal is long-term progression: maximize **Total Level + GP + Equipment Value**.

## Core Differences from Scripts

| Aspect | Scripts | Bot Arcs |
|--------|---------|----------|
| Character State | Reset each run | Persistent across runs |
| Goal | Task completion | Score maximization |
| Duration | Fixed (usually 5-10m) | Variable (1m-30m) |
| Iteration | Change script each run | Re-run same script if working |
| Success Metric | Binary (pass/fail) | Continuous (score) |

## The Score Function

```
Score = Total Level + GP + Equipment Value
```

Where:
- **Total Level** = Sum of all skill levels (starting: 32 at level 1 in all skills)
- **GP** = Coins in inventory + coins in bank + rough value of items in bank
- **Equipment Value** = rough value of all worn items (drip factor)

Track this score at the start and end of each arc.

## Arc Types

Choose timeout based on success of previous run and similarity to that run:
Confidence + track record = higher run length. Robust, long running tasks are the goal but we can't skip to them.

| Duration | Use Case |
|----------|----------|
| **1m** | Quick tests, validation runs, risky experiments |
| **5m** | Short grinds |
| **10m-30m** | Standard progression arc with proven strategy, increase in proportion to confidence |

## Directory Structure

```
bot_arcs/
├── METHODOLOGY.md              # This file
├── learnings/                  # Shared patterns and working code snippets
│   ├── mining.md
│   ├── combat.md
│   ├── fishing.md
│   └── ...
├── <character-name>/           # One folder per persistent character
│   ├── config.ts               # Character settings, current goals
│   ├── lab_log.md              # Progress journal
│   └── arcs/
│       └── <arc-name>/
│           ├── script.ts       # The automation code
│           └── runs/
│               └── <timestamp>/
│                   ├── metadata.json
│                   ├── events.jsonl
│                   └── screenshots/
```

## Character Setup

Each character has a `config.ts`:

```typescript
export const character = {
  username: 'iron_max_01',

  // Current focus
  currentArc: 'fishing-to-40',

  // Progress tracking
  lastScore: {
    totalLevel: 45,
    gp: 12500,
    equipmentValue: 3200,
    total: 45 + 12500 + 3200, // 15,745
    timestamp: '2026-01-24T12:00:00Z'
  },

  // Bank state summary (updated manually or via script)
  bankHighlights: [
    '500 raw trout',
    '200 oak logs',
    'steel axe',
  ],
};
```

## The Arc Cycle

```
Plan Arc → Write Script → Run (1-30m) → Record State → Analyze → Repeat (or re-run)
```

1. **Plan Arc** - What should the character do next? Review last state snapshot.

2. **Write Script** - Implement the arc using `runScript()` with chosen timeout

3. **Run** - Execute with persistence (no preset/spawn reset)

4. **Record State** - Log levels, equipment, inventory, bank, and score

5. **Analyze** - Did score improve? Keep running or try something new?

6. **Repeat** - Re-run if working, or write new arc if needed

## Lab Log Format

```markdown
# Lab Log: iron_max_01

## Character Progress

| Date | Arc | Duration | Score Before | Score After | Delta |
|------|-----|----------|--------------|-------------|-------|
| 01-24 | tutorial-completion | 10m | 32 | 156 | +124 |
| 01-24 | fishing-to-20 | 15m | 156 | 892 | +736 |
| 01-25 | sell-fish-buy-axe | 5m | 892 | 1,245 | +353 |

---

## Arc: fishing-to-20

### Run 001 - 2026-01-24 14:30

**Duration**: 15m
**Timeout**: Completed naturally at 12m
**Score**: 156 → 892 (+736)

### What Happened
- Started at fishing level 5
- Fished shrimp until level 10
- Switched to trout at Barbarian Village
- Reached level 22 (overshot goal)
- Banked 145 raw trout

### State After Run
**Levels**: Fishing 22, Cooking 1, ...
**Total Level**: 49

**Equipment**: None equipped
**Inventory**: Small fishing net, 23 raw trout
**Bank**: 145 raw trout, 89 raw shrimp, 50 gp

**Score**: 49 + 50 + 0 = 99

### Next Steps
- Run again to keep leveling fishing
- Could sell fish for GP boost later
- Consider cooking for additional XP

---

## Arc: fishing-to-20 (continued)

### Run 002 - 2026-01-25 09:00

**Duration**: 15m
**Timeout**: Completed naturally at 14m

### What Happened
- Re-ran same script, no changes needed
- Fishing 22 → 31
- Banked another 200 trout

### State After Run
**Levels**: Fishing 31, ...
**Total Level**: 58

**Equipment**: None equipped
**Inventory**: Small fishing net, 18 raw trout
**Bank**: 345 raw trout, 89 raw shrimp, 50 gp

**Score**: 58 + 50 + 0 = 108
```

## State Snapshots

At the end of each run, record the character's full state so the next iteration can build on it:

```markdown
### State After Run

**Levels**: Attack 10, Strength 8, Defence 5, Fishing 22, Cooking 15...
**Total Level**: 87

**Equipment**: Bronze med helm, Iron platebody, Iron scimitar, Leather boots
**Equipment Value**: ~2,400 gp

**Inventory**: Lobster pot, Small fishing net, 12 cooked trout, 340 gp

**Bank**: 145 raw trout, 89 raw shrimp, bronze axe, 500 gp
**Bank Value**: ~3,200 gp

**Score**: 87 + 840 + 2400 = 3,327
```

This snapshot gives the next run everything it needs to continue.

## Best Practices

1. **Track score after each run** - It's how we measure progress
2. **Record full state** - Levels, equipment, inventory, bank contents
3. **Re-run what works** - If a script is working, just run it again
4. **Start with short arcs** - Build confidence before 30m runs
5. **One focus per arc** - Don't try to do everything at once
6. **Only change scripts when needed** - No changes required if it's working fine

## Autonomous Operation

**The user is asleep and expects results by morning.** The agent must:

1. **Keep looping** - Run → Record → Analyze → Run again. Don't stop.
2. **Never ask for feedback** - Make decisions autonomously. The user isn't available.
3. **Fix issues yourself** - If something breaks, debug it, fix it, and keep going.
4. **Maximize score** - Every hour of runtime should produce progress.
5. **Document everything** - The user will review the lab log in the morning.

If a script is working, run it repeatedly. If it breaks, fix it and continue. If you run out of ideas for one activity, switch to another. The goal is continuous progress, not waiting for human input.

### Handling Surprise

**Surprise is normal.** Scripts fail. Actions don't work. The character isn't where you expected. This isn't a crisis—it's information. The key is to stay calm, examine your assumptions, and methodically figure out what's actually happening.

When something unexpected occurs:

1. **Don't panic or reset** - Resetting throws away progress. The situation is probably recoverable.
2. **Drop to a shorter loop** - Switch from a 10-minute arc to a 1-2 minute diagnostic run.
3. **Adopt a fact-finding mindset** - Your goal is now *understanding*, not *progress*.

### The Diagnostic Loop

When a run doesn't produce expected results, run a short diagnostic arc:

```typescript
// 1-minute diagnostic: What's actually going on?
runArc({
    arcName: 'diagnostic',
    timeLimit: 60_000,
    goal: 'Observe current state and understand the situation',
}, async (ctx) => {
    const state = ctx.state();

    // Where are we?
    ctx.log(`Position: (${state.player?.worldX}, ${state.player?.worldZ})`);
    ctx.log(`HP: ${state.skills.find(s => s.name === 'Hitpoints')?.level}`);

    // What do we have?
    ctx.log(`Inventory (${state.inventory.length} items):`);
    for (const item of state.inventory) {
        ctx.log(`  - ${item.name} x${item.count}`);
    }

    // What's around us?
    ctx.log(`Nearby NPCs: ${state.nearbyNpcs.slice(0, 10).map(n => n.name).join(', ')}`);
    ctx.log(`Nearby objects: ${state.nearbyLocs.slice(0, 10).map(l => l.name).join(', ')}`);

    // What skills do we have?
    const skills = state.skills.filter(s => s.baseLevel > 1);
    ctx.log(`Trained skills: ${skills.map(s => `${s.name}:${s.baseLevel}`).join(', ')}`);

    // Recent game messages (errors, failures)
    ctx.log(`Recent messages: ${state.gameMessages.slice(-5).map(m => m.text).join(' | ')}`);
});
```

### Common Surprises and Responses

| Surprise | What to check | Possible responses |
|----------|---------------|-------------------|
| **Can't fish** | Do we have a net? What's our fishing level? What kind of spots are nearby? | Train something else nearby, or travel to buy a net (Lumbridge fishing shop), or find level-appropriate spots |
| **Can't attack NPCs** | Is there a fence/gate between us? Are they already in combat? | Try `openDoor()`, move to a different area, find other NPCs |
| **Character in unknown location** | Read position coordinates. What's nearby? | If near a useful resource, train there. If lost, walk toward Lumbridge (3222, 3218) |
| **No tools in inventory** | Did we die? Did we drop them? | Check if we can still train something (combat with fists, thieving). Or earn GP and buy replacements |
| **Script errors out** | What was the last action? What game messages appeared? | The error message is a clue. Fix the script logic and retry with a short timeout |
| **No progress despite running** | Is the character actually doing actions? Stuck in dialog? Blocked by obstacle? | Add more logging. Check `state.dialog.isOpen`. Check `player.animId` for activity |

### Recovery Patterns

**Pattern 1: Died or lost your tools**
```
Observation: Inventory has no axe, pickaxe, or fishing net
Analysis: Probably died and respawned
Options:
  a) Train combat (needs no tools) - cows at Lumbridge
  b) Train thieving (needs no tools) - men at Lumbridge
  c) Earn 10-50gp and buy tools - sell starting items at general store
Decision: Pick the option that matches current location and skills
```

**Pattern 2: Action doesn't work**
```
Observation: sendInteractNpc returns success but no XP gained
Analysis: Something is blocking the action
Debug steps:
  1. Check game messages for "can't reach", "too far", etc.
  2. Check if dialog is open (blocking all actions)
  3. Check if there's an obstacle (fence, door, gate)
  4. Try the action manually in a minimal test
```


### Building Back Confidence

After recovering from a surprise:

1. **Start with 1-2 minute arcs** - Prove the basic loop works
2. **Add one thing at a time** - Don't jump back to complex multi-step arcs
3. **Celebrate small wins** - +5 levels in a 2-minute run is progress
4. **Gradually extend duration** - 2min → 5min → 10min as stability improves

The goal isn't to immediately return to long arcs. It's to *understand what went wrong* and *build evidence that things work now*. A series of successful 2-minute runs gives you more confidence than one hopeful 15-minute run.

### There's Always Something To Do

No matter the situation, there's always a productive next step:

| Current state | Productive action |
|---------------|-------------------|
| In Lumbridge with nothing | Pickpocket men for 50GP |
| Have GP but no tools | Walk to a shop and buy what you need (remember that general stores dont sell much, write down shop locations in the learnings ) |
| Low HP, dangerous area | Walk away from danger, eat any food |
| Stuck at an obstacle | Look for doors/gates to open, or walk around |

**Never give up and reset.** The character's current state, whatever it is, has value. Work with what you have.



## Shared Learnings

The `bot_arcs/learnings/` folder contains **proven patterns and working code snippets** organized by skill/topic:

```
learnings/
├── mining.md      # Rock finding, mining actions, locations
├── combat.md      # Attacking, style cycling, safe locations
├── fishing.md     # Spot types, level requirements, drift handling
├── woodcutting.md # Tree finding, drop patterns
├── walking.md     # Long-distance waypoints, known routes
├── banking.md     # Bank interactions, deposit/withdraw
├── shops.md     # Shop locations and what they sell
└── dialogs.md     # Level-ups, NPC conversations, toll gates

```

### Contributing to Learnings

When you discover a pattern that **works reliably**, add it to the appropriate file:
When you're having problems, don't write any learnings entry, just focus on yourself and your lab log.

1. **Include code** - Snippets that can be copy-pasted
2. **Add context** - Coordinates, level requirements, gotchas that helped, effeciency tips
3. **Keep it concise** - One pattern per section


### Using Learnings

Before writing a new arc, check if `learnings/` has patterns for your task. Copy working code rather than reinventing it.

## Character Lab Logs

Each character also maintains a personal `lab_log.md` for:

- Run history with scores
- Character-specific state snapshots
- Arc-by-arc observations

```markdown
---

## Lab learnings sections (fill this out after each run, be brief)

### 1. Progression Insights
- What activities gave best score/time ratio
- Optimal arc durations for different tasks
- Which scripts are worth re-running vs changing

### 2. Character Build Observations
- Which skills unlocked useful content
- Equipment upgrades that mattered
- Effective training order

### 3. Process Improvements
- What to track more carefully
- When to use short vs long timeouts
- SDK issues encountered
```

## Reference Material

When writing arc scripts, look at existing code for patterns and examples:

- **`tests/`** - Test cases showing basic SDK usage patterns
- **`scripts/`** - Working automation scripts with lab logs showing iteration
- **`scripts/script_best_practices.md`** - Common pitfalls and solutions (dialog handling, fishing spots, toll gates, etc.)
- **`bot_arcs/learnings/`** - Shared patterns and working code snippets

These are valuable references for how to interact with the game, handle edge cases, and structure automation logic.

## Starting a New Character

1. Create folder: `bot_arcs/<username>/`
2. Create `config.ts` with initial state
3. Create `lab_log.md` with header
4. Run first arc (recommend: 5m safe activity)
5. Record initial score
6. Begin the journey
