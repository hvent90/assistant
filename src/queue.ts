import type { Signal } from "./types"

export type SignalQueue = {
  push(signal: Signal): void
  drain(): Signal[]
  onSignal(cb: () => void): void
}

export function createSignalQueue(): SignalQueue {
  let buffer: Signal[] = []
  let listener: (() => void) | null = null

  return {
    push(signal) {
      buffer.push(signal)
      listener?.()
    },
    drain() {
      const drained = buffer
      buffer = []
      return drained
    },
    onSignal(cb) {
      listener = cb
    },
  }
}
