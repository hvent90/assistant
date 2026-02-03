import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/zen"
import { readTool, writeTool } from "./tools"
import { buildHeartbeatContext } from "./context"
import { readMemoryFiles } from "./memory"
import { appendMessage, getKv, setKv } from "./db"
import type { DiscordChannel } from "./discord"
import type { ContentBlock, StatusBoardInstance } from "./types"

export function computeStartDelay(lastTickMs: number | null, intervalMs: number, nowMs: number = Date.now()): number {
  if (lastTickMs === null) return 0
  const elapsed = nowMs - lastTickMs
  if (elapsed >= intervalMs) return 0
  return intervalMs - elapsed
}

const LAST_TICK_KEY = "heartbeat_last_tick_at"

type HeartbeatAgentOpts = {
  discord: DiscordChannel
  statusBoard: StatusBoardInstance
  model: string
  intervalMs: number
  memoriesDir: string
}

export async function startHeartbeatAgent(opts: HeartbeatAgentOpts) {
  const { discord, statusBoard, model, intervalMs, memoriesDir } = opts
  let running = false
  let timerId: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>

  async function tick() {
    if (running) return
    running = true
    await statusBoard.update("heartbeat", { status: "running", detail: "reflecting on recent activity" })

    try {
      const memory = await readMemoryFiles(memoriesDir)
      const messages = buildHeartbeatContext({ statusBoard: statusBoard.get(), memory })

      const providerHarness = createGeneratorHarness()
      const agentHarness = createAgentHarness({ harness: providerHarness })
      const orchestrator = new AgentOrchestrator(agentHarness)

      orchestrator.spawn({
        model,
        messages,
        tools: [readTool, writeTool],
        permissions: {
          allowlist: [{ tool: "read" }, { tool: "write" }],
        },
      })

      let fullText = ""
      for await (const { event } of orchestrator.events()) {
        if (event.type === "text") {
          fullText += event.content
        }
        if (event.type === "error") {
          console.error("heartbeat agent error:", event.error)
        }
      }

      if (fullText && !fullText.toLowerCase().includes("[no action needed]")) {
        try {
          const dmId = await discord.dmChannelId()
          await discord.send(dmId, fullText)
        } catch {
          // No DM channel yet — user hasn't messaged the bot. Skip sending.
        }
      }

      if (fullText) {
        const content: ContentBlock[] = [{ type: "text", text: fullText }]
        await appendMessage({
          role: "assistant",
          content,
          source: "heartbeat",
          agent: "heartbeat",
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
