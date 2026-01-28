# Lab Log: Agility Training

## Overview

**Goal**: Train Agility from level 1 to 10+ using the Gnome Stronghold Agility Course

**Starting Preset**: `TestPresets.LUMBRIDGE_SPAWN` (fresh account at Lumbridge)

**Challenge**: The Gnome Stronghold is located very far northwest (~400+ tiles from Lumbridge). This requires a long travel phase before training can begin.

## Course Information

### Gnome Stronghold Agility Course
- **Location**: (2474, 3436) - Northwest of Ardougne
- **Requirements**: Level 1 Agility (starter course)
- **Members-only**: Yes (may be blocked on some servers)

### Course Layout (7 obstacles in order)
| # | Obstacle | Action | XP |
|---|----------|--------|-----|
| 1 | Log balance | Walk-across | 7.5 |
| 2 | Obstacle net | Climb-over | 7.5 |
| 3 | Tree branch | Climb | 5 |
| 4 | Balancing rope | Walk-on | 7.5 |
| 5 | Tree branch | Climb-down | 5 |
| 6 | Obstacle net | Climb-over | 7.5 |
| 7 | Obstacle pipe | Squeeze-through | 7.5 |
| - | Lap bonus | - | 39 |
| **Total** | | | **~86.5** |

### XP Requirements
- Level 10 = 1,154 XP
- Laps needed = ~14

---

## Run 001 - Initial Test

**Date**: 2026-01-27
**Timeout**: 10 min
**Stall timeout**: 90s

**Hypothesis**: The script should travel from Lumbridge to Gnome Stronghold and begin training.

### What Happened

Travel progressed well through the southern route:
1. Lumbridge (3222, 3218) -> West of Lumbridge ✓
2. Near Draynor Manor road ✓
3. Draynor area ✓ (took some HP damage from wandering monsters)
4. West of Draynor ✓
5. Port Sarim area ✓
6. Rimmington area ✓
7. **BLOCKED at (2908, 3319)** - South of Falador

### Outcome

**FAILED** - Path blocked south of Falador

The pathfinder returned "No path found" for all waypoints north of position (2908, 3319). This suggests:
- The Falador walls block direct entry
- The gate/entrance may not be pathable
- Or the area north is members-only content

### Analysis

Position (2908, 3319) is approximately:
- South of Falador's western walls
- Near the crafting guild area
- The city of Falador has walls that require using gates

The Gnome Stronghold is in a members-only area. The path north from Rimmington goes through:
- Falador (need to enter through a gate)
- Taverley (members-only)
- Catherby area (members-only)
- Gnome Stronghold (members-only)

### Root Cause

**Members-only content is not accessible from a F2P spawn point.**

The Gnome Stronghold Agility Course is the only level 1 agility course, but it's in a members-only area. Without members access, there is no way to train Agility from level 1 using LUMBRIDGE_SPAWN preset.

---

## Known Limitations

### 1. Members-Only Area
The Gnome Stronghold is in a members-only region. If the server doesn't support members content, travel will fail.

**Detection**: Script will log position when it gets stuck and throw an error.

### 2. Long Travel Time
The journey from Lumbridge to Gnome Stronghold is ~400+ tiles:
- Lumbridge (3222, 3218)
- Gnome Stronghold (2474, 3436)
- Requires passing through Draynor, Falador, Taverley

**Mitigation**: 90s stall timeout, 10 min total time limit.

### 3. Obstacles Have Directional Requirements
Some obstacles can only be approached from certain directions:
- `gnome_obstacle_net_1`: Must approach from south (z > loc z)
- `gnome_obstacle_net_2`: Must approach from north (z < loc z)
- `gnome_obstacle_pipe`: Must enter from south

**Mitigation**: Course is designed to flow in one direction. Script follows natural order.

---

## Obstacle Interaction Patterns

From `content/scripts/skill_agility/scripts/gnome_course.rs2`:

