import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Client as PgClient } from "pg"

const DATABASE_URL = "postgres://assistant:assistant@localhost:5434/assistant"
const TEST_PORT = 5199

let serverProc: import("bun").Subprocess | null = null
let pgClient: PgClient

async function notify(sessionId: number, event: Record<string, unknown>): Promise<void> {
  await pgClient.query(`SELECT pg_notify('agent_events', $1)`, [
    JSON.stringify({ sessionId, event }),
  ])
}

/**
 * Read SSE events using curl subprocess to avoid Bun fetch buffering issues.
 * Connects to the SSE endpoint, waits for the connection to establish,
 * calls sendNotify, then collects output until curl times out.
 */
async function readSSEViaCurl(
  path: string,
  sendNotify: () => Promise<void>,
  timeoutSec = 3,
): Promise<string[]> {
  const proc = Bun.spawn(
    ["curl", "-s", "-N", "-m", String(timeoutSec), `http://localhost:${TEST_PORT}${path}`],
    { stdout: "pipe", stderr: "pipe" },
  )

  // Wait for curl to connect and the SSE stream controller to register
  await new Promise((r) => setTimeout(r, 500))

  await sendNotify()

  const output = await new Response(proc.stdout).text()
  return output
    .split("\n\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "))
      return dataLine ? dataLine.slice(6) : ""
    })
    .filter(Boolean)
}

/** Check SSE headers via curl -D (dump headers) */
async function checkSSEHeaders(path: string): Promise<Record<string, string>> {
  const proc = Bun.spawn(
    ["curl", "-s", "-m", "1", "-D", "-", "-o", "/dev/null", `http://localhost:${TEST_PORT}${path}`],
    { stdout: "pipe", stderr: "pipe" },
  )
  const output = await new Response(proc.stdout).text()
  const headers: Record<string, string> = {}
  for (const line of output.split("\r\n")) {
    const idx = line.indexOf(": ")
    if (idx > 0) {
      headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 2)
    }
  }
  return headers
}

beforeAll(async () => {
  serverProc = Bun.spawn(["bun", "run", "clients/heartbeat-viewer/server.ts"], {
    cwd: "/Users/hv/repos/assistant-live-streaming",
    env: { ...process.env, VIEWER_PORT: String(TEST_PORT), DATABASE_URL },
    stdout: "pipe",
    stderr: "pipe",
  })

  // Wait for server to be ready
  const maxWait = 5000
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      await fetch(`http://localhost:${TEST_PORT}/api/sessions`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  pgClient = new PgClient({ connectionString: DATABASE_URL })
  await pgClient.connect()
}, 10000)

afterAll(async () => {
  await pgClient.end()
  serverProc?.kill()
})

describe("GET /api/sessions/:id/stream", () => {
  test("returns SSE headers", async () => {
    const headers = await checkSSEHeaders("/api/sessions/1/stream")
    expect(headers["content-type"]).toBe("text/event-stream")
    expect(headers["cache-control"]).toBe("no-cache")
  })

  test("receives events via pg_notify", async () => {
    const sessionId = 999999
    const event = { type: "text", id: "abc", runId: "r1", agentId: "heartbeat", content: "hello world" }

    const events = await readSSEViaCurl(
      `/api/sessions/${sessionId}/stream`,
      () => notify(sessionId, event),
    )

    expect(events.length).toBeGreaterThanOrEqual(1)
    const parsed = JSON.parse(events[0])
    expect(parsed.type).toBe("text")
    expect(parsed.content).toBe("hello world")
  }, 10000)

  test("receives harness_end event", async () => {
    const sessionId = 999998

    const events = await readSSEViaCurl(
      `/api/sessions/${sessionId}/stream`,
      () => notify(sessionId, { type: "harness_end", runId: "r1", agentId: "heartbeat" }),
    )

    expect(events.length).toBeGreaterThanOrEqual(1)
    const parsed = JSON.parse(events[0])
    expect(parsed.type).toBe("harness_end")
  }, 10000)
})

describe("GET /api/sessions/feed", () => {
  test("returns SSE headers", async () => {
    const headers = await checkSSEHeaders("/api/sessions/feed")
    expect(headers["content-type"]).toBe("text/event-stream")
    expect(headers["cache-control"]).toBe("no-cache")
  })

  test("pushes session_start on harness_start", async () => {
    const sessionId = 888888

    const events = await readSSEViaCurl(
      "/api/sessions/feed",
      () => notify(sessionId, { type: "harness_start", runId: "r1", agentId: "heartbeat" }),
    )

    expect(events.length).toBeGreaterThanOrEqual(1)
    const parsed = JSON.parse(events[0])
    expect(parsed.type).toBe("session_start")
    expect(parsed.sessionId).toBe(sessionId)
  }, 10000)

  test("pushes session_end on harness_end", async () => {
    const sessionId = 888887

    const events = await readSSEViaCurl(
      "/api/sessions/feed",
      () => notify(sessionId, { type: "harness_end", runId: "r1", agentId: "heartbeat" }),
    )

    expect(events.length).toBeGreaterThanOrEqual(1)
    const parsed = JSON.parse(events[0])
    expect(parsed.type).toBe("session_end")
    expect(parsed.sessionId).toBe(sessionId)
  }, 10000)
})

describe("GET /api/sessions active field", () => {
  test("sessions include active boolean field", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/sessions`)
    const data = await res.json()

    expect(Array.isArray(data)).toBe(true)
    for (const session of data) {
      expect(typeof session.active).toBe("boolean")
    }
  })

  test("tracks active state via harness_start and harness_end", async () => {
    const sessionId = 777777

    await notify(sessionId, { type: "harness_start", runId: "r1", agentId: "heartbeat" })
    await new Promise((r) => setTimeout(r, 200))

    await notify(sessionId, { type: "harness_end", runId: "r1", agentId: "heartbeat" })
    await new Promise((r) => setTimeout(r, 200))

    const res = await fetch(`http://localhost:${TEST_PORT}/api/sessions`)
    const data = await res.json()
    const match = data.find((s: any) => s.id === sessionId)
    if (match) {
      expect(match.active).toBe(false)
    }
  })
})
