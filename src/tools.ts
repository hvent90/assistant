import { z } from "zod"
import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import type { ToolDefinition } from "llm-gateway/packages/ai/types"

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
