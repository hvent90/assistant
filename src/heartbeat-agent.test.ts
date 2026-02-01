import { describe, test, expect } from "bun:test"
import { computeStartDelay } from "./heartbeat-agent"

describe("computeStartDelay", () => {
  const intervalMs = 1800000 // 30 min

  test("returns 0 when no previous tick (first run)", () => {
    expect(computeStartDelay(null, intervalMs)).toBe(0)
  })

  test("returns 0 when overdue", () => {
    const lastTick = Date.now() - intervalMs - 1000 // 1s overdue
    expect(computeStartDelay(lastTick, intervalMs)).toBe(0)
  })

  test("returns remaining time when not yet due", () => {
    const elapsed = 10000 // 10s ago
    const lastTick = Date.now() - elapsed
    const delay = computeStartDelay(lastTick, intervalMs)
    // Should be approximately intervalMs - elapsed (within 50ms tolerance for test execution)
    expect(delay).toBeGreaterThan(intervalMs - elapsed - 50)
    expect(delay).toBeLessThanOrEqual(intervalMs - elapsed)
  })

  test("returns 0 when exactly at interval", () => {
    const lastTick = Date.now() - intervalMs
    expect(computeStartDelay(lastTick, intervalMs)).toBe(0)
  })
})
