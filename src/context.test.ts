import { describe, test, expect } from "bun:test"
import { buildConversationContext, buildHeartbeatContext } from "./context"
import type { Signal, StatusBoard } from "./types"
import type { MemoryFiles } from "./memory"

describe("buildConversationContext", () => {
  const baseBoard: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }
  const noMemory: MemoryFiles = { soul: null, user: null }

  test("message signal produces system + history + user message", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hello" }], timestamp: 1 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
    })

    expect(messages[0]!.role).toBe("system")
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "hello" })
  })

  test("multiple drained messages become one user turn", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hey" }], timestamp: 1 },
      { type: "message", source: "discord", content: [{ type: "text", text: "whats up" }], timestamp: 2 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
    })
    const userMsgs = messages.filter((m) => m.role === "user")
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0]!.content).toContain("hey")
    expect(userMsgs[0]!.content).toContain("whats up")
  })

  test("includes memory in system prompt when soul.md exists", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const memory: MemoryFiles = { soul: "I am a helpful assistant.", user: null }

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("I am a helpful assistant.")
  })

  test("includes memory in system prompt when user.md exists", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const memory: MemoryFiles = { soul: null, user: "User prefers TypeScript." }

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("User prefers TypeScript.")
  })

  test("includes conversation history", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const history = [
      { role: "user", content: [{ type: "text" as const, text: "earlier message" }] },
      { role: "assistant", content: [{ type: "text" as const, text: "earlier reply" }] },
    ]

    const messages = buildConversationContext({
      signals,
      history,
      statusBoard: baseBoard,
      memory: noMemory,
    })
    const texts = messages.map((m) => m.content)
    expect(texts.some((t) => t.includes("earlier message"))).toBe(true)
    expect(texts.some((t) => t.includes("earlier reply"))).toBe(true)
  })

  test("status board is included when agents are active", () => {
    const board: StatusBoard = {
      conversation: { status: "idle", detail: null },
      heartbeat: { status: "running", detail: "writing a recipe" },
    }
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: board,
      memory: noMemory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("writing a recipe")
  })
})

describe("buildHeartbeatContext", () => {
  const baseBoard: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }
  const noMemory: MemoryFiles = { soul: null, user: null }

  test("produces system + heartbeat prompt, no history", () => {
    const messages = buildHeartbeatContext({
      statusBoard: baseBoard,
      memory: noMemory,
    })

    expect(messages[0]!.role).toBe("system")
    const userMsg = messages.find((m) => m.role === "user")
    expect(userMsg!.content).toContain("heartbeat")
    // No history messages — only system and user
    expect(messages).toHaveLength(2)
  })

  test("includes memory when files exist", () => {
    const memory: MemoryFiles = { soul: "I am thoughtful.", user: "User likes coffee." }

    const messages = buildHeartbeatContext({
      statusBoard: baseBoard,
      memory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("I am thoughtful.")
    expect(system!.content).toContain("User likes coffee.")
  })

  test("includes status board when agents are active", () => {
    const board: StatusBoard = {
      conversation: { status: "running", detail: "replying to user" },
      heartbeat: { status: "idle", detail: null },
    }

    const messages = buildHeartbeatContext({
      statusBoard: board,
      memory: noMemory,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("replying to user")
  })
})
