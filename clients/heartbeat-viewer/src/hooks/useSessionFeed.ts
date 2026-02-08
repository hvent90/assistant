import { useState, useEffect, useRef } from "react"

export interface FeedEvent {
  type: "session_start" | "session_end"
  sessionId: number
}

export function useSessionFeed() {
  const [activeSessions, setActiveSessions] = useState<Set<number>>(new Set())
  const [feedEvent, setFeedEvent] = useState<FeedEvent | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource("/api/sessions/feed")
    esRef.current = es

    es.onmessage = (msg) => {
      let data: FeedEvent
      try {
        data = JSON.parse(msg.data)
      } catch {
        return
      }

      if (data.type === "session_start") {
        setActiveSessions((prev) => {
          const next = new Set(prev)
          next.add(data.sessionId)
          return next
        })
      } else if (data.type === "session_end") {
        setActiveSessions((prev) => {
          const next = new Set(prev)
          next.delete(data.sessionId)
          return next
        })
      }

      setFeedEvent(data)
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  return { activeSessions, feedEvent }
}
