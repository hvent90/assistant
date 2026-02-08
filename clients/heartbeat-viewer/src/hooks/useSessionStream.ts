import { useState, useEffect, useRef, useCallback } from "react"
import { createGraph, reduceEvent } from "llm-gateway/packages/ai/client"
import type { Graph, GraphEvent } from "llm-gateway/packages/ai/client"

interface UseSessionStreamResult {
  graph: Graph | null
  isStreaming: boolean
}

/**
 * Normalize an SSE event into a GraphEvent that reduceEvent() can process.
 * Events from pg_notify are ConsumerHarnessEvent objects which may lack agentId
 * and have `error: {...}` instead of `message: string`.
 */
function toGraphEvent(raw: Record<string, unknown>): GraphEvent | null {
  const type = raw.type as string
  if (!type) return null

  // Skip "connected" events
  if (type === "connected") return null

  // Error events: ConsumerHarnessEvent has `error: Error` (serialized as `{}` or `{message}`),
  // but GraphEvent expects `message: string`
  if (type === "error") {
    const errObj = raw.error as Record<string, unknown> | undefined
    const message = (raw.message as string) ?? (errObj?.message as string) ?? "unknown error"
    return {
      type: "error",
      runId: raw.runId as string,
      agentId: (raw.agentId as string) ?? "agent",
      parentId: raw.parentId as string | undefined,
      message,
    }
  }

  // Lifecycle events need agentId
  if (type === "harness_start" || type === "harness_end") {
    return {
      ...raw,
      type,
      agentId: (raw.agentId as string) ?? "agent",
    } as GraphEvent
  }

  return raw as GraphEvent
}

/**
 * Hook that streams live events from an active session via SSE,
 * building a Graph incrementally with reduceEvent() and RAF batching.
 *
 * Accepts an optional initialGraph (from REST) so streaming appends
 * to existing conversation history rather than starting empty.
 */
export function useSessionStream(
  sessionId: number | null,
  active: boolean,
  initialGraph?: Graph | null,
): UseSessionStreamResult {
  const [graph, setGraph] = useState<Graph | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  // Refs for RAF batching
  const graphRef = useRef<Graph>(createGraph())
  const pendingEvents = useRef<GraphEvent[]>([])
  const rafId = useRef<number>(0)
  const initialGraphRef = useRef<Graph | null>(null)
  initialGraphRef.current = initialGraph ?? null

  // If REST data arrives while already streaming with an empty graph, seed it in
  useEffect(() => {
    if (isStreaming && initialGraph && graphRef.current.nodes.size === 0) {
      graphRef.current = initialGraph
      setGraph(initialGraph)
    }
  }, [initialGraph, isStreaming])

  const flushEvents = useCallback(() => {
    rafId.current = 0
    if (pendingEvents.current.length === 0) return

    let g = graphRef.current
    for (const event of pendingEvents.current) {
      g = reduceEvent(g, event)
    }
    pendingEvents.current = []
    graphRef.current = g
    setGraph(g)
  }, [])

  useEffect(() => {
    if (!active || sessionId === null) {
      // Don't null the graph — keep last state for smooth transition back to REST
      setIsStreaming(false)
      return
    }

    // Seed from REST history if available, otherwise start empty
    const seed = initialGraphRef.current ?? createGraph()
    graphRef.current = seed
    pendingEvents.current = []
    setGraph(seed.nodes.size > 0 ? seed : null)
    setIsStreaming(true)

    const baseUrl = (import.meta as any).env?.VITE_BACKEND_URL ?? ""
    const es = new EventSource(`${baseUrl}/api/sessions/${sessionId}/stream`)

    es.onmessage = (msg) => {
      let raw: Record<string, unknown>
      try {
        raw = JSON.parse(msg.data)
      } catch {
        return
      }

      // Handle harness_end — stream is complete
      if (raw.type === "harness_end") {
        const graphEvent = toGraphEvent(raw)
        if (graphEvent) {
          pendingEvents.current.push(graphEvent)
        }
        // Flush immediately on end
        if (rafId.current) cancelAnimationFrame(rafId.current)
        let g = graphRef.current
        for (const event of pendingEvents.current) {
          g = reduceEvent(g, event)
        }
        pendingEvents.current = []
        graphRef.current = g
        setGraph(g)
        setIsStreaming(false)
        return
      }

      const graphEvent = toGraphEvent(raw)
      if (!graphEvent) return

      pendingEvents.current.push(graphEvent)
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(flushEvents)
      }
    }

    es.onerror = () => {
      setIsStreaming(false)
      es.close()
    }

    return () => {
      es.close()
      if (rafId.current) cancelAnimationFrame(rafId.current)
      pendingEvents.current = []
      setIsStreaming(false)
    }
  }, [sessionId, active, flushEvents])

  return { graph, isStreaming }
}
