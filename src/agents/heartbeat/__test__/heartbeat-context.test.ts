import { describe, test, expect } from "bun:test"
import { buildHeartbeatContext } from "../context"
import type { StatusBoard } from "../../../types"

const emptyMemory = { soul: null, user: null, instructions: null }
const idleBoard: StatusBoard = {
  conversation: { status: "idle", detail: null },
  heartbeat: { status: "idle", detail: null },
}

const baseInput = {
  statusBoard: idleBoard,
  memory: emptyMemory,
  memoriesDir: "/tmp/memories",
  repoRoot: "/tmp",
}

describe("buildHeartbeatContext", () => {
  test("includes recent speaks section when provided", () => {
    const messages = buildHeartbeatContext({
      ...baseInput,
      recentSpeaks: [
        { thought: "Reminder: pushups tonight, target is 24", created_at: new Date("2026-02-13T02:51:00Z") },
        { thought: "URGENT: bike tow at 9:30 AM, $160 cash needed", created_at: new Date("2026-02-13T14:22:00Z") },
      ],
    })

    const heartbeatPrompt = messages.find(m => m.role === "system" && typeof m.content === "string" && m.content.includes("Your Recent Speaks"))
    expect(heartbeatPrompt).toBeDefined()
    expect(heartbeatPrompt!.content).toContain("pushups tonight, target is 24")
    expect(heartbeatPrompt!.content).toContain("bike tow at 9:30 AM")
    expect(heartbeatPrompt!.content).toContain("Do NOT repeat a message on the same topic")
  })

  test("omits recent speaks section when empty", () => {
    const messages = buildHeartbeatContext({
      ...baseInput,
      recentSpeaks: [],
    })

    const heartbeatPrompt = messages.find(m => m.role === "system" && typeof m.content === "string" && m.content.includes("heartbeat signal"))
    expect(heartbeatPrompt!.content).not.toContain("Your Recent Speaks")
  })

  test("omits recent speaks section when undefined", () => {
    const messages = buildHeartbeatContext(baseInput)

    const heartbeatPrompt = messages.find(m => m.role === "system" && typeof m.content === "string" && m.content.includes("heartbeat signal"))
    expect(heartbeatPrompt!.content).not.toContain("Your Recent Speaks")
  })

  test("prompt includes tightened update semantics", () => {
    const messages = buildHeartbeatContext(baseInput)

    const heartbeatPrompt = messages.find(m => m.role === "system" && typeof m.content === "string" && m.content.includes("heartbeat signal"))
    expect(heartbeatPrompt!.content).toContain("Only update reminder files when their status genuinely changes")
    expect(heartbeatPrompt!.content).toContain("Do NOT append audit trail entries")
  })

  test("speaks section appears after conversation history", () => {
    const messages = buildHeartbeatContext({
      ...baseInput,
      recentHistory: [
        { role: "user", text: "hello", created_at: new Date("2026-02-13T01:00:00Z") },
      ],
      recentSpeaks: [
        { thought: "Pushup reminder", created_at: new Date("2026-02-13T02:00:00Z") },
      ],
    })

    const heartbeatPrompt = messages.find(m => m.role === "system" && typeof m.content === "string" && m.content.includes("heartbeat signal"))!
    const content = heartbeatPrompt.content as string
    const historyIdx = content.indexOf("Recent Conversation")
    const speaksIdx = content.indexOf("Your Recent Speaks")
    expect(historyIdx).toBeGreaterThan(-1)
    expect(speaksIdx).toBeGreaterThan(historyIdx)
  })
})
