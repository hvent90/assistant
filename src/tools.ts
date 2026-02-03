import { z } from "zod"
import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import type { ToolDefinition } from "llm-gateway/packages/ai/types"
import type { SignalQueue } from "./queue"

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
  thought: z.string().describe("Your thought process about what to communicate, e.g. 'I noticed the user mentioned a deadline tomorrow, I should check in about that'"),
})

export function createSpeakTool(queue: SignalQueue): ToolDefinition<typeof speakSchema, string> {
  return {
    name: "speak",
    description: "Communicate something to the user. Use when you have something worth saying — a proactive check-in, reminder, or thought to share. The thought you provide will guide how you formulate your message.",
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
