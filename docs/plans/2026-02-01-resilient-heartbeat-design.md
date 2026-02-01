# Resilient Heartbeat

## Problem

The heartbeat uses `setInterval` which resets to zero whenever the process restarts (hot reload, crash, pm2 restart). If the interval is 30 minutes and the app restarts at minute 25, the next heartbeat won't fire for another 30 minutes — a 55-minute gap instead of 30.

## Design

Anchor heartbeat timing to the wall clock by persisting the last tick timestamp in Postgres. On startup, compute elapsed time and either fire immediately (if overdue) or wait only the remaining time.

## Changes

### 1. New `kv` table (`infra/init.sql`)

```sql
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
```

Generic key-value store. Heartbeat uses key `heartbeat_last_tick_at` with value `{ "timestamp": <epoch_ms> }`.

### 2. New DB helpers (`src/db.ts`)

- `getKv(key: string): Promise<unknown | null>` — read a key, return `value` or `null`
- `setKv(key: string, value: unknown): Promise<void>` — upsert via `INSERT ... ON CONFLICT`

### 3. Reworked scheduler (`src/heartbeat-agent.ts`)

`startHeartbeatAgent` becomes `async` (returns `Promise<{ tick, stop }>`).

Startup logic:

1. Read `heartbeat_last_tick_at` from DB
2. Compute `elapsed = now - lastTick.timestamp` (if no row exists, treat as `Infinity`)
3. If `elapsed >= intervalMs`: fire immediately, then `setInterval` at full interval
4. If `elapsed < intervalMs`: `setTimeout` for remaining time, then switch to `setInterval`

After each successful tick, write `Date.now()` to `heartbeat_last_tick_at`.

`stop()` uses `clearTimeout`/`clearInterval` on whichever handle is active.

### 4. Await in `main.ts`

Change `startHeartbeatAgent(...)` call to `await startHeartbeatAgent(...)`.

## Files touched

| File | Change |
|------|--------|
| `infra/init.sql` | Add `kv` table |
| `src/db.ts` | Add `getKv`, `setKv` |
| `src/heartbeat-agent.ts` | Async startup, persist-and-resume scheduling |
| `src/main.ts` | `await` the heartbeat start |
