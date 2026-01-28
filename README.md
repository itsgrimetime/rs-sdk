<div align="center">
    <h1>RS-SDK</h1>
</div>

rs-sdk is a typescript library for connecting to and driving bots on a research-oriented implimentation of economic role-playing mmo environment.

> [!NOTE]
> RS-SDK is a fork and extension of the base LostCity engine and client. LostCity is an amazing project without which this would not be possible. 
> Find their original code here or read their history and ethos on their forum: https://lostcity.rs/t/faq-what-is-lost-city/16


## Getting Started

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
│   └── bot/       # Bot-specific modules (BotSDK)
├── out/           # Built client bundles
│   ├── standard/  # Standard client output
│   └── bot/       # Bot client output
└── 3rdparty/      # Third-party dependencies
```

### Gateway (`gateway/`)

WebSocket relay service connecting browser game clients to SDK automation scripts.

```
gateway/
├── gateway.ts         # WebSocket router for bot ↔ SDK communication
├── types.ts           # Gateway message protocol types
├── run-recorder.ts    # Run logging and screenshots
└── agent-state/       # Live state files per bot
```


---

## System Architecture

```
┌──────────────────┐                    ┌──────────────────┐
│   Game Engine    │◄──── TCP/WS ─────► │   Bot Client     │
│  (engine/)       │                    │  (webclient/)    │
│  :8888           │                    │                  │
│ - Game server    │                    │ - Browser-based  │
│ - World state    │                    │ - Renders game   │
│ - Player logic   │                    │ - Bot SDK        │
└──────────────────┘                    └────────┬─────────┘
                                                 │
                                                 │ WebSocket
                                                 ▼
┌──────────────────────────────────────────────────────────┐
│                    Gateway (gateway/gateway.ts)          │
│                           :7780                          │
├──────────────────────────────────────────────────────────┤
│  SyncModule              │  ControllerModule             │
│  - Bot ↔ SDK routing     │  - UI connections             │
│  - State sync            │  - Agent lifecycle            │
│  - Action relay          │  - Start/stop/logs            │
└────────────────────────────────────────────────────────┬─┘

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
| `bun run gateway` | Start gateway (unified sync + controller) |
| `bun run gateway:dev` | Gateway with hot-reload |
| `bun run agent` | Start Claude Agent service |
| `bun run agent:dev` | Agent service with hot-reload |
| `bun run cli` | Run agent CLI |
| `bun cli.ts launch <bot> "goal"` | Launch browser + start agent |
| `bun cli.ts status` | View connected bots |
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

# Terminal 2: Start gateway + agent
cd agent && bun run gateway:dev
cd agent && bun run agent:dev

# Terminal 3: Use CLI
cd agent && bun cli.ts launch mybot "chop trees"
cd agent && bun cli.ts status
```

---

## Gameplay Modifications

This server has a few modifications from the original game to make development and bot testing easier:

- **Faster leveling** - The XP curve is flattened and sped up so high-level skills don't take as long to train
- **Infinite run energy** - Players never run out of energy (enabled by default, can be toggled off)
- **No random events** - Anti-bot random events can be disabled via config

---

## Disclaimer

This is a free, open-source, community-run project.

The goal is strictly education and scientific research.

LostCity Server was written from scratch after many hours of research and peer review. Everything you see is completely and transparently open source.

We have not been endorsed by, authorized by, or officially communicated with Jagex Ltd. on our efforts here.

You cannot play Old School RuneScape here, buy RuneScape gold, or access any of the official game's services!

---

## License
This project is licensed under the [MIT License](https://opensource.org/licenses/MIT). See the [LICENSE](LICENSE) file for details.
