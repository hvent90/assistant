import { join } from "node:path"
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools"
import { readTool, writeTool } from "./tools"
import { buildConversationContext } from "./context"
import { readMemoryFiles } from "./memory"
import { appendMessage, getSessionMessages, ensureCurrentSession } from "./db"
import { collectAgentOutput } from "./collect"
import type { SignalQueue } from "./queue"
import type { DiscordChannel } from "./discord"
import type { Node } from "llm-gateway/packages/ai/client"
import type { StatusBoardInstance } from "./types"

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
      const sessionId = await ensureCurrentSession()
      const history = await getSessionMessages(sessionId)

      // Persist inbound messages
      for (let i = 0; i < signals.length; i++) {
        const sig = signals[i]!
        if (sig.content) {
          const userNode: Node = {
            id: `user-${sig.timestamp}-${i}`,
            runId: `signal-${sig.timestamp}`,
            kind: "user" as const,
            content: sig.content.length === 1 && sig.content[0]!.type === "text"
              ? sig.content[0]!.text
              : sig.content,
          }
          await appendMessage({
            role: "user",
            content: [userNode],
            source: sig.source,
            channelId: sig.channelId,
            agent: "conversation",
            sessionId,
          })
        }
      }

      // Build context
      const memory = await readMemoryFiles(memoriesDir)
      const repoRoot = join(memoriesDir, "..")
      const messages = buildConversationContext({ signals, history, statusBoard: statusBoard.get(), memory, memoriesDir, repoRoot })

      // Create harness and run agent
      const providerHarness = createGeneratorHarness()
      const agentHarness = createAgentHarness({ harness: providerHarness })
      const orchestrator = new AgentOrchestrator(agentHarness)

      orchestrator.spawn({
        model,
        messages,
        tools: [bashTool, readTool, writeTool],
        permissions: {
          allowlist: [{ tool: "bash" }, { tool: "read" }, { tool: "write" }],
        },
      })

      // Stream response to Discord while collecting nodes
      const renderer = channelId ? discord.createStreamRenderer(channelId) : null

      const nodes = await collectAgentOutput(
        orchestrator.events(),
        renderer?.onEvent,
      )

      if (renderer) {
        await renderer.flush()
      }

      // Persist assistant response
      if (nodes.length > 0) {
        await appendMessage({
          role: "assistant",
          content: nodes,
          source: "conversation",
          agent: "conversation",
          sessionId,
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
