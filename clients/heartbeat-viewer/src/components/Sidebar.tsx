interface Session {
  id: number
  createdAt: string
  preview: string
}

interface SidebarProps {
  sessions: Session[]
  activeId: number | null
  onSelect: (id: number) => void
  className?: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export function Sidebar({ sessions, activeId, onSelect, className = "flex" }: SidebarProps) {
  return (
    <aside className={`${className} h-full w-full md:w-[280px] md:shrink-0 flex-col border-r border-neutral-800 overflow-y-auto`}>
      <div className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-bold tracking-tight text-neutral-400 uppercase">Heartbeat Sessions</h1>
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
