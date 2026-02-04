import type { Signal, StatusBoard } from "./types"
import type { Node } from "llm-gateway/packages/ai/client"
import type { Message } from "llm-gateway/packages/ai/types"
import type { MemoryFiles } from "./memory"
import { nodesToMessages } from "./projection"
import { formatLocalTime } from "./format-time"

type ConversationContextInput = {
  signals: Signal[]
  history: Array<{ role: string; content: Node[]; created_at: Date }>
  statusBoard: StatusBoard
  memory: MemoryFiles
  memoriesDir: string
  repoRoot: string
}

export function buildSystemPrompt(statusBoard: StatusBoard, memory: MemoryFiles, memoriesDir: string, repoRoot: string): string {
  let prompt = `You are a personal AI assistant. You run in the background and help your user with whatever they need. You have access to bash for executing commands, reading files, and querying databases.`

  // Paths
  prompt += `\n\n## Paths`
  prompt += `\n- Memories directory: ${memoriesDir}`
  prompt += `\n- Project root (your source code): ${repoRoot}`

  // Inject instructions.md (core behavioral guidance)
  if (memory.instructions) {
    prompt += `\n\n${memory.instructions}`
  }

  // Memory instructions
  prompt += `\n\n## Persistent Memory`
  prompt += `\n\nYou have persistent memory stored as files in the memories/ directory. You can read and write these files using bash.`
  prompt += `\n- memories/soul.md — Your personality. Update this when you learn something important about yourself.`
  prompt += `\n- memories/user.md — Facts about your user. Update this when you learn something important about them.`
  prompt += `\n- memories/diary/ — Timestamped diary entries (YYYY-MM-DDTHH-MM-SS.md). Write entries to summarize significant events.`
  prompt += `\n\nThe memories directory may also contain other files — reminders, notes, tasks, or anything else you or a previous run has stored. List the directory contents to discover what's there.`
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
    const projected = nodesToMessages(msg.content)
    for (const m of projected) {
      if (m.role === "user" && typeof m.content === "string") {
        messages.push({ role: "user", content: `[${formatLocalTime(msg.created_at)}]\n${m.content}` })
      } else {
        messages.push(m)
      }
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
      content: `[${formatLocalTime(new Date())}]\n${userParts.join("\n")}`,
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
  messages.push({ role: "system", content: `Current time: ${formatLocalTime(new Date())}` })

  return messages
}
