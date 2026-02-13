# Benchmark Tasks (Harbor)

All task directories are **generated** — never edit them directly.

## Source of truth

| Path | Purpose |
|------|---------|
| `generate-tasks.ts` | Generates all 18 task directories |
| `shared/check_xp.ts` | XP verifier (copied into each task's tests/) |
| `shared/check_level.ts` | Level verifier (used by woodcutting-10) |
| `docker/` | Shared Docker image source (pre-built, pushed to GHCR) |

## Regenerate tasks

```bash
bun benchmark/generate-tasks.ts
```

Run this before `harbor run`. Generated directories are gitignored.

## Running on Daytona (cloud)

```bash
export DAYTONA_API_KEY=<your-key>
bun benchmark/generate-tasks.ts
harbor run -p benchmark/<task-dir> -a <agent> -m <model> --env daytona
```

Run the full dataset with parallelism:
```bash
harbor run -p benchmark/ -a claude-code -m anthropic/claude-sonnet-4-20250514 --env daytona -n 16
```

Each task has an `environment/Dockerfile` that `FROM`s the pre-built GHCR image, so Daytona pulls the image with no build step beyond the layer cache.

## Adding a new task

1. Add a new entry to the `SKILLS` array (for standard XP-grind tasks) or `VARIANTS` array (for custom tasks) in `generate-tasks.ts`
2. If the task needs a new verifier, add it to `shared/`
3. Run `bun benchmark/generate-tasks.ts`

## Docker image

All standard tasks use the pre-built image `ghcr.io/maxbittker/rs-agent-benchmark:latest` (8x game speed via `NODE_TICKRATE=50`). Variant tasks that need different env settings use a thin `FROM` layer on top of this image.

Build and push:
```bash
cd benchmark/docker && ./build.sh
```
