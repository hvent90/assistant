import { Client, GatewayIntentBits, Partials, type DMChannel } from "discord.js"
import type { SignalQueue } from "./queue"
import type { ContentBlock } from "./types"

export type DiscordChannel = {
  start(): Promise<void>
  send(channelId: string, text: string): Promise<void>
  dmChannelId(): string
  destroy(): void
}

export function createDiscordChannel(opts: {
  token: string
  queue: SignalQueue
}): DiscordChannel {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  })

  let ownerDmChannelId: string | null = null

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return
    if (!message.channel.isDMBased()) return

    // Track the DM channel for proactive messaging
    ownerDmChannelId = message.channel.id

    const content: ContentBlock[] = []

    if (message.content) {
      content.push({ type: "text", text: message.content })
    }

    // Handle attachments
    for (const attachment of message.attachments.values()) {
      if (attachment.contentType?.startsWith("image/")) {
        content.push({ type: "image", path: attachment.url, mimeType: attachment.contentType })
      } else {
        content.push({ type: "file", path: attachment.url, filename: attachment.name ?? "file" })
      }
    }

    if (content.length === 0) return

    opts.queue.push({
      type: "message",
      source: "discord",
      content,
      channelId: message.channel.id,
      metadata: { userId: message.author.id, username: message.author.username },
      timestamp: Date.now(),
    })
  })

  return {
    async start() {
      await client.login(opts.token)
      console.log(`discord bot logged in as ${client.user?.tag}`)
    },
    async send(channelId: string, text: string) {
      const channel = await client.channels.fetch(channelId)
      if (!channel?.isTextBased()) return
      const chunks = splitMessage(text, 2000)
      for (const chunk of chunks) {
        await (channel as DMChannel).send(chunk)
      }
    },
    dmChannelId(): string {
      if (!ownerDmChannelId) throw new Error("No DM channel yet — send the bot a message first")
      return ownerDmChannelId
    },
    destroy() {
      client.destroy()
    },
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen))
    remaining = remaining.slice(maxLen)
  }
  return chunks
}
