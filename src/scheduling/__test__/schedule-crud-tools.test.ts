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
