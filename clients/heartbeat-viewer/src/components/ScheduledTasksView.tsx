import { useState } from "react"

export interface ScheduledTask {
  id: number
  fireAt: string
  prompt: string
  status: string
  attempts: number
  maxAttempts: number
  lastError: string | null
  sessionId: number | null
  createdAt: string
}

type Filter = "active" | "completed" | "all"

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-900/40 text-yellow-400 border-yellow-800",
  running: "bg-blue-900/40 text-blue-400 border-blue-800",
  completed: "bg-green-900/40 text-green-400 border-green-800",
  failed: "bg-red-900/40 text-red-400 border-red-800",
  cancelled: "bg-neutral-800 text-neutral-500 border-neutral-700",
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-neutral-800 text-neutral-400 border-neutral-700"
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium border rounded ${style}`}>
      {status}
    </span>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

function TaskCard({ task }: { task: ScheduledTask }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left border border-neutral-800 rounded p-4 hover:border-neutral-700 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={task.status} />
            <span className="text-xs text-neutral-500">#{task.id}</span>
            {task.attempts > 0 && (
              <span className="text-xs text-neutral-600">
                attempt {task.attempts}/{task.maxAttempts}
              </span>
            )}
          </div>
          <div className={`text-sm text-neutral-300 ${expanded ? "" : "line-clamp-2"}`}>
            {task.prompt}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-neutral-500">{formatDate(task.fireAt)}</div>
          <div className="text-xs text-neutral-600 mt-0.5">created {formatDate(task.createdAt)}</div>
        </div>
      </div>
      {expanded && task.lastError && (
        <div className="mt-3 p-2 bg-red-950/30 border border-red-900/50 rounded text-xs text-red-400 font-mono whitespace-pre-wrap">
          {task.lastError}
        </div>
      )}
      {task.sessionId != null && task.status === "completed" && (
        <a
          href={`/#/heartbeat/${task.sessionId}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-2 inline-block text-xs text-blue-400 hover:text-blue-300 underline"
        >
          View session #{task.sessionId}
        </a>
      )}
    </button>
  )
}

export function ScheduledTasksView({ tasks }: { tasks: ScheduledTask[] }) {
  const [filter, setFilter] = useState<Filter>("active")

  const filtered = tasks.filter((t) => {
    if (filter === "active") return t.status === "pending" || t.status === "running"
    if (filter === "completed") return t.status === "completed" || t.status === "failed" || t.status === "cancelled"
    return true
  })

  const filters: { key: Filter; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "completed", label: "History" },
    { key: "all", label: "All" },
  ]

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center gap-1">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              filter === f.key
                ? "bg-neutral-800 text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-xs text-neutral-600 ml-2">{filtered.length} tasks</span>
      </div>
      {filtered.length === 0 ? (
        <div className="text-sm text-neutral-600 py-8 text-center">
          No {filter === "all" ? "" : filter} tasks.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  )
}
