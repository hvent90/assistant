import { Client, GatewayIntentBits, Partials, SlashCommandBuilder, type DMChannel, type Message } from "discord.js"
import { createGraph, projectThread } from "llm-gateway/packages/ai/client"
import type { Graph, ViewNode, ViewContent } from "llm-gateway/packages/ai/client"
import type { ConsumerHarnessEvent } from "llm-gateway/packages/ai/orchestrator"
import type { SignalQueue } from "./queue"
import { getKv, setKv, createSession } from "./db"

const DM_CHANNEL_KEY = "discord_dm_channel_id"

// Events that trigger a Discord message update (not streaming deltas)
const UPDATE_EVENTS = new Set(["harness_start", "harness_end", "tool_call", "tool_result", "error"])

function renderViewContent(content: ViewContent): string {
  switch (content.kind) {
    case "text":
      return content.text
    case "reasoning":
      return `> *${content.text.split("\n").join("\n> ")}*`
    case "tool_call": {
      const input = typeof content.input === "string" ? content.input : JSON.stringify(content.input)
      return `\`\`\`\n${content.name}: ${input}\n\`\`\``
    }
    case "error":
      return `**Error:** ${content.message}`
    case "pending":
      return "*thinking...*"
    case "user":
    case "relay":
      return ""
  }
}

function renderViewNodes(nodes: ViewNode[]): string {
  const parts: string[] = []
  for (const node of nodes) {
    if (node.role === "user") continue
    const text = renderViewContent(node.content)
    if (text) parts.push(text)
    // Render branches (subagent responses nested under tool calls)
    for (const branch of node.branches) {
      const branchText = renderViewNodes(branch)
      if (branchText) parts.push(branchText)
    }
  }
  return parts.join("\n")
}

export type DiscordChannel = {
  start(): Promise<void>
  send(channelId: string, text: string): Promise<void>
  createStreamRenderer(channelId: string): {
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

  let ownerDmChannelId: string | null = null
  const loaded = getKv(DM_CHANNEL_KEY).then((v) => {
    if (v && typeof v === "object" && "channelId" in v) {
      ownerDmChannelId = (v as { channelId: string }).channelId
    }
  }).catch(() => {})

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return
    if (!message.channel.isDMBased()) return
    if (opts.allowedUsername && message.author.username !== opts.allowedUsername) return

    // Track the DM channel for proactive messaging
    ownerDmChannelId = message.channel.id
    setKv(DM_CHANNEL_KEY, { channelId: message.channel.id }).catch(() => {})

    const content: Array<Record<string, unknown>> = []

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

  client.once("ready", async () => {
    if (!client.application) return
    const clear = new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Start a new conversation session")
    await client.application.commands.set([clear])
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
    createStreamRenderer(channelId: string) {
      let msg: Message | null = null
      let hasUnsentReasoning = false
      let pendingRender: string | null = null
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      let channelRef: DMChannel | null = null
      let latestGraph: Graph = createGraph()

      const getChannel = async () => {
        if (!channelRef) {
          const ch = await client.channels.fetch(channelId)
          if (!ch?.isTextBased()) throw new Error("Channel not text-based")
          channelRef = ch as DMChannel
        }
        return channelRef
      }

      const flushUpdate = async () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer)
          debounceTimer = null
        }
        if (!pendingRender) return
        const content = pendingRender
        pendingRender = null
        const ch = await getChannel()
        const chunks = splitMessage(content, 1500)
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!
          if (i === 0) {
            if (!msg) {
              msg = await ch.send(chunk)
            } else {
              await msg.edit(chunk).catch(console.error)
            }
          } else {
            await ch.send(chunk)
          }
        }
      }

      const scheduleUpdate = (rendered: string) => {
        pendingRender = rendered
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(flushUpdate, 1000)
      }

      return {
        onEvent(event: ConsumerHarnessEvent, graph: Graph) {
          latestGraph = graph

          if (event.type === "reasoning") {
            hasUnsentReasoning = true
            return
          }

          const shouldUpdate =
            UPDATE_EVENTS.has(event.type) ||
            (hasUnsentReasoning && (event.type === "text" || event.type === "tool_call"))

          if (hasUnsentReasoning && (event.type === "text" || event.type === "tool_call")) {
            hasUnsentReasoning = false
          }

          if (!shouldUpdate) return

          const viewNodes = projectThread(graph)
          const rendered = renderViewNodes(viewNodes)
          if (rendered) scheduleUpdate(rendered)
        },
        async flush() {
          const viewNodes = projectThread(latestGraph)
          const finalRendered = renderViewNodes(viewNodes)
          if (finalRendered) {
            pendingRender = finalRendered
            await flushUpdate()
          }
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
