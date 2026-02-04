import { join } from "node:path"
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools"
import { createSpeakTool, createScheduleTool, readTool, writeTool } from "../../tools"
import { buildHeartbeatContext } from "./context"
import { readMemoryFiles } from "../../memory"
import { appendMessage, createSession } from "../../db"
import { collectAgentOutput } from "../../collect"
import type { SignalQueue } from "../../queue"
import type { StatusBoardInstance } from "../../types"

export type HeartbeatRunOpts = {
  queue: SignalQueue
  statusBoard: StatusBoardInstance
  model: string
  memoriesDir: string
}

export async function spawnHeartbeatRun(opts: HeartbeatRunOpts, addendum?: string): Promise<void> {
  const { queue, statusBoard, model, memoriesDir } = opts

  await statusBoard.update("heartbeat", { status: "running", detail: addendum ? "executing scheduled task" : "reflecting on recent activity" })

  try {
    const sessionId = await createSession()
    const memory = await readMemoryFiles(memoriesDir)
    const repoRoot = join(memoriesDir, "..")
    const messages = buildHeartbeatContext({ statusBoard: statusBoard.get(), memory, memoriesDir, repoRoot, addendum })

    const speakTool = createSpeakTool(queue)
    const scheduleTool = createScheduleTool()

    const providerHarness = createGeneratorHarness()
    const agentHarness = createAgentHarness({ harness: providerHarness })
    const orchestrator = new AgentOrchestrator(agentHarness)

    orchestrator.spawn({
      model,
      messages,
      tools: [bashTool, readTool, writeTool, speakTool, scheduleTool],
      permissions: {
        allowlist: [{ tool: "bash" }, { tool: "read" }, { tool: "write" }, { tool: "speak" }, { tool: "schedule" }],
      },
    })

    const nodes = await collectAgentOutput(orchestrator.events())

    if (nodes.length > 0) {
      await appendMessage({
        role: "assistant",
        content: nodes,
        source: addendum ? "scheduled" : "heartbeat",
        agent: "heartbeat",
        sessionId,
      })
    }
  } finally {
    await statusBoard.update("heartbeat", { status: "idle", detail: null })
  }
}
