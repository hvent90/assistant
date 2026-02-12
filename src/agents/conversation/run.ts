import { join } from "node:path"
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools"
import { discoverSkills, formatSkillsPrompt } from "llm-gateway/packages/ai/skills"
import { createScheduleTool, scheduleListTool, scheduleEditTool, scheduleCancelTool, readTool, writeTool } from "../../tools"
import { buildConversationContext } from "./context"
import { readMemoryFiles, collectAgentOutput } from "../../context"
import { appendMessage, getSessionMessages, ensureCurrentSession } from "../../db"
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

export function signalToPersisted(sig: Signal, index: number): {
  role: "user" | "assistant"
  content: Node[]
  source: string
  channelId?: string
} {
  const textContent = sig.content!.length === 1 && sig.content![0]!.type === "text"
    ? sig.content![0]!.text
    : sig.content!

  if (sig.type === "heartbeat") {
    return {
      role: "assistant",
      content: [{
        id: `heartbeat-${sig.timestamp}-${index}`,
        runId: `signal-${sig.timestamp}`,
        kind: "text" as const,
        content: textContent,
      }],
      source: sig.source,
    }
  }

  return {
    role: "user",
    content: [{
      id: `user-${sig.timestamp}-${index}`,
      runId: `signal-${sig.timestamp}`,
      kind: "user" as const,
      content: textContent,
    }],
    source: sig.source,
    channelId: sig.channelId,
  }
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

    // Persist inbound signals
    for (let i = 0; i < signals.length; i++) {
      const sig = signals[i]!
      if (sig.content) {
        const persisted = signalToPersisted(sig, i)
        await appendMessage({
          ...persisted,
          agent: "conversation",
          sessionId,
        })
      }
    }

    // Build context
    const memory = await readMemoryFiles(memoriesDir)
    const repoRoot = join(memoriesDir, "..")
    const skills = await discoverSkills([join(repoRoot, ".agent/skills")])
    const skillsPrompt = formatSkillsPrompt(skills)
    const messages = buildConversationContext({ signals, history, statusBoard: statusBoard.get(), memory, memoriesDir, repoRoot, skillsPrompt })

    const scheduleTool = createScheduleTool()

    // Create harness and run agent
    const providerHarness = createGeneratorHarness()
    const agentHarness = createAgentHarness({ harness: providerHarness })
    const orchestrator = new AgentOrchestrator(agentHarness)

    orchestrator.spawn({
      model,
      messages,
      tools: [bashTool, readTool, writeTool, scheduleTool, scheduleListTool, scheduleEditTool, scheduleCancelTool],
      permissions: {
        allowlist: [{ tool: "bash" }, { tool: "read" }, { tool: "write" }, { tool: "schedule" }, { tool: "schedule_list" }, { tool: "schedule_edit" }, { tool: "schedule_cancel" }],
      },
    })

    // Stream response to Discord while collecting nodes
    const viewerBase = process.env.VIEWER_BASE_URL
    const viewerPrefix = viewerBase ? `[view session](${viewerBase}/#/conversation/${sessionId})` : undefined
    const renderer = channelId ? discord.createStreamRenderer(channelId, { prefix: viewerPrefix }) : null
    const nodes = await collectAgentOutput(orchestrator.events(), renderer?.onEvent, sessionId)
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
