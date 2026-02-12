# Schedule CRUD Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add list, edit, and cancel tools for the internal scheduling system so it has full CRUD.

**Architecture:** Three new DB functions in `src/db/client.ts`, three new tool definitions in `src/tools/tools.ts`, wired into both agents. TDD throughout — write failing test, implement, verify, commit.

**Tech Stack:** Bun, PostgreSQL, Zod (tool schemas), llm-gateway ToolDefinition interface

---

### Task 1: DB function — `listScheduledTasks`

**Files:**
- Test: `src/db/__test__/db-scheduled.test.ts`
- Modify: `src/db/client.ts`
- Modify: `src/db/index.ts`

**Step 1: Write failing tests**

Add to `src/db/__test__/db-scheduled.test.ts`. Update the import line to include `listScheduledTasks`. Add these tests inside the existing `describe` block:

```typescript
test("listScheduledTasks defaults to pending tasks", async () => {
  const fireAt = new Date(Date.now() + 3_600_000)
  await insertScheduledTask(fireAt, `${PREFIX}list-default`)

  const tasks = await listScheduledTasks({})
  const found = tasks.find((t) => t.prompt === `${PREFIX}list-default`)
  expect(found).toBeDefined()
  expect(found!.status).toBe("pending")
})

test("listScheduledTasks filters by status", async () => {
  const fireAt = new Date(Date.now() - 60_000)
  const id = await insertScheduledTask(fireAt, `${PREFIX}list-status`)
  await updateTaskStatus(id, "running")
  await updateTaskStatus(id, "completed")

  const pending = await listScheduledTasks({ status: "pending" })
  expect(pending.find((t) => t.id === id)).toBeUndefined()

  const completed = await listScheduledTasks({ status: "completed" })
  expect(completed.find((t) => t.id === id)).toBeDefined()
})

test("listScheduledTasks filters by date range", async () => {
  const feb15 = new Date("2099-02-15T12:00:00Z")
  const feb20 = new Date("2099-02-20T12:00:00Z")
  await insertScheduledTask(feb15, `${PREFIX}list-range-in`)
  await insertScheduledTask(feb20, `${PREFIX}list-range-out`)

  const tasks = await listScheduledTasks({
    from: new Date("2099-02-14T00:00:00Z"),
    to: new Date("2099-02-16T00:00:00Z"),
  })
  expect(tasks.find((t) => t.prompt === `${PREFIX}list-range-in`)).toBeDefined()
  expect(tasks.find((t) => t.prompt === `${PREFIX}list-range-out`)).toBeUndefined()
})

test("listScheduledTasks returns empty array when nothing matches", async () => {
  const tasks = await listScheduledTasks({ status: "pending", from: new Date("2199-01-01"), to: new Date("2199-01-02") })
  expect(tasks).toEqual([])
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/db/__test__/db-scheduled.test.ts`
Expected: FAIL — `listScheduledTasks` is not exported

**Step 3: Implement `listScheduledTasks`**

Add to `src/db/client.ts` after the `insertScheduledTask` function (after line 94):

```typescript
export async function listScheduledTasks(opts: {
  status?: string
  from?: Date
  to?: Date
}): Promise<ScheduledTask[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  const status = opts.status ?? "pending"
  conditions.push(`status = $${i++}`)
  params.push(status)

  if (opts.from) {
    conditions.push(`fire_at >= $${i++}`)
    params.push(opts.from)
  }
  if (opts.to) {
    conditions.push(`fire_at <= $${i++}`)
    params.push(opts.to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const result = await getPool().query(
    `SELECT * FROM scheduled_tasks ${where} ORDER BY fire_at ASC`,
    params
  )
  return result.rows
}
```

Export it from `src/db/index.ts` — add `listScheduledTasks` to the export list.

**Step 4: Run tests to verify they pass**

