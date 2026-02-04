# Heartbeat Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone read-only web app that lists heartbeat agent sessions and renders their full node graphs.

**Architecture:** Bun HTTP server (`clients/heartbeat-viewer/server.ts`) serves a React+Vite frontend and two REST endpoints. The frontend is adapted from the llm-gateway web client, stripped of interactive concerns (chat input, SSE streaming, permissions). The server queries Postgres directly for heartbeat session data.

**Tech Stack:** Bun, React 19, Vite 7, Tailwind CSS 4, pg, streamdown (all already in node_modules via llm-gateway)

---

### Task 1: Scaffold project structure

**Files:**
- Create: `clients/heartbeat-viewer/src/main.tsx`
- Create: `clients/heartbeat-viewer/src/index.css`
- Create: `clients/heartbeat-viewer/index.html`
- Create: `clients/heartbeat-viewer/tsconfig.json`
- Create: `clients/heartbeat-viewer/vite.config.ts`

**Step 1: Create `clients/heartbeat-viewer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#000000" />
    <title>Heartbeat Viewer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 2: Create `clients/heartbeat-viewer/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src/**/*", "vite.config.ts"]
}
```

**Step 3: Create `clients/heartbeat-viewer/vite.config.ts`**

```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const port = Number(process.env.VITE_PORT) || 5174
const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:4001"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "clients/heartbeat-viewer",
  server: {
    host: true,
    port,
    proxy: {
      "/api": backendUrl,
    },
  },
})
```

**Step 4: Create `clients/heartbeat-viewer/src/index.css`**

Copy from `node_modules/llm-gateway/clients/web/src/index.css` (the Tailwind import + streamdown markdown styles + mobile optimizations). Exact content:

```css
@import "tailwindcss";

/* Streamdown markdown rendering */
.streamdown {
  line-height: 1.6;

  & p {
    margin: 0.5em 0;
  }

  & p:first-child {
    margin-top: 0;
  }

  & p:last-child {
    margin-bottom: 0;
  }

  & h1,
  & h2,
  & h3,
  & h4 {
    font-weight: 700;
    margin: 1em 0 0.5em;
    color: #fff;
  }

  & h1 {
    font-size: 1.5em;
  }

  & h2 {
    font-size: 1.25em;
  }

  & h3 {
    font-size: 1.1em;
  }

  & code {
    background: #111;
    padding: 0.15em 0.35em;
    border-radius: 0.25em;
    font-size: 0.9em;
    color: #ccc;
  }

  & pre {
    background: #111;
    border: 1px solid #333;
    padding: 0.75em 1em;
    border-radius: 0;
    overflow-x: auto;
    margin: 0.5em 0;
  }

  & pre code {
    background: none;
    padding: 0;
    font-size: 0.85em;
  }

  & ul,
  & ol {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  & ul {
    list-style-type: disc;
  }

  & ol {
    list-style-type: decimal;
  }

  & li {
    margin: 0.25em 0;
  }

  & blockquote {
    border-left: 2px solid #555;
    padding-left: 1em;
    margin: 0.5em 0;
    color: #999;
  }

  & a {
    color: #fff;
    text-decoration: underline;
  }

  & hr {
    border: none;
    border-top: 1px solid #333;
    margin: 1em 0;
  }

  & table {
    border-collapse: collapse;
    margin: 0.5em 0;
    width: 100%;
  }

  & th,
  & td {
    border: 1px solid #333;
    padding: 0.4em 0.75em;
    text-align: left;
  }

  & th {
    background: #111;
    font-weight: 700;
  }

  & strong {
    font-weight: 700;
    color: #fff;
  }
}

html,
body {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior: none;
}

html {
  height: 100%;
}

body {
  min-height: 100%;
  min-height: 100dvh;
}
```

**Step 5: Create `clients/heartbeat-viewer/src/main.tsx`**

Placeholder entry point:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

function App() {
  return (
    <div className="flex h-dvh bg-black text-white items-center justify-center">
      <p className="text-neutral-500">heartbeat viewer</p>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**Step 6: Verify the Vite dev server starts**

Run: `cd /Users/hv/repos/assistant && npx vite --config clients/heartbeat-viewer/vite.config.ts`
Expected: Vite starts on port 5174, no build errors.
Kill the server after verifying.

**Step 7: Commit**

```bash
git add clients/heartbeat-viewer/
git commit -m "feat(viewer): scaffold heartbeat viewer project"
```

---

### Task 2: Backend server

**Files:**
- Create: `clients/heartbeat-viewer/server.ts`
- Modify: `package.json` (add scripts)

**Step 1: Create `clients/heartbeat-viewer/server.ts`**

```ts
import { Pool } from "pg"
import type { Node } from "llm-gateway/packages/ai/client"
import { join } from "path"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://assistant:assistant@localhost:5434/assistant"
const PORT = Number(process.env.VIEWER_PORT) || 4001
const DIST_DIR = join(import.meta.dir, "dist")

const pool = new Pool({ connectionString: DATABASE_URL })

interface SessionRow {
  session_id: number
  created_at: Date
  content: Node[]
}

function extractPreview(nodes: Node[]): string {
  for (const node of nodes) {
    if (node.kind === "text" && node.content) {
      return node.content.slice(0, 120)
    }
  }
  return ""
}

async function handleApi(url: URL): Promise<Response> {
  if (url.pathname === "/api/sessions") {
    const result = await pool.query<SessionRow>(
      `SELECT m.session_id, s.created_at, m.content
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.agent = 'heartbeat'
       ORDER BY s.created_at DESC`
    )
    const sessions = result.rows.map((r) => ({
      id: r.session_id,
      createdAt: r.created_at.toISOString(),
      preview: extractPreview(r.content),
    }))
    return Response.json(sessions)
  }

  const match = url.pathname.match(/^\/api\/sessions\/(\d+)$/)
  if (match) {
    const sessionId = Number(match[1])
    const result = await pool.query<{ content: Node[]; created_at: Date }>(
      `SELECT m.content, s.created_at
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.agent = 'heartbeat' AND m.session_id = $1`,
      [sessionId]
    )
    if (result.rows.length === 0) {
      return Response.json({ error: "not found" }, { status: 404 })
    }
    const row = result.rows[0]!
    return Response.json({
      id: sessionId,
      createdAt: row.created_at.toISOString(),
      nodes: row.content,
    })
  }

  return Response.json({ error: "not found" }, { status: 404 })
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(url)
      } catch (err) {
        console.error("API error:", err)
        return Response.json({ error: "internal error" }, { status: 500 })
      }
    }

    // Serve static files from dist/
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname
    const file = Bun.file(join(DIST_DIR, filePath))
    if (await file.exists()) {
      return new Response(file)
    }
    // SPA fallback
    return new Response(Bun.file(join(DIST_DIR, "index.html")))
  },
})

