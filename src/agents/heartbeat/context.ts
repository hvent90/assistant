import type { Message } from "llm-gateway/packages/ai/types"
import type { StatusBoard } from "../../types"
import type { MemoryFiles } from "../../memory"
import { buildSystemPrompt } from "../../context"

type HeartbeatContextInput = {
  statusBoard: StatusBoard
  memory: MemoryFiles
  memoriesDir: string
  repoRoot: string
  addendum?: string
}

export function buildHeartbeatContext({ statusBoard, memory, memoriesDir, repoRoot, addendum }: HeartbeatContextInput): Message[] {
  const messages: Message[] = []

  messages.push({ role: "system", content: buildSystemPrompt(statusBoard, memory, memoriesDir, repoRoot) })

  let heartbeatPrompt = `This is a heartbeat signal. You MUST do the following steps using actual tool calls:

1. Run: bash ls ${memoriesDir}
2. Read any file that looks like a reminder, task, or note (not soul.md, user.md, or instructions.md — those are config)
3. If any reminder is due or overdue, use speak() to notify the user immediately
4. Clean up or update files after acting on them
5. If you need recent conversation context, run: bash psql to query the database

If anything needs to be communicated to the user — a due reminder, proactive check-in, follow-up, or thought to share — use the speak() tool.

Only write a diary entry if something genuinely significant has happened — a routine, uneventful heartbeat does not need one. Otherwise, just complete silently.

IMPORTANT: Do NOT say "no action items" unless you have actually run ls and read the files. Claiming there is nothing to do without checking is a failure.`

  if (addendum) {
    heartbeatPrompt += `\n\n## Scheduled Task\n\n${addendum}`
  }

  messages.push({ role: "user", content: heartbeatPrompt })

  return messages
}
