import type { Message } from "llm-gateway/packages/ai/types"
import type { StatusBoard } from "../../types"
import type { MemoryFiles } from "../../context"
import { buildSystemPrompt } from "../../context"
import { formatLocalTime } from "../../format-time"

type RecentMessage = {
  role: string
  text: string
  created_at: Date
}

type HeartbeatContextInput = {
  statusBoard: StatusBoard
  memory: MemoryFiles
  memoriesDir: string
  repoRoot: string
  addendum?: string
  skillsPrompt?: string
  recentHistory?: RecentMessage[]
}

export function buildHeartbeatContext({ statusBoard, memory, memoriesDir, repoRoot, addendum, skillsPrompt, recentHistory }: HeartbeatContextInput): Message[] {
  const messages: Message[] = []

  messages.push({ role: "system", content: buildSystemPrompt(statusBoard, memory, memoriesDir, repoRoot, skillsPrompt) })

  let heartbeatPrompt = `This is a heartbeat signal. You MUST do the following steps using actual tool calls:

1. Run: bash ls ${memoriesDir}
2. Read any file that looks like a reminder, task, or note (not soul.md, user.md, or instructions.md — those are config)
3. If any reminder is due or overdue, use speak() to notify the user immediately
4. Clean up or update files after acting on them

If anything needs to be communicated to the user — a due reminder, proactive check-in, follow-up, or thought to share — use the speak() tool. But do NOT repeat or follow up on topics already covered in the recent conversation below — only flag genuinely new or stale items.

Only write a diary entry if something genuinely significant has happened — a routine, uneventful heartbeat does not need one. Otherwise, just complete silently.

IMPORTANT: Do NOT say "no action items" unless you have actually run ls and read the files. Claiming there is nothing to do without checking is a failure.`

  if (recentHistory && recentHistory.length > 0) {
    const lines = recentHistory.map(m => `[${formatLocalTime(m.created_at)}] ${m.role}: ${m.text}`)
    heartbeatPrompt += `\n\n## Recent Conversation\n\n${lines.join("\n")}`
  }

  if (addendum) {
    heartbeatPrompt += `\n\n## Scheduled Task\n\n${addendum}`
  }

  messages.push({ role: "system", content: heartbeatPrompt })

  messages.push({ role: "user", content: "[heartbeat tick]" })

  messages.push({ role: "system", content: `Current time: ${formatLocalTime(new Date())}` })

  return messages
}
