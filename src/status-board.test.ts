import { describe, test, expect } from "bun:test"
import { createStatusBoard } from "./status-board"

describe("StatusBoard", () => {
  test("starts with both agents idle", () => {
    const board = createStatusBoard()
    expect(board.get()).toEqual({
      conversation: { status: "idle", detail: null },
      heartbeat: { status: "idle", detail: null },
    })
  })

  test("update sets agent status", () => {
    const board = createStatusBoard()
    board.update("heartbeat", { status: "running", detail: "writing a recipe" })
    expect(board.get().heartbeat).toEqual({ status: "running", detail: "writing a recipe" })
    expect(board.get().conversation).toEqual({ status: "idle", detail: null })
  })

  test("format returns human-readable string", () => {
    const board = createStatusBoard()
    board.update("heartbeat", { status: "running", detail: "writing a recipe" })
    const text = board.format()
    expect(text).toContain("conversation: idle")
    expect(text).toContain("heartbeat: running — writing a recipe")
  })
})
