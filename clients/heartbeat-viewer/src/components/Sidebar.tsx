import { useState, useEffect } from "react"
import type { Agent, Session } from "../types"
import { formatDate } from "../utils"

interface HeartbeatStatus {
  lastTickAt: string | null
  nextTickAt: string | null
  intervalMs: number
}

interface SidebarProps {
  sessions: Session[]
  activeId: number | null
  onSelect: (id: number) => void
  agent: Agent
  onAgentChange: (agent: Agent) => void
  activeSessions?: Set<number>
  className?: string
}

function formatRelativeTime(nextTickAt: string): string {
  const diffMs = new Date(nextTickAt).getTime() - Date.now()
  if (diffMs <= 0) return "Heartbeat overdue"
  const totalSeconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `Next heartbeat in ${minutes}m`
  return `Next heartbeat in ${seconds}s`
}

const TABS: { key: Agent; label: string }[] = [
  { key: "heartbeat", label: "Heartbeat" },
  { key: "conversation", label: "Conversation" },
  { key: "scheduled", label: "Scheduled" },
]

export function Sidebar({ sessions, activeId, onSelect, agent, onAgentChange, activeSessions, className = "flex" }: SidebarProps) {
  const [heartbeatStatus, setHeartbeatStatus] = useState<HeartbeatStatus | null>(null)

  useEffect(() => {
    if (agent !== "heartbeat") {
      setHeartbeatStatus(null)
      return
    }
    let cancelled = false
    async function fetchStatus() {
      try {
        const res = await fetch("/api/heartbeat-status")
        if (!cancelled) setHeartbeatStatus(await res.json())
      } catch {}
    }
    fetchStatus()
    const id = setInterval(fetchStatus, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [agent])

  return (
    <aside className={`${className} h-full w-full md:w-[280px] md:shrink-0 flex-col border-r border-neutral-800 overflow-y-auto`}>
      <div className="flex border-b border-neutral-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onAgentChange(tab.key)}
            className={`flex-1 min-w-0 px-2 py-3 text-[10px] font-semibold uppercase truncate transition-colors ${
              agent === tab.key
                ? "text-white border-b-2 border-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {agent === "heartbeat" && heartbeatStatus?.nextTickAt && (
        <div className={`px-4 py-2 border-b border-neutral-800 text-xs font-medium ${
          new Date(heartbeatStatus.nextTickAt).getTime() <= Date.now()
            ? "text-amber-400"
            : "text-neutral-400"
        }`}>
          {formatRelativeTime(heartbeatStatus.nextTickAt)}
        </div>
      )}
      <div className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-bold tracking-tight text-neutral-400 uppercase">{agent} Sessions</h1>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="px-4 py-8 text-sm text-neutral-600">No sessions found.</div>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full text-left px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900 transition-colors ${
              s.id === activeId ? "bg-neutral-900" : ""
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
              {activeSessions?.has(s.id) && (
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
              )}
              {formatDate(s.createdAt)}
            </div>
            {s.preview && (
              <div className="mt-1 text-sm text-neutral-400 line-clamp-2">{s.preview}</div>
            )}
          </button>
        ))}
      </nav>
    </aside>
  )
}
