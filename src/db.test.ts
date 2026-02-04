import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { initDb, shutdown, getKv, setKv, createSession, getSessionMessages, appendMessage } from "./db"

const TEST_DB = "postgres://assistant:assistant@localhost:5434/assistant"

beforeAll(async () => {
  initDb(TEST_DB)
})

afterAll(async () => {
  await shutdown()
})

describe("kv", () => {
  test("getKv returns null for missing key", async () => {
    const result = await getKv("nonexistent_key_" + Date.now())
    expect(result).toBeNull()
  })

  test("setKv inserts and getKv retrieves", async () => {
    const key = "test_key_" + Date.now()
    await setKv(key, { hello: "world" })
    const result = await getKv(key)
    expect(result).toEqual({ hello: "world" })
  })

  test("setKv upserts existing key", async () => {
    const key = "test_upsert_" + Date.now()
    await setKv(key, { v: 1 })
    await setKv(key, { v: 2 })
    const result = await getKv(key)
    expect(result).toEqual({ v: 2 })
  })
})

describe("sessions", () => {
  test("createSession returns a session id", async () => {
    const id = await createSession()
    expect(typeof id).toBe("number")
    expect(id).toBeGreaterThan(0)
  })

  test("getSessionMessages returns empty array for new session", async () => {
    const sessionId = await createSession()
    const messages = await getSessionMessages(sessionId)
    expect(messages).toEqual([])
  })

  test("appendMessage with sessionId tags the message", async () => {
    const sessionId = await createSession()
    await appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello session" }],
      source: "test",
      sessionId,
    })
    const messages = await getSessionMessages(sessionId)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe("user")
  })

  test("messages from different sessions are isolated", async () => {
    const session1 = await createSession()
    const session2 = await createSession()
    await appendMessage({
      role: "user",
      content: [{ type: "text", text: "session 1 msg" }],
      source: "test",
      sessionId: session1,
    })
    await appendMessage({
      role: "user",
      content: [{ type: "text", text: "session 2 msg" }],
      source: "test",
      sessionId: session2,
    })
    const msgs1 = await getSessionMessages(session1)
    const msgs2 = await getSessionMessages(session2)
    expect(msgs1).toHaveLength(1)
    expect(msgs2).toHaveLength(1)
    expect(msgs1[0]!.content[0]).toEqual({ type: "text", text: "session 1 msg" })
    expect(msgs2[0]!.content[0]).toEqual({ type: "text", text: "session 2 msg" })
  })

  test("appendMessage without sessionId stores null session_id", async () => {
    await appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "heartbeat msg" }],
      source: "heartbeat",
      agent: "heartbeat",
    })
    // Should not appear in any session
    const session = await createSession()
    const messages = await getSessionMessages(session)
    expect(messages).toEqual([])
  })
})
