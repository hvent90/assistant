import { describe, test, expect } from "bun:test"
import { buildConversationContext } from "../context"
import { buildHeartbeatContext } from "../agents/heartbeat/context"
import type { StatusBoard } from "../types"

const emptyMemory = { soul: null, user: null, instructions: null }
const idleBoard: StatusBoard = {
  conversation: { status: "idle", detail: null },
  heartbeat: { status: "idle", detail: null },
}

describe("context time formatting", () => {
  test("buildHeartbeatContext does not use ISO format for current time", () => {
    const messages = buildHeartbeatContext({
      statusBoard: idleBoard,
      memory: emptyMemory,
      memoriesDir: "/tmp/memories",
      repoRoot: "/tmp",
    })
    const allText = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n")
    expect(allText).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  test("buildConversationContext uses local time for current time system message", () => {
    const messages = buildConversationContext({
      signals: [{ type: "message", source: "discord", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
      history: [],
      statusBoard: idleBoard,
      memory: emptyMemory,
      memoriesDir: "/tmp/memories",
      repoRoot: "/tmp",
    })
    const systemMessages = messages.filter((m) => m.role === "system")
    const currentTimeMsg = systemMessages.find((m) => typeof m.content === "string" && m.content.startsWith("Current time:"))
    expect(currentTimeMsg).toBeDefined()
    expect(currentTimeMsg!.content as string).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })
})
