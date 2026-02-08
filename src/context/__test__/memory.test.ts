import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { readMemoryFiles } from ".."
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"

const TEST_DIR = join(import.meta.dir, "../../.test-memories")

describe("readMemoryFiles", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  test("returns null for both when directory does not exist", async () => {
    const result = await readMemoryFiles("/tmp/nonexistent-memory-dir-xyz")
    expect(result.soul).toBeNull()
    expect(result.user).toBeNull()
  })

  test("reads soul.md when it exists", async () => {
    await writeFile(join(TEST_DIR, "soul.md"), "I am helpful.")
    const result = await readMemoryFiles(TEST_DIR)
    expect(result.soul).toBe("I am helpful.")
  })

  test("reads user.md when it exists", async () => {
    await writeFile(join(TEST_DIR, "user.md"), "User likes TypeScript.")
    const result = await readMemoryFiles(TEST_DIR)
    expect(result.user).toBe("User likes TypeScript.")
  })

  test("returns null for missing files even when directory exists", async () => {
    const result = await readMemoryFiles(TEST_DIR)
    expect(result.soul).toBeNull()
    expect(result.user).toBeNull()
  })

  test("reads both files when both exist", async () => {
    await writeFile(join(TEST_DIR, "soul.md"), "soul content")
    await writeFile(join(TEST_DIR, "user.md"), "user content")
    const result = await readMemoryFiles(TEST_DIR)
    expect(result.soul).toBe("soul content")
    expect(result.user).toBe("user content")
  })
})
