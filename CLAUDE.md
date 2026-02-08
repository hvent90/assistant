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
- `clients/heartbeat-viewer/` — Web UI for heartbeat data
- `infra/` — Docker compose, SQL schemas
- `src/` root — shared primitives: `types.ts`, `format-time.ts`, `queue.ts`, `status-board.ts`

Each domain folder has its own CLAUDE.md with detailed context. Tests live in co-located `__test__/` directories.

## Commands

```bash
bun test                 # Run all tests
bun run dev              # Start with --watch
bun run start            # Start without watch
bun run pm2:start        # Start via pm2
```

## Infrastructure

```bash
podman compose -f infra/docker-compose.yml up -d   # Start Postgres
```

Postgres on port 5434. Connection: `postgres://assistant:assistant@localhost:5434/assistant`. See `infra/CLAUDE.md` for details.

## Bash Tool Pitfalls

Never put newlines in the middle of a command — Bash interprets them as command separators. Use single-line commands or `\` for continuation.

## Web Search via Claude CLI

`claude -p "query"` — print-only mode, non-interactive, 30s default. Use `--timeout 60` for complex queries.
