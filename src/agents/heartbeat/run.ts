import { join } from "node:path"
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools"
import { discoverSkills, formatSkillsPrompt } from "llm-gateway/packages/ai/skills"
import { createSpeakTool, createScheduleTool, scheduleListTool, scheduleEditTool, scheduleCancelTool, readTool, writeTool } from "../../tools"
import { buildHeartbeatContext } from "./context"
import { readMemoryFiles, collectAgentOutput } from "../../context"
import { appendMessage, createSession, getRecentMessages } from "../../db"
import type { SignalQueue } from "../../queue"
import type { StatusBoardInstance } from "../../types"

export type HeartbeatRunOpts = {
  queue: SignalQueue
  statusBoard: StatusBoardInstance
  model: string
  memoriesDir: string
}

export async function spawnHeartbeatRun(opts: HeartbeatRunOpts, addendum?: string): Promise<number> {
  const { queue, statusBoard, model, memoriesDir } = opts

  await statusBoard.update("heartbeat", { status: "running", detail: addendum ? "executing scheduled task" : "reflecting on recent activity" })

  try {
    const sessionId = await createSession()
    const [memory, recentHistory] = await Promise.all([
      readMemoryFiles(memoriesDir),
      getRecentMessages(20),
    ])
    const repoRoot = join(memoriesDir, "..")
    const skills = await discoverSkills([join(repoRoot, ".agent/skills")])
    const skillsPrompt = formatSkillsPrompt(skills)
    const messages = buildHeartbeatContext({ statusBoard: statusBoard.get(), memory, memoriesDir, repoRoot, addendum, skillsPrompt, recentHistory })

    const speakTool = createSpeakTool(queue)
    const scheduleTool = createScheduleTool()

    const providerHarness = createGeneratorHarness()
    const agentHarness = createAgentHarness({ harness: providerHarness })
    const orchestrator = new AgentOrchestrator(agentHarness)

    orchestrator.spawn({
      model,
      messages,
      tools: [bashTool, readTool, writeTool, speakTool, scheduleTool, scheduleListTool, scheduleEditTool, scheduleCancelTool],
      permissions: {
        allowlist: [{ tool: "bash" }, { tool: "read" }, { tool: "write" }, { tool: "speak" }, { tool: "schedule" }, { tool: "schedule_list" }, { tool: "schedule_edit" }, { tool: "schedule_cancel" }],
      },
    })

    const nodes = await collectAgentOutput(orchestrator.events(), undefined, sessionId)

    if (nodes.length > 0) {
      await appendMessage({
        role: "assistant",
        content: nodes,
        source: addendum ? "scheduled" : "heartbeat",
        agent: "heartbeat",
        sessionId,
      })
    }

    return sessionId
  } finally {
    await statusBoard.update("heartbeat", { status: "idle", detail: null })
  }
}
