import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { createSignalQueue } from "./queue"
import { createStatusBoard } from "./status-board"
import { createDiscordChannel } from "./discord"
import { startConversationAgent } from "./conversation-agent"
import { startHeartbeatAgent } from "./heartbeat-agent"
import { initDb, ping, shutdown as shutdownDb } from "./db"

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "glm-4.7"
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 1800000)
const DISCORD_ALLOWED_USERNAME = process.env.DISCORD_ALLOWED_USERNAME
const MEMORIES_DIR = join(import.meta.dir, "../memories")

async function main() {
  console.log("assistant starting...")

  // Initialize and verify DB connection
  initDb(DATABASE_URL)
  await ping()
  console.log("database connected")

  // Ensure memories directories exist
  await mkdir(join(MEMORIES_DIR, "diary"), { recursive: true })

  // Create shared primitives
  const queue = createSignalQueue()
  const statusBoard = await createStatusBoard()

  // Start Discord bot (listens for DMs)
  const discord = createDiscordChannel({
    token: DISCORD_BOT_TOKEN,
    queue,
    allowedUsername: DISCORD_ALLOWED_USERNAME,
  })
  await discord.start()
  console.log("discord bot online")

  // Start conversation agent
  startConversationAgent({
    queue,
    discord,
    statusBoard,
    model: DEFAULT_MODEL,
    memoriesDir: MEMORIES_DIR,
  })
  console.log("conversation agent ready")

  // Start heartbeat agent
  const heartbeat = await startHeartbeatAgent({
    queue,
    discord,
    statusBoard,
    model: DEFAULT_MODEL,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    memoriesDir: MEMORIES_DIR,
  })
  console.log(`heartbeat agent ready (interval: ${HEARTBEAT_INTERVAL_MS}ms)`)

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("shutting down...")
    heartbeat.stop()
    discord.destroy()
    await shutdownDb()
    process.exit(0)
  })

  process.on("SIGTERM", async () => {
    console.log("shutting down...")
    heartbeat.stop()
    discord.destroy()
    await shutdownDb()
    process.exit(0)
  })

  console.log("assistant is running")
}

main().catch((err) => {
  console.error("fatal:", err)
  process.exit(1)
})