```rs2
[oploc1,gnome_log_balance]
~agility_force_move(75, human_walk_logbalance, movecoord(coord, 0, 0, -7));

[oploc1,gnome_obstacle_net_1]
if(coordz(coord) <= coordz(loc_coord)) {
    mes("You can not do that from here.");
    return;
}
~agility_climb_up(75, movecoord(coord, 0, 1, -2));

[oploc1,gnome_obstacle_pipe]
if(coordz(coord) > coordz(loc_coord)) {
    mes("You can't enter the pipe from this side.");
    return;
}
```

Key observations:
- Each obstacle awards 5-7.5 XP individually
- Completing all 7 obstacles in sequence awards 39 XP bonus
- Course progress tracked via `%gnome_course_progress` varp (1-7, resets to 0)

---

## Alternative Approaches Considered

### 1. Spawn at Gnome Stronghold
Could modify preset to spawn at the course, but this violates the methodology:
> "Preset is a constraint, not a variable"

### 2. Barbarian Outpost Course
Another option at level 35, but requires higher level and is also far from Lumbridge.

### 3. Wilderness Agility Course
Level 52 requirement, dangerous area. Not suitable for level 1.

---

## Conclusion

### STATUS: BLOCKED - MEMBERS-ONLY CONTENT

**Agility cannot be trained from level 1 using `TestPresets.LUMBRIDGE_SPAWN`.**

The only level 1 Agility course (Gnome Stronghold) is in a members-only area that is inaccessible from Lumbridge.

### Travel Test Results

| Waypoint | Coordinates | Status |
|----------|-------------|--------|
| Lumbridge | (3222, 3218) | Start |
| West of Lumbridge | (3200, 3210) | ✓ |
| Near Draynor Manor | (3170, 3220) | ✓ |
| Draynor area | (3100, 3250) | ✓ |
| West of Draynor | (3050, 3260) | ✓ |
| Port Sarim | (2980, 3270) | ✓ |
| Rimmington | (2920, 3280) | ✓ |
| South of Falador | (2920, 3350) | **BLOCKED** |
| Gnome Stronghold | (2474, 3436) | Unreachable |

**Maximum distance traveled**: ~315 tiles (Lumbridge to Rimmington)
**Remaining distance**: ~450 tiles to Gnome Stronghold

### What Would Be Needed

To train Agility from level 1, one of these would be required:
1. **Members-only preset** that spawns at or near Gnome Stronghold
2. **Server-side change** to make Gnome area accessible
3. **Alternative course** that doesn't exist in classic RS (e.g., a F2P agility course)

### Learnings

1. **Members-only content** - Agility is fundamentally a members-only skill in classic RS
2. **Pathfinding works** - The `bot.walkTo()` successfully navigated ~315 tiles
3. **Long-distance travel** - The waypoint system worked well for multi-leg journeys
4. **HP regeneration** - Bot took some combat damage but HP naturally regenerated during travel

---

## Run 002 - Fixed Waypoints (Falador Gate Route)

**Date**: 2026-01-27
**Change**: Fixed waypoints to route through Falador's south gate instead of walking straight north into walls

### Problem
Previous waypoints tried to go straight north from Rimmington (2920, 3280) to "South of Falador" (2920, 3350), which walked directly into Falador's walls and got stuck at (2908, 3319).

### Fix Applied
Changed waypoints to:
1. From Rimmington, go **EAST** first toward Falador south gate (~2965, 3305)
2. Enter through south gate entrance (~2965, 3340)
3. Navigate through Falador city center
4. Exit through west/north side toward Taverley

### What Happened

Travel progression:
1. Lumbridge (3222, 3218) -> West of Lumbridge ✓
2. Near Draynor Manor road ✓
3. Draynor area ✓
4. West of Draynor ✓
5. Port Sarim ✓
6. Rimmington (2921, 3271) ✓
7. **Approach Falador south gate (2961, 3302) ✓** ← NEW WAYPOINT
8. South gate entrance - struggled but got in via east side (3001, 3356) ✓
9. **Inside Falador south (2948, 3376) ✓** ← MADE IT INSIDE!
10. **Falador center (2951, 3395) ✓** ← NEW PROGRESS!
11. **BLOCKED at (2946, 3407)** - Cannot exit north to Taverley

### Outcome

**PARTIAL SUCCESS** - Waypoint fix worked, now blocked at members-only boundary

