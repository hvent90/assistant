# Conversation Agent

Responds to user messages (Discord) and heartbeat thoughts. Drains the signal queue, builds context from history + new signals, spawns an LLM agent run, streams output to Discord, and persists the exchange.

## Public API

- `startConversationAgent(opts)` — Wires up the signal queue listener and returns `{ runOnce }`. Automatically re-checks the queue after each run completes.
- `spawnConversationRun(opts, signals)` — Single run: build context, spawn agent, stream to Discord, persist.
- `ConversationRunOpts` — Config type: `queue`, `discord`, `statusBoard`, `model`, `memoriesDir`

## Dependencies

- `context/` — `buildSystemPrompt`, `readMemoryFiles`, `nodesToMessages`, `collectAgentOutput`
- `db/` — session management (`ensureCurrentSession`, `getSessionMessages`, `appendMessage`)
- `discord/` — `DiscordChannel` for streaming responses
- `tools/` — `readTool`, `writeTool`, `createScheduleTool`
- `llm-gateway` — orchestrator, harness, skills

## Notes

- Signals of type `heartbeat` become assistant-role messages in history; user signals become user-role.
- The run loop is re-entrant safe: single-threaded event loop guarantees no concurrent `runOnce()` calls (see `index.ts:19` comment).
- Discord envelope metadata is injected as an ephemeral system message (not persisted to history).
