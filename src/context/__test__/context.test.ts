import { describe, test, expect } from "bun:test"
import { buildConversationContext } from "../../agents/conversation/context"
import { buildHeartbeatContext } from "../../agents/heartbeat/context"
import type { Signal, StatusBoard } from "../../types"
import type { MemoryFiles } from ".."
import { formatLocalTime } from "../../format-time"

describe("buildConversationContext", () => {
  const baseBoard: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }
  const noMemory: MemoryFiles = { soul: null, user: null, instructions: null }
  const testMemoriesDir = "/tmp/memories"
  const testRepoRoot = "/tmp/repo"

  test("message signal produces system + user message + current-state system message", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hello" }], timestamp: 1 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })

    expect(messages[0]!.role).toBe("system")
    const userMsg = messages.find((m) => m.role === "user")!
    expect(userMsg.content).toContain("hello")
    // Trailing system message with current time
    const last = messages[messages.length - 1]!
    expect(last.role).toBe("system")
    expect(last.content).toContain("Current time:")
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
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })
    const userMsgs = messages.filter((m) => m.role === "user")
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0]!.content).toContain("hey")
    expect(userMsgs[0]!.content).toContain("whats up")
  })

  test("includes skills prompt in system message", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
      skillsPrompt: '<available_skills>\n  <skill>\n    <name>test-skill</name>\n    <description>A test skill</description>\n    <location>/tmp/skills/test-skill/SKILL.md</location>\n  </skill>\n</available_skills>',
    })

    const system = messages[0]!
    expect(system.content).toContain("test-skill")
    expect(system.content).toContain("available_skills")
  })

  test("omits skills section when no skills prompt", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })

    const system = messages[0]!
    expect(system.content).not.toContain("available_skills")
  })

  test("includes memory in system prompt when soul.md exists", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const memory: MemoryFiles = { soul: "I am a helpful assistant.", user: null, instructions: null }

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("I am a helpful assistant.")
  })

  test("includes memory in system prompt when user.md exists", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const memory: MemoryFiles = { soul: null, user: "User prefers TypeScript.", instructions: null }

    const messages = buildConversationContext({
      signals,
      history: [],
      statusBoard: baseBoard,
      memory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("User prefers TypeScript.")
  })

  test("includes conversation history with timestamps on user messages", () => {
    const signals: Signal[] = [
      { type: "message", source: "discord", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]
    const ts = new Date("2025-01-15T10:30:00Z")
    const history = [
      { role: "user", content: [{ id: "u1", runId: "r1", kind: "user" as const, content: "earlier message" }], created_at: ts },
      { role: "assistant", content: [{ id: "t1", runId: "r1", kind: "text" as const, content: "earlier reply" }], created_at: ts },
    ]

    const messages = buildConversationContext({
      signals,
      history,
      statusBoard: baseBoard,
      memory: noMemory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })
    const texts = messages.map((m) => m.content)
    // User history message should have timestamp prefix
    const userHistory = texts.find((t) => t.includes("earlier message"))!
    expect(userHistory).toContain(formatLocalTime(ts))
    // Assistant message should not have timestamp
    const assistantHistory = texts.find((t) => t.includes("earlier reply"))!
    expect(assistantHistory).not.toContain(formatLocalTime(ts))
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
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("writing a recipe")
  })

  test("heartbeat signals become system messages", () => {
    const result = buildConversationContext({
      signals: [
        {
          type: "heartbeat",
          source: "heartbeat",
          content: [{ type: "text", text: "I should check in about the deadline" }],
          timestamp: Date.now(),
        },
      ],
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })

    const heartbeatMsg = result.find((m) => m.role === "system" && typeof m.content === "string" && m.content.includes("I should check in about the deadline"))
    expect(heartbeatMsg).toBeDefined()
  })

  test("user signals before heartbeat signals", () => {
    const result = buildConversationContext({
      signals: [
        {
          type: "message",
          source: "discord",
          content: [{ type: "text", text: "user message" }],
          timestamp: Date.now(),
        },
        {
          type: "heartbeat",
          source: "heartbeat",
          content: [{ type: "text", text: "heartbeat thought" }],
          timestamp: Date.now(),
        },
      ],
      history: [],
      statusBoard: baseBoard,
      memory: noMemory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })

    // Find indices of user message and heartbeat system message
    const userIdx = result.findIndex((m) => m.role === "user")
    const heartbeatIdx = result.findIndex((m) => m.role === "system" && typeof m.content === "string" && m.content.includes("heartbeat thought"))

    expect(userIdx).toBeGreaterThan(-1)
    expect(heartbeatIdx).toBeGreaterThan(-1)
    expect(userIdx).toBeLessThan(heartbeatIdx)
  })
})

describe("buildHeartbeatContext", () => {
  const baseBoard: StatusBoard = {
    conversation: { status: "idle", detail: null },
    heartbeat: { status: "idle", detail: null },
  }
  const noMemory: MemoryFiles = { soul: null, user: null, instructions: null }
  const testMemoriesDir = "/tmp/memories"
  const testRepoRoot = "/tmp/repo"

  test("produces system prompt, heartbeat prompt, user tick, and current time", () => {
    const messages = buildHeartbeatContext({
      statusBoard: baseBoard,
      memory: noMemory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })

    expect(messages[0]!.role).toBe("system")
    const userMsg = messages.find((m) => m.role === "user")
    expect(userMsg!.content).toContain("heartbeat")
    // system prompt + heartbeat prompt (system) + user tick + current time (system)
    expect(messages).toHaveLength(4)
  })

  test("includes skills prompt in system message", () => {
    const messages = buildHeartbeatContext({
      statusBoard: baseBoard,
      memory: noMemory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
      skillsPrompt: '<available_skills>\n  <skill>\n    <name>heartbeat-skill</name>\n    <description>A heartbeat skill</description>\n    <location>/tmp/skills/heartbeat-skill/SKILL.md</location>\n  </skill>\n</available_skills>',
    })

    const system = messages[0]!
    expect(system.content).toContain("heartbeat-skill")
    expect(system.content).toContain("available_skills")
  })

  test("includes memory when files exist", () => {
    const memory: MemoryFiles = { soul: "I am thoughtful.", user: "User likes coffee.", instructions: null }

    const messages = buildHeartbeatContext({
      statusBoard: baseBoard,
      memory,
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
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
      memoriesDir: testMemoriesDir,
      repoRoot: testRepoRoot,
    })
    const system = messages.find((m) => m.role === "system")
    expect(system!.content).toContain("replying to user")
  })
})
