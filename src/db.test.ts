import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { initDb, shutdown, getKv, setKv } from "./db"

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
