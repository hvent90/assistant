import { Pool, Client as PgClient } from "pg"
import type { Node } from "llm-gateway/packages/ai/client"
import type { ServerEvent } from "llm-gateway/packages/ai/client"
import { join } from "path"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const PORT = Number(process.env.VIEWER_PORT) || 5100
const DIST_DIR = join(import.meta.dir, "dist")

const pool = new Pool({ connectionString: DATABASE_URL })

// --- SSE infrastructure ---

/** Active session IDs, updated by harness_start/harness_end notifications */
const activeSessionIds = new Set<number>()

/** Per-session SSE subscribers: sessionId → Set of stream controllers */
const sessionStreams = new Map<number, Set<ReadableStreamDefaultController<Uint8Array>>>()

/** Sidebar feed subscribers (lifecycle events only) */
const feedStreams = new Set<ReadableStreamDefaultController<Uint8Array>>()

const encoder = new TextEncoder()

function sseWrite(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown): void {
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  } catch {
    // Client disconnected, ignore
  }
}

/** Persistent LISTEN connection for agent_events */
async function startListening(): Promise<void> {
  const client = new PgClient({ connectionString: DATABASE_URL })
  await client.connect()
  await client.query("LISTEN agent_events")

  client.on("notification", (msg) => {
    if (msg.channel !== "agent_events" || !msg.payload) return
    let parsed: { sessionId: number; event: ServerEvent }
    try {
      parsed = JSON.parse(msg.payload)
    } catch {
      return
    }

    const { sessionId, event } = parsed

    // Update active session tracking
    if (event.type === "harness_start") {
      activeSessionIds.add(sessionId)
      for (const ctrl of feedStreams) {
        sseWrite(ctrl, { type: "session_start", sessionId })
      }
    } else if (event.type === "harness_end") {
      activeSessionIds.delete(sessionId)
      for (const ctrl of feedStreams) {
        sseWrite(ctrl, { type: "session_end", sessionId })
      }
    }

    // Fan out to per-session stream subscribers
    const subscribers = sessionStreams.get(sessionId)
    if (subscribers) {
      for (const ctrl of subscribers) {
        sseWrite(ctrl, event)
      }
      // Close streams on harness_end
      if (event.type === "harness_end") {
        for (const ctrl of subscribers) {
          try { ctrl.close() } catch { /* already closed */ }
        }
        sessionStreams.delete(sessionId)
      }
    }
  })

  client.on("error", (err) => {
    console.error("LISTEN connection error:", err)
    setTimeout(startListening, 3000)
  })
}

startListening().catch((err) => console.error("Failed to start LISTEN:", err))

// --- SSE headers ---
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const

// --- Existing types ---

interface SessionRow {
  session_id: number
  created_at: Date
  content: Node[]
}

function extractPreview(nodes: Node[]): string {
  for (const node of nodes) {
    if (node.kind === "text" && node.content) {
      return (typeof node.content === "string" ? node.content : "").slice(0, 120)
    }
    if (node.kind === "user" && node.content) {
      const c = node.content
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ") : ""
      return text.slice(0, 120)
    }
  }
  return ""
}

function handleSSEStream(url: URL, req: Request): Response | null {
  // --- SSE: Per-session stream ---
  const streamMatch = url.pathname.match(/^\/api\/sessions\/(\d+)\/stream$/)
  if (streamMatch) {
    const sessionId = Number(streamMatch[1])
    let savedController: ReadableStreamDefaultController<Uint8Array>

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        savedController = controller
        if (!sessionStreams.has(sessionId)) {
          sessionStreams.set(sessionId, new Set())
        }
        sessionStreams.get(sessionId)!.add(controller)
      },
      cancel() {
        const set = sessionStreams.get(sessionId)
        if (set) {
          set.delete(savedController)
          if (set.size === 0) sessionStreams.delete(sessionId)
        }
      },
    })

    return new Response(stream, { headers: SSE_HEADERS })
  }

  // --- SSE: Sidebar lifecycle feed ---
  if (url.pathname === "/api/sessions/feed") {
    let savedController: ReadableStreamDefaultController<Uint8Array>

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        savedController = controller
        feedStreams.add(controller)
      },
      cancel() {
        feedStreams.delete(savedController)
      },
    })

    return new Response(stream, { headers: SSE_HEADERS })
  }

  return null
}

