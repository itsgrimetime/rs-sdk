<div align="center">
    <h1>Lost City</h1>
</div>

> [!NOTE]
> Learn about our history and ethos on our forum: https://lostcity.rs/t/faq-what-is-lost-city/16

This is a higher-level repository contains LostCity base game engine, web client, Java client, game content, plus our own AI agent system.

## Getting Started

> [!IMPORTANT]
> If you run into issues, please see  [common issues](#common-issues).

```sh
# Quick start (interactive menu)
./start.sh      # Linux/macOS
```

## Dependencies

- Git CLI - Windows users: [git-scm](https://git-scm.com/)
- [Bun 1.2+](https://bun.sh)
- [Java 17 or newer](https://adoptium.net/)

> [!TIP]
> If you're using VS Code (recommended), [we have an extension to install on the marketplace.](https://marketplace.visualstudio.com/items?itemName=2004scape.runescriptlanguage)

---

## Directory Structure

| Directory | Description |
|-----------|-------------|
| `engine/` | Game server - handles world state, players, NPCs, game logic |
| `content/` | Game assets - maps, models, scripts, sprites, music |
| `webclient/` | TypeScript web client with BotSDK for automation |
| `javaclient/` | Java applet client (original decompiled code) |
| `agent/` | AI agent system - Claude Agent SDK integration for bot automation |
| `test/` | Test scripts for bot automation and shop interactions |
| `runs/` | Agent run logs and state snapshots |

### Engine (`engine/`)

The game server handling world simulation, player logic, and network protocol.

```
engine/
├── src/           # Server source code
├── public/        # Static files served to clients
│   ├── client/    # Standard web client build
│   └── bot/       # Bot client build (with BotSDK)
├── view/          # EJS templates (bot.ejs for bot interface)
├── data/          # Runtime game data
├── prisma/        # Database schema and migrations
└── tools/         # Build and pack tools
```

### WebClient (`webclient/`)

Browser-based game client ported to TypeScript.

```
webclient/
├── src/
│   ├── client/    # Standard client code
│   └── bot/       # Bot-specific modules (AgentPanel, BotSDK)
├── out/           # Built client bundles
│   ├── standard/  # Standard client output
│   └── bot/       # Bot client output
└── 3rdparty/      # Third-party dependencies
```

### Agent (`agent/`)

AI agent system using Claude Agent SDK for autonomous bot control.

```
agent/
├── agent-state/   # Live state files (JSON/MD) for agent consumption
├── sync.ts        # WebSocket bridge - syncs game state to files
├── cli.ts         # rsbot CLI - read state, queue actions
├── rsbot-agent.ts # Claude Agent SDK wrapper
├── agent-controller.ts # Manages agent lifecycle
└── login.ts       # Automated login helper
```


---

## System Architecture

```
┌──────────────────┐                    ┌──────────────────┐
│   Game Engine    │◄──── TCP/WS ─────► │   Bot Client     │
│  (engine/)       │                    │  (webclient/)    │
│                  │                    │                  │
│ - Game server    │                    │ - Browser-based  │
│ - World state    │                    │ - Renders game   │
│ - Player logic   │                    │ - BotSDK exports │
└──────────────────┘                    └────────┬─────────┘
                                                 │
                                                 │ WebSocket
                                                 ▼
┌──────────────────────────────────────────────────────────┐
│                    Agent System (agent/)                  │
├──────────────────┬───────────────────┬───────────────────┤
│  Sync Service    │   CLI (rsbot)     │  Claude Agent     │
│  (sync.ts)       │   (cli.ts)        │  (rsbot-agent.ts) │
│                  │                   │                   │
│ - WS connection  │ - rsbot state     │ - Agent SDK       │
│ - Write state    │ - rsbot action    │ - Bash tools      │
│   to files       │ - rsbot wait      │ - Goal-driven     │
│ - Execute        │                   │                   │
│   actions        │                   │                   │
└────────┬─────────┴─────────┬─────────┴───────────────────┘
         │                   │
         │     File I/O      │
         ▼                   ▼
┌──────────────────────────────────────┐
│         State Files                  │
│       (agent-state/)                 │
│                                      │
│  world.md, player.json, npcs.json,  │
│  inventory.json, actions.json, etc.  │
└──────────────────────────────────────┘
```

---

## Commands

### Root Level

| Command | Description |
|---------|-------------|
| `./start.sh` | Interactive menu (Linux/macOS) |
| `start.bat` | Interactive menu (Windows) |
| `bun run start.ts` | Run interactive menu directly |

The interactive menu provides options to:
- Start the game server
- Update all subprojects
- Run web or Java client
- Build clients
- Change game version (225, 244, 245.2, 254)

### Engine (`cd engine`)

| Command | Description |
|---------|-------------|
| `bun start` | Install deps and start server |
| `bun run dev` | Start with hot-reload (watch mode) |
| `bun run quickstart` | Start without installing deps |
| `bun run build` | Pack game content |
| `bun run clean` | Clean build artifacts |
| `bun run setup` | Configure server environment |
| `bun run lint` | Run ESLint |

**Database commands:**
| Command | Description |
|---------|-------------|
| `bun run sqlite:migrate` | Apply SQLite migrations |
| `bun run sqlite:reset` | Reset SQLite database |
| `bun run db:migrate` | Apply MySQL migrations |
| `bun run db:reset` | Reset MySQL database |

### WebClient (`cd webclient`)

| Command | Description |
|---------|-------------|
| `bun run build` | Build client bundles (standard + bot) |
| `bun run build:dev` | Build in development mode |

After building, copy to engine:
```sh
cp out/standard/client.js ../engine/public/client/
cp out/bot/client.js ../engine/public/bot/
```

### Agent (`cd agent`)

| Command | Description |
|---------|-------------|
| `bun run sync` | Start sync service (game state → files) |
| `bun run sync:dev` | Sync service with hot-reload |
| `bun run cli` | Run rsbot CLI |
| `./rsbot state` | View current game state |
| `./rsbot action <cmd>` | Queue an action |
| `./rsbot wait` | Wait for action completion |
| `bun run rsbot-agent` | Run Claude Agent |
| `bun run controller` | Run agent controller |
| `bun run login` | Automated login helper |

### Java Client (`cd javaclient`)

| Command | Description |
|---------|-------------|
| `./gradlew build` | Build the Java client |
| `./gradlew run --args="10 0 highmem members 32"` | Run the Java client |

---

## Workflow

**Use the start script provided** - it handles a lot of common use cases. We're trying to reduce the barrier to entry by providing an all-inclusive script.

### Content Development
```sh
cd engine && bun start
# Server watches for script/config changes and auto-repacks
```

### Engine Development
```sh
cd engine && bun run dev
# Server restarts on .ts file changes
```

### Bot Development
```sh
# Terminal 1: Start server
cd engine && bun start

# Terminal 2: Start sync service
cd agent && bun run sync

# Terminal 3: Use CLI or run agent
cd agent && ./rsbot state
cd agent && bun run rsbot-agent
```

---



## License
This project is licensed under the [MIT License](https://opensource.org/licenses/MIT). See the [LICENSE](LICENSE) file for details.
