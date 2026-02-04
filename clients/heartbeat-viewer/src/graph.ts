import type { Node, Graph } from "llm-gateway/packages/ai/client"

export function nodesToGraph(nodes: Node[]): Graph {
  const nodeMap = new Map<string, Node>()
  const edges = new Map<string, string[]>()
  const lastNodeByRunId = new Map<string, string>()

  for (const node of nodes) {
    nodeMap.set(node.id, node)

    const prev = lastNodeByRunId.get(node.runId)
    if (prev) {
      const existing = edges.get(prev)
      if (existing) {
        existing.push(node.id)
      } else {
        edges.set(prev, [node.id])
      }
    }

    lastNodeByRunId.set(node.runId, node.id)
  }

  return { nodes: nodeMap, edges, lastNodeByRunId }
}
