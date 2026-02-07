import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { createStatusBoard } from "../status-board"
import { initDb, shutdown, getKv } from "../db"

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


})
