# Resilient Heartbeat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the heartbeat timer survive app restarts by persisting last-tick timestamp to Postgres and computing remaining time on startup.

**Architecture:** Store last-tick in a generic `kv` table. On startup, read it, compute elapsed time, fire immediately if overdue or `setTimeout` for the remainder. After each tick, persist the new timestamp.

**Tech Stack:** Bun, pg (Postgres), bun:test

---

### Task 1: Add `kv` table to init.sql

**Files:**
- Modify: `infra/init.sql`

**Step 1: Add the table definition**

Append to end of `infra/init.sql`:

```sql
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
```

**Step 2: Apply migration to running Postgres**

Run: `docker exec -i $(docker ps -q -f name=postgres) psql -U assistant -d assistant -c "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL);"`

Expected: `CREATE TABLE`

**Step 3: Commit**

```bash
git add infra/init.sql
git commit -m "feat: add kv table for persistent state"
```

---

### Task 2: Add `getKv` and `setKv` DB helpers with tests

**Files:**
- Create: `src/db.test.ts`
- Modify: `src/db.ts`

**Step 1: Write the failing tests**

Create `src/db.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { initDb, shutdown, getKv, setKv } from "./db"

const TEST_DB = "postgres://assistant:assistant@localhost:5434/assistant"

beforeAll(async () => {
  initDb(TEST_DB)
})

afterAll(async () => {
  await shutdown()
})

describe("kv", () => {
  test("getKv returns null for missing key", async () => {
    const result = await getKv("nonexistent_key_" + Date.now())
    expect(result).toBeNull()
  })

  test("setKv inserts and getKv retrieves", async () => {
    const key = "test_key_" + Date.now()
    await setKv(key, { hello: "world" })
    const result = await getKv(key)
    expect(result).toEqual({ hello: "world" })
  })

  test("setKv upserts existing key", async () => {
    const key = "test_upsert_" + Date.now()
    await setKv(key, { v: 1 })
    await setKv(key, { v: 2 })
    const result = await getKv(key)
    expect(result).toEqual({ v: 2 })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/db.test.ts`

Expected: FAIL — `getKv` and `setKv` are not exported from `./db`

**Step 3: Implement `getKv` and `setKv`**

Add to end of `src/db.ts` (before the `shutdown` function):

```typescript
export async function getKv(key: string): Promise<unknown | null> {
  const result = await getPool().query("SELECT value FROM kv WHERE key = $1", [key])
  return result.rows[0]?.value ?? null
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await getPool().query(
    "INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [key, JSON.stringify(value)]
  )
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/db.test.ts`

Expected: 3 passing tests

**Step 5: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: add getKv/setKv helpers for persistent state"
```

---

### Task 3: Rework heartbeat scheduler with tests

**Files:**
- Create: `src/heartbeat-agent.test.ts`
- Modify: `src/heartbeat-agent.ts`

The heartbeat agent's `tick()` calls LLM APIs and Discord — we can't run those in tests. Instead, we extract and test the **scheduling logic** as a pure function, then wire it into the existing heartbeat agent.

**Step 1: Write the failing test for scheduling logic**

Create `src/heartbeat-agent.test.ts`:

```typescript
import { describe, test, expect } from "bun:test"
import { computeStartDelay } from "./heartbeat-agent"

