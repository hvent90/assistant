# Heartbeat Viewer - Design

A standalone read-only web app for analyzing heartbeat agent activity.

## Architecture

Standalone Bun HTTP server at `clients/heartbeat-viewer/` that serves a React frontend and a thin API layer. Queries Postgres directly (read-only). No auth, no WebSockets, no write operations.

```
┌──────────────┬─────────────────────────────┐
│  Sidebar     │  Thread View                │
│  (280px)     │                             │
│              │  [ConversationThread]        │
│  Session 1 ← │                             │
│  Session 2   │  tool_call: bash ls ...     │
│  Session 3   │  text: No reminders due...  │
│  ...         │                             │
└──────────────┴─────────────────────────────┘
```

## Backend API

Single `server.ts` using `Bun.serve()`. Serves static frontend + two endpoints.

### `GET /api/sessions`

Returns heartbeat sessions sorted most-recent-first, with a text preview (first ~100 chars of first text node).

```sql
SELECT m.session_id, s.created_at, m.content
FROM messages m JOIN sessions s ON s.id = m.session_id
WHERE m.agent = 'heartbeat'
ORDER BY s.created_at DESC
```

Response:
```json
[{ "id": 42, "createdAt": "2026-02-03T14:30:00Z", "preview": "Checked reminders..." }]
```

### `GET /api/sessions/:id`

Returns full `Node[]` content for a session.

```sql
SELECT content FROM messages WHERE agent = 'heartbeat' AND session_id = $1
```

Response:
```json
{ "id": 42, "createdAt": "...", "nodes": [...] }
```

Connection string from `DATABASE_URL` env, defaulting to `postgres://assistant:assistant@localhost:5434/assistant`.

## Frontend

React 19 + Vite + Tailwind. Adapted from llm-gateway's `clients/web/`.

### Kept from llm-gateway (stripped of interactive concerns)

- `ConversationThread.tsx` — Remove permission handling, keep MessageGroupComponent, ContentView, ToolCallView, BranchView, CollapsiblePre, Thread.
- `ErrorBoundary.tsx` — As-is.
- `index.css` — Tailwind setup + streamdown markdown styles.

### Removed

- `InputArea.tsx` — No chat input.
- SSE/streaming logic.
- Permission handling.

### New

- `Sidebar.tsx` — Fetches `/api/sessions`, renders scrollable list with timestamp + preview. Active item highlighted. Most recent auto-selected on load.
- `App.tsx` — Two-panel layout. Fetches `/api/sessions/:id` on selection, builds Graph from nodes, projects via `projectThread()`, passes to ConversationThread.

### Styling

Dark theme matching llm-gateway: black background, green assistant text, yellow tool calls, neutral borders.

## Build & Run

Dependencies reused from project root. Add `streamdown` and `@tailwindcss/vite` if missing.

Scripts in root `package.json`:
- `bun run viewer:dev` — Vite dev server with HMR, proxies `/api` to Bun server
- `bun run viewer:build` — Builds frontend to `clients/heartbeat-viewer/dist/`
- `bun run viewer:start` — Bun server serving API + static dist

Graph projection imported from `llm-gateway` (or copied if import paths are awkward).
