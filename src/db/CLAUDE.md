# Database Module

PostgreSQL client layer via a single `pg.Pool`.

## Key Concepts

- Call `initDb(connectionString)` before any queries; call `shutdown()` on exit.
- Sessions group messages into conversations. `ensureCurrentSession` lazy-creates one.
- KV store is a generic `key -> jsonb` table used for runtime state (DM channel ID, scheduler checkpoint, current session, heartbeat last tick).
- Schema lives at `infra/init.sql` — check there for column definitions and constraints.

## Testing

`bun test src/db/__test__/` — requires Postgres running.
