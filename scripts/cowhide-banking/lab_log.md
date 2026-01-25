# Lab Log: cowhide-banking

**Goal**: Collect and bank as many cow hides as possible in 15 minutes.

**Preset**: LUMBRIDGE_SPAWN (standard post-tutorial inventory)

**Strategy**:
1. Equip bronze sword + wooden shield for combat
2. Walk to Lumbridge cow field (3253, 3270)
3. Kill cows, pick up cow hides
4. When inventory is full (~26 items), bank at Lumbridge Castle (2nd floor)
5. Return to cow field and repeat

**Key Metrics**:
- Hides banked (primary metric)
- Hides per minute rate
- Bank trips completed
- Total kills

---

## Run 001 - 2026-01-25 06:15

**Outcome**: error (Bot disconnected)
**Duration**: ~2 min

### What Happened
- Script started correctly, equipped gear, walked to cow field
- Killed 3 cows, collected 4 hides
- HP dropped to 3-4/23 - no food eating logic
- Bot disconnected with "Bot not connected" error

### Root Cause
- No HP checking - bot fought at critically low HP
- Eventually died or got disconnected

### Fix Applied
- Added HP checking in main loop
- Bot now eats food when HP < 50%

---

## Run 002 - 2026-01-25 06:22

**Outcome**: error (Bot disconnected)
**Duration**: ~3.5 min

### What Happened
- HP eating logic worked! Ate shrimp (1) and bread (1)
- But only 2 food items in starting inventory
- Ran out of food at HP 8/26
- Continued fighting with low HP (6-9 HP)
- Collected 9 hides, made 4 kills
- Bot eventually disconnected

### Observations
1. **Food shortage** - Starting preset only has 1 shrimp + 1 bread
2. **Kill counter low** - Only 4 kills registered despite many attacks. Combat detection may be unreliable.
3. **Never reached banking** - Threshold is 20 hides or 26 items, never got there
4. **Attack XP gain is fast** - Attack went from 1 to 38 in ~3 min (cows give good XP)

### Problems Identified
1. Not enough food to survive extended combat
2. Banking threshold too high for quick testing
3. Bot dies before collecting enough hides

### Next Steps
1. Lower banking threshold to 8 hides (faster iteration)
2. Consider: pick up bones and bury for prayer XP? No - waste time
3. Consider: use Al Kharid bank (closer to cow field east side)?
4. Accept that first trip may be short due to food

---

## Run 003 - 2026-01-25 06:34

**Outcome**: error (Bot disconnected during banking walk)
**Duration**: ~2.5 min

### What Happened
- Lowered banking threshold to 8 hides
- Killed 7 cows, collected 8 hides
- **Banking triggered successfully!** ("=== Banking Trip ===" appeared)
- Started walking to castle stairs
- Position reached (3245, 3296) - north of cow field, heading to castle
- Bot disconnected - likely died with 6 HP while walking (no food, goblins along path)

### Observations
1. Banking threshold works correctly at 8 hides
2. Script detects floor level correctly (level: 0)
3. Bot dies during banking walk - 6 HP is too low to survive
4. Need to either bank earlier or avoid combat on the way

### Next Steps
1. Lower HP threshold for eating to avoid critical HP
2. Or: trigger banking BEFORE running out of food
3. Or: flee/escape when HP too low for banking

---

## Run 004-007 - 2026-01-25 06:47-07:06

**Outcome**: Multiple runs with varying results

### Key Findings

1. **Banking loop bug fixed**: Added verification that deposits actually worked before counting
2. **Stair location was wrong**: (3206, 3228) was the graveyard, not castle interior
3. **Castle coordinates updated**: Added castle entrance (3210, 3217), stairs (3206, 3208)
4. **Bank interface never opened**: Script aborted banking correctly after fix
5. **Connection instability**: SDK shows reconnect attempts, suggests server-side issues

### Run 005 Details (best run)
- 7 kills, 8 hides collected
- Multiple successful banking trips attempted (but failed due to wrong coordinates)
- Emergency banking logic triggered correctly
- Script properly aborted when bank didn't open

### Remaining Issues
1. Need to verify stair climbing works with new coordinates
2. Connection stability is external/server issue
3. Kill counter undercounts (5 kills tracked but more cows killed)

### Fixes Applied
- Added deposit verification (check hides left inventory)
- Abort banking if interface doesn't open (prevents infinite loop)
- Better logging for stair/loc detection
- Updated castle coordinates

---

## Notes

### Cow Field Location
- Lumbridge cow field is east of the castle at approximately (3253, 3270)
- Contains regular cows (level 2)
- Has a gate that may need to be opened

### Banking Route
- Lumbridge Castle bank is on the 2nd floor (level 2)
- Requires climbing two flights of stairs
- Route: Cow field -> Castle entrance -> Stairs up x2 -> Bank -> Stairs down x2 -> Cow field

### Potential Optimizations
1. Minimize pathing time by staying near gate
2. Only pick up cow hides (ignore bones, beef to maximize hide rate)
3. Consider banking threshold - full inventory vs. partial trips
4. Could potentially use Al Kharid bank if we get 10gp for toll (closer from east side of field)

### Known Issues
- [ ] Need to verify Lumbridge Castle bank access works
- [ ] Need to verify stair climbing works correctly
- [ ] Gate handling at cow field
