import { Pool } from "pg"
import type { Node } from "llm-gateway/packages/ai/client"
import { join } from "path"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const PORT = Number(process.env.VIEWER_PORT) || 5100
const DIST_DIR = join(import.meta.dir, "dist")

const pool = new Pool({ connectionString: DATABASE_URL })

interface SessionRow {
  session_id: number
  created_at: Date
  content: Node[]
}

function extractPreview(nodes: Node[]): string {
  for (const node of nodes) {
    if (node.kind === "text" && node.content) {
      return node.content.slice(0, 120)
    }
  }
  return ""
}

async function handleApi(url: URL): Promise<Response> {
  if (url.pathname === "/api/sessions") {
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
    }))
    return Response.json(sessions)
  }

  const match = url.pathname.match(/^\/api\/sessions\/(\d+)$/)
  if (match) {
    const sessionId = Number(match[1])
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
    return Response.json({
      id: sessionId,
      createdAt: row.created_at.toISOString(),
      nodes: row.content,
    })
  }

  return Response.json({ error: "not found" }, { status: 404 })
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname.startsWith("/api/")) {
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
