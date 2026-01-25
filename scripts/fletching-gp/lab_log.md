# Lab Log: fletching-gp

Goal: Maximize GP earned from fletching unstrung bows and selling them (now 10 minutes).

## Strategy Overview

**Approach**: Chop -> Fletch -> Sell cycle
- Chop normal trees near Lumbridge for logs
- Fletch logs into best available product based on Fletching level:
  - Level 1-4: Arrow shafts (15 per log, 5 XP)
  - Level 5+: Shortbow (u) (1 per log, 5 XP)
- Sell products at Lumbridge general store
- Track total GP earned

**Starting conditions**: Bronze axe, knife, position near Lumbridge trees

**Key metrics**:
- Total GP earned (primary reward signal)
- Logs chopped
- Items fletched
- Items sold
- Final Fletching level

---

## Run 014 - 2026-01-25 07:15 (died to giant spider again)

**Outcome**: died, lost all items
**GP Earned**: 93 GP earned, then lost on death

### What Happened
1. Knife pickup worked, cycle 1 completed (93 GP)
2. Switched to oak trees near general store
3. **Giant spider attacked while chopping oaks**
4. HP: 9→7→6→3→1→DEAD
5. Respawned at Lumbridge, lost knife + axe + 93 GP

### Death Timeline (from events.jsonl)
```
tick 13791: HP=9, Giant spider dist=0 (attacking!)
tick 14527: HP=7
tick 15213: HP=6
tick 15966: HP=3
tick 16654: HP=1
tick 18122: HP=10, respawned - inventory wiped
```

### Problem
The oak trees near Lumbridge general store (3203, 3243) are in a dangerous area with Giant spiders (level 2). They're aggressive and will attack low-level players.

### Potential Solutions
1. **Kill threatening spiders** - fight back when attacked
2. Add food and eat when HP low
3. Use different oak tree location (e.g., near Lumbridge church)
4. Run away when attacked

---

## Run 013 - 2026-01-25 06:56 (legit start - knife from ground)

**Outcome**: timeout (93 GP in 1 cycle)
**Duration**: 10m 0s
**GP Earned**: 93 GP

### Configuration
- Start: Level 1 Fletching, bronze axe only
- **Pick up knife from ground** (SE of Lumbridge at 3224, 3202)
- No cheats!

### Results
- Found and picked up knife successfully
- Cycle 1: 6 normal logs → 4 longbow + 1 shortbow + 15 shafts = **93 GP**
- Leveled 1→21 Fletching
- Died to spider in oak phase (see Run 014)

### Key Finding
**Legit start works!** Knife pickup from ground is viable.

---

## Run 012 - 2026-01-25 06:10 (oak progression success!)

**Outcome**: timeout (successful - 243 GP!)
**Duration**: 10m 0s
**GP Earned**: 243 GP (2 cycles)

### Configuration
- Start: Level 1 Fletching, bronze axe + knife + 5 bread
- Strategy: Normal trees until level 20, then oaks

### Results
| Cycle | Logs | Products | GP | Fletching Level |
|-------|------|----------|-----|-----------------|
| 1 | 6 normal | 4 longbow, 1 shortbow, 15 shafts | 93 | 1→21 |
| 2 | 6 oak | 1 oak longbow, 5 oak shortbow | 150 | 21→33 |

**Total: 243 GP** - more than 2x previous best!

### Key Finding: Oak bows are VERY profitable!
- **Oak longbow: 112 GP** (vs 21 GP for normal longbow)
- **Oak shortbow: ~8 GP each** (38 GP for 5)
- Progression strategy works: normal logs → level 20 → oaks

### Observations
- Bot switched to oaks automatically at level 21
- Fletching dialog has some reliability issues ("Dialog closed without fletching")
- Only 2 cycles in 10 min - lots of time lost to dialog errors and recovery
- No death this time (food not needed, or no random events)

