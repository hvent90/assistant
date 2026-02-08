# Conversation Agent

Responds to user messages (Discord) and heartbeat thoughts. Drains the signal queue, builds context from history + new signals, spawns an LLM agent run, streams output to Discord, and persists the exchange.

## Public API

- `startConversationAgent(opts)` — Wires up the signal queue listener and returns `{ runOnce }`. Automatically re-checks the queue after each run completes.
- `ConversationRunOpts` — Config type: `queue`, `discord`, `statusBoard`, `model`, `memoriesDir`

## Key Concepts

- `spawnConversationRun(opts, signals)` — Internal: single run that builds context, spawns agent, streams to Discord, and persists. Called by `startConversationAgent`.
- Signals of type `heartbeat` become assistant-role messages in history; user signals become user-role.
- The run loop is re-entrant safe: single-threaded event loop guarantees no concurrent `runOnce()` calls (see `index.ts:19` comment).
- Discord envelope metadata is injected as an ephemeral system message (not persisted to history).

## Dependencies

- **Depends on:** `context/`, `db/`, `discord/`, `tools/`, `llm-gateway`
- **Used by:** `src/main.ts`
