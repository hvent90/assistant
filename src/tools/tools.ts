import { z } from "zod"
import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import type { ToolDefinition } from "llm-gateway/packages/ai/types"
import type { SignalQueue } from "../queue"
import { insertScheduledTask, listScheduledTasks, editScheduledTask, cancelScheduledTask } from "../db"
import { formatLocalTime } from "../format-time"

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
  thought: z.string().describe("Context and instructions for the conversation agent. Describe the situation and what to tell the user — do NOT write the message itself. Example: 'The user set a reminder to call their dentist at 2pm — it's now 2pm, time to remind them.'"),
})

export function createSpeakTool(queue: SignalQueue): ToolDefinition<typeof speakSchema, string> {
  return {
    name: "speak",
    description: "Send a thought to the conversation agent, which will craft and deliver a message to the user. Describe the situation and relevant context — the conversation agent decides how to phrase it. Do NOT write as if speaking directly to the user.",
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

const scheduleListSchema = z.object({
  status: z.string().optional().describe("Filter by status: pending, running, completed, failed, cancelled. Defaults to 'pending'."),
  from: z.string().optional().describe("Only show tasks firing at or after this time, e.g. '2026-02-10' or '2026-02-10 14:00'"),
  to: z.string().optional().describe("Only show tasks firing at or before this time"),
})

export const scheduleListTool: ToolDefinition<typeof scheduleListSchema, string> = {
  name: "schedule_list",
  description: "List scheduled tasks. Defaults to showing pending tasks. Use status, from, and to filters to narrow results.",
  schema: scheduleListSchema,
  derivePermission: () => ({ tool: "schedule_list", params: {} }),
  execute: async ({ status, from, to }) => {
    const opts: { status?: string; from?: Date; to?: Date } = {}
    if (status) opts.status = status
    if (from) {
      const d = new Date(from)
      if (isNaN(d.getTime())) {
        const msg = `Error: could not parse "${from}" as a date.`
        return { context: msg, result: msg }
      }
      opts.from = d
    }
    if (to) {
      const d = new Date(to)
      if (isNaN(d.getTime())) {
        const msg = `Error: could not parse "${to}" as a date.`
        return { context: msg, result: msg }
      }
      opts.to = d
    }

    const tasks = await listScheduledTasks(opts)
    if (tasks.length === 0) {
      const msg = "No scheduled tasks found matching filters."
      return { context: msg, result: msg }
    }

    const lines = tasks.map((t) => {
      const time = formatLocalTime(t.fire_at)
      const prompt = t.prompt.length > 60 ? t.prompt.slice(0, 60) + "..." : t.prompt
      return `#${t.id}  ${time}  [${t.status}]  ${prompt}`
    })
    const msg = lines.join("\n")
    return { context: msg, result: msg }
  },
}

const scheduleEditSchema = z.object({
  id: z.number().describe("The task ID to edit"),
  at: z.string().optional().describe("New fire time, e.g. '2026-02-10 3:00 PM'"),
  prompt: z.string().optional().describe("New prompt/instructions for the task"),
})

export const scheduleEditTool: ToolDefinition<typeof scheduleEditSchema, string> = {
  name: "schedule_edit",
  description: "Edit a pending scheduled task's time or prompt. At least one of 'at' or 'prompt' must be provided. Only pending tasks can be edited.",
  schema: scheduleEditSchema,
  derivePermission: () => ({ tool: "schedule_edit", params: {} }),
  execute: async ({ id, at, prompt }) => {
    const updates: { fireAt?: Date; prompt?: string } = {}

    if (at) {
      const d = new Date(at)
      if (isNaN(d.getTime())) {
        const msg = `Error: could not parse "${at}" as a date/time.`
        return { context: msg, result: msg }
      }
      updates.fireAt = d
    }
    if (prompt) updates.prompt = prompt

    if (!updates.fireAt && !updates.prompt) {
      const msg = "Error: provide at least one of 'at' or 'prompt' to edit."
      return { context: msg, result: msg }
    }

    const count = await editScheduledTask(id, updates)
    if (count === 0) {
      const msg = `Task #${id} not found or not editable (only pending tasks can be edited).`
      return { context: msg, result: msg }
    }

    const parts = []
    if (updates.fireAt) parts.push(`time -> ${formatLocalTime(updates.fireAt)}`)
    if (updates.prompt) parts.push(`prompt -> "${updates.prompt.slice(0, 60)}${updates.prompt.length > 60 ? "..." : ""}"`)
    const msg = `Updated task #${id}: ${parts.join(", ")}`
    return { context: msg, result: msg }
  },
}

const scheduleCancelSchema = z.object({
  id: z.number().describe("The task ID to cancel"),
})

export const scheduleCancelTool: ToolDefinition<typeof scheduleCancelSchema, string> = {
  name: "schedule_cancel",
  description: "Cancel a pending scheduled task. Only pending tasks can be cancelled.",
  schema: scheduleCancelSchema,
  derivePermission: () => ({ tool: "schedule_cancel", params: {} }),
  execute: async ({ id }) => {
    const count = await cancelScheduledTask(id)
    if (count === 0) {
      const msg = `Task #${id} not found or not editable (only pending tasks can be cancelled).`
      return { context: msg, result: msg }
    }
    const msg = `Cancelled task #${id}.`
    return { context: msg, result: msg }
  },
}