| Metric | Run 001 | Run 002 | Change |
|--------|---------|---------|--------|
| Distance traveled | ~315 tiles | ~550 tiles | +235 tiles |
| Stuck position | (2908, 3319) | (2946, 3407) | Inside Falador now |
| Progress | South of Falador walls | Inside Falador center | Much better |
| Remaining distance | ~450 tiles | ~473 tiles | Similar |

### Analysis

1. **Waypoint fix successful** - Bot no longer gets stuck at Falador walls
2. **Got inside Falador** - Bot reached (2946, 3407) which is inside the city
3. **Members-only boundary confirmed** - No path found to any waypoint north/west of Falador
4. **Taverley is blocked** - All paths to Taverley (2880, 3440) return "No path found"

### Root Cause Confirmed

**The Gnome Stronghold is in members-only territory.** The boundary is at the north edge of Falador. Everything beyond (Taverley, Catherby, Gnome Stronghold) is inaccessible without members access.

### Updated Travel Map

```
Lumbridge (3222, 3218)
    ↓ ~22 tiles
West of Lumbridge (3200, 3210) ✓
    ↓ ~30 tiles
Draynor area (3100, 3250) ✓
    ↓ ~50 tiles
Port Sarim (2980, 3270) ✓
    ↓ ~60 tiles
Rimmington (2920, 3280) ✓
    ↓ ~45 tiles (go EAST first!)
Falador South Gate (2965, 3305) ✓
    ↓ ~35 tiles
Inside Falador (2948, 3376) ✓
    ↓ ~25 tiles
Falador Center (2946, 3407) ✓
    ↓ BLOCKED - Members-only
Taverley (2880, 3440) ✗
    ↓
Gnome Stronghold (2474, 3436) ✗
```

**Total F2P traversable distance**: ~550 tiles (Lumbridge to Falador center)

---

## Run 003 - Manual Gate Navigation for Falador-Taverley

**Date**: 2026-01-27
**Change**: Implemented manual gate handling since pathfinder can't traverse the Falador-Taverley passage

### Problem from Run 002
Bot got stuck at Falador center (2946, 3407) because the pathfinder couldn't handle the gate/passage to Taverley. However, the gates ARE clickable and Taverley IS accessible on this server.

### Fix Applied
Added manual gate navigation:
1. Detect when bot is in "Falador gate zone" (x: 2920-2960, z: 3400-3450)
2. Walk northwest toward gate area with smaller waypoints
3. Use `getNearbyLocs()` to find gates/doors/passages
4. Use `sendInteractLoc()` to click/open gates
5. Handle any dialogs that appear
6. Walk through after clicking

Key new functions:
- `isPastTaverleyGate()` - Check if x < 2900 (past gate area)
- `isInFaladorGateZone()` - Detect when manual navigation needed
- `findAndUseGate()` - Search for and interact with gates
- `navigateFaladorToTaverley()` - Orchestrate gate passage

### What Happened

**MAJOR SUCCESS** - Bot passed through Falador-Taverley gate!

Travel progression:
1. Lumbridge -> Falador center ✓ (same as Run 002)
2. Detected "gate zone" at (2952, 3395) ✓
3. **Switched to manual gate navigation** ✓
4. Found doors at (2949, 3450) and gates at (2935, 3450) ✓
5. **Clicked Door, walked through** ✓ - Position changed (2949, 3450) -> (2944, 3455)
6. Found more gates at (2935, 3450) ✓
7. **Clicked Gate, walked through** ✓ - Position changed (2936, 3451) -> (2932, 3453)
8. **Exited to Taverley area** - reached (2880, 3434) ✓
9. Continued west toward Catherby - reached (2704, 3440) ✓
10. **NEW BLOCKER at (2641, 3448)** - Near White Wolf Mountain

### Gate Detection Output

```
Found 4 potential gates/doors:
  - Door at (2949, 3450) dist=5.0 opts=[Open]
  - Door at (2952, 3453) dist=8.0 opts=[Open]
  - Gate at (2935, 3450) dist=10.0 opts=[Open]
  - Gate at (2935, 3451) dist=10.0 opts=[Open]
```

