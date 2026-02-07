import { getKv, setKv } from "../../db"
import { spawnHeartbeatRun, type HeartbeatRunOpts } from "./run"

export { spawnHeartbeatRun } from "./run"

export function computeStartDelay(lastTickMs: number | null, intervalMs: number, nowMs: number = Date.now()): number {
  if (lastTickMs === null) return 0
  const elapsed = nowMs - lastTickMs
  if (elapsed >= intervalMs) return 0
  return intervalMs - elapsed
}

const LAST_TICK_KEY = "heartbeat_last_tick_at"

type StartHeartbeatOpts = HeartbeatRunOpts & {
  intervalMs: number
}

export async function startHeartbeatAgent(opts: StartHeartbeatOpts) {
  const { intervalMs, ...runOpts } = opts
  let timerId: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>

  async function tick() {
    try {
      await spawnHeartbeatRun(runOpts)
      await setKv(LAST_TICK_KEY, { timestamp: Date.now() })
    } catch (err) {
      console.error("heartbeat agent error:", err)
    }
  }

  const stored = await getKv(LAST_TICK_KEY) as { timestamp: number } | null
  const lastTickMs = stored?.timestamp ?? null
  const delay = computeStartDelay(lastTickMs, intervalMs)

  if (delay === 0) {
    tick()
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
