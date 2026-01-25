# Lab Log: fishing-speedrun

Goal: Maximize combined Fishing+Cooking level in 10 minutes.

## Current Status

**Best Result**: Combined Level 112 (Fishing 56 + Cooking 56) in 10 min

## Known Issues

1. **Fire lighting unreliable**: `sendUseItemOnItem` consumes logs but fire not detected
2. **Connection drops**: Browser disconnects intermittently
3. **Draynor dangerous**: Dark wizards kill player - use Al-Kharid instead

## Current Strategy (v3 - Al-Kharid)

**Preset**: FISHER_COOK_AT_DRAYNOR (now at Al-Kharid position)
- Small fishing net
- Tinderbox
- 15 logs
- Position: Al-Kharid (3267, 3148) - SAFE

**Cycle**:
1. Fish until 18 raw fish
2. Light fire with tinderbox + logs
3. Cook all fish on fire
4. Drop cooked/burned fish
5. Repeat (or just fish after logs run out)

---

## Run History

### Run 007 - Banking Fixed!

**Date**: 2026-01-25
**Duration**: ~280s (connection dropped mid-run)

**Results** (best stable cycle):
- Fishing: Level 49 (95,000 XP)
- Cooking: Level 47 (81,000 XP)
- **COMBINED: 96** (single full cycle with banking)
- Fish Caught: 46
- Fish Cooked: 27
- **Fish Banked: 24** ✓

**Fix Applied**:
- Bank booth "Use" option doesn't work
- **"Use-quickly" (option 2) DOES open the bank interface!**
- Deposits now work correctly

**Remaining Issue**:
- Server connection drops intermittently
- When disconnected, player respawns at Lumbridge (~117 tiles away)
- Pathfinding fails with "Not connected" error
- Script unable to recover from Lumbridge spawn

---

### Run 006 - v4 Range + Drop (before banking fix)

**Date**: 2026-01-25
**Duration**: 600s (full 10 min)

**Results**:
- Fishing: Level 56 (198,000 XP)
- Cooking: Level 56 (198,000 XP)
- **COMBINED: 112**
- Cycles: 3 complete fish→cook→drop cycles
- Fish Caught: 78
- Fish Cooked: 54

**Strategy**:
- Fish at Al-Kharid until 27 raw fish
- Walk to range, cook all at once
- Bank interface didn't open (14 booths found but "Use" option failed)
- Fallback: Drop cooked fish
- Return to fishing spot

**Notes**:
- Cooking works perfectly - 27 fish cooked per batch
- Drop fallback ensures continuous progress when banking fails
- 3 cycles per 10 min with current walking distances

---

### Run 005 - Previous Best (Draynor with cooking)

**Date**: 2026-01-25
**Duration**: 520s (~8.7 min) - connection lost early

**Results**:
- Fishing: Level 60 (282,000 XP)
- Cooking: Level 39 (36,000 XP)
- **COMBINED: 99**
- Fires Lit: 1
- Fish Cooked: ~12

### Run 004 - Fishing Only (Draynor)

**Date**: 2026-01-25
**Duration**: 600s (full 10 min)

**Results**:
- Fishing: Level 64 (414,000 XP)
- Cooking: Level 1
- **COMBINED: 65**

### Run 002 - Initial Fishing Success

**Date**: 2026-01-25
**Duration**: 221s

**Results**:
- Fishing: Level 53
- XP/Hour: ~2.3M

---

## Technical Notes

### XP Rates (100x Server)
- Shrimp: 1,000 XP fishing, 3,000 XP cooking
- Anchovies: 4,000 XP fishing, 3,400 XP cooking

### Safe Locations
- **Al-Kharid (3267, 3148)**: Safe shrimp fishing
- Draynor (3086, 3230): DANGEROUS - dark wizards!

### Environment
- `NODE_RANDOM_EVENTS=false`: Disable random events

## Next Steps

1. ~~Fix fire lighting detection (XP check timing)~~ - Switching to permanent range
2. ~~Consider using cooking range instead of fires~~ - **Implemented in v4**
3. Handle connection drops with retries

---

## Strategy v4 - Range & Bank (Current)

**Change**: No more portable fires. Use permanent cooking range + bank cycle.

**Locations**:
- Fishing spot: (3267, 3148)
- Range: (3273, 3180)
- Bank: (3269, 3167)

**Cycle**:
1. Fish until inventory full (28 slots)
2. Walk north to Al-Kharid range
3. Cook all fish on range
4. Walk to Al-Kharid bank
5. Deposit all cooked fish
6. Walk back to fishing spot
7. Repeat

**Advantages**:
- Permanent range never disappears (unlike fires)
- No logs/tinderbox needed (more inventory space)
- Banking allows unlimited cooking without dropping

**Disadvantages**:
- More walking time per cycle
- Distance: ~32 tiles fishing→range, ~13 tiles range→bank, ~19 tiles bank→fishing
