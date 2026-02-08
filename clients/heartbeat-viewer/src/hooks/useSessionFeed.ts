import { useState, useEffect, useRef } from "react"

export interface FeedEvent {
  type: "session_start" | "session_end"
  sessionId: number
}

interface InitialEvent {
  type: "initial"
  activeSessions: number[]
}

export function useSessionFeed() {
  const [activeSessions, setActiveSessions] = useState<Set<number>>(new Set())
  const [feedEvent, setFeedEvent] = useState<FeedEvent | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource("/api/sessions/feed")
    esRef.current = es

    es.onmessage = (msg) => {
      let data: FeedEvent | InitialEvent
      try {
        data = JSON.parse(msg.data)
      } catch {
        return
      }

      // Seed active sessions from server on initial connect
      if (data.type === "initial") {
        setActiveSessions(new Set((data as InitialEvent).activeSessions))
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

      setFeedEvent(data as FeedEvent)
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  return { activeSessions, feedEvent }
}
