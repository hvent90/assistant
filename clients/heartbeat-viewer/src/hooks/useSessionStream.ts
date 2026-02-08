import { useState, useEffect, useRef, useCallback } from "react"
import { reduceEvent } from "llm-gateway/packages/ai/client"
import type { Graph, GraphEvent } from "llm-gateway/packages/ai/client"

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
 * applying them directly to the parent's graph via setGraph.
 *
 * Single-graph pattern: no internal graph state. Events are applied
 * via reduceEvent() to the same graph that REST data populates.
 * Waits for graphLoaded before connecting to avoid overwrite races.
 */
export function useSessionStream(
  sessionId: number | null,
  active: boolean,
  graphLoaded: boolean,
  setGraph: React.Dispatch<React.SetStateAction<Graph | null>>,
): { isStreaming: boolean } {
  const [isStreaming, setIsStreaming] = useState(false)

  // Refs for RAF batching
  const pendingEvents = useRef<GraphEvent[]>([])
  const rafId = useRef<number>(0)
  const setGraphRef = useRef(setGraph)
  setGraphRef.current = setGraph

  const applyEvents = useCallback((events: GraphEvent[]) => {
    setGraphRef.current((prev) => {
      if (!prev) return prev
      let g = prev
      for (const event of events) g = reduceEvent(g, event)
      return g
    })
  }, [])

  const flushEvents = useCallback(() => {
    rafId.current = 0
    if (pendingEvents.current.length === 0) return
    const batch = pendingEvents.current
    pendingEvents.current = []
    applyEvents(batch)
  }, [applyEvents])

  useEffect(() => {
    if (!active || sessionId === null || !graphLoaded) {
      setIsStreaming(false)
      return
    }

    pendingEvents.current = []
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
        if (graphEvent) pendingEvents.current.push(graphEvent)
        // Flush immediately on end
        if (rafId.current) cancelAnimationFrame(rafId.current)
        const batch = pendingEvents.current
        pendingEvents.current = []
        applyEvents(batch)
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
      // Flush any remaining events before disconnecting
      if (rafId.current) cancelAnimationFrame(rafId.current)
      if (pendingEvents.current.length > 0) {
        const batch = pendingEvents.current
        pendingEvents.current = []
        applyEvents(batch)
      }
      setIsStreaming(false)
    }
  }, [sessionId, active, graphLoaded, flushEvents, applyEvents])

  return { isStreaming }
}
