import { join } from "node:path"
import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { bashTool } from "llm-gateway/packages/ai/tools"
import { createSpeakTool, readTool, writeTool } from "./tools"
import { buildHeartbeatContext } from "./context"
import { readMemoryFiles } from "./memory"
import { appendMessage, createSession, getKv, setKv } from "./db"
import type { SignalQueue } from "./queue"
import type { DiscordChannel } from "./discord"
import { collectAgentOutput } from "./collect"
import type { StatusBoardInstance } from "./types"

export function computeStartDelay(lastTickMs: number | null, intervalMs: number, nowMs: number = Date.now()): number {
  if (lastTickMs === null) return 0
  const elapsed = nowMs - lastTickMs
  if (elapsed >= intervalMs) return 0
  return intervalMs - elapsed
}

const LAST_TICK_KEY = "heartbeat_last_tick_at"

type HeartbeatAgentOpts = {
  queue: SignalQueue
  discord: DiscordChannel
  statusBoard: StatusBoardInstance
  model: string
  intervalMs: number
  memoriesDir: string
}

export async function startHeartbeatAgent(opts: HeartbeatAgentOpts) {
  const { queue, discord, statusBoard, model, intervalMs, memoriesDir } = opts
  let running = false
  let timerId: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>

  const speakTool = createSpeakTool(queue)

  async function tick() {
    if (running) return
    running = true
    await statusBoard.update("heartbeat", { status: "running", detail: "reflecting on recent activity" })

    try {
      const sessionId = await createSession()
      const memory = await readMemoryFiles(memoriesDir)
      const repoRoot = join(memoriesDir, "..")
      const messages = buildHeartbeatContext({ statusBoard: statusBoard.get(), memory, memoriesDir, repoRoot })

      const providerHarness = createGeneratorHarness()
      const agentHarness = createAgentHarness({ harness: providerHarness })
      const orchestrator = new AgentOrchestrator(agentHarness)

      orchestrator.spawn({
        model,
        messages,
        tools: [bashTool, readTool, writeTool, speakTool],
        permissions: {
          allowlist: [{ tool: "bash" }, { tool: "read" }, { tool: "write" }, { tool: "speak" }],
        },
      })

      const nodes = await collectAgentOutput(orchestrator.events())

      if (nodes.length > 0) {
        await appendMessage({
          role: "assistant",
          content: nodes,
          source: "heartbeat",
          agent: "heartbeat",
          sessionId,
        })
      }

      await setKv(LAST_TICK_KEY, { timestamp: Date.now() })
    } catch (err) {
      console.error("heartbeat agent error:", err)
    } finally {
      running = false
      await statusBoard.update("heartbeat", { status: "idle", detail: null })
    }
  }

  // Compute start delay from persisted state
  const stored = await getKv(LAST_TICK_KEY) as { timestamp: number } | null
  const lastTickMs = stored?.timestamp ?? null
  const delay = computeStartDelay(lastTickMs, intervalMs)

  if (delay === 0) {
    tick() // fire immediately (don't await — let it run in background)
    timerId = setInterval(tick, intervalMs)
  } else {
    timerId = setTimeout(() => {
      tick()
      timerId = setInterval(tick, intervalMs)
    }, delay)
  }

  return {
    tick,
    stop() {
      clearTimeout(timerId as ReturnType<typeof setTimeout>)
      clearInterval(timerId as ReturnType<typeof setInterval>)
    },
  }
}
