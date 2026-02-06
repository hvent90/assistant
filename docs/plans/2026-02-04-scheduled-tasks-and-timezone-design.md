# Scheduled Tasks & Timezone Design

## Problem

1. Agents can only reach out to the user on 30-minute heartbeat intervals. There's no way to schedule a precise future action (e.g., "remind user at 3 PM").
2. All datetime formatting is UTC. The user is in San Francisco (Pacific time) but sees UTC everywhere.

## Design

### Scheduled Tasks Table

New Postgres table for one-shot scheduled agent spawns:

```sql
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id SERIAL PRIMARY KEY,
  fire_at TIMESTAMPTZ NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_tasks_pending ON scheduled_tasks(fire_at)
  WHERE status IN ('pending', 'failed');
```

- `prompt` is free-form text describing what the spawned agent should do
- `status` tracks lifecycle: pending → running → completed/failed
- Failed tasks retry up to `max_attempts`, with `last_error` for diagnostics

### Schedule Tool

New `scheduleTool` available to both conversation and heartbeat agents:

- Input: `{ at: string, prompt: string }`
- Parses `at` using process `TZ` for local time interpretation
- Inserts row into `scheduled_tasks`
- Returns confirmation with local-formatted time

### Scheduler Loop

New `src/scheduler.ts` — infrastructure that polls for due tasks and spawns agents:

- Polls every 60 seconds
- Query: `fire_at <= now AND (status = 'pending' OR (status = 'failed' AND attempts < max_attempts))`
- Each due task spawns a heartbeat agent run **concurrently** (fire-and-forget with error handling)
- Per-task lifecycle:
  - Set status to `running`, increment `attempts`
  - Spawn `spawnHeartbeatRun(task.prompt)`
  - On success: set status to `completed`
  - On error: set status to `failed`, record `last_error`
- Startup resilience: persists `scheduler_last_poll_at` to `kv` table, catches up on missed tasks after restart
- Graceful shutdown alongside heartbeat and Discord client

### Heartbeat & Scheduler Independence

The scheduler and heartbeat timer are independent. They don't coordinate timers. If both fire close together, the heartbeat agent checks the status board to see recent activity and avoids duplicate work. The status board is informational, not a mutex — concurrent runs are allowed.

### Timezone Configuration

Set `TZ=America/Los_Angeles` in `.env`. Bun respects this process-wide.

Changes:
- New `formatLocalTime(date: Date): string` helper using `Intl.DateTimeFormat` — produces e.g. `"Feb 4, 2026 3:15 PM PST"`
- `context.ts`: current time and conversation history timestamps use `formatLocalTime()`
- Heartbeat context "Current time" line uses `formatLocalTime()`
- `scheduleTool` parses and confirms times in local timezone
- No date libraries — `Intl.DateTimeFormat` handles everything

### Agent Directory Structure

Refactor from flat `src/` files to standardized agent directories:

```
src/agents/
  heartbeat/
    index.ts        # startHeartbeatAgent() — 30-min timer lifecycle
    run.ts          # spawnHeartbeatRun(addendum?) — orchestrator + spawn
    context.ts      # buildHeartbeatContext(addendum?) — prompt assembly
    __test__/
      run.test.ts
      context.test.ts
  conversation/
    index.ts        # startConversationLoop() — queue drain loop
    run.ts          # spawnConversationRun(signals) — orchestrator + spawn
    context.ts      # buildConversationContext(messages) — prompt assembly
    __test__/
      run.test.ts
      context.test.ts
src/
  scheduler.ts      # polling loop, spawns heartbeat runs for due tasks
  tools.ts          # shared tools (bash, read, write, speak, schedule)
  context.ts        # shared helpers (formatLocalTime, readMemoryFiles, system prompt)
  db.ts             # database layer (+ scheduled_tasks functions)
  queue.ts          # signal queue (unchanged)
  status-board.ts   # status tracking (unchanged)
  __test__/
    scheduler.test.ts
    db.test.ts
    tools.test.ts
    context.test.ts
```

Each agent directory follows the pattern:
- `index.ts` — lifecycle (start/stop, timers, loops)
- `run.ts` — single execution (create orchestrator, spawn, collect, persist)
- `context.ts` — prompt and message assembly

### Heartbeat Refactor

- Remove the `running` concurrency guard — concurrent runs are now intentional
- Extract spawn logic to `src/agents/heartbeat/run.ts`
- `spawnHeartbeatRun(addendum?)` creates its own orchestrator instance per call
- `buildHeartbeatContext(addendum?)` appends addendum as `## Scheduled Task\n\n{addendum}` when present
- Both the heartbeat timer and the scheduler call `spawnHeartbeatRun()`

### Testing

All tests use real Postgres (port 5434), no mocks. Quiet on success, loud on failure.

- `src/agents/heartbeat/__test__/run.test.ts` — spawn with addendum, verify context and execution
- `src/agents/heartbeat/__test__/context.test.ts` — verify prompt with/without addendum
- `src/__test__/scheduler.test.ts` — poll cycle transitions, retry logic, max_attempts exhaustion
- `src/__test__/db.test.ts` — CRUD for scheduled_tasks, query correctness
- `src/__test__/tools.test.ts` — scheduleTool inserts and confirms with local time
- `src/__test__/context.test.ts` — formatLocalTime output with TZ set

## Decisions

- **One-shot only** — no recurring schedules. Agents can schedule the next occurrence during their run.
- **60-second polling** — near-precise without being wasteful.
- **No timer coordination** — heartbeat and scheduler are independent; status board provides awareness.
- **Env var for timezone** — `TZ=America/Los_Angeles`, rarely changes, works process-wide.
- **Reuse heartbeat agent** — scheduled tasks spawn a heartbeat run with addendum, not a new agent type.
