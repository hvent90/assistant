import { StrictMode, useState, useEffect, useCallback, useRef } from "react"
import { createRoot } from "react-dom/client"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Sidebar } from "./components/Sidebar"
import { ConversationThread } from "./components/ConversationThread"
import { ScheduledTasksView } from "./components/ScheduledTasksView"
import type { ScheduledTask } from "./components/ScheduledTasksView"
import { nodesToGraph } from "./graph"
import { useSessionStream } from "./hooks/useSessionStream"
import { useSessionFeed } from "./hooks/useSessionFeed"
import type { Graph, Node } from "llm-gateway/packages/ai/client"
import "./index.css"

type Agent = "heartbeat" | "conversation" | "scheduled"

interface Session {
  id: number
  createdAt: string
  preview: string
  active: boolean
}

interface TriggeredBy {
  id: number
  prompt: string
  fireAt: string
}

interface SessionDetail {
  id: number
  createdAt: string
  nodes: Node[]
  triggeredBy?: TriggeredBy | null
}

function parseHash(): { agent: Agent; sessionId: number | null } {
  const hash = window.location.hash.replace(/^#\/?/, "")
  const parts = hash.split("/")
  const agent: Agent = parts[0] === "conversation" ? "conversation" : parts[0] === "scheduled" ? "scheduled" : "heartbeat"
  const sessionId = parts[1] ? parseInt(parts[1], 10) : null
  return { agent, sessionId: sessionId && !isNaN(sessionId) ? sessionId : null }
}

function App() {
  const initial = parseHash()
  const [agent, setAgent] = useState<Agent>(initial.agent)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<number | null>(initial.sessionId)
  const [restGraph, setRestGraph] = useState<Graph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const suppressHashUpdate = useRef(false)
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
  const [triggeredBy, setTriggeredBy] = useState<TriggeredBy | null>(null)

  // Subscribe to the sidebar lifecycle feed
  const { activeSessions, feedEvent } = useSessionFeed()

  // Refetch session list and active session detail when a feed event arrives
  useEffect(() => {
    if (!feedEvent || agent === "scheduled") return
    fetch(`/api/sessions?agent=${agent}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: Session[]) => setSessions(data))
      .catch(() => {})
    // If the event is for the currently viewed session, refetch detail
    // to pick up any just-persisted messages (e.g. user message before streaming starts)
    if (feedEvent.type === "session_start" && feedEvent.sessionId === activeId) {
      fetch(`/api/sessions/${activeId}?agent=${agent}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((data: SessionDetail) => {
          setRestGraph(nodesToGraph(data.nodes))
          setTriggeredBy(data.triggeredBy ?? null)
        })
        .catch(() => {})
    }
  }, [feedEvent, agent, activeId])

  // Determine if the currently selected session is live
  const selectedSession = sessions.find((s) => s.id === activeId)
  const isSessionActive = selectedSession?.active ?? activeSessions.has(activeId!)

  // Stream hook — only active when viewing a live session
  const { graph: streamGraph, isStreaming } = useSessionStream(
    isSessionActive ? activeId : null,
    isSessionActive,
    restGraph,
  )

  // Use streaming graph only when session is active, otherwise REST graph
  const graph = isSessionActive ? (streamGraph ?? restGraph) : restGraph

  // When streaming ends, immediately preserve the stream graph as rest graph
  // so there's no gap when isSessionActive flips to false, then refetch for canonical state
  const prevStreaming = useRef(false)
  useEffect(() => {
    if (prevStreaming.current && !isStreaming && activeId !== null) {
      if (streamGraph) {
        setRestGraph(streamGraph)
      }
      fetch(`/api/sessions/${activeId}?agent=${agent}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((data: SessionDetail) => {
          setRestGraph(nodesToGraph(data.nodes))
          setTriggeredBy(data.triggeredBy ?? null)
        })
        .catch(() => {})
    }
    prevStreaming.current = isStreaming
  }, [isStreaming, activeId, agent, streamGraph])

  const loadSession = useCallback((id: number) => {
    setActiveId(id)
    setRestGraph(null)
    setTriggeredBy(null)
    window.location.hash = `#/${agent}/${id}`

    // Always fetch REST data (provides history for streaming to build on)
    fetch(`/api/sessions/${id}?agent=${agent}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: SessionDetail) => {
        setRestGraph(nodesToGraph(data.nodes))
        setTriggeredBy(data.triggeredBy ?? null)
      })
      .catch((err) => setError(err.message))
  }, [agent])

  // Fetch sessions when agent changes
  useEffect(() => {
    if (agent === "scheduled") {
      fetch("/api/scheduled-tasks")
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((data: ScheduledTask[]) => setScheduledTasks(data))
        .catch((err) => setError(err.message))
      return
    }
    fetch(`/api/sessions?agent=${agent}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: Session[]) => {
        setSessions(data)
        // If we have an activeId from hash, load it; otherwise load the first session
        if (activeId !== null) {
          loadSession(activeId)
        } else if (data.length > 0) {
          loadSession(data[0]!.id)
        }
      })
      .catch((err) => setError(err.message))
  }, [agent]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for hashchange to support browser back/forward
  useEffect(() => {
    const onHashChange = () => {
      if (suppressHashUpdate.current) {
        suppressHashUpdate.current = false
        return
      }
      const parsed = parseHash()
      if (parsed.agent !== agent) {
        setAgent(parsed.agent)
        setSessions([])
        setActiveId(parsed.sessionId)
        setRestGraph(null)
      } else if (parsed.sessionId !== activeId) {
        if (parsed.sessionId !== null) {
          loadSession(parsed.sessionId)
        } else {
          setActiveId(null)
          setRestGraph(null)
        }
      }
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [agent, activeId, loadSession])

  // Set initial hash if none present
  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = `#/${agent}`
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAgentChange = useCallback((newAgent: Agent) => {
    if (newAgent === agent) return
    setSessions([])
    setScheduledTasks([])
    setActiveId(null)
    setRestGraph(null)
    setAgent(newAgent)
    window.location.hash = `#/${newAgent}`
  }, [agent])

  const handleBack = useCallback(() => {
    setActiveId(null)
    setRestGraph(null)
    window.location.hash = `#/${agent}`
  }, [agent])

  return (
    <div className="flex h-dvh bg-black text-white">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={loadSession}
        agent={agent}
        onAgentChange={handleAgentChange}
        activeSessions={activeSessions}
        className={agent === "scheduled" ? "hidden md:flex" : activeId !== null ? "hidden md:flex" : "flex"}
      />
      <main className={`flex-1 flex-col overflow-y-auto p-4 ${agent === "scheduled" ? "flex" : activeId === null ? "hidden md:flex" : "flex"}`}>
        {agent !== "scheduled" && (
          <button
            onClick={handleBack}
            className="mb-3 text-sm text-neutral-500 hover:text-white md:hidden"
          >
            &larr; sessions
          </button>
        )}
        {error && (
          <div className="mb-4 border border-neutral-700 p-3 text-sm text-red-400">
            error: {error}
          </div>
        )}
        {triggeredBy && agent === "heartbeat" && (
          <a
            href={`/#/scheduled`}
            className="mb-3 block border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-400 hover:text-white"
          >
            Triggered by scheduled task #{triggeredBy.id}: {triggeredBy.prompt.length > 80 ? triggeredBy.prompt.slice(0, 80) + "..." : triggeredBy.prompt}
          </a>
        )}
        {isStreaming && (
          <div className="mb-3 flex items-center gap-2 text-sm text-green-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-400" />
            live
          </div>
        )}
        {agent === "scheduled" ? (
          <ScheduledTasksView tasks={scheduledTasks} />
        ) : graph ? (
          <ConversationThread graph={graph} agent={agent} />
        ) : activeId !== null ? (
          <div className="flex h-full items-center justify-center text-neutral-600">
            loading...
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-600">
            select a session from the sidebar.
          </div>
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
