# Scheduled Tasks Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Scheduled" page to the heartbeat-viewer frontend that displays active and historical scheduled tasks with status, timing, prompt, and error details.

**Architecture:** Add a `/api/scheduled-tasks` endpoint to the existing Bun server that queries the `scheduled_tasks` table. Extend the frontend's tab/routing system with a third "Scheduled" tab that renders a dedicated `ScheduledTasksView` component instead of the session-based ConversationThread. The view displays tasks as a list of expandable cards with status badges, timing info, and error details.

**Tech Stack:** React 18, Tailwind CSS, Bun server, PostgreSQL (existing `scheduled_tasks` table)

---

### Task 1: Add API endpoint for scheduled tasks

**Files:**
- Modify: `clients/heartbeat-viewer/server.ts:103-105` (before the 404 fallback)

**Step 1: Add the `/api/scheduled-tasks` handler**

Insert before the final `return Response.json({ error: "not found" }, { status: 404 })` at line 105:

```typescript
  if (url.pathname === "/api/scheduled-tasks") {
    const result = await pool.query(
      `SELECT id, fire_at, prompt, status, attempts, max_attempts, last_error, created_at
       FROM scheduled_tasks
       ORDER BY created_at DESC`
    )
    const tasks = result.rows.map((r: any) => ({
      id: r.id,
      fireAt: r.fire_at.toISOString(),
      prompt: r.prompt,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      createdAt: r.created_at.toISOString(),
    }))
    return Response.json(tasks)
  }
```

**Step 2: Verify endpoint works**

Run: `curl http://localhost:5100/api/scheduled-tasks 2>/dev/null | head -c 200`
Expected: JSON array (possibly empty `[]` if no tasks exist yet)

**Step 3: Commit**

```bash
git add clients/heartbeat-viewer/server.ts
git commit -m "feat(viewer): add /api/scheduled-tasks endpoint"
```

---

### Task 2: Create ScheduledTasksView component

**Files:**
- Create: `clients/heartbeat-viewer/src/components/ScheduledTasksView.tsx`

**Step 1: Create the component file**

```tsx
import { useState } from "react"

export interface ScheduledTask {
  id: number
  fireAt: string
  prompt: string
  status: string
  attempts: number
  maxAttempts: number
  lastError: string | null
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
```

**Step 2: Verify it compiles**

Run: `cd /Users/hv/repos/assistant && bunx tsc --noEmit --project clients/heartbeat-viewer/tsconfig.json`
Expected: No errors (or only pre-existing ones)

**Step 3: Commit**

```bash
git add clients/heartbeat-viewer/src/components/ScheduledTasksView.tsx
git commit -m "feat(viewer): add ScheduledTasksView component"
```

---

### Task 3: Wire up routing, sidebar tab, and app state

**Files:**
- Modify: `clients/heartbeat-viewer/src/main.tsx`
- Modify: `clients/heartbeat-viewer/src/components/Sidebar.tsx`

**Step 1: Update Sidebar to support three tabs**

In `clients/heartbeat-viewer/src/components/Sidebar.tsx`:

Change the `Agent` type at line 7 to:
```typescript
type Agent = "heartbeat" | "conversation" | "scheduled"
```

Change the `TABS` array at lines 18-21 to:
```typescript
const TABS: { key: Agent; label: string }[] = [
  { key: "heartbeat", label: "Heartbeat" },
  { key: "conversation", label: "Conversation" },
  { key: "scheduled", label: "Scheduled" },
]
```

**Step 2: Update main.tsx with scheduled tasks support**

In `clients/heartbeat-viewer/src/main.tsx`:

Add import at top (after existing imports around line 6):
```typescript
import { ScheduledTasksView } from "./components/ScheduledTasksView"
import type { ScheduledTask } from "./components/ScheduledTasksView"
```

Change the `Agent` type at line 10 to:
```typescript
type Agent = "heartbeat" | "conversation" | "scheduled"
```

Update `parseHash()` at line 27 — replace the agent assignment:
```typescript
const agent: Agent = parts[0] === "conversation" ? "conversation" : parts[0] === "scheduled" ? "scheduled" : "heartbeat"
```

Add `scheduledTasks` state after the existing state declarations (after line 38):
```typescript
const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
```

In the `useEffect` that fetches sessions when agent changes (starting at line 54), add a branch for "scheduled" at the top of the effect body:
```typescript
  useEffect(() => {
    if (agent === "scheduled") {
      fetch("/api/scheduled-tasks")
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then((data: ScheduledTask[]) => setScheduledTasks(data))
        .catch((err) => setError(err.message))
      return
    }
    fetch(`/api/sessions?agent=${agent}`)
    // ... rest of existing code unchanged
```

In `handleAgentChange` (line 102), add `setScheduledTasks([])` to the state clearing:
```typescript
  const handleAgentChange = useCallback((newAgent: Agent) => {
    if (newAgent === agent) return
    setSessions([])
    setScheduledTasks([])
    setActiveId(null)
    setGraph(null)
    setAgent(newAgent)
    window.location.hash = `#/${newAgent}`
  }, [agent])
```

Update the JSX return. The Sidebar `className` should also hide for scheduled view on mobile. Update the `<Sidebar>` className prop (line 125):
```tsx
className={agent === "scheduled" ? "hidden md:flex" : activeId !== null ? "hidden md:flex" : "flex"}
```

Update the `<main>` section (lines 127-150). Replace the main element contents:
```tsx
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
```

**Step 3: Verify it compiles and renders**

Run: `cd /Users/hv/repos/assistant && bunx tsc --noEmit --project clients/heartbeat-viewer/tsconfig.json`
Expected: No errors

Run: `cd /Users/hv/repos/assistant && bunx vite build --config clients/heartbeat-viewer/vite.config.ts`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add clients/heartbeat-viewer/src/main.tsx clients/heartbeat-viewer/src/components/Sidebar.tsx
git commit -m "feat(viewer): add Scheduled tab with routing and task list"
```

---

### Task 4: Manual verification

**Step 1: Build and serve**

Run: `cd /Users/hv/repos/assistant && bunx vite build --config clients/heartbeat-viewer/vite.config.ts`

**Step 2: Verify the three tabs render**

Open `http://localhost:5100/#/scheduled` in a browser (or use curl to check the API):
Run: `curl -s http://localhost:5100/api/scheduled-tasks | python3 -m json.tool | head -30`

**Step 3: Verify routing works**

- `/#/heartbeat` shows heartbeat sessions (existing behavior)
- `/#/conversation` shows conversation sessions (existing behavior)
- `/#/scheduled` shows scheduled tasks view with filter buttons
