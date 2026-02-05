import { StrictMode, useState, useEffect, useCallback } from "react"
import { createRoot } from "react-dom/client"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { Sidebar } from "./components/Sidebar"
import { ConversationThread } from "./components/ConversationThread"
import { nodesToGraph } from "./graph"
import type { Graph, Node } from "llm-gateway/packages/ai/client"
import "./index.css"

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

function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [graph, setGraph] = useState<Graph | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadSession = useCallback((id: number) => {
    setActiveId(id)
    setGraph(null)
    fetch(`/api/sessions/${id}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: SessionDetail) => {
        setGraph(nodesToGraph(data.nodes))
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: Session[]) => {
        setSessions(data)
        if (data.length > 0) {
          loadSession(data[0]!.id)
        }
      })
      .catch((err) => setError(err.message))
  }, [loadSession])

  return (
    <div className="flex h-dvh bg-black text-white">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={loadSession}
        className={activeId !== null ? "hidden md:flex" : "flex"}
      />
      <main className={`flex-1 flex-col overflow-y-auto p-4 ${activeId === null ? "hidden md:flex" : "flex"}`}>
        <button
          onClick={() => setActiveId(null)}
          className="mb-3 text-sm text-neutral-500 hover:text-white md:hidden"
        >
          &larr; sessions
        </button>
        {error && (
          <div className="mb-4 border border-neutral-700 p-3 text-sm text-red-400">
            error: {error}
          </div>
        )}
        {graph ? (
          <ConversationThread graph={graph} />
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
