import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { initDb, shutdown, insertScheduledTask, getPendingDueTasks, updateTaskStatus, ping } from "../db"

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
})
