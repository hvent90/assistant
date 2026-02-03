import { Client, GatewayIntentBits, Partials, type DMChannel, type Message } from "discord.js"
import { createGraph, reduceEvent, projectThread } from "llm-gateway/packages/ai/client"
import type { Graph, ViewNode, ViewContent } from "llm-gateway/packages/ai/client"
import type { ConsumerHarnessEvent } from "llm-gateway/packages/ai/orchestrator"
import type { SignalQueue } from "./queue"
import type { ContentBlock } from "./types"
import { getKv, setKv } from "./db"

const DM_CHANNEL_KEY = "discord_dm_channel_id"

type OrchestratorEvent = { agentId: string; event: ConsumerHarnessEvent }

// Events that trigger a Discord message update (not streaming deltas)
const UPDATE_EVENTS = new Set(["harness_start", "harness_end", "tool_call", "tool_result", "error"])

function toGraphEvent(event: ConsumerHarnessEvent, agentId: string) {
  if (event.type === "error") {
    return { ...event, type: "error" as const, message: event.error.message, agentId }
  }
  return { ...event, agentId }
}

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

function extractFinalText(nodes: ViewNode[]): string {
  const parts: string[] = []
  for (const node of nodes) {
    if (node.role === "user") continue
    if (node.content.kind === "text") {
      parts.push(node.content.text)
    }
    for (const branch of node.branches) {
      parts.push(extractFinalText(branch))
    }
  }
  return parts.join("\n")
}

export type DiscordChannel = {
  start(): Promise<void>
  send(channelId: string, text: string): Promise<void>
  streamResponse(channelId: string, events: AsyncIterable<OrchestratorEvent>): Promise<string>
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
    async streamResponse(channelId: string, events: AsyncIterable<OrchestratorEvent>): Promise<string> {
      const channel = await client.channels.fetch(channelId)
      if (!channel?.isTextBased()) throw new Error("Channel not text-based")

      let graph: Graph = createGraph()
      let msg: Message | null = null
      let hasUnsentReasoning = false
      let pendingRender: string | null = null
      let debounceTimer: ReturnType<typeof setTimeout> | null = null

      const flushUpdate = async () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer)
          debounceTimer = null
        }
        if (!pendingRender) return
        const content = pendingRender
        pendingRender = null
        const chunks = splitMessage(content, 1500)
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!
          if (i === 0) {
            if (!msg) {
              msg = await (channel as DMChannel).send(chunk)
            } else {
              await msg.edit(chunk).catch(console.error)
            }
          } else {
            await (channel as DMChannel).send(chunk)
          }
        }
      }

      const scheduleUpdate = (rendered: string) => {
        pendingRender = rendered
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(flushUpdate, 1000)
      }

      for await (const { agentId, event } of events) {
        const graphEvent = toGraphEvent(event, agentId)
        graph = reduceEvent(graph, graphEvent)

        // Track reasoning - send it when text or tool_call arrives
        if (event.type === "reasoning") {
          hasUnsentReasoning = true
          continue
        }

        // Determine if we should update Discord
        const shouldUpdate =
          UPDATE_EVENTS.has(event.type) ||
          (hasUnsentReasoning && (event.type === "text" || event.type === "tool_call"))

        if (hasUnsentReasoning && (event.type === "text" || event.type === "tool_call")) {
          hasUnsentReasoning = false
        }

        if (!shouldUpdate) continue

        const viewNodes = projectThread(graph)
        const rendered = renderViewNodes(viewNodes)
        if (rendered) scheduleUpdate(rendered)
      }

      // Final update - flush immediately with complete content
      const viewNodes = projectThread(graph)
      const finalRendered = renderViewNodes(viewNodes)
      if (finalRendered) {
        pendingRender = finalRendered
        await flushUpdate()
      }

      return extractFinalText(viewNodes)
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
