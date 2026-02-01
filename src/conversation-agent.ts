import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/anthropic"
import { bashTool } from "llm-gateway/packages/ai/tools/bash"
import { buildContext } from "./context"
import { appendMessage, getRecentMessages } from "./db"
import type { SignalQueue } from "./queue"
import type { DiscordChannel } from "./discord"
import type { ContentBlock } from "./types"
import type { createStatusBoard } from "./status-board"

type ConversationAgentOpts = {
  queue: SignalQueue
  discord: DiscordChannel
  statusBoard: ReturnType<typeof createStatusBoard>
  model: string
}

export function startConversationAgent(opts: ConversationAgentOpts) {
  const { queue, discord, statusBoard, model } = opts
  let running = false

  async function runOnce() {
    const signals = queue.drain()
    if (signals.length === 0) return

    running = true
    statusBoard.update("conversation", { status: "running", detail: "responding to user" })

    try {
      // Determine which channel to respond to
      const channelId = signals.find((s) => s.channelId)?.channelId

      // Persist inbound messages
      for (const sig of signals) {
        if (sig.content) {
          await appendMessage({
            role: "user",
            content: sig.content,
            source: sig.source,
            channelId: sig.channelId,
            agent: "conversation",
          })
        }
      }

      // Build context
      const history = await getRecentMessages(50)
      const messages = buildContext({ signals, history, statusBoard: statusBoard.get() })

      // Create harness and run agent
      const providerHarness = createGeneratorHarness()
      const agentHarness = createAgentHarness({ harness: providerHarness })
      const orchestrator = new AgentOrchestrator(agentHarness)

      orchestrator.spawn({
        model,
        messages,
        tools: [bashTool],
        permissions: {
          allowlist: [{ tool: "bash", params: { command: "**" } }],
        },
      })

      // Collect assistant response and stream to Discord
      let fullText = ""
      for await (const { event } of orchestrator.events()) {
        if (event.type === "text") {
          fullText += event.content
        }
        if (event.type === "error") {
          console.error("agent error:", event.error)
        }
      }

      // Send response to Discord
      if (fullText && channelId) {
        await discord.send(channelId, fullText)
      }

      // Persist assistant response
      if (fullText) {
        const content: ContentBlock[] = [{ type: "text", text: fullText }]
        await appendMessage({
          role: "assistant",
          content,
          source: "conversation",
          agent: "conversation",
        })
      }
    } catch (err) {
      console.error("conversation agent error:", err)
    } finally {
      running = false
      statusBoard.update("conversation", { status: "idle", detail: null })

      // Re-check: messages may have arrived while we were running.
      // The onSignal callback skips when running is true, so those signals
      // sit in the queue unprocessed. Calling runOnce() here drains them.
      // runOnce() bails immediately if the queue is empty, so this is a no-op
      // in the common case. Not awaited to avoid unbounded stack growth.
      runOnce()
    }
  }

  // When a signal arrives and we're not running, start a run
  queue.onSignal(() => {
    if (!running) {
      runOnce()
    }
  })

  return { runOnce }
}