Run: `bun test src/db/__test__/db-scheduled.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```
feat(db): add listScheduledTasks with status and date range filters
```

---

### Task 2: DB functions — `updateScheduledTask` and `cancelScheduledTask`

**Files:**
- Test: `src/db/__test__/db-scheduled.test.ts`
- Modify: `src/db/client.ts`
- Modify: `src/db/index.ts`

**Step 1: Write failing tests**

Add to the import line: `updateScheduledTask2` (we'll name it `editScheduledTask` to avoid collision with existing `updateTaskStatus`), `cancelScheduledTask`. Add these tests inside the existing `describe` block:

Actually — the existing function is called `updateTaskStatus`. Our new function should be called `editScheduledTask` to avoid confusion. It updates content fields (fire_at, prompt), not lifecycle status.

```typescript
test("editScheduledTask updates fire_at on pending task", async () => {
  const fireAt = new Date("2099-03-01T12:00:00Z")
  const id = await insertScheduledTask(fireAt, `${PREFIX}edit-time`)

  const newTime = new Date("2099-04-01T12:00:00Z")
  const count = await editScheduledTask(id, { fireAt: newTime })
  expect(count).toBe(1)

  const tasks = await listScheduledTasks({ from: new Date("2099-03-30"), to: new Date("2099-04-02") })
  expect(tasks.find((t) => t.id === id)).toBeDefined()
})

test("editScheduledTask updates prompt on pending task", async () => {
  const fireAt = new Date("2099-03-01T12:00:00Z")
  const id = await insertScheduledTask(fireAt, `${PREFIX}edit-prompt-old`)

  const count = await editScheduledTask(id, { prompt: `${PREFIX}edit-prompt-new` })
  expect(count).toBe(1)

  const tasks = await listScheduledTasks({})
  const found = tasks.find((t) => t.id === id)
  expect(found!.prompt).toBe(`${PREFIX}edit-prompt-new`)
})

test("editScheduledTask returns 0 for non-pending task", async () => {
  const fireAt = new Date(Date.now() - 60_000)
  const id = await insertScheduledTask(fireAt, `${PREFIX}edit-running`)
  await updateTaskStatus(id, "running")

  const count = await editScheduledTask(id, { prompt: `${PREFIX}nope` })
  expect(count).toBe(0)
})

test("editScheduledTask returns 0 for nonexistent task", async () => {
  const count = await editScheduledTask(999999, { prompt: `${PREFIX}nope` })
  expect(count).toBe(0)
})

test("cancelScheduledTask cancels a pending task", async () => {
  const fireAt = new Date("2099-03-01T12:00:00Z")
  const id = await insertScheduledTask(fireAt, `${PREFIX}cancel-me`)

  const count = await cancelScheduledTask(id)
  expect(count).toBe(1)

  const tasks = await listScheduledTasks({ status: "cancelled" })
  expect(tasks.find((t) => t.id === id)).toBeDefined()
})

test("cancelScheduledTask returns 0 for non-pending task", async () => {
  const fireAt = new Date(Date.now() - 60_000)
  const id = await insertScheduledTask(fireAt, `${PREFIX}cancel-running`)
  await updateTaskStatus(id, "running")

  const count = await cancelScheduledTask(id)
  expect(count).toBe(0)
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/db/__test__/db-scheduled.test.ts`
Expected: FAIL — `editScheduledTask` and `cancelScheduledTask` not exported

**Step 3: Implement both functions**

Add to `src/db/client.ts` after `listScheduledTasks`:

```typescript
export async function editScheduledTask(
  id: number,
  updates: { fireAt?: Date; prompt?: string }
): Promise<number> {
  const sets: string[] = []
  const params: unknown[] = []
  let i = 1

  if (updates.fireAt) {
    sets.push(`fire_at = $${i++}`)
    params.push(updates.fireAt)
  }
  if (updates.prompt) {
    sets.push(`prompt = $${i++}`)
    params.push(updates.prompt)
  }
  if (sets.length === 0) return 0

  params.push(id)
  const result = await getPool().query(
    `UPDATE scheduled_tasks SET ${sets.join(", ")} WHERE id = $${i} AND status = 'pending'`,
    params
  )
  return result.rowCount ?? 0
}

export async function cancelScheduledTask(id: number): Promise<number> {
  const result = await getPool().query(
    "UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = $1 AND status = 'pending'",
    [id]
  )
  return result.rowCount ?? 0
}
```

Export both from `src/db/index.ts`.

**Step 4: Run tests to verify they pass**

Run: `bun test src/db/__test__/db-scheduled.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```
feat(db): add editScheduledTask and cancelScheduledTask
```

---

### Task 3: Tool definitions — `schedule_list`, `schedule_edit`, `schedule_cancel`

**Files:**
- Test: `src/scheduling/__test__/schedule-crud-tools.test.ts` (new)
- Modify: `src/tools/tools.ts`
- Modify: `src/tools/index.ts`

**Step 1: Write failing tests**

Create `src/scheduling/__test__/schedule-crud-tools.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { scheduleListTool, scheduleEditTool, scheduleCancelTool } from "../../tools"
import { initDb, shutdown, ping, insertScheduledTask } from "../../db"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const PREFIX = "crud-tool-test:"

beforeAll(async () => {
  initDb(DATABASE_URL)
  await ping()
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: DATABASE_URL })
  await pool.query("DELETE FROM scheduled_tasks WHERE prompt LIKE $1", [`${PREFIX}%`])
  await pool.end()
})

afterAll(async () => {
  await shutdown()
})

describe("schedule_list tool", () => {
  test("lists pending tasks with formatted output", async () => {
    const fireAt = new Date("2099-06-15T14:00:00Z")
    await insertScheduledTask(fireAt, `${PREFIX}list tool test`)

    const result = await scheduleListTool.execute({})
    expect(result.result).toContain("list tool test")
    expect(result.result).toContain("Jun")
    expect(result.result).toContain("2099")
  })

  test("returns message when no tasks match", async () => {
    const result = await scheduleListTool.execute({ status: "pending", from: "2199-01-01", to: "2199-01-02" })
    expect(result.result).toContain("No scheduled tasks found")
  })
})

describe("schedule_edit tool", () => {
  test("edits a pending task and returns confirmation", async () => {
    const fireAt = new Date("2099-06-15T14:00:00Z")
    const id = await insertScheduledTask(fireAt, `${PREFIX}edit tool test`)

    const result = await scheduleEditTool.execute({ id, prompt: `${PREFIX}edited prompt` })
    expect(result.result).toContain("Updated")
    expect(result.result).toContain(`#${id}`)
  })

  test("returns error for non-pending task", async () => {
    const result = await scheduleEditTool.execute({ id: 999999, prompt: "nope" })
    expect(result.result).toContain("not found or not editable")
  })

  test("returns error for invalid date", async () => {
    const id = await insertScheduledTask(new Date("2099-01-01"), `${PREFIX}edit-bad-date`)
    const result = await scheduleEditTool.execute({ id, at: "not-a-date" })
    expect(result.result).toContain("could not parse")
  })
})

