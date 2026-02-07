process.env.TZ = "America/Los_Angeles"

import { describe, test, expect } from "bun:test"
import { formatLocalTime } from "../format-time"

describe("formatLocalTime", () => {
  test("formats a date in local timezone", () => {
    // 2026-02-04T23:15:00Z = 2026-02-04 3:15 PM PST (UTC-8)
    const date = new Date("2026-02-04T23:15:00Z")
    const result = formatLocalTime(date)
    // Should contain the date and time in a human-readable format
    expect(result).toContain("Feb")
    expect(result).toContain("4")
    expect(result).toContain("2026")
    expect(result).toContain("3:15")
    expect(result).toContain("PM")
  })

  test("returns a string, not ISO format", () => {
    const result = formatLocalTime(new Date())
    // ISO format looks like "2026-02-04T23:15:00.000Z"
    expect(result).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(result).not.toMatch(/\d{2}:\d{2}:\d{2}.*Z$/)
  })
})
