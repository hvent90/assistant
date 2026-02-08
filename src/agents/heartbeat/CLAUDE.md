# Heartbeat Agent

Periodic background agent. Checks reminders, reads memory files, writes diary entries, and communicates with the user via the `speak` tool.

## Key Concepts

- Last tick timestamp persisted to Postgres KV (`heartbeat_last_tick_at`) so restarts don't skip or double-fire.
- `computeStartDelay` calculates initial delay from last persisted tick — ensures consistent intervals across restarts.
- The heartbeat prompt instructs the agent to `ls` the memories dir and act on due reminders — skipping this check is treated as a failure.
- When `addendum` is provided to `spawnHeartbeatRun`, the run executes a scheduled task instead of a regular heartbeat.

## Testing

`bun test src/agents/heartbeat/__test__/`
