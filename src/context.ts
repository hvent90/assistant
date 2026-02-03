import type { Signal, StatusBoard, ContentBlock } from "./types"
import type { MemoryFiles } from "./memory"

type Message = { role: "system" | "user" | "assistant"; content: string }

type ConversationContextInput = {
  signals: Signal[]
  history: Array<{ role: string; content: ContentBlock[]; created_at: Date }>
  statusBoard: StatusBoard
  memory: MemoryFiles
  memoriesDir: string
  repoRoot: string
}

type HeartbeatContextInput = {
  statusBoard: StatusBoard
  memory: MemoryFiles
  memoriesDir: string
  repoRoot: string
}

function buildSystemPrompt(statusBoard: StatusBoard, memory: MemoryFiles, memoriesDir: string, repoRoot: string): string {
  let prompt = `You are a personal AI assistant. You run in the background and help your user with whatever they need. You have access to bash for executing commands, reading files, and querying databases.`

  // Paths
  prompt += `\n\n## Paths`
  prompt += `\n- Memories directory: ${memoriesDir}`
  prompt += `\n- Project root (your source code): ${repoRoot}`

  // Memory instructions
  prompt += `\n\nYou have persistent memory stored as files in the memories/ directory. You can read and write these files using bash.`
  prompt += `\n- memories/soul.md — Your personality. Update this when you learn something important about yourself.`
  prompt += `\n- memories/user.md — Facts about your user. Update this when you learn something important about them.`
  prompt += `\n- memories/diary/ — Timestamped diary entries (YYYY-MM-DDTHH-MM-SS.md). Write entries to summarize significant events.`
  prompt += `\n\nRewrite soul.md and user.md in full when updating (they are living documents). Diary entries are append-only (one file per entry, never modify).`

  // Inject soul.md
  if (memory.soul) {
    prompt += `\n\n## Your Personality\n${memory.soul}`
  }

  // Inject user.md
  if (memory.user) {
    prompt += `\n\n## About the User\n${memory.user}`
  }

  // Status board
  const activeAgents = Object.entries(statusBoard).filter(([_, s]) => s.status === "running")
  if (activeAgents.length > 0) {
    const lines = activeAgents.map(([name, s]) => `- ${name}: ${s.detail ?? "working"}`).join("\n")
    prompt += `\n\nYour other processes currently running:\n${lines}`
  }

  return prompt
}

export function buildConversationContext({ signals, history, statusBoard, memory, memoriesDir, repoRoot }: ConversationContextInput): Message[] {
  const messages: Message[] = []

  messages.push({ role: "system", content: buildSystemPrompt(statusBoard, memory, memoriesDir, repoRoot) })

  // Conversation history
  for (const msg of history) {
    const text = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
    if (text) {
      const content = msg.role === "user" ? `[${msg.created_at.toISOString()}]\n${text}` : text
      messages.push({ role: msg.role as "user" | "assistant", content })
    }
  }

  // Process signals by type
  const userParts: string[] = []
  const heartbeatParts: string[] = []

  for (const sig of signals) {
    if (sig.content) {
      for (const block of sig.content) {
        if (block.type === "text") {
          if (sig.type === "heartbeat") {
            heartbeatParts.push(block.text)
          } else {
            userParts.push(block.text)
          }
        }
      }
    }
  }

  // User messages first
  if (userParts.length > 0) {
    messages.push({
      role: "user",
      content: `[${new Date().toISOString()}]\n${userParts.join("\n")}`,
    })
  }

  // Heartbeat thought last (as assistant's own prior reasoning)
  if (heartbeatParts.length > 0) {
    messages.push({
      role: "assistant",
      content: heartbeatParts.join("\n"),
    })
  }

  // Current state
  messages.push({ role: "system", content: `Current time: ${new Date().toISOString()}` })

  return messages
}

export function buildHeartbeatContext({ statusBoard, memory, memoriesDir, repoRoot }: HeartbeatContextInput): Message[] {
  const messages: Message[] = []

  messages.push({ role: "system", content: buildSystemPrompt(statusBoard, memory, memoriesDir, repoRoot) })

  messages.push({
    role: "user",
    content: `This is a heartbeat signal. Reflect on your current state using your memory files. If you need recent conversation context, query the database via bash.

Write a diary entry if something significant has happened.

If you have something worth communicating to the user — a proactive check-in, reminder, follow-up, or thought to share — use the speak() tool. Otherwise, just complete your reflection without speaking.`,
  })

  return messages
}
