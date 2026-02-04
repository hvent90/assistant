import { createGraph, reduceEvent } from "llm-gateway/packages/ai/client"
import type { Graph, Node } from "llm-gateway/packages/ai/client"
import type { ConsumerHarnessEvent } from "llm-gateway/packages/ai/orchestrator"

type OrchestratorEvent = { agentId: string; event: ConsumerHarnessEvent }

const LIFECYCLE_KINDS = new Set(["harness_start", "harness_end"])

function toGraphEvent(event: ConsumerHarnessEvent, agentId: string) {
  if (event.type === "error") {
    return { ...event, type: "error" as const, message: event.error.message, agentId }
  }
  return { ...event, agentId }
}

export async function collectAgentOutput(
  events: AsyncIterable<OrchestratorEvent>,
  onEvent?: (event: ConsumerHarnessEvent, graph: Graph) => void,
): Promise<Node[]> {
  let graph: Graph = createGraph()

  for await (const { agentId, event } of events) {
    const graphEvent = toGraphEvent(event, agentId)
    graph = reduceEvent(graph, graphEvent)
    onEvent?.(event, graph)
  }

  return Array.from(graph.nodes.values()).filter((n) => !LIFECYCLE_KINDS.has(n.kind))
}
