import { AgentOrchestrator } from "llm-gateway/packages/ai/orchestrator"
import { createAgentHarness } from "llm-gateway/packages/ai/harness/agent"
import { createGeneratorHarness } from "llm-gateway/packages/ai/harness/providers/anthropic"
import { bashTool } from "llm-gateway/packages/ai/tools/bash"
import { buildContext } from "./context"
import { getRecentMessages } from "./db"
import type { DiscordChannel } from "./discord"
import type { Signal } from "./types"
import type { createStatusBoard } from "./status-board"

type HeartbeatAgentOpts = {
  discord: DiscordChannel
  statusBoard: ReturnType<typeof createStatusBoard>
  model: string
  intervalMs: number
  defaultChannelId: string
}

export function startHeartbeatAgent(opts: HeartbeatAgentOpts) {
  const { discord, statusBoard, model, intervalMs, defaultChannelId } = opts
  let running = false
  let timer: ReturnType<typeof setInterval>

  async function tick() {
    if (running) return // skip if already running

    running = true
    statusBoard.update("heartbeat", { status: "running", detail: "reflecting on recent activity" })

    try {
      const signal: Signal = {
        type: "heartbeat",
        source: "cron",
        content: null,
        timestamp: Date.now(),
      }

      const history = await getRecentMessages(50)
      const messages = buildContext({ signals: [signal], history, statusBoard: statusBoard.get() })

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

      let fullText = ""
      for await (const { event } of orchestrator.events()) {
        if (event.type === "text") {
          fullText += event.content
        }
        if (event.type === "error") {
          console.error("heartbeat agent error:", event.error)
        }
      }

      // If the agent produced output, send it to Discord
      if (fullText && !fullText.toLowerCase().includes("[no action needed]")) {
        await discord.send(defaultChannelId, fullText)
      }
    } catch (err) {
      console.error("heartbeat agent error:", err)
    } finally {
      running = false
      statusBoard.update("heartbeat", { status: "idle", detail: null })
    }
  }

  timer = setInterval(tick, intervalMs)

  return {
    tick,
    stop() {
      clearInterval(timer)
    },
  }
}
