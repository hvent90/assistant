# Session-Based Conversation Context

## Summary

Replace the fixed "last 50 messages" context window with session-based message grouping. Users create new sessions via a Discord `/clear` slash command. Sessions provide clean context boundaries — a new session means a clean slate (only system prompt + memories, no old messages).

## Data Model

### New `sessions` table

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Add `session_id` to `messages` table

```sql
ALTER TABLE messages ADD COLUMN session_id INTEGER REFERENCES sessions(id);
```

- Nullable — heartbeat messages have `session_id = NULL` (session-independent).
- Existing messages will have `NULL` session_id (orphaned from any session, effectively invisible to new session-based queries).

## Session Lifecycle

1. **Auto-create on first message**: If no current session exists (first boot, DB reset), automatically create one before processing the message.
2. **`/clear` slash command**: Creates a new session row, stores its ID as current.
3. **Current session tracking**: Store `current_session_id` in KV store (same pattern as `dmChannelId`). Survives process restarts.

## Query Changes

`getRecentMessages(limit: 50)` → `getSessionMessages(sessionId: number)`

- Fetches all messages where `session_id = $1`, ordered by `created_at ASC`.
- No artificial limit — the session boundary is the limit.

## Discord Slash Command

- Register `/clear` command on client ready via `client.application.commands.set()`.
- Handle via `interactionCreate` listener.
- On invocation: create new session in DB, store ID in KV, reply with ephemeral "Session cleared."
- No visible lasting message — ephemeral replies fade for the user.

## Heartbeat

- Heartbeat agent is session-independent. Heartbeat messages are stored with `session_id = NULL`.
- No changes to heartbeat context building.

## Affected Files

| File | Change |
|------|--------|
| `infra/init.sql` | Add `sessions` table, add `session_id` column to `messages` |
| `src/db.ts` | Add `createSession()`, `getCurrentSessionId()`, `setCurrentSessionId()`, replace `getRecentMessages()` with `getSessionMessages()`, update `appendMessage()` to accept `sessionId` |
| `src/discord.ts` | Register `/clear` slash command, add `interactionCreate` handler |
| `src/conversation-agent.ts` | Use session-scoped messages instead of `getRecentMessages(50)` |
| `src/context.ts` | No structural changes — just receives session-scoped history instead of limit-based |

## Testing

- DB tests: `createSession()`, `getSessionMessages()`, verify session isolation (messages from session A don't appear in session B query).
- Session lifecycle: auto-creation when none exists, `/clear` creates new session and updates KV.
- Discord: manual test of slash command registration and invocation.
