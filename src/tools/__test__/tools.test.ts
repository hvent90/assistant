import { describe, test, expect, afterAll } from "bun:test"
import { readTool, writeTool, createSpeakTool } from ".."
import { createSignalQueue } from "../../queue"
import { join } from "path"
import { tmpdir } from "os"
import { unlink, rm } from "fs/promises"

const tempDir = join(tmpdir(), `tools-test-${Date.now()}`)
const tempFiles: string[] = []

afterAll(async () => {
  for (const f of tempFiles) {
    try { await unlink(f) } catch {}
  }
  try { await rm(tempDir, { recursive: true }) } catch {}
})

describe("readTool", () => {
  test("reads an existing file and returns its content", async () => {
    const filePath = join(tempDir, "read-test.txt")
    await Bun.write(filePath, "hello from readTool test")
    tempFiles.push(filePath)

    const result = await readTool.execute({ path: filePath })
    expect(result.result).toBe("hello from readTool test")
  })

  test("returns error message for non-existent file", async () => {
    const filePath = join(tempDir, "does-not-exist.txt")
    const result = await readTool.execute({ path: filePath })
    expect(result.result).toContain("Error reading")
  })
})

describe("writeTool", () => {
  test("writes content to a new file and creates parent dirs", async () => {
    const filePath = join(tempDir, "subdir", "write-test.txt")
    tempFiles.push(filePath)

    const result = await writeTool.execute({ path: filePath, content: "written by writeTool" })
    expect(result.result).toContain("Wrote")
    expect(result.result).toContain("20 bytes")

    const written = await Bun.file(filePath).text()
    expect(written).toBe("written by writeTool")
  })
})

describe("createSpeakTool", () => {
  test("pushes a signal to the queue when executed", async () => {
    const queue = createSignalQueue()
    const speakTool = createSpeakTool(queue)

    const result = await speakTool.execute({ thought: "Remind user about their dentist appointment" })
    expect(result.result).toContain("Queued message")

    const signals = queue.drain()
    expect(signals).toHaveLength(1)
    expect(signals[0].type).toBe("heartbeat")
    expect(signals[0].source).toBe("heartbeat")
    expect(signals[0].content).toEqual([{ type: "text", text: "Remind user about their dentist appointment" }])
  })
})
