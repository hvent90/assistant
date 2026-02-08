# Agents

Two agents share one identity, conversation history, and status board. Both use llm-gateway, `context/`, `db/`, and `tools/`.

## Architecture

- **Conversation agent** (`conversation/`) — Responds to Discord DMs. Drains the signal queue, builds context, spawns LLM run, streams to Discord.
- **Heartbeat agent** (`heartbeat/`) — Periodic background runs. Checks reminders, reads memory files, writes diary entries. Communicates with user via `speak` tool.

## Inter-Agent Communication

Heartbeat → Conversation flow: heartbeat calls `speak` tool → pushes signal to `SignalQueue` (`src/queue.ts`) → conversation agent drains it and responds on Discord.

Both agents' status (idle/running) is tracked on the shared `StatusBoard` (`src/status-board.ts`), persisted to Postgres KV.

## Key Differences

| | Conversation | Heartbeat |
|---|---|---|
| Trigger | Signal queue (user message or speak) | Interval timer (default 30m) |
| Output | Discord stream | Memory files, speak signals |
| Extra dep | `discord/` | `createSpeakTool` |
| Sessions | Reuses current session | Creates new session per run |
