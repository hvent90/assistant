# Memories

## Overview

The assistant needs persistent memory across ephemeral agent runs. Conversation history (Postgres) captures what was said, but the assistant also needs to retain knowledge about itself, its user, and summaries of past events.

Memories live as **markdown files on disk**, managed entirely by the agent via its bash tool. No new tools or abstractions — the infrastructure reads two key files into context, and the agent handles everything else.

## Storage

**Postgres** — Infrastructure-managed. Stores all messages (user and assistant). The application code writes messages; the agent can query them via SQL through bash.

**Disk (`memories/`)** — Agent-managed. The agent reads and writes these files via bash. This is the agent's personal knowledge base.

## File Layout

```
memories/
  soul.md       # Personality and self-knowledge
  user.md       # Facts about the user
  diary/
    2026-02-01T14-30-00.md
    2026-02-01T20-15-00.md
```

### `soul.md`

The assistant's personality. Who it is, how it behaves, what it's learned about itself. The agent rewrites this file in full when it needs to update. Read into context on every agent run.

### `user.md`

Important information about the user. Preferences, facts, projects, communication style. The agent rewrites this file in full when it learns something new. Read into context on every agent run.

### `diary/`

Timestamped entries summarizing recent events. Written primarily during heartbeat ticks, but can also be written after significant conversations. Each entry is a separate file, never modified after creation.

Filenames use filesystem-safe timestamps: `YYYY-MM-DDTHH-MM-SS.md`

Diary entries are **not** loaded into context automatically. The agent reads them on demand via bash when it needs to recall past events.

## Context Integration

Memory adds a stage to the context pipeline, between the system prompt and status board. The infrastructure reads `soul.md` and `user.md` from disk and injects their contents:

```
## Your Personality
[contents of soul.md]

## About the User
[contents of user.md]
```

If either file doesn't exist (first run), that section is omitted.

### Per-Agent Context Pipelines

**Conversation agent:**

1. System prompt (tool instructions, memory instructions)
2. Memory files (`soul.md` + `user.md`)
3. Status board
4. Conversation history (last N messages from DB)
5. Trigger signal (current user message)

**Heartbeat agent:**

1. System prompt (tool instructions, memory instructions)
2. Memory files (`soul.md` + `user.md`)
3. Status board
4. Heartbeat prompt

The heartbeat agent does **not** receive conversation history automatically. It queries recent messages via bash/SQL when it needs them.

## When Memories Get Written

**During conversations:** When the agent learns something important (a user preference, a correction, a new fact), it uses bash to rewrite `user.md` or `soul.md`. This happens naturally — no automated trigger. The system prompt instructs the agent to do this when warranted.

**During heartbeat ticks:** The heartbeat agent reflects on recent events and writes diary entries to `diary/`. It may also update `soul.md` or `user.md` if it notices something worth persisting.

## Conventions

- `soul.md` and `user.md` are rewritten in full (not appended). The agent maintains them as living documents.
- Diary entries are append-only. New file per entry, never modified.
- The agent decides when something is worth remembering. No automated triggers.
- `memories/` directory should be in `.gitignore` — these are runtime-generated, personal data.

## Edge Cases

**First run:** No memory files exist. Context builder omits memory sections. System prompt tells the agent the files exist and it can create them. Agent creates them on first meaningful interaction.

**Concurrent writes:** Both agents could theoretically write to `soul.md` at the same time. The heartbeat agent skips ticks when the conversation agent is running, making this unlikely. If it happens, last-write-wins is acceptable — the agent can recover information from conversation history.

**Growing diary directory:** Accumulates over time. The agent can `ls memories/diary/` to browse and `cat` specific entries. No cleanup mechanism needed initially.

## Future Work

- Token budgeting: track context window usage and trim conversation history to fit within limits.
- Additional memory categories beyond diary (agent creates new subdirectories as needed).
- Semantic search over diary entries if the collection grows large.