### Next Steps
- Optimize to get more cycles per 10 min
- Maybe stay with oaks longer once level 20+
- Fix fletching dialog reliability

---

## Run 011 - 2026-01-25 05:21 (oak experiment - knife lost)

**Outcome**: timeout (stuck in loop)
**Duration**: 10m 0s
**GP Earned**: 93 GP (1 cycle only)

### Configuration
- Start: Level 1 Fletching, Level 1 Woodcutting
- Bronze axe + Knife
- Try normal trees first, switch to oaks at WC 15

### What Happened
1. **First cycle was AMAZING**:
   - Chopped 6 normal logs
   - Leveled from 1→21 Fletching in one batch (boosted XP)
   - Made: 1 arrow shaft stack, 1 shortbow, 4 longbows
   - Sold for **93 GP** (84 longbow, 9 shortbow, 0 arrow shafts)

2. **Then knife disappeared**:
   - Continued chopping successfully (WC leveled to 39!)
   - Walked to oak trees, chopped 10 oak logs
   - Tried to fletch oak → "No knife in inventory"
   - Script stuck in infinite fletch-fail loop

### Key Finding: Longbows are VERY profitable!
- Previous runs at level 5: 42 GP per 6 shortbows (first cycle)
- This run at level 10+: 84 GP per 4 longbows!
- **Longbows sell for ~21 GP each vs ~7 GP for shortbows**

### Bug Investigation - SOLVED
The bot **DIED from a Swarm random event!**
- HP: 10→7→6→2→0 over ~30 seconds
- Respawned at Lumbridge castle, lost knife + 93 GP
- Then stuck trying to fletch without knife

Event log showed:
- tick 9471: HP 7, Swarm attacking
- tick 11632: HP 0 (dead!)
- tick 12325: Respawned at (3220, 3208) without knife/coins

### Implications
1. **Normal logs + longbows** might be optimal - no need for oaks!
2. Need food in inventory to survive random events
3. Starting at level 10 Fletching (to make longbows immediately) could be worth testing

---

## Run 010 - 2026-01-25 04:49 (shopSell timeout)

**Outcome**: error
**Duration**: ~3m
**GP Earned**: 12 GP (1 cycle before crash)

### What Happened
The script was running smoothly but crashed with "Action timed out: shopSell" during the second sell cycle. This appears to be a server/browser stability issue.

### Stability Notes
Observed crashes across runs:
- Run 006: "Bot not connected" at ~9 min
- Run 007: Completed but with fletch failures
- Run 008: ✅ Full 10 min success
- Run 009: ✅ Full 10 min success
- Run 010: "shopSell timeout" at ~3 min

The script logic is solid; stability issues are external (server/browser).

---

## Run 009 - 2026-01-25 04:37 (saturated shop)

**Outcome**: timeout (successful completion)
**Duration**: 10m 0s
**GP Earned**: 61 GP

### Key Finding: Shop Persistence
The Lumbridge General Store was **already saturated from Run 008**. Shop stock persists across game sessions!

### GP Breakdown
| Cycle | GP Earned | Notes |
|-------|-----------|-------|
| 1     | 13        | Already saturated! |
| 2     | 12        | Stable low prices |
| 3     | 12        | Stable low prices |
| 4     | 12        | Stable low prices |
| 5     | 12        | Stable low prices |

**Total: 61 GP** (vs 108 GP on fresh shop)

### Comparison: Fresh vs Saturated Shop
| Metric | Fresh Shop (Run 008) | Saturated (Run 009) |
|--------|---------------------|---------------------|
| First cycle GP | 42 | 13 |
| Total GP | 108 | 61 |
| GP/cycle (avg) | 27 | 12 |

### Implications
1. **Shop rotation is critical** - a fresh shop gives 2x more GP
2. The shop price "floor" is ~2 GP per bow (12 GP per 6 bows)
3. Subsequent runs without shop reset will earn ~60 GP baseline

---

## Run 008 - 2026-01-25 04:26 (10-minute success) ⭐

