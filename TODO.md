# TODO

## System Architecture

```
┌──────────────────┐                    ┌──────────────────┐
│   Game Engine    │◄──── TCP/WS ─────►│   Bot Client     │
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

### Components

| Component | Path | Purpose |
|-----------|------|---------|
| **Engine** | `engine/` | Game server, handles world state, players, NPCs |
| **WebClient** | `webclient/` | Browser client with BotSDK for automation |
| **Sync Service** | `agent/sync.ts` | Bridges bot client to file-based state |
| **CLI (rsbot)** | `agent/cli.ts` | Read state, queue actions via command line |
| **Agent** | `agent/rsbot-agent.ts` | Claude Agent SDK wrapper |
| **Controller** | `agent/agent-controller.ts` | Manages agent lifecycle |

### Build Flow

```
webclient/src/ ──► bun run build ──► webclient/out/ 
(symlinked to engine/public/client/ and engine/public/bot/)
```

---