console.log(`Heartbeat viewer running on http://localhost:${PORT}`)
```

**Step 2: Add scripts to root `package.json`**

Add these to the `"scripts"` object:

```json
"viewer:dev": "bunx vite --config clients/heartbeat-viewer/vite.config.ts",
"viewer:build": "bunx vite build --config clients/heartbeat-viewer/vite.config.ts",
"viewer:serve": "bun run clients/heartbeat-viewer/server.ts"
```

**Step 3: Verify server starts and responds**

Run: `bun run clients/heartbeat-viewer/server.ts &`
Then: `curl http://localhost:4001/api/sessions`
Expected: JSON array (may be empty if no heartbeat data exists yet).
Kill the server after verifying.

**Step 4: Commit**

```bash
git add clients/heartbeat-viewer/server.ts package.json
git commit -m "feat(viewer): add backend API server"
```

---

### Task 3: ConversationThread component (adapted)

**Files:**
- Create: `clients/heartbeat-viewer/src/components/ConversationThread.tsx`
- Create: `clients/heartbeat-viewer/src/components/ErrorBoundary.tsx`

**Step 1: Create `clients/heartbeat-viewer/src/components/ErrorBoundary.tsx`**

Copy from llm-gateway verbatim:

```tsx
import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React error boundary caught:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center bg-black p-4 text-white">
          <h1 className="mb-4 text-xl font-bold text-red-400">Something went wrong</h1>
          <pre className="max-w-full overflow-auto rounded bg-neutral-900 p-4 text-sm text-neutral-300">
            {this.state.error?.message ?? "Unknown error"}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 border border-neutral-600 px-4 py-2 text-sm text-white hover:bg-neutral-900"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
```

**Step 2: Create `clients/heartbeat-viewer/src/components/ConversationThread.tsx`**

Adapted from llm-gateway's `ConversationThread.tsx`. Removes: `PermissionPromptInline`, `pendingRelays`, `permissionHandlers` props, `isConnected` prop, relay content case. Keeps all rendering logic.

