import { Pool } from "pg"
import type { ContentBlock } from "./types"

let pool: Pool

export function initDb(databaseUrl: string) {
  pool = new Pool({ connectionString: databaseUrl })
}

export async function appendMessage(msg: {
  role: "user" | "assistant"
  content: ContentBlock[]
  source: string
  channelId?: string
  agent?: string
}) {
  await pool.query(
    `INSERT INTO messages (role, content, source, channel_id, agent) VALUES ($1, $2, $3, $4, $5)`,
    [msg.role, JSON.stringify(msg.content), msg.source, msg.channelId ?? null, msg.agent ?? "conversation"]
  )
}

export async function getRecentMessages(limit: number = 50): Promise<Array<{
  role: string
  content: ContentBlock[]
  source: string
  agent: string
  created_at: Date
}>> {
  const result = await pool.query(
    `SELECT role, content, source, agent, created_at FROM messages ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  return result.rows.reverse()
}

export async function shutdown() {
  await pool.end()
}
