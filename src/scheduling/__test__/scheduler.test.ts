import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { initDb, shutdown, ping, insertScheduledTask } from "../../db"
import { pollOnce } from ".."

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const PREFIX = "sched-test:"

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

describe("scheduler pollOnce", () => {
  test("fires due tasks and transitions them to running then completed", async () => {
    const fireAt = new Date(Date.now() - 60_000)
    const id = await insertScheduledTask(fireAt, `${PREFIX}pollOnce test task`)

    const fired: Array<{ id: number; prompt: string }> = []

    await pollOnce(async (task) => {
      fired.push({ id: task.id, prompt: task.prompt })
      return 0
    })

    expect(fired.length).toBeGreaterThanOrEqual(1)
    const found = fired.find((f) => f.id === id)
    expect(found).toBeDefined()
    expect(found!.prompt).toBe(`${PREFIX}pollOnce test task`)
  })

  test("does not fire future tasks", async () => {
    const fireAt = new Date(Date.now() + 3_600_000)
    const id = await insertScheduledTask(fireAt, `${PREFIX}future pollOnce test`)

    const fired: number[] = []

    await pollOnce(async (task) => {
      fired.push(task.id)
      return 0
    })

    expect(fired).not.toContain(id)
  })

  test("marks tasks as failed when handler throws", async () => {
    const fireAt = new Date(Date.now() - 60_000)
    const id = await insertScheduledTask(fireAt, `${PREFIX}failing task`)

    await pollOnce(async (task) => {
      if (task.id === id) throw new Error("intentional failure")
      return 0
    })

    const { getPendingDueTasks } = await import("../../db")
    const tasks = await getPendingDueTasks(new Date())
    const found = tasks.find((t) => t.id === id)
    expect(found).toBeDefined()
    expect(found!.status).toBe("failed")
    expect(found!.attempts).toBe(1)
    expect(found!.last_error).toBe("intentional failure")
  })
})
