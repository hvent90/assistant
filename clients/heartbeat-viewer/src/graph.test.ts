import { test, expect } from "bun:test"
import { nodesToGraph } from "./graph"
import type { Node } from "llm-gateway/packages/ai/client"

test("empty array produces empty graph", () => {
  const graph = nodesToGraph([])
  expect(graph.nodes.size).toBe(0)
  expect(graph.edges.size).toBe(0)
})

test("single node produces graph with no edges", () => {
  const nodes: Node[] = [
    { id: "a", runId: "r1", kind: "text", content: "hello" },
  ]
  const graph = nodesToGraph(nodes)
  expect(graph.nodes.size).toBe(1)
  expect(graph.nodes.get("a")).toEqual(nodes[0])
  expect(graph.edges.size).toBe(0)
})

test("sequential nodes in same run get edges", () => {
  const nodes: Node[] = [
    { id: "a", runId: "r1", kind: "text", content: "hello" },
    { id: "b", runId: "r1", kind: "tool_call", name: "bash", input: "ls" },
    { id: "c", runId: "r1", kind: "tool_result", name: "bash", output: "file.txt" },
  ]
  const graph = nodesToGraph(nodes)
  expect(graph.edges.get("a")).toEqual(["b"])
  expect(graph.edges.get("b")).toEqual(["c"])
  expect(graph.edges.has("c")).toBe(false)
})

test("nodes in different runs get no cross-edges", () => {
  const nodes: Node[] = [
    { id: "a", runId: "r1", kind: "text", content: "hello" },
    { id: "b", runId: "r2", kind: "text", content: "world" },
  ]
  const graph = nodesToGraph(nodes)
  expect(graph.edges.size).toBe(0)
})

test("lastNodeByRunId tracks last node per run", () => {
  const nodes: Node[] = [
    { id: "a", runId: "r1", kind: "text", content: "hello" },
    { id: "b", runId: "r1", kind: "text", content: "world" },
    { id: "c", runId: "r2", kind: "text", content: "other" },
  ]
  const graph = nodesToGraph(nodes)
  expect(graph.lastNodeByRunId.get("r1")).toBe("b")
  expect(graph.lastNodeByRunId.get("r2")).toBe("c")
})
