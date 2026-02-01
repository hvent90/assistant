import { describe, test, expect } from "bun:test"
import { buildContext } from "./context"
import type { Signal, StatusBoard } from "./types"

describe("buildContext", () => {
  const baseBoard: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }

  test("message signal produces system + history + user message", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hello" }], timestamp: 1 }
    ]
    const history: Array<{ role: string; content: any[] }> = []

    const messages = buildContext({ signals, history, statusBoard: baseBoard })

    expect(messages[0]!.role).toBe("system")
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    })
  })

  test("multiple drained messages become one user turn", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hey" }], timestamp: 1 },
      { type: "message", source: "discord", content: [{ type: "text", text: "whats up" }], timestamp: 2 },
    ]

    const messages = buildContext({ signals, history: [], statusBoard: baseBoard })
    const userMsgs = messages.filter((m) => m.role === "user")
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0]!.content).toContain("hey")
    expect(userMsgs[0]!.content).toContain("whats up")
  })

  test("heartbeat signal produces reflection prompt", () => {
    const signals: Signal[] = [
      { type: "heartbeat", source: "cron", content: null, timestamp: 1 }
    ]

    const messages = buildContext({ signals, history: [], statusBoard: baseBoard })
    const userMsg = messages.find((m) => m.role === "user")
    expect(userMsg!.content).toContain("heartbeat")
  })

  test("status board is included in system prompt when agents are active", () => {
    const board: StatusBoard = {
      conversation: { status: "idle", detail: null },
      heartbeat: { status: "running", detail: "writing a recipe" },
    }
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 }
    ]

    const messages = buildContext({ signals, history: [], statusBoard: board })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("writing a recipe")
  })
})
