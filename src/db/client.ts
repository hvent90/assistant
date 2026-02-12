import { Pool } from "pg"
import type { Node } from "llm-gateway/packages/ai/client"

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
  content: Node[]
  source: string
  channelId?: string
  agent?: string
  sessionId?: number
}) {
  await getPool().query(
    `INSERT INTO messages (role, content, source, channel_id, agent, session_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [msg.role, JSON.stringify(msg.content), msg.source, msg.channelId ?? null, msg.agent ?? "conversation", msg.sessionId ?? null]
  )
}

export async function createSession(): Promise<number> {
  const result = await getPool().query("INSERT INTO sessions DEFAULT VALUES RETURNING id")
  return result.rows[0].id
}

export async function getSessionMessages(sessionId: number): Promise<Array<{
  role: string
  content: Node[]
  source: string
  agent: string
  created_at: Date
}>> {
  const result = await getPool().query(
    `SELECT role, content, source, agent, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  )
  return result.rows
}

export async function getKv(key: string): Promise<unknown | null> {
  const result = await getPool().query("SELECT value FROM kv WHERE key = $1", [key])
  return result.rows[0]?.value ?? null
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await getPool().query(
    "INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, JSON.stringify(value)]
  )
}

const SESSION_KV_KEY = "current_session_id"

export async function ensureCurrentSession(): Promise<number> {
  const existing = await getKv(SESSION_KV_KEY)
  if (existing && typeof existing === "object" && "sessionId" in existing) {
    return (existing as { sessionId: number }).sessionId
  }
  const sessionId = await createSession()
  await setKv(SESSION_KV_KEY, { sessionId })
  return sessionId
}

export type ScheduledTask = {
  id: number
  fire_at: Date
  prompt: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string | null
  session_id: number | null
  created_at: Date
}

export async function insertScheduledTask(fireAt: Date, prompt: string): Promise<number> {
  const result = await getPool().query(
    "INSERT INTO scheduled_tasks (fire_at, prompt) VALUES ($1, $2) RETURNING id",
    [fireAt, prompt]
  )
  return result.rows[0].id
}

export async function listScheduledTasks(opts: {
  status?: string
  from?: Date
  to?: Date
}): Promise<ScheduledTask[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  const status = opts.status ?? "pending"
  conditions.push(`status = $${i++}`)
  params.push(status)

  if (opts.from) {
    conditions.push(`fire_at >= $${i++}`)
    params.push(opts.from)
  }
  if (opts.to) {
    conditions.push(`fire_at <= $${i++}`)
    params.push(opts.to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const result = await getPool().query(
    `SELECT * FROM scheduled_tasks ${where} ORDER BY fire_at ASC`,
    params
  )
  return result.rows
}

export async function getPendingDueTasks(now: Date): Promise<ScheduledTask[]> {
  const result = await getPool().query(
    `SELECT * FROM scheduled_tasks
     WHERE fire_at <= $1
       AND (status = 'pending' OR (status = 'failed' AND attempts < max_attempts))
     ORDER BY fire_at ASC`,
    [now]
  )
  return result.rows
}

export async function updateTaskStatus(
  id: number,
  status: "running" | "completed" | "failed" | "cancelled",
  error?: string,
  sessionId?: number
): Promise<void> {
  if (status === "running") {
    await getPool().query(
      "UPDATE scheduled_tasks SET status = $1, attempts = attempts + 1 WHERE id = $2",
      [status, id]
    )
  } else if (status === "failed") {
    await getPool().query(
      "UPDATE scheduled_tasks SET status = $1, last_error = $2 WHERE id = $3",
      [status, error ?? null, id]
    )
  } else if (status === "completed" && sessionId != null) {
    await getPool().query(
      "UPDATE scheduled_tasks SET status = $1, session_id = $2 WHERE id = $3",
      [status, sessionId, id]
    )
  } else {
    await getPool().query(
      "UPDATE scheduled_tasks SET status = $1 WHERE id = $2",
      [status, id]
    )
  }
}

const PG_NOTIFY_MAX = 8000
const PAYLOAD_OVERHEAD = 200 // room for JSON wrapper: {"sessionId":...,"event":...,"truncated":true}

export async function publishEvent(sessionId: number, event: object): Promise<void> {
  const full = JSON.stringify({ sessionId, event })
  if (full.length <= PG_NOTIFY_MAX) {
    await getPool().query("SELECT pg_notify('agent_events', $1)", [full])
    return
  }
  // Payload too large — send a truncated marker so viewers know to fetch via REST
  const truncated = JSON.stringify({ sessionId, event: { type: (event as { type?: string }).type ?? "unknown" }, truncated: true })
  await getPool().query("SELECT pg_notify('agent_events', $1)", [truncated])
}

export async function shutdown() {
  await pool?.end()
  pool = null
}
