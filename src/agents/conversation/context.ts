import type { Message } from "llm-gateway/packages/ai/types"
import type { Signal, StatusBoard } from "../../types"
import type { MemoryFiles } from "../../memory"
import type { Node } from "llm-gateway/packages/ai/client"
import { buildSystemPrompt } from "../../context"
import { nodesToMessages } from "../../projection"
import { formatLocalTime } from "../../format-time"

type ConversationContextInput = {
  signals: Signal[]
  history: Array<{ role: string; content: Node[]; created_at: Date }>
  statusBoard: StatusBoard
  memory: MemoryFiles
  memoriesDir: string
  repoRoot: string
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

  // Heartbeat thought last — framed so the conversation agent knows what to do with it
  if (heartbeatParts.length > 0) {
    messages.push({
      role: "system",
      content: `Your background process flagged the following for the user's attention. Read the context and craft an appropriate message to deliver:\n\n${heartbeatParts.join("\n")}`,
    })
  }

  // Current state
  messages.push({ role: "system", content: `Current time: ${formatLocalTime(new Date())}` })

  return messages
}
