import { describe, test, expect, beforeAll } from "bun:test"
import { buildSystemPrompt } from "../context"
import { formatLocalTime } from "../format-time"
import type { StatusBoard } from "../types"
import type { MemoryFiles } from "../memory"

beforeAll(() => {
  process.env.TZ = "UTC"
})

const emptyMemory: MemoryFiles = { soul: null, user: null, instructions: null }
const idleBoard: StatusBoard = {
  conversation: { status: "idle", detail: null },
  heartbeat: { status: "idle", detail: null },
}

describe("buildSystemPrompt", () => {
  test("returns a string", () => {
    const result = buildSystemPrompt(idleBoard, emptyMemory, "/tmp/memories", "/tmp/repo")
    expect(typeof result).toBe("string")
  })

  test("contains the current time via formatLocalTime", () => {
    const now = new Date()
    const result = buildSystemPrompt(idleBoard, emptyMemory, "/tmp/memories", "/tmp/repo")
    const expected = formatLocalTime(now)
    expect(result).toContain(expected)
  })

  test("includes status board info when agents are running", () => {
    const board: StatusBoard = {
      conversation: { status: "running", detail: "responding to user" },
      heartbeat: { status: "idle", detail: null },
    }
    const result = buildSystemPrompt(board, emptyMemory, "/tmp/memories", "/tmp/repo")
    expect(result).toContain("conversation: responding to user")
  })

  test("omits status board section when all agents are idle", () => {
    const result = buildSystemPrompt(idleBoard, emptyMemory, "/tmp/memories", "/tmp/repo")
    expect(result).not.toContain("other processes currently running")
  })

  test("includes memory content when provided", () => {
    const memory: MemoryFiles = {
      soul: "I am a helpful assistant.",
      user: "The user likes coffee.",
      instructions: "Always be polite.",
    }
    const result = buildSystemPrompt(idleBoard, memory, "/tmp/memories", "/tmp/repo")
    expect(result).toContain("I am a helpful assistant.")
    expect(result).toContain("The user likes coffee.")
    expect(result).toContain("Always be polite.")
  })

  test("includes skills prompt when provided", () => {
    const result = buildSystemPrompt(idleBoard, emptyMemory, "/tmp/memories", "/tmp/repo", "## Skills\nYou can use reminders.")
    expect(result).toContain("## Skills")
    expect(result).toContain("You can use reminders.")
  })
})