describe("computeStartDelay", () => {
  const intervalMs = 1800000 // 30 min

  test("returns 0 when no previous tick (first run)", () => {
    expect(computeStartDelay(null, intervalMs)).toBe(0)
  })

  test("returns 0 when overdue", () => {
    const lastTick = Date.now() - intervalMs - 1000 // 1s overdue
    expect(computeStartDelay(lastTick, intervalMs)).toBe(0)
  })

  test("returns remaining time when not yet due", () => {
    const elapsed = 10000 // 10s ago
    const lastTick = Date.now() - elapsed
    const delay = computeStartDelay(lastTick, intervalMs)
    // Should be approximately intervalMs - elapsed (within 50ms tolerance for test execution)
    expect(delay).toBeGreaterThan(intervalMs - elapsed - 50)
    expect(delay).toBeLessThanOrEqual(intervalMs - elapsed)
  })

  test("returns 0 when exactly at interval", () => {
    const lastTick = Date.now() - intervalMs
    expect(computeStartDelay(lastTick, intervalMs)).toBe(0)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/heartbeat-agent.test.ts`

Expected: FAIL — `computeStartDelay` is not exported

**Step 3: Add `computeStartDelay` to heartbeat-agent.ts**

Add this exported function near the top of `src/heartbeat-agent.ts` (after imports, before the type):

```typescript
export function computeStartDelay(lastTickMs: number | null, intervalMs: number): number {
  if (lastTickMs === null) return 0
  const elapsed = Date.now() - lastTickMs
  if (elapsed >= intervalMs) return 0
  return intervalMs - elapsed
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/heartbeat-agent.test.ts`

Expected: 4 passing tests

**Step 5: Commit**

```bash
git add src/heartbeat-agent.ts src/heartbeat-agent.test.ts
git commit -m "feat: add computeStartDelay for resilient heartbeat scheduling"
```

---

### Task 4: Wire scheduling logic into heartbeat agent

**Files:**
- Modify: `src/heartbeat-agent.ts`

**Step 1: Update `startHeartbeatAgent` to be async and use persisted timing**

Replace the entire `startHeartbeatAgent` function in `src/heartbeat-agent.ts`. The key changes:

1. Import `getKv` and `setKv` from `./db`
2. Make function `async`
3. Wrap tick to persist timestamp after each successful run
4. On startup: read last tick from DB, compute delay, schedule accordingly
5. Handle both `setTimeout` and `setInterval` in `stop()`

Updated imports (replace existing import line from `./db`):

```typescript
import { appendMessage, getRecentMessages, getKv, setKv } from "./db"
```

Updated constant for the KV key:

```typescript
const LAST_TICK_KEY = "heartbeat_last_tick_at"
```

Replace `startHeartbeatAgent` function body:

```typescript
export async function startHeartbeatAgent(opts: HeartbeatAgentOpts) {
  const { discord, statusBoard, model, intervalMs } = opts
  let running = false
  let timerId: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>

  async function tick() {
    if (running) return
    running = true
    statusBoard.update("heartbeat", { status: "running", detail: "reflecting on recent activity" })

    try {
      const signal: Signal = {
        type: "heartbeat",
        source: "cron",
        content: null,
        timestamp: Date.now(),
      }

      const history = await getRecentMessages(50)
      const messages = buildContext({ signals: [signal], history, statusBoard: statusBoard.get() })

      const providerHarness = createGeneratorHarness()
      const agentHarness = createAgentHarness({ harness: providerHarness })
      const orchestrator = new AgentOrchestrator(agentHarness)

      orchestrator.spawn({
        model,
        messages,
        tools: [bashTool],
        permissions: {
          allowlist: [{ tool: "bash", params: { command: "**" } }],
        },
      })

      let fullText = ""
      for await (const { event } of orchestrator.events()) {
        if (event.type === "text") {
          fullText += event.content
        }
        if (event.type === "error") {
          console.error("heartbeat agent error:", event.error)
        }
      }

      if (fullText && !fullText.toLowerCase().includes("[no action needed]")) {
        try {
          const dmId = discord.dmChannelId()
          await discord.send(dmId, fullText)
        } catch {
          // No DM channel yet — user hasn't messaged the bot. Skip sending.
        }
      }

      if (fullText) {
        const content: ContentBlock[] = [{ type: "text", text: fullText }]
        await appendMessage({
          role: "assistant",
          content,
          source: "heartbeat",
          agent: "heartbeat",
        })
      }

      await setKv(LAST_TICK_KEY, { timestamp: Date.now() })
    } catch (err) {
      console.error("heartbeat agent error:", err)
    } finally {
      running = false
      statusBoard.update("heartbeat", { status: "idle", detail: null })
    }
  }

  // Compute start delay from persisted state
  const stored = await getKv(LAST_TICK_KEY) as { timestamp: number } | null
  const lastTickMs = stored?.timestamp ?? null
  const delay = computeStartDelay(lastTickMs, intervalMs)

  if (delay === 0) {
    tick() // fire immediately (don't await — let it run in background)
    timerId = setInterval(tick, intervalMs)
  } else {
    timerId = setTimeout(() => {
      tick()
      timerId = setInterval(tick, intervalMs)
    }, delay)
  }

  return {
    tick,
    stop() {
      clearTimeout(timerId as ReturnType<typeof setTimeout>)
      clearInterval(timerId as ReturnType<typeof setInterval>)
    },
  }
}
```

**Step 2: Run all tests**

Run: `bun test`

Expected: All tests pass (heartbeat-agent tests don't touch the DB or network — they only test `computeStartDelay`)

**Step 3: Commit**

```bash
git add src/heartbeat-agent.ts
git commit -m "feat: resilient heartbeat — persist last tick, resume on restart"
```

---

### Task 5: Update `main.ts` to await heartbeat startup

**Files:**
- Modify: `src/main.ts`

**Step 1: Add `await` to `startHeartbeatAgent` call**

In `src/main.ts`, change line 45:

```typescript
  const heartbeat = startHeartbeatAgent({
```

to:

```typescript
  const heartbeat = await startHeartbeatAgent({
```

**Step 2: Run all tests to confirm nothing is broken**

Run: `bun test`

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: await async heartbeat startup in main"
```

---

### Task 6: Manual smoke test

**Step 1: Start the app**

Run: `bun run dev`

Expected: App starts, logs show `heartbeat agent ready`. Since no previous tick exists, it fires immediately.

**Step 2: Check kv table has the timestamp**

Run: `docker exec -i $(docker ps -q -f name=postgres) psql -U assistant -d assistant -c "SELECT * FROM kv WHERE key = 'heartbeat_last_tick_at';"`

Expected: Row exists with a recent timestamp.

**Step 3: Restart the app (Ctrl+C, then `bun run dev`)**

Expected: App starts. If less than 30 min since last tick, logs show it's waiting the remaining time (no immediate heartbeat fire). If more than 30 min, it fires immediately.
