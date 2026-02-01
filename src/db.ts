import { Pool } from "pg"
import type { ContentBlock } from "./types"

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) throw new Error("Database not initialized. Call initDb() first.")
  return pool
}

export function initDb(databaseUrl: string) {
  pool = new Pool({ connectionString: databaseUrl })
}

export async function ping() {
  await getPool().query("SELECT 1")
}

export async function appendMessage(msg: {
  role: "user" | "assistant"
  content: ContentBlock[]
  source: string
  channelId?: string
  agent?: string
}) {
  await getPool().query(
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
  const result = await getPool().query(
    `SELECT role, content, source, agent, created_at FROM messages ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  return result.rows.reverse()
}

export async function getKv(key: string): Promise<unknown | null> {
  const result = await getPool().query("SELECT value FROM kv WHERE key = $1", [key])
  return result.rows[0]?.value ?? null
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await getPool().query(
    "INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [key, JSON.stringify(value)]
  )
}

export async function shutdown() {
  await pool?.end()
  pool = null
}
