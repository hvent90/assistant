import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { initDb, shutdown, insertScheduledTask, getPendingDueTasks, updateTaskStatus, listScheduledTasks, editScheduledTask, cancelScheduledTask, ping } from ".."

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const PREFIX = "db-sched-test:"

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

describe("scheduled tasks DB functions", () => {
  test("insertScheduledTask creates a pending task", async () => {
    const fireAt = new Date(Date.now() - 60_000) // 1 min ago (already due)
    const id = await insertScheduledTask(fireAt, `${PREFIX}Test prompt`)
    expect(id).toBeGreaterThan(0)
  })

  test("getPendingDueTasks returns tasks that are due", async () => {
    const fireAt = new Date(Date.now() - 60_000)
    await insertScheduledTask(fireAt, `${PREFIX}Due task`)

    const tasks = await getPendingDueTasks(new Date())
    expect(tasks.length).toBeGreaterThan(0)
    const found = tasks.find((t) => t.prompt === `${PREFIX}Due task`)
    expect(found).toBeDefined()
    expect(found!.status).toBe("pending")
  })

  test("getPendingDueTasks does not return future tasks", async () => {
    const fireAt = new Date(Date.now() + 3_600_000) // 1 hour from now
    await insertScheduledTask(fireAt, `${PREFIX}Future task`)

    const tasks = await getPendingDueTasks(new Date())
    const found = tasks.find((t) => t.prompt === `${PREFIX}Future task`)
    expect(found).toBeUndefined()
  })

  test("updateTaskStatus transitions status correctly", async () => {
    const fireAt = new Date(Date.now() - 60_000)
    const id = await insertScheduledTask(fireAt, `${PREFIX}Status test`)

    await updateTaskStatus(id, "running")
    let tasks = await getPendingDueTasks(new Date())
    expect(tasks.find((t) => t.id === id)).toBeUndefined() // running tasks not returned

    await updateTaskStatus(id, "failed", "something broke")
    tasks = await getPendingDueTasks(new Date())
    const found = tasks.find((t) => t.id === id)
    expect(found).toBeDefined() // failed tasks ARE returned for retry
    expect(found!.attempts).toBe(1)
    expect(found!.last_error).toBe("something broke")
  })

  test("getPendingDueTasks does not return exhausted failed tasks", async () => {
    const fireAt = new Date(Date.now() - 60_000)
    const id = await insertScheduledTask(fireAt, `${PREFIX}Exhausted task`)

    // Simulate 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await updateTaskStatus(id, "running")
      await updateTaskStatus(id, "failed", `attempt ${i + 1}`)
    }

    const tasks = await getPendingDueTasks(new Date())
    expect(tasks.find((t) => t.id === id)).toBeUndefined()
  })

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

  test("listScheduledTasks filters by status and date range combined", async () => {
    const fireAt = new Date("2099-05-10T12:00:00Z")
    const id = await insertScheduledTask(fireAt, `${PREFIX}list-combined`)
    await updateTaskStatus(id, "running")
    await updateTaskStatus(id, "completed")

    // Matches status + date range
    const found = await listScheduledTasks({ status: "completed", from: new Date("2099-05-09"), to: new Date("2099-05-11") })
    expect(found.find((t) => t.id === id)).toBeDefined()

    // Wrong status
    const wrongStatus = await listScheduledTasks({ status: "pending", from: new Date("2099-05-09"), to: new Date("2099-05-11") })
    expect(wrongStatus.find((t) => t.id === id)).toBeUndefined()

    // Wrong date range
    const wrongRange = await listScheduledTasks({ status: "completed", from: new Date("2099-06-01"), to: new Date("2099-06-02") })
    expect(wrongRange.find((t) => t.id === id)).toBeUndefined()
  })

  test("listScheduledTasks returns empty array when nothing matches", async () => {
    const tasks = await listScheduledTasks({ status: "pending", from: new Date("2199-01-01"), to: new Date("2199-01-02") })
    expect(tasks).toEqual([])
  })

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
})
