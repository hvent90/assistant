# Heartbeat Agent

Periodic background agent that checks reminders, reads memory files, and proactively communicates with the user via the `speak` tool. Also handles scheduled task execution.

## Public API

- `startHeartbeatAgent(opts)` — Starts the interval loop, respecting last-tick persistence to avoid duplicate runs after restart. Returns `{ tick, stop }`.
- `spawnHeartbeatRun(opts, addendum?)` — Single run: build context, spawn agent, persist output. When `addendum` is provided, the run executes a scheduled task instead of a regular heartbeat.
- `computeStartDelay(lastTickMs, intervalMs, nowMs?)` — Pure function to calculate initial delay from last persisted tick.

## Dependencies

- **Depends on:** `context/`, `db/`, `tools/`, `queue` (SignalQueue), `llm-gateway`
- **Used by:** `src/main.ts`

## Key Concepts

- Last tick timestamp is persisted to Postgres KV (`heartbeat_last_tick_at`) so restarts don't skip or double-fire.
- The heartbeat prompt instructs the agent to `ls` the memories dir and act on due reminders — skipping this check is treated as a failure.

## Testing

Tests in `__test__/`. Run: `bun test src/agents/heartbeat/__test__/`