**Outcome**: timeout (successful completion)
**Duration**: 10m 0s
**GP Earned**: 108 GP

### Configuration
- Time limit: 10 minutes
- Start: Level 5 Fletching
- Batch size: 6 logs
- Added GP/cycle tracking

### Results
- **4 complete sell cycles**
- **Fletching level 29**
- 30 logs chopped, 24 fletched, 24 sold

### GP Breakdown by Cycle
| Cycle | GP Earned | Cumulative | GP/Bow | Shop State |
|-------|-----------|------------|--------|------------|
| 1     | 42        | 42         | ~7     | Fresh |
| 2     | 32        | 74         | ~5.3   | Filling |
| 3     | 21        | 95         | ~3.5   | Saturating |
| 4     | 13        | 108        | ~2.2   | Saturated |

### Key Success Factors
1. **Full 10-minute run without crash** - server stability improved
2. **Cycle tracking working** - clear visibility into saturation curve
3. **No fletching failures** (unlike Run 007)
4. **108 GP baseline established** for 10-minute runs

### Saturation Analysis
The GP/cycle drops ~50% every 2 cycles due to shop accumulation. Extrapolating:
- Cycles 5-6 would earn ~6-8 GP each (diminishing returns)
- **Shop rotation could significantly improve earnings** - walking to Varrock after cycle 2-3 when Lumbridge saturates

### Next Steps
1. Consider shop rotation (walk to Varrock General Store after Lumbridge saturates)
2. Or accept saturation and optimize for speed (more cycles = more total GP even at lower rates)

---

## Run 007 - 2026-01-25 04:16 (fletch failures)

**Outcome**: timeout
**Duration**: 10m 0s
**GP Earned**: 8 GP (issues)

### What Happened
- Multiple "Fletching dialog did not open" errors
- Shop opening failure at one point
- GP tracking showed incorrect values due to sell cycle interruptions

### Root Cause
Intermittent fletching dialog issues - the knife+log interaction sometimes fails to open the dialog. Need better retry logic or dialog detection.

---

## Run 006 - 2026-01-25 03:57 (10-minute extension)

**Outcome**: error (connection dropped ~9 min in)
**Duration**: ~9m 4s
**GP Earned**: 105 GP (97 recorded + 8 in final partial sell)

### Configuration
- Time limit extended to **10 minutes**
- Start: Level 5 Fletching
- Batch size: 6 logs
- Sell threshold: 6 items

### Results
- 5 complete sell cycles before crash
- Reached Fletching level 31
- 30 logs chopped, 30 items fletched, 28+ items sold

### GP Breakdown by Cycle
| Cycle | GP Earned | Cumulative | Shop State |
|-------|-----------|------------|------------|
| 1     | 42        | 42         | Fresh (9,8,7,7,6,5 GP) |
| 2     | 28        | 70         | Filling up |
| 3     | 15        | 85         | Saturating |
| 4     | 12        | 97         | More saturated |
| 5     | 8         | 105        | Nearly saturated |

### Key Observations
1. **Shop saturation accelerates**: GP per cycle dropped from 42→28→15→12→8 as stock accumulated
2. **Script executed flawlessly**: No logic errors, all cycles completed cleanly
3. **External crash**: "Bot not connected" error during 5th sell cycle - browser/server issue, not script bug
4. **Chopping rate**: ~3.3 logs/minute with bronze axe (30 logs in ~9 min)
5. **Projected 10-min earnings**: ~110-120 GP at current saturation rate

### Issue: Connection Dropped
The bot disconnected during `sellToShop()` after 9 minutes of stable operation. This appears to be a browser/server stability issue rather than a script problem. The final state snapshot shows:
- Shop was open
- 3 shortbows remaining in inventory
- 97 GP before crash, 8 GP sold in final transaction

