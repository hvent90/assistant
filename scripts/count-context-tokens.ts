import { join, dirname } from "path"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { initDb, getRecentMessages } from "../src/db"
import { readMemoryFiles } from "../src/memory"
import { buildConversationContext } from "../src/context"
import type { StatusBoard } from "../src/types"

const __dirname = dirname(fileURLToPath(import.meta.url))
const envFile = readFileSync(join(__dirname, "../.env"), "utf-8")
const dbUrl =
  envFile.match(/DATABASE_URL=(.+)/)?.[1] ??
  "postgres://assistant:assistant@localhost:5434/assistant"

initDb(dbUrl)

const memoriesDir = join(__dirname, "../memories")
const repoRoot = join(__dirname, "..")

const [history, memory] = await Promise.all([
  getRecentMessages(50),
  readMemoryFiles(memoriesDir),
])

const statusBoard: StatusBoard = {
  conversation: { status: "idle", detail: null },
  heartbeat: { status: "idle", detail: null },
}

const messages = buildConversationContext({
  signals: [],
  history,
  statusBoard,
  memory,
  memoriesDir,
  repoRoot,
})

let totalChars = 0

console.log("=== Conversation Agent Context ===\n")

for (const msg of messages) {
  const chars = msg.content.length
  totalChars += chars
  const preview =
    msg.content.length > 120
      ? msg.content.slice(0, 120).replace(/\n/g, "\\n") + "..."
      : msg.content.replace(/\n/g, "\\n")
  console.log(`[${msg.role}] ${chars} chars — ${preview}`)
}

const approxTokens = Math.ceil(totalChars / 4)

console.log("\n=== Summary ===")
console.log(`Messages:         ${messages.length}`)
console.log(`Total characters: ${totalChars.toLocaleString()}`)
console.log(`Approx tokens:    ~${approxTokens.toLocaleString()} (chars/4 estimate)`)

process.exit(0)
