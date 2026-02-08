import { describe, test, expect } from "bun:test"
import { splitMessage, renderViewContent, renderViewNodes } from "../util"
import type { ViewNode, ViewContent } from "llm-gateway/packages/ai/client"

function makeNode(overrides: Partial<ViewNode> & { content: ViewContent }): ViewNode {
  return {
    id: "n1",
    runId: "r1",
    role: "assistant",
    status: "complete",
    branches: [],
    ...overrides,
  }
}

describe("splitMessage", () => {
  test("returns single-element array for short text", () => {
    expect(splitMessage("hello", 2000)).toEqual(["hello"])
  })

  test("returns single-element array for text at exactly maxLen", () => {
    const text = "a".repeat(2000)
    expect(splitMessage(text, 2000)).toEqual([text])
  })

  test("splits text over maxLen into multiple chunks", () => {
    const line = "a".repeat(100)
    const text = Array(25).fill(line).join("\n") // 25 * 100 + 24 newlines = 2524
    const chunks = splitMessage(text, 2000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000)
    }
    // Rejoining should give back the original text
    expect(chunks.join("\n")).toBe(text)
  })

  test("does not split inside a code block", () => {
    // Build text: normal line, code block, normal line
    // The code block should not be line-split in the middle
    const codeLine = "x".repeat(80)
    const codeBlock = "```\n" + Array(5).fill(codeLine).join("\n") + "\n```"
    // codeBlock is 4 + (5*80 + 4) + 4 = 412 chars — fits in a single 500-char chunk
    const text = "before\n" + codeBlock + "\nafter"
    const chunks = splitMessage(text, 500)
    // The code block content should appear intact in one chunk
    const joined = chunks.join("\n")
    expect(joined).toContain(codeBlock)
  })

  test("returns single-element array for empty string", () => {
    expect(splitMessage("", 2000)).toEqual([""])
  })

  test("hard-splits a single long line that exceeds maxLen", () => {
    const text = "a".repeat(5000)
    const chunks = splitMessage(text, 2000)
    expect(chunks).toEqual([
      "a".repeat(2000),
      "a".repeat(2000),
      "a".repeat(1000),
    ])
  })
})

describe("renderViewContent", () => {
  test("renders text content", () => {
    expect(renderViewContent({ kind: "text", text: "hello world" })).toBe("hello world")
  })

  test("renders reasoning as blockquote italic", () => {
    expect(renderViewContent({ kind: "reasoning", text: "thinking" })).toBe("> *thinking*")
  })

  test("renders multiline reasoning with blockquotes on each line", () => {
    expect(renderViewContent({ kind: "reasoning", text: "line1\nline2" })).toBe("> *line1\n> line2*")
  })

  test("renders tool_call as inline code", () => {
    expect(renderViewContent({ kind: "tool_call", name: "search", input: {} })).toBe("`search`")
  })

  test("renders error with bold prefix", () => {
    expect(renderViewContent({ kind: "error", message: "something broke" })).toBe("**Error:** something broke")
  })

  test("renders pending as italic thinking", () => {
    expect(renderViewContent({ kind: "pending" })).toBe("*thinking...*")
  })

  test("renders user as empty string", () => {
    expect(renderViewContent({ kind: "user", content: "hi" })).toBe("")
  })

  test("renders relay as empty string", () => {
    expect(renderViewContent({ kind: "relay", relayKind: "permission", toolCallId: "t1", tool: "bash", params: {} })).toBe("")
  })
})

describe("renderViewNodes", () => {
  test("skips user-role nodes", () => {
    const nodes: ViewNode[] = [
      makeNode({ role: "user", content: { kind: "user", content: "hello" } }),
    ]
    expect(renderViewNodes(nodes)).toBe("")
  })

  test("renders assistant text nodes", () => {
    const nodes: ViewNode[] = [
      makeNode({ content: { kind: "text", text: "response" } }),
    ]
    expect(renderViewNodes(nodes)).toBe("response")
  })

  test("joins multiple nodes with newlines", () => {
    const nodes: ViewNode[] = [
      makeNode({ id: "n1", content: { kind: "text", text: "line1" } }),
      makeNode({ id: "n2", content: { kind: "tool_call", name: "search", input: {} } }),
    ]
    expect(renderViewNodes(nodes)).toBe("line1\n`search`")
  })

  test("skips nodes that render to empty string", () => {
    const nodes: ViewNode[] = [
      makeNode({ id: "n1", content: { kind: "text", text: "visible" } }),
      makeNode({ id: "n2", role: "user", content: { kind: "user", content: "hidden" } }),
      makeNode({ id: "n3", content: { kind: "text", text: "also visible" } }),
    ]
    expect(renderViewNodes(nodes)).toBe("visible\nalso visible")
  })

  test("renders branches recursively", () => {
    const branch: ViewNode[] = [
      makeNode({ id: "b1", content: { kind: "text", text: "branch response" } }),
    ]
    const nodes: ViewNode[] = [
      makeNode({ id: "n1", content: { kind: "tool_call", name: "subagent", input: {} }, branches: [branch] }),
    ]
    expect(renderViewNodes(nodes)).toBe("`subagent`\nbranch response")
  })

  test("returns empty string for empty array", () => {
    expect(renderViewNodes([])).toBe("")
  })
})