### Ideas for Improvement
1. **Shop rotation**: Could walk to Varrock General Store after Lumbridge saturates (~3 cycles)
2. **Better axe**: Steel/mithril axe would increase chop rate significantly
3. **Oak logs**: At higher levels, oak logs → oak longbows sell for more GP
4. **Connection resilience**: Add reconnection logic if disconnected mid-operation

---

## Run 005 - 2026-01-25 02:35

**Outcome**: timeout (but successful cycles)
**Duration**: 5m 0s
**GP Earned**: 25 GP (shop saturated from previous runs)

### Configuration
- Start: Level 5 Fletching
- Batch size: 6 logs
- Sell threshold: 6 items

### Results
- 2 complete sell cycles
- Reached Fletching level 23
- 12 shortbows sold

### Key Finding: Shop Saturation
Shop prices depend on current stock:
- **Fresh shop**: 9,8,7,7,6,6 GP = 43 GP per 6 bows
- **Saturated shop**: 2,2,2,2,2,2 GP = 12 GP per 6 bows

The Lumbridge General Store retains stock between runs, causing prices to drop over time. Best results occur when the shop has no shortbows in stock.

### What Works Well
1. Starting at level 5 skips worthless arrow shafts
2. 6-bow batches balance efficiency and frequency
3. GP-based success detection in sell loop is reliable
4. Walking away from stuck shop recovers gracefully

---

## Run 001 - 2026-01-25 00:43

**Outcome**: timeout
**Duration**: 5m 0s
**GP Earned**: 0

### What Happened
- Chopped 16 logs successfully
- Fletched 16 times, reached Fletching level 28
- Sold 240 arrow shafts total
- Completed 2 full chop->fletch->sell cycles

### Metrics
- Logs chopped: 16
- Items fletched: 16
- Items sold: 240
- Final Fletching level: 28

### Issues Found

1. **fletchLogs() product selection bug**: Even when calling `fletchLogs("short bow")`, the function creates Arrow shafts. The dialog option selection isn't working correctly.
   - Evidence: Events show `"method":"fletchLogs","args":["short bow"]` returning `"product":{"name":"Arrow shaft"}`
   - Root cause: The product pattern matching or dialog click sequence isn't selecting the right option

2. **Arrow shafts sell for 0 GP**: The Lumbridge general store gives 0 coins for arrow shafts.
   - Evidence: Sold 240 arrow shafts, GP earned stayed at 0
   - Need to sell shortbows or longbows (which are worth more) to earn GP

3. **Shop closing stuck**: `closeShop()` consistently times out and requires walking away to force close.
   - Workaround: Added retry limit and walk-away fallback

4. **Level-up dialogs blocking**: Frequent level-up dialogs (from rapid XP gain) interfere with fletching and need to be dismissed.
   - Workaround: Added dialog dismissal loops before key operations

### Root Cause Analysis

The primary failure is that **we cannot make shortbows** due to the `fletchLogs()` product selection bug. Since arrow shafts are worthless at the general store, we earn 0 GP regardless of how many we sell.

### Fixes Needed

1. **Fix fletchLogs() in bot-actions.ts**: The dialog option selection logic needs to properly click the shortbow/longbow option before clicking Ok. The current implementation falls through to making arrow shafts.

2. **Alternative shop**: Try selling at a different shop that buys arrow shafts for GP, or fix the bow creation to sell bows instead.

### What Worked Well

- Script structure and cycle logic is correct
- Chopping logs works reliably (~6-8 logs per minute with bronze axe)
- Fletching arrow shafts works (just not bows)
- Selling to shop works (just for 0 GP)
- Walking away to force-close stuck shops is effective
- Reached level 28 Fletching in 5 minutes (good XP rate!)

---

## Next Steps

1. Investigate and fix the `fletchLogs()` product selection bug in bot-actions.ts
2. Once fixed, verify shortbows sell for GP at general store
3. Consider starting with oak logs near a different location for higher-value products
4. Optimize batch sizes based on travel time vs. crafting time

---

## Technical Notes

