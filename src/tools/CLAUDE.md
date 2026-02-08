# Tools

LLM-callable tool definitions given to agents at runtime. Each tool conforms to `llm-gateway`'s `ToolDefinition` interface (zod schema + execute function + permission derivation).

## Public API

See `index.ts` for exports:

- `readTool` / `writeTool` — File I/O (static, no dependencies)
- `createSpeakTool(queue)` — Pushes a thought onto the signal queue for the conversation agent to deliver. Used only by the heartbeat agent.
- `createScheduleTool()` — Persists a future agent run to Postgres via `db/`

## Dependencies

- `db/` — `insertScheduledTask` for the schedule tool
- `queue` (SignalQueue) — injected into `createSpeakTool`
- `format-time` — human-readable timestamps in schedule confirmations

## Notes

- `speak` sends a *thought* (context for the conversation agent), not a user-facing message. The conversation agent decides phrasing.
- `schedule` parses natural-language dates via `new Date()` — only ISO-ish formats are reliable.
