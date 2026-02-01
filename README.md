# Assistant

Background AI assistant that runs autonomously, responds to user messages via Discord DMs, performs proactive work via a periodic heartbeat, and persists state across ephemeral agent runs.

## Prerequisites

- [Bun](https://bun.sh)
- PostgreSQL (port 5434)
- A Discord bot with **Message Content Intent** enabled
- A [Zen](https://opencode.ai) API key

## Setup

```bash
bun install
```

Copy `.env.example` to `.env` and fill in your credentials:

```
DISCORD_BOT_TOKEN=       # from Discord Developer Portal
DISCORD_ALLOWED_USERNAME # Discord username allowed to DM the bot (unset = open)
ZEN_API_KEY=             # OpenCode Zen API key
DATABASE_URL=            # defaults to postgres://assistant:assistant@localhost:5434/assistant
DEFAULT_MODEL=           # defaults to glm-4.7
HEARTBEAT_INTERVAL_MS=   # defaults to 1800000 (30 min)
```

Initialize the database:

```bash
psql $DATABASE_URL -f infra/init.sql
```

## Running

```bash
bun run dev          # start with --watch
bun run start        # start without watch
bun run pm2:start    # start via pm2 (background)
bun run pm2:logs     # tail pm2 logs
```

## Architecture

Two agents share one identity, one message history, and one status board:

- **Conversation agent** — reacts to inbound signals (Discord DMs). Messages queue up while the agent is busy; the entire queue drains into a single turn when it's ready.
- **Heartbeat agent** — fires on a timer, reflects on recent activity, and messages the user proactively if there's something worth saying.

Both agents use [llm-gateway](https://github.com/hvent90/llm-gateway) for the agentic loop (orchestrator, harness, tools) and OpenCode Zen as the LLM provider.

```
Discord DM -> Signal Queue -> Conversation Agent -> Discord DM
                                    |
                              Shared History (Postgres)
                                    |
Timer ---------> Heartbeat Agent ---+
```
