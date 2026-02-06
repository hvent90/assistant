interface Session {
  id: number
  createdAt: string
  preview: string
}

type Agent = "heartbeat" | "conversation"

interface SidebarProps {
  sessions: Session[]
  activeId: number | null
  onSelect: (id: number) => void
  agent: Agent
  onAgentChange: (agent: Agent) => void
  className?: string
}

const TABS: { key: Agent; label: string }[] = [
  { key: "heartbeat", label: "Heartbeat" },
  { key: "conversation", label: "Conversation" },
]

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export function Sidebar({ sessions, activeId, onSelect, agent, onAgentChange, className = "flex" }: SidebarProps) {
  return (
    <aside className={`${className} h-full w-full md:w-[280px] md:shrink-0 flex-col border-r border-neutral-800 overflow-y-auto`}>
      <div className="flex border-b border-neutral-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onAgentChange(tab.key)}
            className={`flex-1 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
              agent === tab.key
                ? "text-white border-b-2 border-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
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
            <div className="text-xs text-neutral-500">{formatDate(s.createdAt)}</div>
            {s.preview && (
              <div className="mt-1 text-sm text-neutral-400 line-clamp-2">{s.preview}</div>
            )}
          </button>
        ))}
      </nav>
    </aside>
  )
}
