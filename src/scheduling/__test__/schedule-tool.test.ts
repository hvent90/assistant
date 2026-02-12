import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { createScheduleTool } from "../../tools"
import { initDb, shutdown, ping, getPendingDueTasks } from "../../db"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const PREFIX = "tool-test:"

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

describe("scheduleTool", () => {
  const tool = createScheduleTool()

  test("inserts a scheduled task and returns confirmation", async () => {
    const result = await tool.execute({
      at: "2026-12-25 9:00 AM",
      prompt: `${PREFIX}Wish user merry christmas`,
    })
    expect(result.result).toContain("Scheduled")
    expect(result.result).toContain("Dec")
    expect(result.result).toContain("25")
    expect(result.result).toContain("2026")
  })

  test("the inserted task appears in pending due tasks when time passes", async () => {
    const pastTime = "2020-01-01 12:00 PM"
    await tool.execute({
      at: pastTime,
      prompt: `${PREFIX}Past task for test`,
    })
    const tasks = await getPendingDueTasks(new Date())
    const found = tasks.find((t) => t.prompt === `${PREFIX}Past task for test`)
    expect(found).toBeDefined()
  })
})
