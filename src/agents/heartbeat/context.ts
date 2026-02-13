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

type SpeakEntry = {
  thought: string
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
  recentSpeaks?: SpeakEntry[]
}

export function buildHeartbeatContext({ statusBoard, memory, memoriesDir, repoRoot, addendum, skillsPrompt, recentHistory, recentSpeaks }: HeartbeatContextInput): Message[] {
  const messages: Message[] = []

  messages.push({ role: "system", content: buildSystemPrompt(statusBoard, memory, memoriesDir, repoRoot, skillsPrompt) })

  let heartbeatPrompt = `This is a heartbeat signal. You are the HEARTBEAT agent — your job is proactive check-ins and reminders.

## Your Scope
- Check memories/reminders directory for due/overdue items
- Send reminders or check-ins when needed
- Do proactive outreach on stale items

## How to use recent conversation context
You receive recent conversation history below for CONTEXT ONLY — to help you make better decisions about what to check in on.
- Use it to AVOID being redundant (don't follow up on something the conversation agent just handled)
- Use it to IDENTIFY gaps (e.g., user asked a question but didn't get a complete answer)
- DO NOT respond to or acknowledge any user message directly

## What you MUST NOT do
- NEVER send a response that simply acknowledges or replies to a user message
- If the conversation agent already responded to something, do NOT send a duplicate
- Your output should ONLY be proactive reminders/check-ins that are genuinely useful beyond what's already been said

## Steps
1. Run: bash ls ${memoriesDir}
2. Read any file that looks like a reminder, task, or note (not soul.md, user.md, or instructions.md — those are config)
3. If any reminder is due or overdue, use speak() to notify the user — but check your recent speak history below first. Do NOT speak about a topic you already spoke about recently unless circumstances have materially changed (e.g., user responded, deadline is now imminent, or new info emerged).
4. Only update reminder files when their status genuinely changes (e.g., marking an item completed, cancelled, or postponed). Do NOT append audit trail entries, timestamps, or "Updated:" log lines just because you checked or reminded about an item.

Only write a diary entry if something genuinely significant has happened — a routine, uneventful heartbeat does not need one. Otherwise, just complete silently.

IMPORTANT: Do NOT say "no action items" unless you have actually run ls and read the files. Claiming there is nothing to do without checking is a failure.`

  if (recentHistory && recentHistory.length > 0) {
    const lines = recentHistory.map(m => `[${formatLocalTime(m.created_at)}] ${m.role}: ${m.text}`)
    heartbeatPrompt += `\n\n## Recent Conversation (context only — do not respond to these)\n\n${lines.join("\n")}`
  }

  if (recentSpeaks && recentSpeaks.length > 0) {
    const lines = recentSpeaks.map(s => `[${formatLocalTime(s.created_at)}] ${s.thought}`)
    heartbeatPrompt += `\n\n## Your Recent Speaks (messages you already sent to the user)\n\nThese are speak() calls YOU made recently. Do NOT repeat a message on the same topic unless circumstances have materially changed since you last spoke about it.\n\n${lines.join("\n\n")}`
  }

  if (addendum) {
    heartbeatPrompt += `\n\n## Scheduled Task\n\n${addendum}`
  }

  messages.push({ role: "system", content: heartbeatPrompt })

  messages.push({ role: "user", content: "[heartbeat tick]" })

  messages.push({ role: "system", content: `Current time: ${formatLocalTime(new Date())}` })

  return messages
}
