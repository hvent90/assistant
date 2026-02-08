# Scheduling Module

Polls the `scheduled_tasks` table for due tasks. Uses polling (not cron) because the heartbeat interval is configurable at runtime.

## Key Concepts

- `startScheduler` fires immediately on startup to catch missed tasks, then polls every 60s.
- Failed tasks with `attempts < max_attempts` are retried automatically on next poll.
- The `onTask` callback is provided by `main.ts` and triggers a heartbeat run with the task as addendum.

## Testing

`bun test src/scheduling/__test__/`
