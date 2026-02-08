import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Client } from "pg"
import { initDb, publishEvent, shutdown } from ".."

const DATABASE_URL = "postgres://assistant:assistant@localhost:5434/assistant"

describe("publishEvent", () => {
  let listener: Client

  beforeAll(async () => {
    initDb(DATABASE_URL)
    listener = new Client({ connectionString: DATABASE_URL })
    await listener.connect()
    await listener.query("LISTEN agent_events")
  })

  afterAll(async () => {
    await listener.end()
    await shutdown()
  })

  test("sends notification on agent_events channel", async () => {
    const sessionId = 42
    const event = { type: "text", runId: "r1", id: "t1", content: "hello" }

    const notificationPromise = new Promise<{ channel: string; payload: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for notification")), 5000)
      listener.once("notification", (msg) => {
        clearTimeout(timeout)
        resolve({ channel: msg.channel, payload: msg.payload! })
      })
    })

    await publishEvent(sessionId, event)

    const notification = await notificationPromise
    expect(notification.channel).toBe("agent_events")
    const parsed = JSON.parse(notification.payload)
    expect(parsed.sessionId).toBe(42)
    expect(parsed.event).toEqual(event)
  })

  test("truncates payload exceeding 7500 bytes", async () => {
    const sessionId = 1
    const largeContent = "x".repeat(8000)
    const event = { type: "tool_result", runId: "r1", id: "tr1", output: largeContent }

    const notificationPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for notification")), 5000)
      listener.once("notification", (msg) => {
        clearTimeout(timeout)
        resolve(msg.payload!)
      })
    })

    await publishEvent(sessionId, event)

    const payload = await notificationPromise
    expect(payload.length).toBeLessThanOrEqual(8000)
    const parsed = JSON.parse(payload)
    expect(parsed.sessionId).toBe(1)
    expect(parsed.truncated).toBe(true)
  })
})
