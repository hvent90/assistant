# Assistant

Background AI assistant that runs autonomously, responds to user messages via Discord, performs proactive work via a heartbeat, and persists state across ephemeral agent runs. Built on top of llm-gateway's agent harness.

## Tech Stack

| Tool       | Purpose                            |
| ---------- | ---------------------------------- |
| Bun        | Runtime & package manager          |
| discord.js | Discord bot integration (DMs)      |
| llm-gateway| Agent harness, orchestrator, tools  |
| OpenCode Zen | LLM provider (default: minimax-m2.5-free) |
| PostgreSQL | Conversation history, structured data |
| pm2        | Process management                 |

## Setup

Required env vars in `.env` (copy from `.env.example`):

| Variable | Description |
| -------- | ----------- |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `ZEN_API_KEY` | OpenCode Zen API key (used by llm-gateway) |

Postgres on non-standard port **5434**: `postgres://assistant:assistant@localhost:5434/assistant`

```bash
podman compose -f infra/docker-compose.yml up -d   # Start Postgres
bun install && bun test && bun run dev
```

## Development Principles

- TDD with failure loops — write failing test first, then implement
- Tests: quiet success, loud failure. No mocks — use real integrations
- Refactor freely, no backwards compatibility shims or re-export shims
- Ask questions early via AskUserQuestion when requirements are unclear

## Commands

```bash
bun test                         # Run all tests
bun test src/db/__test__/        # Run single module's tests
bun run dev                      # Start with --watch
bun run start                    # Start without watch
bun run pm2:start                # Start all 3 pm2 processes
bun run pm2:logs                 # Tail logs
```

`ecosystem.config.cjs` defines 3 pm2 processes: `assistant`, `viewer-api`, `viewer`. Logs write to `logs/`.

## Architecture

Two agents share one identity and conversation history:
- **Conversation agent** — responds to Discord DMs
- **Heartbeat agent** — periodic proactive background work (diary, reminders, speak tool)

Heartbeat → Conversation flow: heartbeat calls `speak` tool → signal queue → conversation agent delivers on Discord.

Each domain folder has its own CLAUDE.md. Tests live in co-located `__test__/` directories.

## Gotchas

- **Bash tool pitfall:** Never put newlines in the middle of a command — Bash interprets them as command separators. Use single-line commands or `\` for continuation.
- **Web search:** `claude -p "query"` — print-only mode, non-interactive, 30s default. Use `--timeout 60` for complex queries.
- **Voice transcription** requires `ffmpeg` and `whisper-cli` at `/opt/homebrew/bin/`
