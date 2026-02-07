import type { StatusBoard } from "./types"
import type { MemoryFiles } from "./memory"
import { formatLocalTime } from "./format-time"

export function buildSystemPrompt(statusBoard: StatusBoard, memory: MemoryFiles, memoriesDir: string, repoRoot: string, skillsPrompt?: string): string {
  const now = new Date()
  const currentTime = formatLocalTime(now)

  let prompt = `You are a personal AI assistant. You run in the background and help your user with whatever they need. You have access to bash for executing commands, reading files, and querying databases.

Current time: ${currentTime}

## Output
Your text output is streamed directly to the user via Discord. To communicate with the user, simply write your message as text — no tool calls or special delivery mechanisms needed.`

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

  if (skillsPrompt) {
    prompt += `\n\n${skillsPrompt}`
  }

  return prompt
}
