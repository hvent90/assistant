# Database Module

PostgreSQL client layer. Manages conversation messages, sessions, a key-value store, and scheduled tasks. All queries go through a single `pg.Pool` initialized at startup.

## Public API

See `index.ts` — exports `initDb`, `ping`, `shutdown`, message CRUD (`appendMessage`, `getSessionMessages`), session management (`createSession`, `ensureCurrentSession`), KV store (`getKv`, `setKv`), and scheduled task operations (`insertScheduledTask`, `getPendingDueTasks`, `updateTaskStatus`).

## Key Concepts

- Call `initDb(connectionString)` before any queries; call `shutdown()` on exit.
- Sessions group messages into conversations. `ensureCurrentSession` lazy-creates one.
- KV store is a generic `key -> jsonb` table used for runtime state (DM channel ID, scheduler checkpoint, current session).
- Schema lives at `infra/init.sql`.

## Dependencies

- **Depends on:** `pg` (PostgreSQL driver), `llm-gateway` (Node type for message content)
- **Used by:** nearly everything — `discord/`, `scheduling/`, `tools/`, `agents/`, `main.ts`

## Testing

Tests in `__test__/`. Run: `bun test src/db/__test__/`

Requires Postgres running (`podman compose -f infra/docker-compose.yml up -d`).