```tsx
import { useState, memo } from "react"
import { Streamdown } from "streamdown"
import { projectThread } from "llm-gateway/packages/ai/client"
import type { ViewNode, ViewContent, Graph } from "llm-gateway/packages/ai/client"
import type { ContentPart } from "llm-gateway/packages/ai/types"

interface ConversationThreadProps {
  graph: Graph
}

interface MessageGroup {
  runId: string
  role: "user" | "assistant"
  nodes: ViewNode[]
}

function groupNodes(nodes: ViewNode[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const node of nodes) {
    const last = groups[groups.length - 1]
    if (last && last.runId === node.runId) {
      last.nodes.push(node)
    } else {
      groups.push({ runId: node.runId, role: node.role, nodes: [node] })
    }
  }
  return groups
}

function ContentView({ content }: { content: ViewContent }) {
  switch (content.kind) {
    case "user":
      return (
        <div className="mt-1 whitespace-pre-wrap">
          {typeof content.content === "string"
            ? content.content
            : (content.content as ContentPart[])
                .filter((p) => p.type === "text")
                .map((p) => (p as { type: "text"; text: string }).text)
                .join("\n")}
        </div>
      )
    case "text":
      return (
        <div className="mt-1 streamdown">
          <Streamdown>{content.text}</Streamdown>
        </div>
      )
    case "reasoning":
      return (
        <div className="mt-1 text-sm italic text-neutral-500 streamdown">
          <Streamdown>{content.text}</Streamdown>
        </div>
      )
    case "error":
      return (
        <div className="mt-1 border border-neutral-700 p-2 text-sm text-red-400">
          {content.message}
        </div>
      )
    case "tool_call":
      return <ToolCallView content={content} />
    case "relay":
    case "pending":
      return null
  }
}

function CollapsiblePre({
  label,
  text,
  className,
}: {
  label: string
  text: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const oneLine = text.replace(/\n/g, " ").replace(/\s+/g, " ")

  return (
    <div className="mt-1">
      <div className="flex w-full items-start gap-1 text-left">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 text-neutral-600 hover:text-white"
        >
          {expanded ? "▼" : "▶"}
        </button>
        {expanded ? (
          <pre
            className={`whitespace-pre-wrap break-words select-text ${className ?? "text-neutral-400"}`}
          >
            {text}
          </pre>
        ) : (
          <span
            className={`cursor-pointer truncate font-mono ${className ?? "text-neutral-400"}`}
            onClick={() => {
              const sel = window.getSelection()
              if (sel && sel.toString().length > 0) return
              setExpanded(true)
            }}
          >
            <span className="text-neutral-600">{label}: </span>
            {oneLine}
          </span>
        )}
      </div>
    </div>
  )
}

function ToolCallView({ content }: { content: Extract<ViewContent, { kind: "tool_call" }> }) {
  const [expanded, setExpanded] = useState(false)
  const inputStr =
    typeof content.input === "string" ? content.input : JSON.stringify(content.input, null, 2)
  const outputStr =
    content.output !== undefined
      ? typeof content.output === "string"
        ? content.output
        : JSON.stringify(content.output, null, 2)
      : null
  const paramsOneLine =
    typeof content.input === "string"
      ? content.input.replace(/\n/g, " ")
      : JSON.stringify(content.input).replace(/,/g, ", ")

  return (
    <div className="my-1 border border-neutral-800 text-sm">
      <div
        className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-900"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0 text-neutral-600">{expanded ? "▼" : "▶"}</span>
        <span className="font-mono text-yellow-500">{content.name}</span>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate font-mono text-neutral-500">
            {paramsOneLine}
          </span>
        )}
      </div>
      {expanded && (
        <div className="border-t border-neutral-800 px-2 py-1">
          <CollapsiblePre label="params" text={inputStr} className="text-neutral-500" />
          {outputStr && (
            <div className="mt-1 border-t border-neutral-800 pt-1">
              <CollapsiblePre label="result" text={outputStr} className="text-neutral-300" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const MessageGroupComponent = memo(function MessageGroupComponent({
  group,
}: {
  group: MessageGroup
}) {
  const isUser = group.role === "user"

  return (
    <div className="mb-4">
      <div className={`font-bold ${isUser ? "text-white" : "text-green-400"}`}>
        &gt; {isUser ? "you" : "heartbeat"}
      </div>
      {group.nodes.map((node) => (
        <NodeContent key={node.id} node={node} />
      ))}
    </div>
  )
})

function NodeContent({ node }: { node: ViewNode }) {
  return (
    <>
      <ContentView content={node.content} />
      {node.branches.map((branch, i) => (
        <BranchView key={i} branch={branch} />
      ))}
    </>
  )
}

function BranchView({ branch }: { branch: ViewNode[] }) {
  const [expanded, setExpanded] = useState(false)

  if (branch.length === 0) return null

  const agentLabel = `agent-${branch[0]!.runId.replace(/-/g, "").slice(-7)}`

  return (
    <div className="mt-2 border-l-4 border-neutral-700 pl-2 sm:pl-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mb-1 text-xs text-neutral-600 hover:text-white"
      >
        {expanded ? "▼" : "▶"} <span className="text-green-700">{agentLabel}</span>
      </button>
      <div
        className={expanded ? "" : "flex max-h-[100px] flex-col-reverse overflow-hidden"}
        style={expanded ? undefined : { maskImage: "linear-gradient(transparent, black 40%)" }}
      >
        <div>
          <Thread nodes={branch} />
        </div>
      </div>
      {expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 text-xs text-neutral-600 hover:text-white"
        >
          ▲ collapse
        </button>
      )}
    </div>
  )
}

function Thread({ nodes }: { nodes: ViewNode[] }) {
  const groups = groupNodes(nodes)

  return (
    <>
      {groups.map((group) => (
        <MessageGroupComponent
          key={`${group.runId}-${group.nodes[0]!.id}`}
          group={group}
        />
      ))}
    </>
  )
}

export function ConversationThread({ graph }: ConversationThreadProps) {
  const viewNodes = projectThread(graph)

  if (viewNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-600">
        no data for this session.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Thread nodes={viewNodes} />
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add clients/heartbeat-viewer/src/components/
git commit -m "feat(viewer): add ConversationThread and ErrorBoundary components"
```

