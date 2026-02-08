import { describe, test, expect } from "bun:test"
import { buildConversationContext } from "../../conversation/context"
import { signalToPersisted } from "../../conversation/run"
import type { StatusBoard } from "../../../types"
import type { Node } from "llm-gateway/packages/ai/client"

const emptyMemory = { soul: null, user: null, instructions: null }
const idleBoard: StatusBoard = {
  conversation: { status: "idle", detail: null },
  heartbeat: { status: "idle", detail: null },
}

describe("heartbeat signal persistence", () => {
  test("heartbeat signal persists as role:assistant with kind:text node", () => {
    const result = signalToPersisted(
      {
        type: "heartbeat",
        source: "heartbeat",
        content: [{ type: "text", text: "Pushup reminder: do 17 tonight" }],
        timestamp: 1000,
      },
      0
    )

    expect(result.role).toBe("assistant")
    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.kind).toBe("text")
    expect(result.content[0]!.content).toBe("Pushup reminder: do 17 tonight")
    expect(result.source).toBe("heartbeat")
  })

  test("user signal persists as role:user with kind:user node", () => {
    const result = signalToPersisted(
      {
        type: "message",
        source: "discord",
        content: [{ type: "text", text: "hello" }],
        channelId: "ch-123",
        timestamp: 2000,
      },
      0
    )

    expect(result.role).toBe("user")
    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.kind).toBe("user")
    expect(result.content[0]!.content).toBe("hello")
    expect(result.source).toBe("discord")
    expect(result.channelId).toBe("ch-123")
  })
})

describe("heartbeat signal in conversation context", () => {
  test("current heartbeat signal becomes system message with framing, not user message", () => {
    const messages = buildConversationContext({
      signals: [
        {
          type: "heartbeat",
          source: "heartbeat",
          content: [{ type: "text", text: "Pushup reminder: do 17 tonight" }],
          timestamp: Date.now(),
        },
      ],
      history: [],
      statusBoard: idleBoard,
      memory: emptyMemory,
      memoriesDir: "/tmp/memories",
      repoRoot: "/tmp",
    })

    const systemMessages = messages.filter(
      (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("background process")
    )
    const userMessages = messages.filter((m) => m.role === "user")

    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0]!.content).toContain("Pushup reminder: do 17 tonight")
    expect(userMessages).toHaveLength(0)
  })

  test("heartbeat history with kind:text and role:assistant shows as assistant", () => {
    // This is the format after migration (or new storage)
    const textNode: Node = {
      id: "heartbeat-123-0",
      runId: "signal-123",
      kind: "text" as const,
      content: "Evening check-in: pushup goal is 17",
    }

    const messages = buildConversationContext({
      signals: [
        {
          type: "message",
          source: "discord",
          content: [{ type: "text", text: "hi" }],
          timestamp: Date.now(),
        },
      ],
      history: [
        {
          role: "assistant",
          content: [textNode],
          source: "heartbeat",
          agent: "conversation",
          created_at: new Date("2026-02-04T22:00:00Z"),
        },
      ],
      statusBoard: idleBoard,
      memory: emptyMemory,
      memoriesDir: "/tmp/memories",
      repoRoot: "/tmp",
    })

    // Should appear as assistant, not user
    const userMessages = messages.filter(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("pushup goal")
    )
    expect(userMessages).toHaveLength(0)

    const assistantMessages = messages.filter(
      (m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("pushup goal")
    )
    expect(assistantMessages).toHaveLength(1)
  })

  test("normal user history messages are unaffected", () => {
    const userNode: Node = {
      id: "user-456-0",
      runId: "signal-456",
      kind: "user" as const,
      content: "hello there",
    }

    const messages = buildConversationContext({
      signals: [
        {
          type: "message",
          source: "discord",
          content: [{ type: "text", text: "new message" }],
          timestamp: Date.now(),
        },
      ],
      history: [
        {
          role: "user",
          content: [userNode],
          source: "discord",
          agent: "conversation",
          created_at: new Date("2026-02-04T22:00:00Z"),
        },
      ],
      statusBoard: idleBoard,
      memory: emptyMemory,
      memoriesDir: "/tmp/memories",
      repoRoot: "/tmp",
    })

    const userMessages = messages.filter(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("hello there")
    )
    expect(userMessages).toHaveLength(1)
  })
})