async function handleApi(url: URL): Promise<Response> {
  // --- REST: Session list ---
  if (url.pathname === "/api/sessions") {
    const agent = url.searchParams.get("agent") ?? "heartbeat"

    if (agent === "conversation") {
      const result = await pool.query<SessionRow>(
        `SELECT DISTINCT ON (m.session_id) m.session_id, s.created_at, m.content
         FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE m.agent = 'conversation'
         ORDER BY m.session_id DESC, m.created_at ASC`
      )
      const sessions = result.rows.map((r) => ({
        id: r.session_id,
        createdAt: r.created_at.toISOString(),
        preview: extractPreview(r.content),
        active: activeSessionIds.has(r.session_id),
      }))
      return Response.json(sessions)
    }

    const result = await pool.query<SessionRow>(
      `SELECT m.session_id, s.created_at, m.content
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.agent = 'heartbeat'
       ORDER BY s.created_at DESC`
    )
    const sessions = result.rows.map((r) => ({
      id: r.session_id,
      createdAt: r.created_at.toISOString(),
      preview: extractPreview(r.content),
      active: activeSessionIds.has(r.session_id),
    }))
    return Response.json(sessions)
  }

  const match = url.pathname.match(/^\/api\/sessions\/(\d+)$/)
  if (match) {
    const sessionId = Number(match[1])
    const agent = url.searchParams.get("agent") ?? "heartbeat"

    if (agent === "conversation") {
      const result = await pool.query<{ content: Node[]; created_at: Date }>(
        `SELECT m.content, s.created_at
         FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE m.agent = 'conversation' AND m.session_id = $1
         ORDER BY m.created_at ASC`,
        [sessionId]
      )
      if (result.rows.length === 0) {
        return Response.json({ error: "not found" }, { status: 404 })
      }
      const nodes = result.rows.flatMap((r) => r.content)
      return Response.json({
        id: sessionId,
        createdAt: result.rows[0]!.created_at.toISOString(),
        nodes,
      })
    }

    const result = await pool.query<{ content: Node[]; created_at: Date }>(
      `SELECT m.content, s.created_at
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.agent = 'heartbeat' AND m.session_id = $1`,
      [sessionId]
    )
    if (result.rows.length === 0) {
      return Response.json({ error: "not found" }, { status: 404 })
    }
    const row = result.rows[0]!

    // Check if this session was triggered by a scheduled task
    const taskResult = await pool.query<{ id: number; prompt: string; fire_at: Date }>(
      `SELECT id, prompt, fire_at FROM scheduled_tasks WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    )
    const triggeredBy = taskResult.rows[0]
      ? { id: taskResult.rows[0].id, prompt: taskResult.rows[0].prompt, fireAt: taskResult.rows[0].fire_at.toISOString() }
      : null

    return Response.json({
      id: sessionId,
      createdAt: row.created_at.toISOString(),
      nodes: row.content,
      triggeredBy,
    })
  }

  if (url.pathname === "/api/heartbeat-status") {
    const intervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS) || 1800000
    const result = await pool.query(`SELECT value FROM kv WHERE key = 'heartbeat_last_tick_at'`)
    const row = result.rows[0]
    const lastTickMs: number | null = row?.value?.timestamp ?? null
    const lastTickAt = lastTickMs ? new Date(lastTickMs).toISOString() : null
    const nextTickAt = lastTickMs ? new Date(lastTickMs + intervalMs).toISOString() : null
    return Response.json({ lastTickAt, nextTickAt, intervalMs })
  }

  if (url.pathname === "/api/scheduled-tasks") {
    const result = await pool.query(
      `SELECT id, fire_at, prompt, status, attempts, max_attempts, last_error, session_id, created_at
       FROM scheduled_tasks
       ORDER BY created_at DESC`
    )
    const tasks = result.rows.map((r: any) => ({
      id: r.id,
      fireAt: r.fire_at.toISOString(),
      prompt: r.prompt,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      sessionId: r.session_id ?? null,
      createdAt: r.created_at.toISOString(),
    }))
    return Response.json(tasks)
  }

  return Response.json({ error: "not found" }, { status: 404 })
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname.startsWith("/api/")) {
      // SSE endpoints must be handled synchronously (not async)
      const sseResponse = handleSSEStream(url, req)
      if (sseResponse) return sseResponse

      try {
        return await handleApi(url)
      } catch (err) {
        console.error("API error:", err)
        return Response.json({ error: "internal error" }, { status: 500 })
      }
    }

    // Serve static files from dist/
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname
    const resolved = join(DIST_DIR, filePath)
    if (!resolved.startsWith(DIST_DIR)) {
      return new Response("forbidden", { status: 403 })
    }
    const file = Bun.file(resolved)
    if (await file.exists()) {
      return new Response(file)
    }
    // SPA fallback
    return new Response(Bun.file(join(DIST_DIR, "index.html")))
  },
})

console.log(`Heartbeat viewer running on http://localhost:${PORT}`)
