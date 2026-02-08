import { describe, test, expect } from "bun:test"
import { collectAgentOutput } from ".."
import type { ConsumerHarnessEvent } from "llm-gateway/packages/ai/orchestrator"

type OrchestratorEvent = { agentId: string; event: ConsumerHarnessEvent }

async function* makeEvents(events: OrchestratorEvent[]): AsyncIterable<OrchestratorEvent> {
  for (const e of events) yield e
}

describe("collectAgentOutput", () => {
  test("collects text nodes from events", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "hello " } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "world" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const textNodes = nodes.filter((n) => n.kind === "text")
    expect(textNodes).toHaveLength(1)
    expect(textNodes[0]!.content).toBe("hello world")
  })

  test("collects reasoning nodes", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "reasoning", runId: "r1", id: "r1r", content: "thinking..." } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "answer" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const reasoning = nodes.filter((n) => n.kind === "reasoning")
    expect(reasoning).toHaveLength(1)
    expect(reasoning[0]!.content).toBe("thinking...")
  })

  test("collects tool_call and tool_result nodes", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "tool_call", runId: "r1", id: "tc1", name: "bash", input: { cmd: "ls" } } },
      { agentId: "a1", event: { type: "tool_result", runId: "r1", id: "tc1", name: "bash", output: "file.txt" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const calls = nodes.filter((n) => n.kind === "tool_call")
    const results = nodes.filter((n) => n.kind === "tool_result")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe("bash")
    expect(results).toHaveLength(1)
    expect(results[0]!.output).toBe("file.txt")
  })

  test("filters out harness_start and harness_end nodes", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "hi" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const lifecycle = nodes.filter((n) => n.kind === "harness_start" || n.kind === "harness_end")
    expect(lifecycle).toHaveLength(0)
  })

  test("calls onEvent callback for each event", async () => {
    const seen: string[] = []
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "text", runId: "r1", id: "t1", content: "hi" } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    await collectAgentOutput(events, (event) => {
      seen.push(event.type)
    })

    expect(seen).toEqual(["harness_start", "text", "harness_end"])
  })

  test("collects error nodes", async () => {
    const events = makeEvents([
      { agentId: "a1", event: { type: "harness_start", runId: "r1" } },
      { agentId: "a1", event: { type: "error", runId: "r1", error: new Error("something broke") } },
      { agentId: "a1", event: { type: "harness_end", runId: "r1" } },
    ])

    const nodes = await collectAgentOutput(events)
    const errors = nodes.filter((n) => n.kind === "error")
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toBe("something broke")
  })
})
