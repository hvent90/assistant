import { createSignalQueue } from "./queue"
import { createStatusBoard } from "./status-board"
import { createDiscordChannel } from "./discord"
import { startConversationAgent } from "./conversation-agent"
import { startHeartbeatAgent } from "./heartbeat-agent"
import { initDb, shutdown as shutdownDb } from "./db"

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID!
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "claude-sonnet-4-20250514"
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 1800000)

async function main() {
  console.log("assistant starting...")

  // Initialize DB
  initDb(DATABASE_URL)
  console.log("database connected")

  // Create shared primitives
  const queue = createSignalQueue()
  const statusBoard = createStatusBoard()

  // Start Discord bot
  const discord = createDiscordChannel({
    token: DISCORD_BOT_TOKEN,
    allowedChannelIds: [DISCORD_CHANNEL_ID],
    queue,
  })
  await discord.start()
  console.log("discord bot online")

  // Start conversation agent
  startConversationAgent({
    queue,
    discord,
    statusBoard,
    model: DEFAULT_MODEL,
  })
  console.log("conversation agent ready")

  // Start heartbeat agent
  const heartbeat = startHeartbeatAgent({
    discord,
    statusBoard,
    model: DEFAULT_MODEL,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    defaultChannelId: DISCORD_CHANNEL_ID,
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
