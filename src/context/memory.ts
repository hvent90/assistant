import { readFile } from "node:fs/promises"
import { join } from "node:path"

export type MemoryFiles = {
  soul: string | null
  user: string | null
  instructions: string | null
}

export async function readMemoryFiles(memoriesDir: string): Promise<MemoryFiles> {
  const [soul, user, instructions] = await Promise.all([
    readFile(join(memoriesDir, "soul.md"), "utf-8").catch(() => null),
    readFile(join(memoriesDir, "user.md"), "utf-8").catch(() => null),
    readFile(join(memoriesDir, "instructions.md"), "utf-8").catch(() => null),
  ])
  return { soul, user, instructions }
}
