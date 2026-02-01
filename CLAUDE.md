# Assistant

Background AI assistant that runs autonomously, responds to user messages via Discord, performs proactive work via a heartbeat, and persists state across ephemeral agent runs. Built on top of llm-gateway's agent harness.

## Tech Stack

| Tool       | Purpose                          |
| ---------- | -------------------------------- |
| Bun        | Runtime & package manager        |
| discord.js | Discord bot integration          |
| llm-gateway| Agent harness, orchestrator, tools |
| PostgreSQL | Conversation history, structured data |
| pm2        | Process management               |

## Development Principles

- TDD with failure loops - write failing test first, then implement
- Tests must only output on failure (quiet success, loud failure)
- No mocks - use real integrations in tests
- Refactor freely, no backwards compatibility shims
- No re-export shims - when code moves, update all import sites to point to the new location instead of leaving behind proxy re-exports
- Ask questions early - liberally use AskUserQuestion when requirements are unclear or ambiguous

## Project Structure

- `src/` - Core application code
- `infra/` - Docker compose, SQL schemas
- `docs/` - Design docs and implementation plans
- Tests are co-located with source files (e.g., `foo.test.ts` next to `foo.ts`)

## Commands

```bash
bun install
bun run dev              # Start with --watch
bun run start            # Start without watch
bun test                 # Run all tests
bun run pm2:start        # Start via pm2
bun run pm2:logs         # Tail pm2 logs
```

## Infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d   # Start Postgres
```

Postgres runs on port 5434. Connection: `postgres://assistant:assistant@localhost:5434/assistant`
