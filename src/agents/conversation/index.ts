import type { SignalQueue } from "../../queue"
import { spawnConversationRun, type ConversationRunOpts } from "./run"

export type { ConversationRunOpts } from "./run"

export function startConversationAgent(opts: ConversationRunOpts) {
  const { queue } = opts
  let running = false

  async function runOnce() {
    const signals = queue.drain()
    if (signals.length === 0) return

    running = true
    try {
      await spawnConversationRun(opts, signals)
    } catch (err) {
      console.error("conversation agent error:", err)
    } finally {
      running = false
      // Re-check: messages may have arrived while we were running.
      // Safe in single-threaded event loop — drain() runs synchronously
      // before yielding, so no concurrent runOnce() invocations are possible.
      runOnce()
    }
  }

  // When a signal arrives and we're not running, start a run
  queue.onSignal(() => {
    if (!running) runOnce()
  })

  return { runOnce }
}