---

### Task 4: Graph reconstruction utility

The DB stores `Node[]` (flat array from `collectAgentOutput`), but `projectThread` expects a `Graph` (nodes Map + edges Map + lastNodeByRunId). The stored nodes have been filtered (no `harness_start`/`harness_end`), so we reconstruct the graph by:

1. Putting all nodes into the Map
2. Building sequential edges between consecutive nodes in the same `runId`

**Files:**
- Create: `clients/heartbeat-viewer/src/graph.ts`
- Create: `clients/heartbeat-viewer/src/graph.test.ts`

**Step 1: Write the failing test**

Create `clients/heartbeat-viewer/src/graph.test.ts`:

```ts
import { test, expect } from "bun:test"
import { nodesToGraph } from "./graph"
import type { Node } from "llm-gateway/packages/ai/client"

test("empty array produces empty graph", () => {
  const graph = nodesToGraph([])
  expect(graph.nodes.size).toBe(0)
  expect(graph.edges.size).toBe(0)
})

test("single node produces graph with no edges", () => {
  const nodes: Node[] = [
    { id: "a", runId: "r1", kind: "text", content: "hello" },
  ]
  const graph = nodesToGraph(nodes)
  expect(graph.nodes.size).toBe(1)
  expect(graph.nodes.get("a")).toEqual(nodes[0])
  expect(graph.edges.size).toBe(0)
})

test("sequential nodes in same run get edges", () => {
  const nodes: Node[] = [
    { id: "a", runId: "r1", kind: "text", content: "hello" },
    { id: "b", runId: "r1", kind: "tool_call", name: "bash", input: "ls" },
    { id: "c", runId: "r1", kind: "tool_result", name: "bash", output: "file.txt" },
  ]
  const graph = nodesToGraph(nodes)
  expect(graph.edges.get("a")).toEqual(["b"])
  expect(graph.edges.get("b")).toEqual(["c"])
  expect(graph.edges.has("c")).toBe(false)
})

test("nodes in different runs get no cross-edges", () => {
  const nodes: Node[] = [
    { id: "a", runId: "r1", kind: "text", content: "hello" },
    { id: "b", runId: "r2", kind: "text", content: "world" },
  ]
  const graph = nodesToGraph(nodes)
  expect(graph.edges.size).toBe(0)
})

test("lastNodeByRunId tracks last node per run", () => {
  const nodes: Node[] = [
    { id: "a", runId: "r1", kind: "text", content: "hello" },
    { id: "b", runId: "r1", kind: "text", content: "world" },
    { id: "c", runId: "r2", kind: "text", content: "other" },
  ]
  const graph = nodesToGraph(nodes)
  expect(graph.lastNodeByRunId.get("r1")).toBe("b")
  expect(graph.lastNodeByRunId.get("r2")).toBe("c")
})
```

