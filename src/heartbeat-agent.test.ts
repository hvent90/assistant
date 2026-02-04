import { describe, test, expect } from "bun:test"
import { computeStartDelay } from "./agents/heartbeat"

describe("computeStartDelay", () => {
  const intervalMs = 1800000 // 30 min
  const now = 1000000000000

  test("returns 0 when no previous tick (first run)", () => {
    expect(computeStartDelay(null, intervalMs, now)).toBe(0)
  })

  test("returns 0 when overdue", () => {
    const lastTick = now - intervalMs - 1000
    expect(computeStartDelay(lastTick, intervalMs, now)).toBe(0)
  })

  test("returns remaining time when not yet due", () => {
    const lastTick = now - 10000
    expect(computeStartDelay(lastTick, intervalMs, now)).toBe(intervalMs - 10000)
  })

  test("returns 0 when exactly at interval", () => {
    const lastTick = now - intervalMs
    expect(computeStartDelay(lastTick, intervalMs, now)).toBe(0)
  })
})
