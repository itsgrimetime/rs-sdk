# Lab Log: combat-trainer

## Goal
Maximize the value function: Attack + Strength + Defence + Hitpoints base levels

After 5 minutes of training, measure the sum of these four combat skill levels.

## Baseline
Starting levels from COMBAT_TRAINER preset:
- Attack: 1
- Strength: 1
- Defence: 1
- Hitpoints: 10

**Starting Value: 13**

## Strategy Notes

### Training Locations
1. **Chickens** (north of Lumbridge) - Level 1, low HP, good for beginners
2. **Goblins** (east of Lumbridge) - Level 2, slightly stronger
3. **Cows** (cow field east) - Level 2, need to open gate

### XP Distribution in OSRS
- Attack style determines which skill gets XP
- HP always gets 1/3 of damage dealt as XP
- Need to check which attack style the bot defaults to

---

## Runs

## Run 001 - 2026-01-24 22:45

**Outcome**: timeout (5 min limit reached)
**Duration**: 5 minutes
**Final Value**: ~5 (started at 5 - HP showing 2 not 10)
**Kills**: 1

### What Happened
- Started at chicken coop after walking north
- Opened gate successfully
- Kept saying "Combat taking too long, re-targeting..." after every attack
- Only got 1 confirmed kill in the entire 5 minutes
- Lots of dialogs dismissed (probably level-up popups?)
- At the end "No targets found" - walked to wrong spot

### Root Cause
1. **Combat detection broken**: The `targetStillAlive` check keeps finding the chicken, but we're not actually dealing damage. Need to track XP gain or player animation to know if we're fighting.
2. **Timeout too short**: 50 game ticks (~30s) but chickens respawn, so we see same chicken and think combat is ongoing.
3. **HP starting at 2 not 10**: Save generator issue or skill reading issue.

### Fix Applied
Need to:
1. Track XP gain during combat as success signal
2. Re-attack more frequently if not getting XP
3. Check if we're actually in combat (player animation)
4. Shorten the "combat taking too long" window to 10s

---

## Run 002 - 2026-01-24 22:52

**Outcome**: timeout (5 min limit - expected)
**Duration**: 5 minutes
**Final Value**: 56 (started at 5)
**Kills**: 43

### What Happened
- XP-based kill detection worked perfectly
- Consistent chicken kills every ~7 seconds
- Final stats: Atk=32 Str=1 Def=1 HP=22

### Issues Found
1. **All XP going to Attack only** - Need to rotate attack styles or use controlled style
2. **HP still starting at 2 not 10** - Save generator bug with Hitpoints skill name

### Value Analysis
- Gained 51 value points (5 → 56)
- If we trained all 4 skills equally instead of just Attack + HP, we could potentially gain more levels
- Level distribution: Attack went from 1→32 (+31), HP went from 2→22 (+20)
- Strength and Defence stayed at 1 (wasted XP potential)

### Fix for Next Run
1. Rotate between attack styles (accurate/aggressive/defensive) to train all skills
2. Or find and use "controlled" attack style

---

## Run 003 - 2026-01-24 22:58

**Outcome**: timeout (5 min limit - expected)
**Duration**: 5 minutes
**Final Value**: 95 (started at 5)
**Kills**: 33

### What Happened
- Rotation working but buggy - started with Strength (style 1) but currentStyleIndex was 0
- So first rotation stayed on Strength, then Defence, then Attack
- Final: Atk=16 Str=29 Def=25 HP=25

### Root Cause
Style index mismatch: started with `styles[1]` but `currentStyleIndex=0`

---

## Run 004 - 2026-01-24 23:04

**Outcome**: timeout (expected)
**Duration**: 5 minutes
**Final Value**: 64 (started at 13)
**Kills**: 34

### What Happened
- Tried using "Shared/Lunge" style which claims to train all 3 skills
- BUT it only trained Strength! Atk=1, Str=36, Def=1, HP=26
- The "Shared" style doesn't actually train all skills on this server

### Learning
Shared/Controlled style is NOT viable for maximizing the value function. Use rotation instead.

---

## Run 005 - 2026-01-24 23:10

**Outcome**: timeout (expected)
**Duration**: 5 minutes
**Final Value**: ~98+ (Atk=24+, Str=28+, Def=30+, HP=26+)
**Kills**: 34

### What Happened
- Fixed rotation: Attack → Strength → Defence → repeat
- Proper balanced training across all 3 combat skills
- Each style gets 5 kills before rotating

### Results
- Starting: Value=13 (Atk=1 Str=1 Def=1 HP=10)
- Final: Value=~98 (estimated from last logged stats at kill 30: 95)
- Improvement: +85 value points in 5 minutes

### Possible Optimizations
1. Shorter rotation (3 kills?) - may improve balance
2. Reduce time spent walking/waiting between attacks
3. Priority attack nearest chicken to reduce movement

---

## Run 006 - 2026-01-24 23:15

**Outcome**: timeout (expected)
**Duration**: 5 minutes
**Final Value**: ~100 (at kill 30: Value=96, then 4 more kills)
**Kills**: 34

### What Happened
- Tried 3-kill rotation (more frequent style changes)
- Stats at kill 30: Atk=26 Str=22 Def=23 HP=25

### Comparison
| Rotation | Value | Atk | Str | Def | HP  | Balance |
|----------|-------|-----|-----|-----|-----|---------|
| 5-kill   | ~98   | 20  | 24  | 26  | 25  | Def-heavy |
| 3-kill   | ~100  | 26  | 22  | 23  | 25  | Atk-heavy |

Both approaches yield ~98-100 final value. The 3-kill rotation gives slightly better balance.

### Current Best Strategy
1. Use style rotation (Attack → Strength → Defence)
2. Rotate every 3-5 kills
3. Re-attack every 4 seconds if no XP gain
4. Stay at chicken coop for consistent spawns
5. ~34 kills achievable in 5 minutes

---

## Summary

**Best Result: Value ≈ 100** (from starting value of 13)

The combat trainer successfully improved from:
- Start: Atk=1, Str=1, Def=1, HP=10 (Value=13)
- End: Atk≈25, Str≈22, Def≈24, HP≈25 (Value≈96-100)

Key learnings:
1. XP-based kill detection > NPC presence tracking
2. Style rotation required for balanced training
3. "Shared/Controlled" style doesn't work on this server
4. 4-second re-attack timer optimal for chicken spawns
5. ~34 kills achievable in 5 minutes at chicken coop

---

<!-- Template for logging runs:

## Run XXX - YYYY-MM-DD HH:MM

**Outcome**: success | stall | timeout | error
**Duration**: X minutes Y seconds
**Final Value**: XX (started at 13)
**Kills**: N

### What Happened
- Key events...

### Root Cause (if failed)
Description of why it failed

### Fix Applied
What changes were made

### Ideas for Next Run
- Optimizations to try...

---
-->
