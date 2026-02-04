import { join } from "node:path"
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools"
import { createScheduleTool, readTool, writeTool } from "../../tools"
import { buildConversationContext } from "./context"
import { readMemoryFiles } from "../../memory"
import { appendMessage, getSessionMessages, ensureCurrentSession } from "../../db"
import { collectAgentOutput } from "../../collect"
import type { Signal } from "../../types"
import type { Node } from "llm-gateway/packages/ai/client"
import type { DiscordChannel } from "../../discord"
import type { StatusBoardInstance } from "../../types"
import type { SignalQueue } from "../../queue"

export type ConversationRunOpts = {
  queue: SignalQueue
  discord: DiscordChannel
  statusBoard: StatusBoardInstance
  model: string
  memoriesDir: string
}

export async function spawnConversationRun(opts: ConversationRunOpts, signals: Signal[]): Promise<void> {
  const { discord, statusBoard, model, memoriesDir } = opts

  await statusBoard.update("conversation", { status: "running", detail: "responding to user" })

  try {
    // Determine which channel to respond to
    const channelId = signals.find((s) => s.channelId)?.channelId
      ?? await discord.dmChannelId().catch(() => undefined as string | undefined)

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

    const scheduleTool = createScheduleTool()

    // Create harness and run agent
    const providerHarness = createGeneratorHarness()
    const agentHarness = createAgentHarness({ harness: providerHarness })
    const orchestrator = new AgentOrchestrator(agentHarness)

    orchestrator.spawn({
      model,
      messages,
      tools: [bashTool, readTool, writeTool, scheduleTool],
      permissions: {
        allowlist: [{ tool: "bash" }, { tool: "read" }, { tool: "write" }, { tool: "schedule" }],
      },
    })

    // Stream response to Discord while collecting nodes
    const renderer = channelId ? discord.createStreamRenderer(channelId) : null
    const nodes = await collectAgentOutput(orchestrator.events(), renderer?.onEvent)
    if (renderer) await renderer.flush()

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
  } finally {
    await statusBoard.update("conversation", { status: "idle", detail: null })
  }
}
