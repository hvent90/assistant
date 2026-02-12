import { Client, GatewayIntentBits, Partials, SlashCommandBuilder, type DMChannel, type Message } from "discord.js"
import type { Graph } from "llm-gateway/packages/ai/client"
import type { ConsumerHarnessEvent } from "llm-gateway/packages/ai/orchestrator"
import type { ContentPart } from "llm-gateway/packages/ai/types"
import type { SignalQueue } from "../queue"
import { getKv, setKv, createSession } from "../db"
import { transcribeVoice } from "./transcribe"
import { splitMessage } from "./util"

const DM_CHANNEL_KEY = "discord_dm_channel_id"

export type DiscordChannel = {
  start(): Promise<void>
  send(channelId: string, text: string): Promise<void>
  createStreamRenderer(channelId: string, opts?: { prefix?: string }): {
    onEvent: (event: ConsumerHarnessEvent, graph: Graph) => void
    flush: () => Promise<void>
  }
  dmChannelId(): Promise<string>
  destroy(): void
}

export function createDiscordChannel(opts: {
  token: string
  queue: SignalQueue
  allowedUsername?: string
}): DiscordChannel {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  })

  client.on("error", (err) => console.error("discord client error:", err))
  client.on("warn", (msg) => console.warn("discord warning:", msg))

  let ownerDmChannelId: string | null = null
  const loaded = getKv(DM_CHANNEL_KEY).then((v) => {
    if (v && typeof v === "object" && "channelId" in v) {
      ownerDmChannelId = (v as { channelId: string }).channelId
    }
  }).catch(() => {})

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return
      if (!message.channel.isDMBased()) return
      if (opts.allowedUsername && message.author.username !== opts.allowedUsername) return

      // Track the DM channel for proactive messaging
      ownerDmChannelId = message.channel.id
      setKv(DM_CHANNEL_KEY, { channelId: message.channel.id }).catch(() => {})

      const content: ContentPart[] = []

      if (message.content) {
        content.push({ type: "text", text: message.content })
      }

      for (const attachment of message.attachments.values()) {
        console.log("attachment:", { name: attachment.name, contentType: attachment.contentType, duration: attachment.duration, url: attachment.url?.slice(0, 80) })
        if (attachment.contentType?.startsWith("image/")) {
          const res = await fetch(attachment.url)
          const buf = Buffer.from(await res.arrayBuffer())
          content.push({
            type: "image",
            mediaType: attachment.contentType,
            data: buf.toString("base64"),
          })
        }
        else if (attachment.contentType?.startsWith("audio/") && attachment.duration) {
          console.log("transcribing voice message...")
          const text = await transcribeVoice(attachment.url)
          console.log("transcription result:", text)
          if (text) {
            content.push({ type: "text", text: `[voice message]: ${text}` })
          }
        }
      }

      const discord = {
        type: message.type,
        flags: message.flags.toArray(),
        createdAt: message.createdTimestamp,
        editedAt: message.editedTimestamp,
        pinned: message.pinned,
        tts: message.tts,
        author: { id: message.author.id, username: message.author.username },
        content: message.content || null,
        attachments: [...message.attachments.values()].map(a => ({
          name: a.name,
          contentType: a.contentType,
          size: a.size,
          duration: a.duration,
          waveform: a.waveform,
          width: a.width,
          height: a.height,
          description: a.description,
        })),
        embeds: message.embeds.map(e => e.toJSON()),
        stickers: [...message.stickers.values()].map(s => ({ name: s.name, format: s.format })),
        reference: message.reference,
        poll: message.poll ? { question: message.poll.question.text } : null,
      }

      opts.queue.push({
        type: "message",
        source: "discord",
        content: content.length > 0 ? content : null,
        channelId: message.channel.id,
        metadata: { userId: message.author.id, username: message.author.username, discord },
        timestamp: Date.now(),
      })
    } catch (err) {
      console.error("error handling discord message:", err)
    }
  })

  client.once("ready", async () => {
    if (!client.application) return
    const clear = new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Start a new conversation session")
      .setDMPermission(true)
    try {
      const registered = await client.application.commands.set([clear])
      console.log(`registered ${registered.size} slash command(s)`)
    } catch (err) {
      console.error("failed to register slash commands:", err)
    }
  })

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return
    if (interaction.commandName !== "clear") return
    if (opts.allowedUsername && interaction.user.username !== opts.allowedUsername) return

    const sessionId = await createSession()
    await setKv("current_session_id", { sessionId })
    await interaction.reply({ content: "Session cleared.", ephemeral: true })
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
    createStreamRenderer(channelId: string, opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? ""
      let statusMsg: Message | null = null
      let currentTextId: string | null = null
      let currentText = ""
      let prefixSent = false
      let channelRef: DMChannel | null = null
      let queue: Promise<void> = Promise.resolve()

      const getChannel = async () => {
        if (!channelRef) {
          const ch = await client.channels.fetch(channelId)
          if (!ch?.isTextBased()) throw new Error("Channel not text-based")
          channelRef = ch as DMChannel
        }
        return channelRef
      }

      const enqueue = (fn: () => Promise<void>) => {
        queue = queue.then(fn).catch(console.error)
      }

      const showStatus = () => {
        enqueue(async () => {
          if (statusMsg) return
          const ch = await getChannel()
          statusMsg = await ch.send("*working...*")
        })
      }

      const sendText = () => {
        const text = currentText.trim()
        currentTextId = null
        currentText = ""
        if (!text) return
        const full = (!prefixSent && prefix) ? prefix + "\n" + text : text
        prefixSent = true
        enqueue(async () => {
          const ch = await getChannel()
          for (const chunk of splitMessage(full, 2000)) {
            await ch.send(chunk)
          }
        })
      }

      const deleteStatus = () => {
        enqueue(async () => {
          if (!statusMsg) return
          await statusMsg.delete().catch(console.error)
          statusMsg = null
        })
      }

      return {
        onEvent(event: ConsumerHarnessEvent, _graph: Graph) {
          if (event.type === "harness_start") {
            showStatus()
            return
          }

          if (event.type === "text") {
            // New text block — send the previous one
            if (currentTextId && event.id !== currentTextId) {
              sendText()
            }
            currentTextId = event.id
            currentText += (event as { content: string }).content
            return
          }

          // Non-text event after text accumulation → text block complete
          if (currentText) sendText()

          if (event.type === "tool_call") {
            const name = (event as { name: string }).name
            enqueue(async () => {
              if (!statusMsg) return
              await statusMsg.edit(`*using ${name}...*`).catch(console.error)
            })
            return
          }

          if (event.type === "error") {
            const msg = (event as { error: Error }).error.message
            enqueue(async () => {
              const ch = await getChannel()
              await ch.send(`**Error:** ${msg}`)
            })
          }

          if (event.type === "harness_end") {
            deleteStatus()
          }
        },
        async flush() {
          if (currentText) sendText()
          deleteStatus()
          await queue
        },
      }
    },
    async dmChannelId(): Promise<string> {
      await loaded
      if (!ownerDmChannelId) throw new Error("No DM channel yet — send the bot a message first")
      return ownerDmChannelId
    },
    destroy() {
      client.destroy()
    },
  }
}