**Step 2: Run test to verify it fails**

Run: `bun test clients/heartbeat-viewer/src/graph.test.ts`
Expected: FAIL — `nodesToGraph` does not exist.

**Step 3: Write the implementation**

Create `clients/heartbeat-viewer/src/graph.ts`:

```ts
import type { Node, Graph } from "llm-gateway/packages/ai/client"

export function nodesToGraph(nodes: Node[]): Graph {
  const nodeMap = new Map<string, Node>()
  const edges = new Map<string, string[]>()
  const lastNodeByRunId = new Map<string, string>()

  for (const node of nodes) {
    nodeMap.set(node.id, node)

    const prev = lastNodeByRunId.get(node.runId)
    if (prev) {
      const existing = edges.get(prev)
      if (existing) {
        existing.push(node.id)
      } else {
        edges.set(prev, [node.id])
      }
    }

    lastNodeByRunId.set(node.runId, node.id)
  }

  return { nodes: nodeMap, edges, lastNodeByRunId }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test clients/heartbeat-viewer/src/graph.test.ts`
Expected: All 5 tests PASS.

**Step 5: Commit**

```bash
git add clients/heartbeat-viewer/src/graph.ts clients/heartbeat-viewer/src/graph.test.ts
git commit -m "feat(viewer): add nodesToGraph utility for reconstructing Graph from stored Node[]"
```

---

### Task 5: Sidebar component

**Files:**
- Create: `clients/heartbeat-viewer/src/components/Sidebar.tsx`

**Step 1: Create `clients/heartbeat-viewer/src/components/Sidebar.tsx`**

```tsx
interface Session {
  id: number
  createdAt: string
  preview: string
}

interface SidebarProps {
  sessions: Session[]
  activeId: number | null
  onSelect: (id: number) => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export function Sidebar({ sessions, activeId, onSelect }: SidebarProps) {
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-neutral-800 overflow-y-auto">
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
```

**Step 2: Commit**

```bash
git add clients/heartbeat-viewer/src/components/Sidebar.tsx
git commit -m "feat(viewer): add Sidebar component"
```

---

### Task 6: Wire up App.tsx

**Files:**
- Modify: `clients/heartbeat-viewer/src/main.tsx`

**Step 1: Rewrite `clients/heartbeat-viewer/src/main.tsx`**

Replace the placeholder with the full app:

```tsx
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

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: Session[]) => {
        setSessions(data)
        if (data.length > 0) {
          setActiveId(data[0]!.id)
        }
      })
      .catch((err) => setError(err.message))
  }, [])

  const loadSession = useCallback((id: number) => {
    setActiveId(id)
    setGraph(null)
    fetch(`/api/sessions/${id}`)
      .then((r) => r.json())
      .then((data: SessionDetail) => {
        setGraph(nodesToGraph(data.nodes))
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (activeId !== null) {
      loadSession(activeId)
    }
  }, [activeId, loadSession])

  return (
    <div className="flex h-dvh bg-black text-white">
      <Sidebar sessions={sessions} activeId={activeId} onSelect={setActiveId} />
      <main className="flex-1 overflow-y-auto p-4">
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
```

**Step 2: Verify end-to-end**

1. Start Postgres: `podman compose -f infra/docker-compose.yml up -d`
2. Start backend: `bun run clients/heartbeat-viewer/server.ts &`
3. Start frontend: `bunx vite --config clients/heartbeat-viewer/vite.config.ts &`
4. Open `http://localhost:5174` in browser
5. Verify: sidebar loads sessions (or shows "No sessions found"), clicking a session loads the thread view.

**Step 3: Commit**

```bash
git add clients/heartbeat-viewer/src/main.tsx
git commit -m "feat(viewer): wire up App with sidebar and thread view"
```

---

### Task 7: Add package.json scripts

**Files:**
- Modify: `package.json`

**Step 1: Add viewer scripts**

Add to root `package.json` scripts:

```json
"viewer:dev": "bunx vite --config clients/heartbeat-viewer/vite.config.ts",
"viewer:build": "bunx vite build --config clients/heartbeat-viewer/vite.config.ts",
"viewer:serve": "bun run clients/heartbeat-viewer/server.ts"
```

**Step 2: Verify scripts work**

Run: `bun run viewer:dev` — should start Vite dev server.
Kill after verifying.

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat(viewer): add viewer scripts to package.json"
```