The `findAndUseGate()` function successfully:
1. Found gates using `/gate|door|passage|entrance|exit|barrier/i` regex
2. Identified "Open" option on the gates
3. Walked closer when needed
4. Clicked the gate with `sendInteractLoc()`
5. Walked through after clicking

### Outcome

| Metric | Run 002 | Run 003 | Change |
|--------|---------|---------|--------|
| Distance traveled | ~550 tiles | ~600+ tiles | **+50+ tiles** |
| Stuck position | (2946, 3407) | (2625, 3398) | **Past Taverley!** |
| Progress | Falador center | West of Catherby | **Major progress** |
| Remaining distance | ~473 tiles | ~156 tiles | **-317 tiles!** |

### Analysis

1. **Gate handling worked!** - `findAndUseGate()` successfully found and clicked through gates
2. **Multiple gates needed** - Had to pass through at least 2 doors/gates in the area
3. **Taverley accessible** - This server DOES have Taverley accessible
4. **New blocker: White Wolf Mountain** - Around (2641, 3448) there's another obstacle

### New Blocker: White Wolf Mountain Area

After passing Taverley, the bot got stuck around (2641, 3448) / (2625, 3398). This area is:
- Between Taverley and Catherby
- Near White Wolf Mountain
- May have wolves that attack or terrain obstacles

The pathfinder returned "No path found" suggesting:
- Mountain terrain blocks direct path
- May need to go around (north or south)
- Or there's another gate/passage needed

### Updated Travel Map

```
Lumbridge (3222, 3218)
    ↓ ~22 tiles
West of Lumbridge (3200, 3210) ✓
    ↓ ~30 tiles
Draynor area (3100, 3250) ✓
    ↓ ~50 tiles
Port Sarim (2980, 3270) ✓
    ↓ ~60 tiles
Rimmington (2920, 3280) ✓
    ↓ ~45 tiles
Falador South Gate (2965, 3305) ✓
    ↓ ~35 tiles
Inside Falador (2948, 3376) ✓
    ↓ ~25 tiles
Falador Center (2952, 3395) ✓
    ↓ MANUAL GATE NAVIGATION
North Falador (2947, 3419) ✓
    ↓ Gate/Door at (2949, 3450) - CLICKED THROUGH
Near Taverley gate (2945, 3445) ✓
    ↓ Gate at (2935, 3450) - CLICKED THROUGH
Taverley area (2880, 3434) ✓ ← NEW PROGRESS!
    ↓ ~75 tiles
West of Taverley (2779, 3442) ✓ ← NEW PROGRESS!
    ↓ ~75 tiles
Toward Catherby (2704, 3440) ✓ ← NEW PROGRESS!
    ↓ BLOCKED
White Wolf Mountain area (2641, 3448) ✗
    ↓
Gnome Stronghold (2474, 3436) ✗
```

### Key Learnings

1. **Manual gate handling works** - When pathfinder fails, use `getNearbyLocs()` + `sendInteractLoc()`
2. **Position change detection** - Check if position changed significantly after clicking gate
3. **Walk after click** - Need to explicitly walk through after clicking gate open
4. **Multiple gates** - Some passages have multiple gates/doors in sequence
5. **Progressive discovery** - Each run reveals new blockers further along the path

### Next Steps

Need to handle White Wolf Mountain area:
1. Investigate what's at (2641, 3448) - wolves? terrain? gate?
2. May need to go around the mountain (north via Burthorpe or south)
3. Or find another gate/passage to click through

### Code Changes Summary

```typescript
// New helper to detect gate zone
function isInFaladorGateZone(ctx): boolean {
    // x: 2920-2960, z: 3400-3450
}

// New helper to check if past gate
function isPastTaverleyGate(ctx): boolean {
    return state.player.worldX < 2900;
}

// Search and use gates
async function findAndUseGate(ctx): Promise<boolean> {
    const locs = ctx.sdk.getNearbyLocs();
    const gateKeywords = /gate|door|passage|entrance|exit|barrier/i;
    // Find gates, click Open option, walk through
}

// Orchestrate gate passage
async function navigateFaladorToTaverley(ctx): Promise<boolean> {
    // Walk to gate area waypoints
    // Use findAndUseGate() when blocked
}
```
