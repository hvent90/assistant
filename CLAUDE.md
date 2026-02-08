# Assistant

Background AI assistant that runs autonomously, responds to user messages via Discord, performs proactive work via a heartbeat, and persists state across ephemeral agent runs. Built on top of llm-gateway's agent harness.

## Tech Stack

| Tool       | Purpose                            |
| ---------- | ---------------------------------- |
| Bun        | Runtime & package manager          |
| discord.js | Discord bot integration (DMs)      |
| llm-gateway| Agent harness, orchestrator, tools  |
| OpenCode Zen | LLM provider (default: glm-4.7) |
| PostgreSQL | Conversation history, structured data |
| pm2        | Process management                 |

## Setup

Copy `.env.example` to `.env` and fill in required values.

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `DISCORD_BOT_TOKEN` | **yes** | — | Discord bot token |
| `ZEN_API_KEY` | **yes** | — | OpenCode Zen API key (used by llm-gateway) |
| `DISCORD_ALLOWED_USERNAME` | no | — | Restrict bot to one Discord user |
| `DEFAULT_MODEL` | no | `glm-4.7` | LLM model identifier |
| `DATABASE_URL` | no | `postgres://assistant:assistant@localhost:5434/assistant` | Postgres connection string |
| `HEARTBEAT_INTERVAL_MS` | no | `1800000` (30m) | Heartbeat loop interval |
| `TZ` | no | `UTC` | Timezone for `format-time.ts` |
| `WHISPER_MODEL` | no | `/opt/homebrew/share/whisper-cpp/ggml-large-v3-turbo.bin` | whisper.cpp model path for voice transcription |
| `VIEWER_BASE_URL` | no | — | Base URL for heartbeat viewer links in Discord messages |
| `VIEWER_PORT` | no | `5100` | Viewer API server port |
| `VITE_PORT` | no | `5101` | Viewer Vite dev server port |
| `VITE_BACKEND_URL` | no | `http://localhost:5100` | Viewer API URL for Vite proxy |

First-run workflow:

```bash
cp .env.example .env                              # Fill in DISCORD_BOT_TOKEN, ZEN_API_KEY
podman compose -f infra/docker-compose.yml up -d   # Start Postgres
bun install
bun test
bun run dev
```

## Development Principles

- TDD with failure loops — write failing test first, then implement
- Tests: quiet success, loud failure. No mocks — use real integrations
- Refactor freely, no backwards compatibility shims or re-export shims
- Ask questions early via AskUserQuestion when requirements are unclear

## Module Map

- `src/discord/` — Discord bot, message rendering, voice transcription
- `src/db/` — PostgreSQL data access layer
- `src/scheduling/` — Scheduled task polling and execution
- `src/tools/` — LLM tool definitions (read/write files, schedule, speak)
- `src/context/` — System prompt building, memory, projections
- `src/agents/conversation/` — Conversation agent (responds to Discord DMs)
- `src/agents/heartbeat/` — Heartbeat agent (proactive background work)
- `clients/heartbeat-viewer/` — Web UI for heartbeat data (Vite + API server)
- `infra/` — Docker compose, SQL schemas

### Shared Primitives (`src/` root)

- `types.ts` — Core types: `Signal` (message/heartbeat events), `AgentStatus`, `StatusBoard`, `StatusBoardInstance`
- `queue.ts` — `createSignalQueue()` — in-memory push/drain buffer with listener callback; routes signals between Discord and agents
- `status-board.ts` — `createStatusBoard()` — tracks conversation/heartbeat agent status (idle/running), persists to DB via `setKv`
- `format-time.ts` — `formatLocalTime()` — locale-aware date formatting using `TZ` env var

Each domain folder has its own CLAUDE.md with detailed context. Tests live in co-located `__test__/` directories.

## Startup Flow

`src/main.ts` init sequence:

1. Init DB connection, verify with ping
2. Ensure `memories/diary/` directory exists
3. Create shared primitives (signal queue, status board)
4. Start Discord bot (listens for DMs, pushes signals to queue)
5. Start conversation agent (drains queue, spawns LLM runs)
6. Start heartbeat agent (periodic proactive runs)
7. Start scheduler (polls for scheduled tasks, triggers heartbeat runs)
8. Register SIGINT/SIGTERM handlers (stops heartbeat, scheduler, discord, DB)

## Commands

### Development

```bash
bun test                 # Run all tests
bun run dev              # Start with --watch
bun run start            # Start without watch
```

### Production (pm2)

```bash
bun run pm2:start        # Start all 3 processes
bun run pm2:stop         # Stop all
bun run pm2:restart      # Restart all
bun run pm2:logs         # Tail logs
bun run pm2:status       # Process status table
```

### Heartbeat Viewer

```bash
bun run viewer:dev       # Vite dev server (port 5101)
bun run viewer:build     # Production build
bun run viewer:serve     # API server (port 5100)
```

## Process Management

`ecosystem.config.cjs` defines 3 pm2 processes: `assistant`, `viewer-api`, `viewer`. All logs write to `logs/` directory.

## Infrastructure

Postgres on port 5434. Connection: `postgres://assistant:assistant@localhost:5434/assistant`. See `infra/CLAUDE.md` for details.

```bash
podman compose -f infra/docker-compose.yml up -d   # Start Postgres
```

## Bash Tool Pitfalls

Never put newlines in the middle of a command — Bash interprets them as command separators. Use single-line commands or `\` for continuation.

## Web Search via Claude CLI

`claude -p "query"` — print-only mode, non-interactive, 30s default. Use `--timeout 60` for complex queries.