describe("schedule_cancel tool", () => {
  test("cancels a pending task", async () => {
    const fireAt = new Date("2099-06-15T14:00:00Z")
    const id = await insertScheduledTask(fireAt, `${PREFIX}cancel tool test`)

    const result = await scheduleCancelTool.execute({ id })
    expect(result.result).toContain("Cancelled")
    expect(result.result).toContain(`#${id}`)
  })

  test("returns error for non-pending task", async () => {
    const result = await scheduleCancelTool.execute({ id: 999999 })
    expect(result.result).toContain("not found or not editable")
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/scheduling/__test__/schedule-crud-tools.test.ts`
Expected: FAIL — tools not exported

**Step 3: Implement the three tools**

Add to `src/tools/tools.ts` after `createScheduleTool`. Import `listScheduledTasks`, `editScheduledTask`, `cancelScheduledTask` from `../db` at the top.

```typescript
const scheduleListSchema = z.object({
  status: z.string().optional().describe("Filter by status: pending, running, completed, failed, cancelled. Defaults to 'pending'."),
  from: z.string().optional().describe("Only show tasks firing at or after this time, e.g. '2026-02-10' or '2026-02-10 14:00'"),
  to: z.string().optional().describe("Only show tasks firing at or before this time"),
})

export const scheduleListTool: ToolDefinition<typeof scheduleListSchema, string> = {
  name: "schedule_list",
  description: "List scheduled tasks. Defaults to showing pending tasks. Use status, from, and to filters to narrow results.",
  schema: scheduleListSchema,
  derivePermission: () => ({ tool: "schedule_list", params: {} }),
  execute: async ({ status, from, to }) => {
    const opts: { status?: string; from?: Date; to?: Date } = {}
    if (status) opts.status = status
    if (from) {
      const d = new Date(from)
      if (isNaN(d.getTime())) {
        const msg = `Error: could not parse "${from}" as a date.`
        return { context: msg, result: msg }
      }
      opts.from = d
    }
    if (to) {
      const d = new Date(to)
      if (isNaN(d.getTime())) {
        const msg = `Error: could not parse "${to}" as a date.`
        return { context: msg, result: msg }
      }
      opts.to = d
    }

    const tasks = await listScheduledTasks(opts)
    if (tasks.length === 0) {
      const msg = "No scheduled tasks found matching filters."
      return { context: msg, result: msg }
    }

    const lines = tasks.map((t) => {
      const time = formatLocalTime(t.fire_at)
      const prompt = t.prompt.length > 60 ? t.prompt.slice(0, 60) + "..." : t.prompt
      return `#${t.id}  ${time}  [${t.status}]  ${prompt}`
    })
    const msg = lines.join("\n")
    return { context: msg, result: msg }
  },
}

const scheduleEditSchema = z.object({
  id: z.number().describe("The task ID to edit"),
  at: z.string().optional().describe("New fire time, e.g. '2026-02-10 3:00 PM'"),
  prompt: z.string().optional().describe("New prompt/instructions for the task"),
})

export const scheduleEditTool: ToolDefinition<typeof scheduleEditSchema, string> = {
  name: "schedule_edit",
  description: "Edit a pending scheduled task's time or prompt. At least one of 'at' or 'prompt' must be provided. Only pending tasks can be edited.",
  schema: scheduleEditSchema,
  derivePermission: () => ({ tool: "schedule_edit", params: {} }),
  execute: async ({ id, at, prompt }) => {
    const updates: { fireAt?: Date; prompt?: string } = {}

    if (at) {
      const d = new Date(at)
      if (isNaN(d.getTime())) {
        const msg = `Error: could not parse "${at}" as a date/time.`
        return { context: msg, result: msg }
      }
      updates.fireAt = d
    }
    if (prompt) updates.prompt = prompt

    if (!updates.fireAt && !updates.prompt) {
      const msg = "Error: provide at least one of 'at' or 'prompt' to edit."
      return { context: msg, result: msg }
    }

    const count = await editScheduledTask(id, updates)
    if (count === 0) {
      const msg = `Task #${id} not found or not editable (only pending tasks can be edited).`
      return { context: msg, result: msg }
    }

    const parts = []
    if (updates.fireAt) parts.push(`time → ${formatLocalTime(updates.fireAt)}`)
    if (updates.prompt) parts.push(`prompt → "${updates.prompt.slice(0, 60)}${updates.prompt.length > 60 ? "..." : ""}"`)
    const msg = `Updated task #${id}: ${parts.join(", ")}`
    return { context: msg, result: msg }
  },
}

const scheduleCancelSchema = z.object({
  id: z.number().describe("The task ID to cancel"),
})

export const scheduleCancelTool: ToolDefinition<typeof scheduleCancelSchema, string> = {
  name: "schedule_cancel",
  description: "Cancel a pending scheduled task. Only pending tasks can be cancelled.",
  schema: scheduleCancelSchema,
  derivePermission: () => ({ tool: "schedule_cancel", params: {} }),
  execute: async ({ id }) => {
    const count = await cancelScheduledTask(id)
    if (count === 0) {
      const msg = `Task #${id} not found or not editable (only pending tasks can be cancelled).`
      return { context: msg, result: msg }
    }
    const msg = `Cancelled task #${id}.`
    return { context: msg, result: msg }
  },
}
```

Export from `src/tools/index.ts`: add `scheduleListTool, scheduleEditTool, scheduleCancelTool`.

**Step 4: Run tests to verify they pass**

Run: `bun test src/scheduling/__test__/schedule-crud-tools.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```
feat(tools): add schedule_list, schedule_edit, schedule_cancel tools
```

---

### Task 4: Wire tools into both agents

**Files:**
- Modify: `src/agents/conversation/run.ts`
- Modify: `src/agents/heartbeat/run.ts`

**Step 1: Wire into conversation agent**

In `src/agents/conversation/run.ts`:

- Update import (line 7): add `scheduleListTool, scheduleEditTool, scheduleCancelTool`
- Update tools array (line 105): add the three tools
- Update permissions allowlist (line 107): add `{ tool: "schedule_list" }, { tool: "schedule_edit" }, { tool: "schedule_cancel" }`

**Step 2: Wire into heartbeat agent**

In `src/agents/heartbeat/run.ts`:

- Update import (line 7): add `scheduleListTool, scheduleEditTool, scheduleCancelTool`
- Update tools array (line 44): add the three tools
- Update permissions allowlist (line 46): add `{ tool: "schedule_list" }, { tool: "schedule_edit" }, { tool: "schedule_cancel" }`

**Step 3: Run all scheduling tests to verify nothing broke**

Run: `bun test src/scheduling/__test__/ src/db/__test__/db-scheduled.test.ts`
Expected: All tests PASS

**Step 4: Commit**

```
feat: wire schedule CRUD tools into conversation and heartbeat agents
```

---

### Task 5: Run full test suite

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 2: Final commit (if any fixes needed)**

Only if test failures required fixes.
