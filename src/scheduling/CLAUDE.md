# Scheduling Module

Polls the `scheduled_tasks` table for due tasks and executes them. Used for deferred/recurring prompts (e.g., reminders, scheduled check-ins).

## Public API

See `index.ts` — exports `pollOnce` and `startScheduler`.

## Key Concepts

- `startScheduler({ onTask })` fires immediately to catch up on missed tasks, then polls every 60 seconds.
- `pollOnce` fetches all pending/retriable tasks due now and runs them in parallel via the provided `onTask` callback.
- Tasks use a retry mechanism: failed tasks with `attempts < max_attempts` are re-polled automatically.
- The `onTask` callback receives a `ScheduledTask` and must return a session ID on success.

## Dependencies

- **Depends on:** `db` (task queries, KV for last-poll timestamp)
- **Used by:** `src/main.ts`
- **Related:** `src/tools/tools.ts` inserts tasks via `db.insertScheduledTask`
