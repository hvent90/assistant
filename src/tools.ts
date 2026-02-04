import { z } from "zod"
import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import type { ToolDefinition } from "llm-gateway/packages/ai/types"
import type { SignalQueue } from "./queue"
import { insertScheduledTask } from "./db"
import { formatLocalTime } from "./format-time"

const readSchema = z.object({
  path: z.string().describe("Absolute path to the file to read"),
})

export const readTool: ToolDefinition<typeof readSchema, string> = {
  name: "read",
  description: "Read the contents of a file at the given absolute path.",
  schema: readSchema,
  derivePermission: (params) => ({
    tool: "read",
    params: { path: String(params.path ?? "") },
  }),
  execute: async ({ path }) => {
    try {
      const content = await readFile(path, "utf-8")
      return { context: content, result: content }
    } catch (err: any) {
      const msg = `Error reading ${path}: ${err.message}`
      return { context: msg, result: msg }
    }
  },
}

const writeSchema = z.object({
  path: z.string().describe("Absolute path to the file to write"),
  content: z.string().describe("The content to write to the file"),
})

export const writeTool: ToolDefinition<typeof writeSchema, string> = {
  name: "write",
  description: "Write content to a file at the given absolute path. Creates parent directories if needed.",
  schema: writeSchema,
  derivePermission: (params) => ({
    tool: "write",
    params: { path: String(params.path ?? "") },
  }),
  execute: async ({ path, content }) => {
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, "utf-8")
      const msg = `Wrote ${content.length} bytes to ${path}`
      return { context: msg, result: msg }
    } catch (err: any) {
      const msg = `Error writing ${path}: ${err.message}`
      return { context: msg, result: msg }
    }
  },
}

const speakSchema = z.object({
  thought: z.string().describe("What to communicate and why, with all relevant details. Example: 'The user set a reminder to call their dentist at 2pm — it's now 2pm, time to remind them.'"),
})

export function createSpeakTool(queue: SignalQueue): ToolDefinition<typeof speakSchema, string> {
  return {
    name: "speak",
    description: "Queue a message for the user. Your thought is passed to the conversation agent, which delivers it. Include all relevant details — the conversation agent only knows what you tell it here.",
    schema: speakSchema,
    derivePermission: () => ({ tool: "speak", params: {} }),
    execute: async ({ thought }) => {
      queue.push({
        type: "heartbeat",
        source: "heartbeat",
        content: [{ type: "text", text: thought }],
        timestamp: Date.now(),
      })
      const msg = `Queued message for user: "${thought.slice(0, 50)}${thought.length > 50 ? "..." : ""}"`
      return { context: msg, result: msg }
    },
  }
}

const scheduleSchema = z.object({
  at: z.string().describe("When to fire, e.g. '2026-02-04 3:00 PM', 'tomorrow at 9am', '2026-12-25 9:00 AM'"),
  prompt: z.string().describe("What the spawned agent should do when it fires. Include all relevant context."),
})

export function createScheduleTool(): ToolDefinition<typeof scheduleSchema, string> {
  return {
    name: "schedule",
    description: "Schedule a future agent run at a specific time. The agent will be spawned with your prompt as its instruction. Use this for reminders, follow-ups, or any time-sensitive action.",
    schema: scheduleSchema,
    derivePermission: () => ({ tool: "schedule", params: {} }),
    execute: async ({ at, prompt }) => {
      const fireAt = new Date(at)
      if (isNaN(fireAt.getTime())) {
        const msg = `Error: could not parse "${at}" as a date/time.`
        return { context: msg, result: msg }
      }
      const id = await insertScheduledTask(fireAt, prompt)
      const msg = `Scheduled task #${id} for ${formatLocalTime(fireAt)}: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`
      return { context: msg, result: msg }
    },
  }
}
