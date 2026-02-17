# OSRS Ranked 1v1 PVP Matchmaking — Implementation Plan

## Project Goal

Build a private, Elo-rated 1v1 PVP practice environment for OSRS. Players (you) fight
bot opponents distributed across Elo brackets. Bots range from basic (bronze-tier, 1-way
switches) to expert (tribrid NH). The system tracks your rating, matches you against
appropriately skilled bots, and lets you progressively learn PVP mechanics without getting
dumpstered by LMS sweats or tick-perfect bots.

---

## Architecture Decision: Why Elvarg (Naton1 RL Fork)

After evaluating the landscape, the clear winner is **Naton1's simulation-rsps** — a fork
of Elvarg RSPS that was specifically modified for PVP simulation and validated against live
OSRS by training an RL agent that hit rank #1 in PvP Arena.

### Why not RSMod?
RSMod has beautiful Kotlin architecture and tracks rev 233, but its combat system is
explicitly unfinished (their own Issue #59). No prayer system, no food, no potions, only
2 special attacks implemented. You'd spend 6-12 months just getting combat to a baseline
before you could even start on matchmaking.

### Why Elvarg RL fork specifically (not base Elvarg)?
Base Elvarg has most PVP mechanics, but the Naton1 fork fixed critical timing issues:
- Food consumption / attack delay accuracy (extensive modifications per their docs)
- Added PID tracking (`player_has_pid` observation)
- Validated that the combat produces realistic outcomes (agent trained here performs
  at rank-1 level in live OSRS)

### What Elvarg already has (combat-critical):
- **29 prayers** including all overheads, Piety/Rigour/Augury, Smite, Redemption
- **22+ spec weapons**: AGS, DClaws, DDS, GMaul (0-tick), VLS, DWH, ACB, Dark Bow, etc.
- **Combo eating**: Shark+karambwan, brew tick delays, anglerfish overheal
- **Freeze system**: Ice Rush/Burst/Blitz/Barrage with immunity timers
- **Accurate formulas**: Accuracy rolls, max hit, magic defense (70/30 split), Dharok's effect
- **Equipment switching**: Full gear swap infrastructure
- **8 bot presets**: TribridMax, NHPure, DDSPure (melee/range), MidTribridMax, ObbyMauler, GRanger, F2PMelee
- **Ancient Magicks**: Full spell book (rush/burst/blitz/barrage)

### What's missing / needs work:
- **PID system**: Base Elvarg uses FIFO hit queue, not PID-ordered. RL fork tracks PID but
  may not fully implement PID swaps in the combat loop — needs verification
- **Client**: 317-based client (dated UI, no RuneLite plugins). Functional but ugly.
  Dodian community has an `elvarg-runelite-client` (317 engine + rev 207 data + RuneLite
  features) that could be integrated later
- **No matchmaking/arena system**: Built from scratch
- **No Elo/rating**: Built from scratch
- **Limited map areas**: Need to set up a dedicated PVP arena zone

### Client strategy:
Start with the stock Elvarg 317 client. It's ugly but it works and eliminates an entire
class of integration problems during prototyping. Once combat is validated, evaluate
upgrading to `dodian-community/elvarg-runelite-client` for the RuneLite plugin ecosystem
(ground items, prayer flick helpers, etc.). This is a nice-to-have, not a blocker.

---

## Repo Structure

```
osrs-ranked-pvp/
├── server/                  # Naton1's simulation-rsps (Elvarg fork), our primary codebase
│   └── ...                  # Java/Gradle, this is where all game logic lives
├── client/                  # Elvarg client (or RuneLite-based client later)
│   └── ...                  # Java, connects to server
├── matchmaking/             # Rating system, queue, match orchestration
│   ├── elo.java             # Glicko-2 rating engine
│   ├── MatchQueue.java      # Queue + bracket logic
│   ├── ArenaManager.java    # Instance lifecycle, loadouts, countdowns
│   └── BotManager.java      # Bot pool, difficulty tiers, behavior selection
├── docs/
│   ├── SETUP.md             # Build + run instructions
│   ├── MECHANICS_AUDIT.md   # Combat mechanic validation results
│   └── BOT_TIERS.md         # Bot behavior specs per Elo bracket
└── README.md
```

### Repo setup approach:
**New repo, vendor the server.** Don't use submodules — you'll be making deep changes to
the Elvarg server code (arena system, matchmaking hooks, new bot behaviors). Submodules
create painful merge friction for that. Instead:

1. Create a new repo `osrs-ranked-pvp`
2. Clone `Naton1/osrs-pvp-reinforcement-learning`, extract `simulation-rsps/` into `server/`
3. Clone `RSPSApp/elvarg-rsps`, extract `ElvargClient/` into `client/`
4. Strip the RL-specific code (Python training loop, remote environment socket server) —
   keep the combat fixes and PID additions
5. Commit as initial baseline

---

## Milestones

### Phase 0: Environment Setup & Baseline Build
**Goal**: Get the server and client compiling and running. Log in, walk around, verify basic functionality.

**Tasks**:
- [ ] Create new repo, vendor Naton1's `simulation-rsps/` as `server/`
- [ ] Vendor Elvarg client as `client/`
- [ ] Verify both build with Gradle (server: Java 17, client: Java 8)
- [ ] Start the server, connect with the client, log in with a test account
- [ ] Walk around, open inventory, equip items, interact with the world
- [ ] Strip RL-specific code from server (RemoteEnvironmentServer, RemoteEnvironmentPlayerBot,
  ReinforcementLearningPlugin, AgentBotLoader, Python bridge) while preserving combat fixes
- [ ] Document what you stripped and what you kept in a commit message

**Validation criteria**:
- [x] `./gradlew build` succeeds for both server and client
- [x] Can log in and see your character in-game
- [x] Can walk, equip items, open interfaces
- [x] Server runs without RL-related errors after stripping

**Estimated scope**: Small. Mostly build/config work.

---

### Phase 1: Combat Mechanic Validation
**Goal**: Systematically verify that PVP-critical mechanics work correctly. This is the
most important phase — if combat isn't right, nothing else matters.

**Tasks**:
- [ ] **Spawn a second player bot** and engage in basic melee combat
  - Verify hits land, damage numbers appear, HP bars update
  - Verify attack speed matches expected tick counts (scim = 4t, whip = 4t, 2h = 7t, etc.)
- [ ] **Test prayer switching**
  - Activate Protect from Melee → verify damage reduction (~40% in PVP)
  - Switch overheads → verify old prayer deactivates, new one activates
  - Test Smite drain (damage/4 prayer drain per hit)
  - Test Piety/Rigour/Augury stat boosts
- [ ] **Test special attacks** (prioritize the PVP-critical ones)
  - AGS: Verify 1.375x str, 2.0x accuracy
  - DDS: Verify double hit, 1.15x str, 1.20x accuracy
  - GMaul: Verify 0-tick instant spec (this is the hardest one to get right)
  - DClaws: Verify multi-hit spec formula
  - VLS: Verify 20% min hit
  - Dark Bow: Verify minimum 8-8 hit
- [ ] **Test combo eating**
  - Shark → karambwan in same tick
  - Verify food adds 3 ticks to attack timer
  - Verify karambwan adds 2 ticks
  - Brew + restore cycling
- [ ] **Test freeze mechanics**
  - Ice Barrage → verify 32-tick freeze (19.2 seconds)
  - Verify freeze immunity after expiry (freeze duration + 5 ticks)
  - Verify movement completely blocked during freeze
  - Verify can still attack/eat/switch while frozen
- [ ] **Test equipment switching**
  - Switch from mage gear to melee gear → verify stats update immediately
  - Test multi-way switches (3+ items in one tick)
  - Verify attack style changes when switching weapon types
- [ ] **Test PID behavior**
  - Investigate Naton1's PID implementation — is it just tracking or full PID-ordered hits?
  - If FIFO only: implement PID swap (random reassignment each tick, winner's hits process first)
  - Test that when both players attack on same tick, PID holder's hit resolves first
- [ ] **Test death mechanics**
  - Kill a player → verify they die, respawn
  - Verify items on death behavior (keep 3 + protect item prayer)

**Validation criteria**:
- [x] All attack speeds match OSRS wiki values (within ±1 tick tolerance)
- [x] Prayer protection reduces PVP damage by ~40% (not 100%)
- [x] At least AGS, DDS, GMaul, DClaws specs produce correct damage distributions
- [x] Shark+karambwan combo eat works in same tick
- [x] Ice Barrage freezes for correct duration with immunity after
- [x] Gear switches update combat stats in the same tick
- [x] PID determines hit order when both players attack simultaneously

**Estimated scope**: Medium-large. This is investigative work — reading the Elvarg combat
code, writing test scenarios (spawn 2 players, script actions, check results), fixing
anything that's wrong. Document findings in `docs/MECHANICS_AUDIT.md`.

**Key files to study**:
- `server/game/src/main/java/com/elvarg/game/content/combat/CombatFactory.java`
- `server/game/src/main/java/com/elvarg/game/content/combat/formula/DamageFormulas.java`
- `server/game/src/main/java/com/elvarg/game/content/combat/formula/AccuracyFormulasDpsCalc.java`
- `server/game/src/main/java/com/elvarg/game/content/combat/CombatSpecial.java`
- `server/game/src/main/java/com/elvarg/game/content/combat/hit/PendingHit.java`
- `server/game/src/main/java/com/elvarg/game/content/Food.java`
- `server/game/src/main/java/com/elvarg/game/content/PrayerHandler.java`
- `server/game/src/main/java/com/elvarg/game/entity/impl/playerbot/fightstyle/`

---

### Phase 2: Arena Infrastructure
**Goal**: Build a dedicated 1v1 arena zone with match lifecycle management.

**Tasks**:
- [ ] **Design the arena area**
  - Pick a flat, clear map region (or repurpose an existing area like Duel Arena)
  - Define arena bounds (maybe 20x20 tile box, enough for farcast/kiting)
  - Add supply table NPCs at spawn points (optional, or just pre-load inventories)
- [ ] **Build ArenaManager**
  - `startMatch(player, opponent)` → teleport both to arena spawn points
  - Pre-fight countdown (3-2-1, invulnerable during countdown)
  - Match state machine: `WAITING → COUNTDOWN → ACTIVE → FINISHED`
  - On death: declare winner, teleport both to lobby, distribute results
  - Match timeout (e.g., 5 minutes → sudden death or draw)
  - Prevent leaving arena during active match (block teleports, walking past boundary)
- [ ] **Build loadout presets**
  - Define standard loadouts: Max Main NH, Zerker, Pure, F2P
  - On match start: wipe inventory/equipment, apply preset (stats, gear, inventory, spellbook)
  - This ensures fair fights — no gear advantage, pure skill
  - Store presets as config files or enums for easy iteration
- [ ] **Build lobby system**
  - Lobby area where player waits between matches
  - Basic commands: `::queue` (join queue), `::loadout <name>` (pick preset), `::stats` (view rating)
  - Display current rating, W/L record, queue status

**Validation criteria**:
- [x] Can teleport two entities into arena, countdown fires, match starts
- [x] Death ends the match, winner is declared, both return to lobby
- [x] Loadout preset correctly sets stats/gear/inventory/spellbook
- [x] Cannot leave arena during active match
- [x] Match timeout works

**Estimated scope**: Medium. Mostly new code, but Elvarg already has teleportation,
instancing patterns (Dueling.java is a reference), and entity management.

---

### Phase 3: Bot Opponents — Tiered Difficulty
**Goal**: Create bot opponents at multiple skill levels that provide a meaningful
progression from beginner to advanced PVP.

**Tier design** (Elo brackets are approximate, tune after testing):

#### Bronze Tier (800-1000 Elo) — "Learning the Basics"
- **Behavior**: Uses one combat style only (e.g., melee only). No prayer switching.
  Eats food when below 40% HP. No spec weapon usage. Predictable, slow actions.
- **Purpose**: Learn the basic eat/attack rhythm, get comfortable with the interface.
- **Implementation**: Simple state machine. Attack → check HP → eat if low → repeat.

#### Silver Tier (1000-1200 Elo) — "One-Way Switching"
- **Behavior**: Switches between 2 combat styles (e.g., range + melee). Correct overhead
  prayer ~50% of the time (intentionally slow reactions). Uses DDS spec occasionally.
  Eats at 50% HP. Basic combo eating (food only, no karambwan).
- **Purpose**: Learn to prayer switch against simple patterns, learn to recognize spec timing.
- **Implementation**: Extend Bronze with style switching on a timer, prayer with delay.

#### Gold Tier (1200-1400 Elo) — "Two-Way Switching"
- **Behavior**: Range/melee/mage with 2-way switches. Correct overhead prayer ~70% of time
  with 1-2 tick reaction delay. Uses AGS/DDS specs when opponent is low HP.
  Combo eats (shark + karambwan). Attempts to freeze + farcast.
- **Purpose**: Learn to read gear switches and react, learn freeze kiting counterplay.
- **Implementation**: The existing Elvarg bot presets (DDSPure, GRanger) are close to this level.

#### Platinum Tier (1400-1600 Elo) — "Full Tribrid"
- **Behavior**: Full 3-way NH tribrid. Correct overhead ~85% with <1 tick delay.
  Stack specs (freeze → blood barrage → AGS/claws). Offensive prayer switching.
  Combo eats with brews. Steps under/farcasts intelligently.
- **Purpose**: Practice reading fast switches, learn to stack your own combos.
- **Implementation**: Based on Elvarg's `TribridMaxFighterPreset` and `MidTribridMaxFighterPreset`.

#### Diamond Tier (1600+ Elo) — "Sweatlord"
- **Behavior**: Near tick-perfect everything. 1-ticks specs consistently. Pray flicks to
  conserve prayer. Fakes gear switches to bait wrong prayer. PID-aware play (more aggressive
  when holding PID). Vengeance timing. Smite attempts when opponent is low prayer.
- **Purpose**: The final boss. If you can beat this consistently, you can compete in LMS.
- **Implementation**: Enhancement of Platinum with fake switches, PID awareness, venge timing.

**Tasks**:
- [ ] **Define BotDifficulty enum** with config for each tier:
  - `prayerAccuracy` (0.0-1.0), `reactionDelayTicks` (0-3), `switchComplexity` (1-3 way),
    `eatingThreshold` (HP%), `specUsage` (none/basic/smart), `comboEating` (bool),
    `freezeKiting` (bool), `fakeSwitch` (bool), `pidAwareness` (bool)
- [ ] **Build BotController base class**
  - Per-tick decision loop: assess state → decide action → execute
  - Pluggable strategy pattern for each tier
  - Intentional imperfection system: delay timers, accuracy rolls for prayer switches
- [ ] **Implement Bronze bot** — attack-eat loop, no switching
- [ ] **Implement Silver bot** — add 2-style switching, delayed prayer
- [ ] **Implement Gold bot** — add specs, combo eating, freeze attempts
- [ ] **Implement Platinum bot** — full tribrid with fast prayer
- [ ] **Implement Diamond bot** — tick-perfect with fakes, PID awareness, venge

**Validation criteria**:
- [x] Bronze bot is beatable by someone who has never PKed before
- [x] Each tier feels noticeably harder than the previous one
- [x] Bots don't do anything mechanically impossible (no 0-tick prayer on the same tick
      as a 3-way switch + spec — that's inhuman)
- [x] Diamond bot is competitive with good PKers

**Estimated scope**: Large. This is the core value proposition. Start with Bronze and
Silver, playtest, iterate. Use Elvarg's existing bot presets as reference implementations
for Gold+ tiers.

---

### Phase 4: Elo Rating System
**Goal**: Implement Glicko-2 rating with bracket-based matchmaking.

**Why Glicko-2 over Elo**:
- Tracks rating deviation (uncertainty) — new players have wide RD, veterans narrow
- Handles volatility — players on win/loss streaks have higher volatility
- Better at placing players quickly (fewer "calibration" matches needed)
- Well-documented algorithm with reference implementations available

**Tasks**:
- [ ] **Implement Glicko-2 engine**
  - Player rating: `(rating, ratingDeviation, volatility)`, default `(1500, 350, 0.06)`
  - Update after each match using standard Glicko-2 formulas
  - Persist to server's player save file or a separate ratings DB
- [ ] **Implement matchmaking queue**
  - `QueueEntry(player, loadoutType, timestamp)`
  - On queue: find bot within ±200 Elo of player rating (widen range over time if no match)
  - Bot pool: maintain N bots per tier, select closest Elo match
  - Assign bots fixed ratings: Bronze=900, Silver=1100, Gold=1300, Plat=1500, Diamond=1700
  - As player's rating changes, they naturally face harder/easier bots
- [ ] **Implement rating display**
  - `::stats` command: show current rating, RD, rank, W/L, win streak
  - Post-match summary: rating change, opponent rating, +/- Elo
  - Optional: per-loadout ratings (your NH main rating vs your pure rating)
- [ ] **Implement rank thresholds**
  - Bronze: <1000, Silver: 1000-1200, Gold: 1200-1400, Platinum: 1400-1600, Diamond: 1600+
  - Visual indicator (chat message or interface) showing current rank
- [ ] **Anti-inflation measures**
  - Bot ratings are fixed anchors — they don't change from losses/wins
  - Player RD increases slowly during inactivity (Glicko-2 handles this natively)
  - Floor rating at 100 (can't drop below)

**Validation criteria**:
- [x] New player starts at 1500, RD=350
- [x] After 10 matches, RD has decreased significantly (rating is stabilizing)
- [x] Winning against higher-rated bots gives more Elo than winning against lower-rated
- [x] Losing to lower-rated bots costs more Elo than losing to higher-rated
- [x] Player naturally climbs to face harder bots as they improve

**Estimated scope**: Medium. Glicko-2 is well-documented. The queue logic is simple since
you're matching against a bot pool, not other humans.

---

### Phase 5: Quality of Life & Iteration
**Goal**: Polish the experience, add training aids, iterate on bot difficulty.

**Tasks**:
- [ ] **Post-match replay/stats**
  - Track per-match: damage dealt/taken, successful prayer switches, specs landed/missed,
    combo eats used, freezes landed
  - Display summary after each match
  - Helps identify what you're doing wrong (e.g., "you only prayed correctly 40% of the time")
- [ ] **Practice modes**
  - `::practice prayer` — bot rapidly switches styles, you just practice overhead switching,
    no damage dealt. Tracks your accuracy/reaction time.
  - `::practice eating` — bot deals steady damage, you practice combo eating to survive.
    Tracks how efficiently you eat.
  - `::practice spec` — frozen target dummy, practice 1-tick spec timing.
    Tracks your spec accuracy and timing.
- [ ] **Configurable bot behavior**
  - `::setbot <tier>` — override matchmaking, fight a specific tier
  - `::setbot custom prayer=0.8 reaction=1 switches=2` — fine-tune bot parameters
  - Useful for drilling specific weaknesses
- [ ] **Client improvements** (if needed)
  - Evaluate `dodian-community/elvarg-runelite-client` for RuneLite integration
  - If viable: integrate for GPU rendering, ground item overlays, prayer tab helpers
  - If not viable: consider basic QOL mods to the 317 client (larger prayer icons,
    equipment stat overlay, etc.)
- [ ] **Hot-reload bot configs**
  - Store bot tier parameters in a YAML/JSON config file
  - Reload without server restart so you can tune difficulty on the fly

**Validation criteria**:
- [x] Post-match stats accurately reflect what happened in the fight
- [x] Practice modes isolate specific skills effectively
- [x] Custom bot parameters work and produce noticeably different fight experiences

**Estimated scope**: Medium. This is iterative polish work. Prioritize post-match stats
and custom bot config — those give the fastest feedback loop for improving.

---

## Development Order & Dependencies

```
Phase 0 (Environment Setup)           ~1-2 sessions
    │
    ▼
Phase 1 (Combat Validation)           ~3-5 sessions
    │
    ├──► Fix any broken mechanics found during validation
    │
    ▼
Phase 2 (Arena Infrastructure)        ~2-3 sessions
    │
    ▼
Phase 3 (Bot Tiers)                   ~4-6 sessions
    │   Start with Bronze + Silver, playtest, then build up
    │
    ▼
Phase 4 (Elo Rating)                  ~2-3 sessions
    │   Can partially overlap with Phase 3
    │
    ▼
Phase 5 (QoL & Polish)               ~Ongoing
```

Phases 3 and 4 can be developed in parallel — you can test bots without Elo, and you can
test Elo with placeholder bots. Phase 5 is continuous improvement based on your own
playtesting feedback.

---

## Key Technical References

### Repos to clone:
- **Server base**: `https://github.com/Naton1/osrs-pvp-reinforcement-learning` → extract `simulation-rsps/`
- **Client base**: `https://github.com/RSPSApp/elvarg-rsps` → extract `ElvargClient/`
- **Client upgrade (later)**: `https://github.com/dodian-community/elvarg-runelite-client`

### OSRS PVP reference material:
- Max hit calculator: `https://oldschool.runescape.wiki/w/Maximum_hit`
- Accuracy formulas: `https://oldschool.runescape.wiki/w/Damage_per_second/Melee`
- Spec weapon mechanics: `https://oldschool.runescape.wiki/w/Special_attacks`
- Tick manipulation: `https://oldschool.runescape.wiki/w/Tick_manipulation`
- PID system: `https://oldschool.runescape.wiki/w/Pid`
- Glicko-2 paper: `http://www.glicko.net/glicko/glicko2.pdf`

### Existing bot behavior to study:
- `server/.../entity/impl/playerbot/fightstyle/impl/TribridMaxFighterPreset.java` (14.5KB, full NH tribrid AI)
- `server/.../entity/impl/playerbot/fightstyle/CombatSwitch.java`
- `server/.../entity/impl/playerbot/fightstyle/EnemyDefenseAwareCombatSwitch.java`

### Naton1 RL environment contract (useful for understanding PVP state space):
- `contracts/environments/NhEnv.json` — 29KB spec defining all PVP observations and actions
- 130+ observation fields, 11 action categories — useful reference for what your bots
  need to track and what practice mode stats should measure

---

## First Session Checklist

When you start a new session with this plan, here's exactly what to do first:

```bash
# 1. Create the repo
mkdir osrs-ranked-pvp && cd osrs-ranked-pvp
git init

# 2. Clone source repos (temporary, for extraction)
git clone https://github.com/Naton1/osrs-pvp-reinforcement-learning /tmp/naton1-rl
git clone https://github.com/RSPSApp/elvarg-rsps /tmp/elvarg

# 3. Extract what we need
cp -r /tmp/naton1-rl/simulation-rsps ./server
cp -r /tmp/elvarg/ElvargClient ./client

# 4. Clean up RL-specific code from server
#    (identify and remove: RemoteEnvironmentServer, RemoteEnvironmentPlayerBot,
#     ReinforcementLearningPlugin, AgentBotLoader, and any Python socket bridge code)
#    KEEP: all combat formula changes, PID additions, food/attack delay fixes

# 5. Verify builds
cd server && ./gradlew build && cd ..
cd client && ./gradlew build && cd ..

# 6. Initial commit
git add -A
git commit -m "Initial baseline: Elvarg RL fork (server) + Elvarg client"
```

Then move on to Phase 0 validation tasks: start the server, connect the client, log in,
walk around, verify the world is functional.
