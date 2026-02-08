# Conversation Agent

Responds to user messages (Discord) and heartbeat thoughts via the signal queue.

## Key Concepts

- Signals of type `heartbeat` become assistant-role messages in history; user signals become user-role.
- The run loop is re-entrant safe: single-threaded event loop guarantees no concurrent `runOnce()` calls (see `index.ts:19` comment).
- Discord envelope metadata (username, channel) is injected as an ephemeral system message — not persisted to history.
- After each run completes, the queue is re-checked to catch signals that arrived mid-run.
