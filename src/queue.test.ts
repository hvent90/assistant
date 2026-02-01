import { describe, test, expect } from "bun:test"
import { createSignalQueue } from "./queue"

describe("SignalQueue", () => {
  test("drain returns empty array when queue is empty", () => {
    const q = createSignalQueue()
    expect(q.drain()).toEqual([])
  })

  test("drain returns all pushed signals and empties the queue", () => {
    const q = createSignalQueue()
    const sig1 = { type: "message" as const, source: "discord", content: [{ type: "text" as const, text: "hello" }], timestamp: 1 }
    const sig2 = { type: "message" as const, source: "discord", content: [{ type: "text" as const, text: "world" }], timestamp: 2 }
    q.push(sig1)
    q.push(sig2)

    const drained = q.drain()
    expect(drained).toEqual([sig1, sig2])
    expect(q.drain()).toEqual([])
  })

  test("push during drain does not include new signal", () => {
    const q = createSignalQueue()
    q.push({ type: "message" as const, source: "discord", content: null, timestamp: 1 })
    const drained = q.drain()
    expect(drained).toHaveLength(1)

    q.push({ type: "message" as const, source: "discord", content: null, timestamp: 2 })
    const drained2 = q.drain()
    expect(drained2).toHaveLength(1)
  })

  test("onSignal callback fires when signal is pushed", () => {
    const q = createSignalQueue()
    let called = false
    q.onSignal(() => { called = true })
    q.push({ type: "message" as const, source: "discord", content: null, timestamp: 1 })
    expect(called).toBe(true)
  })
})
