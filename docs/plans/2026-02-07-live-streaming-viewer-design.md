# Live Streaming Viewer

## Goal

Make the heartbeat-viewer support live streaming of agent output so users can watch running agents in real-time, with auto-updating sidebar showing active sessions.

## Architecture

### Event Pipeline

```
Agent process
  → writes nodes to Postgres + pg_notify('agent_events', payload)
  → viewer backend LISTEN agent_events
  → fans out to connected SSE clients
  → browser renders via reduceEvent + projectThread
```

The agent process already writes nodes to Postgres. We add a `pg_notify('agent_events', ...)` alongside those writes. Payload: `{ sessionId, event }` where `event` is the serialized `ServerEvent`.

The viewer backend holds a persistent Postgres connection with `LISTEN agent_events`. When a notification arrives, it deserializes the payload and writes it to all SSE clients subscribed to that session.

### SSE Endpoints

**`GET /api/sessions/:id/stream`** — Per-session event stream. The viewer backend maintains a map of `sessionId → Set<Response>`. Events from NOTIFY are fanned out to matching subscribers. Sends `harness_end` and closes when the session completes.

**`GET /api/sessions/feed`** — Sidebar lifecycle feed. Pushes lightweight notifications on `harness_start` and `harness_end` so the sidebar can refetch its session list.

### Frontend Dual-Mode Rendering

`ConversationThread` operates in two modes:

- **Active session**: Opens `EventSource` to `/api/sessions/:id/stream`. Builds `Graph` incrementally via `reduceEvent()` from `llm-gateway/packages/ai/client`. Batches state updates with `requestAnimationFrame` (same pattern as llm-gateway web client).
- **Completed session**: Fetches from REST API, builds graph via `nodesToGraph()`. No change from current behavior.

### Sidebar Auto-Updates

Sidebar connects to `/api/sessions/feed` on mount. On receiving a lifecycle event, it refetches the existing session list REST endpoint. Active sessions show a visual indicator (pulsing dot). Clicking an active session opens streaming mode; completed sessions open in static mode.

### Session Activity Tracking

The viewer backend tracks active sessions in an in-memory `Set<string>`, updated by `harness_start` (add) and `harness_end` (remove) events from NOTIFY. The existing session list API adds an `active: boolean` field.

## Implementation Tasks

### 1. Agent-side: Add pg_notify on event writes
Find where nodes/events are persisted to Postgres and add `pg_notify('agent_events', json_payload)` alongside. Payload shape: `{ sessionId: string, event: ServerEvent }`.

### 2. Viewer backend: LISTEN + SSE infrastructure
- Persistent Postgres connection with `LISTEN agent_events`
- In-memory active session tracking (Set)
- `GET /api/sessions/:id/stream` — per-session SSE fan-out
- `GET /api/sessions/feed` — sidebar lifecycle SSE
- Add `active` field to session list API response

### 3. Frontend: Streaming ConversationThread
- Detect active session (from `active` field on session data)
- Open EventSource to `/api/sessions/:id/stream` for active sessions
- Build Graph via `reduceEvent()` with RAF batching
- Fall back to existing REST+nodesToGraph for completed sessions
- Streaming indicator in UI

### 4. Frontend: Sidebar auto-updates
- Connect to `/api/sessions/feed` on mount
- Refetch session list on lifecycle events
- Active session indicator (pulsing dot)

## Not In Scope

- Chat input / sending messages (stays on Discord)
- Relay/permission handling (no interactive tool approval)
- Authentication
