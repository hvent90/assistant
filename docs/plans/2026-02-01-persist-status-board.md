# Persist Status Board to Postgres Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist the status board to Postgres via the KV table so agent status is queryable by external tools and survives process lifecycle.

**Architecture:** Write-through pattern — `update()` writes to both in-memory state and the `kv` table. `get()` reads from memory for speed. On startup, initialize to idle and write to DB. Store the full `StatusBoard` object under KV key `"status_board"`.

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

beforeAll(() => {
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

Add to `src/db.ts` before the `shutdown` function:

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

### Task 3: Persist status board via KV table

**Files:**
- Modify: `src/types.ts`
- Modify: `src/status-board.ts`
- Modify: `src/status-board.test.ts`
- Modify: `src/conversation-agent.ts`
- Modify: `src/heartbeat-agent.ts`
- Modify: `src/main.ts`

**Step 1: Update status board tests for async + persistence**

Replace `src/status-board.test.ts` with:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { createStatusBoard } from "./status-board"
import { initDb, shutdown, getKv } from "./db"

const TEST_DB = "postgres://assistant:assistant@localhost:5434/assistant"
const STATUS_BOARD_KEY = "status_board"

beforeAll(() => {
  initDb(TEST_DB)
})

afterAll(async () => {
  await shutdown()
})

describe("StatusBoard", () => {
  test("starts with both agents idle", async () => {
    const board = await createStatusBoard()
    expect(board.get()).toEqual({
      conversation: { status: "idle", detail: null },
      heartbeat: { status: "idle", detail: null },
    })
  })

  test("update sets agent status", async () => {
    const board = await createStatusBoard()
    await board.update("heartbeat", { status: "running", detail: "writing a recipe" })
    expect(board.get().heartbeat).toEqual({ status: "running", detail: "writing a recipe" })
    expect(board.get().conversation).toEqual({ status: "idle", detail: null })
  })

  test("update persists to database", async () => {
    const board = await createStatusBoard()
    await board.update("conversation", { status: "running", detail: "responding" })
    const stored = (await getKv(STATUS_BOARD_KEY)) as Record<string, unknown>
    expect(stored.conversation).toEqual({ status: "running", detail: "responding" })
  })

  test("format returns human-readable string", async () => {
    const board = await createStatusBoard()
    await board.update("heartbeat", { status: "running", detail: "writing a recipe" })
    const text = board.format()
    expect(text).toContain("conversation: idle")
    expect(text).toContain("heartbeat: running — writing a recipe")
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/status-board.test.ts`

Expected: FAIL — `createStatusBoard` is synchronous, `update` is synchronous

**Step 3: Add `StatusBoardInstance` type**

Append to end of `src/types.ts`:

```typescript
export type StatusBoardInstance = {
  get(): StatusBoard
  update(agent: keyof StatusBoard, status: AgentStatus): Promise<void>
  format(): string
}
```

**Step 4: Implement persistent status board**

Replace `src/status-board.ts` with:

```typescript
import { setKv } from "./db"
import type { AgentStatus, StatusBoard, StatusBoardInstance } from "./types"

const STATUS_BOARD_KEY = "status_board"

export async function createStatusBoard(): Promise<StatusBoardInstance> {
  const state: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }

  await setKv(STATUS_BOARD_KEY, state)

  return {
    get(): StatusBoard {
      return {
        conversation: { ...state.conversation },
        heartbeat: { ...state.heartbeat },
      }
    },
    async update(agent: keyof StatusBoard, status: AgentStatus) {
      state[agent] = status
      await setKv(STATUS_BOARD_KEY, state)
    },
    format(): string {
      const lines: string[] = []
      for (const [name, s] of Object.entries(state)) {
        const detail = s.detail ? ` — ${s.detail}` : ""
        lines.push(`${name}: ${s.status}${detail}`)
      }
      return lines.join("\n")
    },
  }
}
```

**Step 5: Run status board tests to verify they pass**

Run: `bun test src/status-board.test.ts`

Expected: 4 passing tests

**Step 6: Update conversation agent types**

In `src/conversation-agent.ts`:

Replace import:
```typescript
import type { createStatusBoard } from "./status-board"
```
with:
```typescript
import type { StatusBoardInstance } from "./types"
```

Replace in `ConversationAgentOpts`:
```typescript
  statusBoard: ReturnType<typeof createStatusBoard>
```
with:
```typescript
  statusBoard: StatusBoardInstance
```

Add `await` to both `statusBoard.update()` calls:
- Line 28: `await statusBoard.update("conversation", { status: "running", detail: "responding to user" })`
- Line 97: `await statusBoard.update("conversation", { status: "idle", detail: null })`

**Step 7: Update heartbeat agent types**

In `src/heartbeat-agent.ts`:

Replace import:
```typescript
import type { createStatusBoard } from "./status-board"
```
with:
```typescript
import type { StatusBoardInstance } from "./types"
```

Replace in `HeartbeatAgentOpts`:
```typescript
  statusBoard: ReturnType<typeof createStatusBoard>
```
with:
```typescript
  statusBoard: StatusBoardInstance
```

Add `await` to both `statusBoard.update()` calls:
- Line 27: `await statusBoard.update("heartbeat", { status: "running", detail: "reflecting on recent activity" })`
- Line 87: `await statusBoard.update("heartbeat", { status: "idle", detail: null })`

**Step 8: Update `main.ts` to await status board creation**

In `src/main.ts`, change:
```typescript
  const statusBoard = createStatusBoard()
```
to:
```typescript
  const statusBoard = await createStatusBoard()
```

**Step 9: Run all tests**

Run: `bun test`

Expected: All tests pass

**Step 10: Commit**

```bash
git add src/status-board.ts src/status-board.test.ts src/types.ts src/conversation-agent.ts src/heartbeat-agent.ts src/main.ts
git commit -m "feat: persist status board to Postgres via kv table"
```
