import { StrictMode, useState, useEffect, useCallback, useRef } from "react"
import { createRoot } from "react-dom/client"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Sidebar } from "./components/Sidebar"
import { ConversationThread } from "./components/ConversationThread"
import { ScheduledTasksView } from "./components/ScheduledTasksView"
import type { ScheduledTask } from "./components/ScheduledTasksView"
import { nodesToGraph } from "./graph"
import type { Graph, Node } from "llm-gateway/packages/ai/client"
import "./index.css"

type Agent = "heartbeat" | "conversation" | "scheduled"

interface Session {
  id: number
  createdAt: string
  preview: string
}

interface SessionDetail {
  id: number
  createdAt: string
  nodes: Node[]
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
  const [graph, setGraph] = useState<Graph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const suppressHashUpdate = useRef(false)
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])

  const loadSession = useCallback((id: number) => {
    setActiveId(id)
    setGraph(null)
    window.location.hash = `#/${agent}/${id}`
    fetch(`/api/sessions/${id}?agent=${agent}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: SessionDetail) => {
        setGraph(nodesToGraph(data.nodes))
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
        setGraph(null)
      } else if (parsed.sessionId !== activeId) {
        if (parsed.sessionId !== null) {
          loadSession(parsed.sessionId)
        } else {
          setActiveId(null)
          setGraph(null)
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
    setGraph(null)
    setAgent(newAgent)
    window.location.hash = `#/${newAgent}`
  }, [agent])

  const handleBack = useCallback(() => {
    setActiveId(null)
    setGraph(null)
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