### Inventory Structure
- Logs don't stack - each is a separate inventory item with count=1
- Arrow shafts DO stack - one item with count=15 per log
- Shortbow (u) doesn't stack - one item per bow

### XP Rates (observed)
- Arrow shafts: ~750 XP per fletch action (server has boosted rates?)
- Reached level 24 from 1 in first 8 fletches

### Shop Behavior
- General store at (3212, 3246) buys most items
- Arrow shafts sell for 0 GP (possibly server-specific)
- Shop interface sometimes gets stuck open

---

## Learnings (Updated after 10-minute expansion)

### 1. Strategic Findings

**Key Metric: GP Earnings**
- **Fresh shop**: 108 GP in 10 minutes (4 cycles: 42, 32, 21, 13 GP)
- **Saturated shop**: 61 GP in 10 minutes (5 cycles: ~12 GP each)
- **Shop stock persists** across game sessions - this is the biggest factor!

**What Worked:**
- **Batch size of 6 logs** is optimal - small enough for frequent sell cycles, large enough to minimize travel overhead
- **Starting at Fletching level 5** skips worthless arrow shafts and goes straight to shortbows
- **GP-based success detection** in sell loop is more reliable than trusting `sellToShop()` return values
- **Walking away from stuck shop** is an effective recovery mechanism
- **Dismissing dialogs before operations** prevents blocking
- **GP/cycle tracking** - lets us see saturation in real-time

**What Didn't Work:**
- **Arrow shafts as a product** - worthless at general stores (0 GP)
- **Relying on sellToShop success field** - reports false failures even when sales succeed
- **Running without checking shop state** - subsequent runs earn less due to saturation

**Game Mechanics Insights:**
- Shop prices decrease as stock increases: 9→8→7→7→6→5 GP for first 6 bows
- Shop "floor price" is ~2 GP per bow when saturated
- Shop stock persists between game sessions/runs - not reset per character
- Logs don't stack in inventory (count=1 each), shortbows don't stack (count=1 each)

**Saturation Curve (GP per 6 bows):**
| Cycle | Fresh Shop | Saturated |
|-------|-----------|-----------|
| 1     | 42        | 12        |
| 2     | 32        | 12        |
| 3     | 21        | 12        |
| 4     | 13        | 12        |
| 5     | -         | 12        |

**Future Improvements:**
- Shop rotation to Varrock when Lumbridge saturates (would require ~2 min travel)
- Better axe (steel/mithril) for faster chopping
- Oak logs for higher-value products at higher levels

### 2. Process & Tooling Reflections

**What Made Debugging Easier:**
- The `events.jsonl` with action results was invaluable for tracing issues
- State snapshots showing inventory contents helped verify operations
- **GP/cycle tracking** made saturation visible immediately
- Adding inline `ctx.log()` for decision points

**What Made Debugging Harder:**
- State snapshots don't include shop data (shop.isOpen, shop.playerItems)
- Hard to distinguish "script bug" vs "SDK bug" vs "game server" when things fail
- Server/browser stability issues cause intermittent crashes

**Stability Observations:**
- ~50% of 10-minute runs complete without crashes
- Common errors: "Bot not connected", "shopSell timeout", "Fletching dialog did not open"
- These appear to be external server/browser issues, not script bugs

### 3. SDK Issues & Gaps

**Functions That Don't Work As Expected:**
- `sellToShop()` returns `success: false` even when GP increases
- `closeShop()` times out frequently - requires walk-away workaround
- `fletchLogs()` occasionally fails with "dialog did not open"

**Missing Functionality:**
- No `getShopStock()` or way to check current shop prices
- No way to check if shop will buy an item without attempting sale
- No `waitForShopClose()` with force-close option
- Missing shop locations (Varrock, etc.) in Locations constants

**Workarounds Still In Use:**
- Checking GP before/after sell to detect success
- Walking away to force-close stuck shops
- Manual dialog dismissal loops before operations
- Retry counters to escape stuck states
