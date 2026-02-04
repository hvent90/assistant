import { describe, test, expect } from "bun:test"
import { nodesToMessages } from "./projection"
import type { Node } from "llm-gateway/packages/ai/client"

describe("nodesToMessages", () => {
  test("converts text nodes to assistant message", () => {
    const nodes: Node[] = [
      { id: "t1", runId: "r1", kind: "text", content: "hello world" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "assistant", content: "hello world" },
    ])
  })

  test("converts tool_call and tool_result to assistant + tool messages", () => {
    const nodes: Node[] = [
      { id: "tc1", runId: "r1", kind: "tool_call", name: "bash", input: { cmd: "ls" } },
      { id: "tc1:result", runId: "r1", kind: "tool_result", name: "bash", output: "file.txt" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "tc1", name: "bash", arguments: { cmd: "ls" } }] },
      { role: "tool", tool_call_id: "tc1", content: "file.txt" },
    ])
  })

  test("converts user nodes to user messages", () => {
    const nodes: Node[] = [
      { id: "u1", runId: "r1", kind: "user", content: "what time is it?" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "user", content: "what time is it?" },
    ])
  })

  test("skips reasoning nodes", () => {
    const nodes: Node[] = [
      { id: "r1r", runId: "r1", kind: "reasoning", content: "let me think..." },
      { id: "t1", runId: "r1", kind: "text", content: "answer" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!).toEqual({ role: "assistant", content: "answer" })
  })

  test("skips usage and error nodes", () => {
    const nodes: Node[] = [
      { id: "r1:usage:1", runId: "r1", kind: "usage", inputTokens: 100, outputTokens: 50 },
      { id: "r1:error", runId: "r1", kind: "error", message: "oops" },
      { id: "t1", runId: "r1", kind: "text", content: "recovered" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toHaveLength(1)
  })

  test("groups adjacent text into single assistant message", () => {
    const nodes: Node[] = [
      { id: "t1", runId: "r1", kind: "text", content: "first" },
      { id: "t2", runId: "r1", kind: "text", content: "second" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "assistant", content: "first\nsecond" },
    ])
  })

  test("tool_call between text creates separate assistant messages", () => {
    const nodes: Node[] = [
      { id: "t1", runId: "r1", kind: "text", content: "before" },
      { id: "tc1", runId: "r1", kind: "tool_call", name: "bash", input: "ls" },
      { id: "tc1:result", runId: "r1", kind: "tool_result", name: "bash", output: "files" },
      { id: "t2", runId: "r1", kind: "text", content: "after" },
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toHaveLength(4)
    expect(msgs[0]).toEqual({ role: "assistant", content: "before" })
    expect(msgs[1]).toEqual({ role: "assistant", content: null, tool_calls: [{ id: "tc1", name: "bash", arguments: "ls" }] })
    expect(msgs[2]).toEqual({ role: "tool", tool_call_id: "tc1", content: "files" })
    expect(msgs[3]).toEqual({ role: "assistant", content: "after" })
  })

  test("user nodes with ContentPart[] preserve structured content", () => {
    const nodes: Node[] = [
      { id: "u1", runId: "r1", kind: "user", content: [
        { type: "text", text: "what is this?" },
        { type: "image", mediaType: "image/png", data: "base64..." },
      ]},
    ]
    const msgs = nodesToMessages(nodes)
    expect(msgs).toEqual([
      { role: "user", content: [
        { type: "text", text: "what is this?" },
        { type: "image", mediaType: "image/png", data: "base64..." },
      ]},
    ])
  })
})
