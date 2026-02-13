/**
 * Generates all benchmark task directories for Harbor.
 *
 * Standard tasks: 16 skills × max XP in 10 minutes
 * Variants: woodcutting-xp-5m (5min XP grind), woodcutting-10 (reach level 10)
 *
 * All generated output is gitignored — run this before `harbor run`.
 *
 * Usage: bun benchmark/generate-tasks.ts
 */
import { mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const BENCHMARK_DIR = join(import.meta.dir);
const SHARED_DIR = join(BENCHMARK_DIR, 'shared');

const DOCKER_IMAGE = 'ghcr.io/maxbittker/rs-agent-benchmark:latest';
const DEFAULT_AGENT_TIMEOUT = 600; // 10 minutes
const VERIFIER_TIMEOUT = 120;

// ── Standard skill definitions (XP-grind tasks) ─────────────────

interface SkillDef {
  /** Skill name as it appears in the game (PascalCase) */
  name: string;
  /** Directory name suffix (lowercase, used in {skill}-xp-10m) */
  slug: string;
  /** Instruction tips for maximizing XP */
  tips: string[];
}

const SKILLS: SkillDef[] = [
  // Combat
  {
    name: 'Attack',
    slug: 'attack',
    tips: [
      'Set combat style to "Accurate" (style index 0) to train Attack',
      'Cows near Lumbridge (3253, 3290) are safe targets — open the gate at (3253, 3270) first',
      'Al Kharid warriors (3293, 3175) give faster XP but hit back harder',
      'Chickens at (3237, 3295) are safest for very low levels',
      'Wrap attacks in try/catch — timeouts are common in crowded areas',
    ],
  },
  {
    name: 'Defence',
    slug: 'defence',
    tips: [
      'Set combat style to "Defensive" (style index 3) to train Defence',
      'Cows near Lumbridge (3253, 3290) are safe targets — open the gate at (3253, 3270) first',
      'Al Kharid warriors (3293, 3175) give faster XP but hit back harder',
      'You gain Defence XP from melee combat only when using defensive style',
      'Wrap attacks in try/catch — timeouts are common in crowded areas',
    ],
  },
  {
    name: 'Strength',
    slug: 'strength',
    tips: [
      'Set combat style to "Aggressive" (style index 1) to train Strength',
      'Cows near Lumbridge (3253, 3290) are safe targets — open the gate at (3253, 3270) first',
      'Al Kharid warriors (3293, 3175) give faster XP but hit back harder',
      'Chickens at (3237, 3295) are safest for very low levels',
      'Wrap attacks in try/catch — timeouts are common in crowded areas',
    ],
  },
  {
    name: 'Hitpoints',
    slug: 'hitpoints',
    tips: [
      'Hitpoints XP is gained from any combat style — every hit that deals damage gives Hitpoints XP',
      'Use any combat style; Hitpoints XP is always 1/3 of the combat XP gained',
      'Cows near Lumbridge (3253, 3290) are safe targets — open the gate at (3253, 3270) first',
      'Al Kharid warriors (3293, 3175) give faster XP but hit back harder',
      'Wrap attacks in try/catch — timeouts are common in crowded areas',
    ],
  },
  {
    name: 'Ranged',
    slug: 'ranged',
    tips: [
      'You need a ranged weapon (bow) and ammunition (arrows) to train Ranged',
      'Buy a shortbow and bronze arrows from a shop, or fletch them',
      'Equip the bow and arrows before attacking',
      'Chickens at (3237, 3295) are good low-level targets',
      'Cows near Lumbridge (3253, 3290) work too — open the gate at (3253, 3270) first',
    ],
  },
  {
    name: 'Prayer',
    slug: 'prayer',
    tips: [
      'Bury bones for Prayer XP — use sdk.sendUseItem(slot) on bones in inventory',
      'Kill chickens at (3237, 3295) for easy bone drops, or cows at (3253, 3290)',
      'Pick up bones from ground with bot.pickupItem(), then bury them',
      'Big bones (from cows, etc.) give more XP than regular bones',
      'Use sdk.scanGroundItems() to find dropped bones, NOT state.nearbyLocs',
    ],
  },
  {
    name: 'Magic',
    slug: 'magic',
    tips: [
      'You need runes to cast spells — buy them from a magic shop or find them',
      'Wind Strike is the basic combat spell, requires 1 air rune + 1 mind rune',
      'Use bot.castSpellOnNpc(target, spell) for combat spells',
      'Chickens at (3237, 3295) are good low-level spell targets',
      'Each successful spell cast gives Magic XP',
    ],
  },
  // Gathering
  {
    name: 'Woodcutting',
    slug: 'woodcutting',
    tips: [
      'Higher-level trees give more XP per log but take longer to chop',
      'Regular trees near Lumbridge (3200, 3220) work for level 1',
      'Oak trees at Varrock (3190, 3458) at level 15+, willows at Draynor (3087, 3235) at level 30+',
      'Drop logs when inventory is full to keep chopping without banking',
      'Use bot.chopTree() for the simplest approach',
    ],
  },
  {
    name: 'Fishing',
    slug: 'fishing',
    tips: [
      'Fishing spots are NPCs, not locations — use findNearbyNpc(/fishing spot/i)',
      'Draynor Village (3087, 3230) has level-1 net/bait spots for shrimp',
      'WARNING: Lumbridge area has NO level-1 fishing spots — use Draynor',
      'You need a small fishing net (buy from Port Sarim at 3014, 3224 for 5gp)',
      'Drop fish when inventory is full to keep fishing without banking',
    ],
  },
  {
    name: 'Mining',
    slug: 'mining',
    tips: [
      'Rocks are locations with a "Mine" option — use findNearbyLoc(/rocks/i)',
      'SE Varrock mine (3285, 3365) has copper (2090/2091), tin (2093/2094), and iron (2092/2095)',
      'You need a pickaxe — buy bronze pickaxe from Bob\'s Axes in Lumbridge (3230, 3203) for 1gp',
      'Iron ore gives good XP but requires Mining level 15',
      'Drop ore when inventory is full to keep mining without banking',
    ],
  },
  // Processing
  {
    name: 'Cooking',
    slug: 'cooking',
    tips: [
      'Cook raw food on a range using bot.useItemOnLoc(rawFood, range)',
      'Lumbridge range near Bob\'s Axes (3211, 3215) works without any quests',
      'WARNING: Lumbridge Castle kitchen range requires Cook\'s Assistant quest — avoid it',
      'You need raw food first — fish shrimp at Draynor (3087, 3230) then cook them',
      'Higher cooking level reduces burn rate',
    ],
  },
  {
    name: 'Fletching',
    slug: 'fletching',
    tips: [
      'Use a knife on logs to fletch — bot.fletchLogs() handles this',
      'Knife spawns at (3224, 3202) SE of Lumbridge castle',
      'Arrow shafts from regular logs give good early XP (~375 XP per log with bonus)',
      'Shortbows can be made at level 5 for better XP',
      'Chop trees for logs, then fletch them — combine woodcutting + fletching',
    ],
  },
  {
    name: 'Crafting',
    slug: 'crafting',
    tips: [
      'Leather crafting: use bot.craftLeather() with needle + thread + leather',
      'Jewelry crafting at furnace: gold bar + mould → rings/necklaces/amulets',
      'Gold ring gives 375 Crafting XP, gold necklace gives 500 XP, gold amulet gives 750 XP',
      'Buy needle and thread from a crafting shop, or find them',
      'Cowhides must be tanned into leather at a tanner before crafting',
    ],
  },
  {
    name: 'Smithing',
    slug: 'smithing',
    tips: [
      'Smelt ores at a furnace: copper + tin → bronze bar (use sendUseItemOnLoc with ore on furnace)',
      'Lumbridge furnace is at (3225, 3256)',
      'Smith bars at an anvil: use bot.smithAtAnvil(product) — requires a hammer',
      'Buy hammer from Lumbridge General Store (3210, 3244) for 1gp',
      'Mine equal copper (2090/2091) and tin (2093/2094) at SE Varrock mine (3285, 3365)',
    ],
  },
  // Utility
  {
    name: 'Firemaking',
    slug: 'firemaking',
    tips: [
      'Use a tinderbox on logs to light them — bot.burnLogs() handles this',
      'Buy tinderbox from Lumbridge General Store (3210, 3244)',
      'Chop trees for logs near Lumbridge (3200, 3220), then burn them',
      'You need open ground to light fires — move if "can\'t light fire here"',
      'Higher-level logs give more Firemaking XP',
    ],
  },
  {
    name: 'Thieving',
    slug: 'thieving',
    tips: [
      'Pickpocket men at Lumbridge castle (3222, 3218) for easy early XP',
      'Use bot.pickpocketNpc(target) or find "Pickpocket" option on NPCs',
      'Getting stunned is normal — wait ~5 seconds for recovery',
      'Al Kharid men (3293, 3175) with kebabs from Karim (3273, 3180) for sustain',
      'No tools or equipment needed — works from level 1 with empty inventory',
    ],
  },
];

// ── Variant tasks (non-standard configurations) ──────────────────

interface VariantTask {
  slug: string;
  instruction: string;
  agentTimeout: number;
  /** Verifier script filename in shared/ */
  verifier: string;
  testSh: string;
  tags: string[];
  /** Use pre-built Docker image (mutually exclusive with environmentDockerfile) */
  dockerImage?: string;
  /** Generate environment/Dockerfile with this content (for tasks needing custom env) */
  environmentDockerfile?: string;
}

const VARIANTS: VariantTask[] = [
  {
    slug: 'woodcutting-xp-5m',
    instruction: `Gain as much Woodcutting XP as possible within the time limit.

The bot name is "agent". The rs-sdk codebase is at /app with full documentation in sdk/API.md and learnings/.

Tips:
- Higher-level trees give more XP per log but take longer to chop
- You need the right axe for your level
- Optimize for XP/hour: balance tree type, banking, and movement
`,
    agentTimeout: 300,
    verifier: 'check_xp.ts',
    testSh: `#!/bin/bash
export SKILL_NAME="Woodcutting"
cd /app && bun run /tests/check_xp.ts
`,
    tags: ['game', 'runescape', 'automation', 'mcp', 'benchmark'],
    dockerImage: DOCKER_IMAGE,
  },
  {
    slug: 'woodcutting-10',
    instruction: `Get level 10 in Woodcutting.

The bot name is "agent". The rs-sdk codebase is at /app with full documentation in sdk/API.md and learnings/.
`,
    agentTimeout: 600,
    verifier: 'check_level.ts',
    testSh: `#!/bin/bash
set -e
mkdir -p /logs/verifier
cd /app
bun run /tests/check_level.ts
`,
    tags: ['game', 'runescape', 'automation', 'mcp'],
    // Normal game speed — override the 8x speedup baked into the base image
    environmentDockerfile: `FROM ${DOCKER_IMAGE}
# Normal game speed (420ms ticks instead of base image's 50ms)
ENV NODE_TICKRATE=420
`,
  },
];

// ── Template generators ──────────────────────────────────────────

function generateSkillTaskToml(): string {
  return `version = "1.0"

[metadata]
author_name = "Sean Lee"
difficulty = "medium"
category = "agent"
tags = ["game", "runescape", "automation", "mcp", "benchmark", "xp-grind"]

[verifier]
timeout_sec = ${VERIFIER_TIMEOUT}.0

[agent]
timeout_sec = ${DEFAULT_AGENT_TIMEOUT}.0

[environment]
docker_image = "${DOCKER_IMAGE}"
cpus = 2
memory_mb = 4096
storage_mb = 10240
allow_internet = true

[[environment.mcp_servers]]
name = "rs-agent"
transport = "stdio"
command = "bash"
args = ["-c", "cd /app && bun run mcp/server.ts"]
`;
}

function generateVariantTaskToml(v: VariantTask): string {
  const envLine = v.dockerImage
    ? `docker_image = "${v.dockerImage}"`
    : `build_timeout_sec = 1800.0`;
  const tagsStr = v.tags.map(t => `"${t}"`).join(', ');

  return `version = "1.0"

[metadata]
author_name = "Sean Lee"
difficulty = "medium"
category = "agent"
tags = [${tagsStr}]

[verifier]
timeout_sec = ${VERIFIER_TIMEOUT}.0

[agent]
timeout_sec = ${v.agentTimeout}.0

[environment]
${envLine}
cpus = 2
memory_mb = 4096
storage_mb = 10240
allow_internet = true

[[environment.mcp_servers]]
name = "rs-agent"
transport = "stdio"
command = "bash"
args = ["-c", "cd /app && bun run mcp/server.ts"]
`;
}

function generateInstructionMd(skill: SkillDef): string {
  const tips = skill.tips.map(t => `- ${t}`).join('\n');
  return `Gain as much ${skill.name} XP as possible within the time limit.

The bot name is "agent". The rs-sdk codebase is at /app with full documentation in sdk/API.md and learnings/.

Tips:
${tips}
`;
}

function generateTestSh(skill: SkillDef): string {
  return `#!/bin/bash
export SKILL_NAME="${skill.name}"
cd /app && bun run /tests/check_xp.ts
`;
}

// ── Main ─────────────────────────────────────────────────────────

console.log(`Generating ${SKILLS.length} standard + ${VARIANTS.length} variant benchmark tasks...`);

// Standard XP-grind tasks (all share identical task.toml)
const skillToml = generateSkillTaskToml();

for (const skill of SKILLS) {
  const taskDir = join(BENCHMARK_DIR, `${skill.slug}-xp-10m`);
  const testsDir = join(taskDir, 'tests');

  console.log(`  ${skill.slug}-xp-10m/ (${skill.name})`);

  mkdirSync(testsDir, { recursive: true });

  // Dockerfile for cloud providers (Daytona) that don't support docker_image.
  // Just pulls the pre-built image — no additional build steps needed.
  const envDir = join(taskDir, 'environment');
  mkdirSync(envDir, { recursive: true });
  writeFileSync(join(envDir, 'Dockerfile'), `FROM ${DOCKER_IMAGE}\n`);

  writeFileSync(join(taskDir, 'task.toml'), skillToml);
  writeFileSync(join(taskDir, 'instruction.md'), generateInstructionMd(skill));
  writeFileSync(join(testsDir, 'test.sh'), generateTestSh(skill));
  copyFileSync(join(SHARED_DIR, 'check_xp.ts'), join(testsDir, 'check_xp.ts'));
}

// Variant tasks
for (const variant of VARIANTS) {
  const taskDir = join(BENCHMARK_DIR, variant.slug);
  const testsDir = join(taskDir, 'tests');

  console.log(`  ${variant.slug}/`);

  mkdirSync(testsDir, { recursive: true });
  writeFileSync(join(taskDir, 'task.toml'), generateVariantTaskToml(variant));
  writeFileSync(join(taskDir, 'instruction.md'), variant.instruction);
  writeFileSync(join(testsDir, 'test.sh'), variant.testSh);
  copyFileSync(
    join(SHARED_DIR, variant.verifier),
    join(testsDir, variant.verifier),
  );

  // Dockerfile for cloud providers (Daytona) — either custom env or
  // a thin FROM layer on the pre-built image.
  const envDir = join(taskDir, 'environment');
  mkdirSync(envDir, { recursive: true });
  writeFileSync(
    join(envDir, 'Dockerfile'),
    variant.environmentDockerfile ?? `FROM ${DOCKER_IMAGE}\n`,
  );
}

console.log(`\nDone! Generated ${SKILLS.length + VARIANTS.length} task directories.`);
console.log(`\nTo build the shared Docker image:`);
console.log(`  cd benchmark/docker && ./build.sh`);
