import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools/bash"
import { buildConversationContext } from "./context"
import { readMemoryFiles } from "./memory"
import { appendMessage, getRecentMessages } from "./db"
import type { SignalQueue } from "./queue"
import type { DiscordChannel } from "./discord"
import type { ContentBlock, StatusBoardInstance } from "./types"

type ConversationAgentOpts = {
  queue: SignalQueue
  discord: DiscordChannel
  statusBoard: StatusBoardInstance
  model: string
  memoriesDir: string
}

export function startConversationAgent(opts: ConversationAgentOpts) {
  const { queue, discord, statusBoard, model, memoriesDir } = opts
  let running = false

  async function runOnce() {
    const signals = queue.drain()
    if (signals.length === 0) return

    running = true
    await statusBoard.update("conversation", { status: "running", detail: "responding to user" })

    try {
      // Determine which channel to respond to
      const channelId = signals.find((s) => s.channelId)?.channelId

      // Fetch history BEFORE persisting new messages to avoid duplication
      const history = await getRecentMessages(50)

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
      const memory = await readMemoryFiles(memoriesDir)
      const messages = buildConversationContext({ signals, history, statusBoard: statusBoard.get(), memory })

      // Create harness and run agent
      const providerHarness = createGeneratorHarness()
      const agentHarness = createAgentHarness({ harness: providerHarness })
      const orchestrator = new AgentOrchestrator(agentHarness)

      orchestrator.spawn({
        model,
        messages,
        tools: [bashTool],
        permissions: {
          allowlist: [{ tool: "bash" }],
        },
      })

      // Collect assistant response
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
      await statusBoard.update("conversation", { status: "idle", detail: null })
      // Re-check: messages may have arrived while we were running.
      // Safe in single-threaded event loop — drain() runs synchronously
      // before yielding, so no concurrent runOnce() invocations are possible.
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
