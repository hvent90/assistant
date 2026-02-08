# Docs

Historical design documents and implementation plans. These capture decisions at the time they were made — the codebase is the source of truth for current behavior.

## Root Files

- `2026-02-01-background-assistant-design.md` — Original architecture doc (signals, context assembly, two-agent model)
- `refactoring-plan.md` — Codebase audit and prioritized refactoring plan
- `writing-a-good-claude-md.md` — Style guide for CLAUDE.md files

## plans/

Date-prefixed design and implementation docs, ordered chronologically:

- `2026-02-01-*` — V1 implementation, memories system, resilient heartbeat, status board persistence
- `2026-02-02-*` — Heartbeat speak tool (inter-agent communication)
- `2026-02-03-*` — Session-based context, unified node persistence, heartbeat viewer
- `2026-02-04-*` — Mobile responsive sidebar, scheduled tasks with timezones
- `2026-02-05-*` — Logging solution, scheduled tasks viewer
- `2026-02-06-*` — Discord message awareness
- `2026-02-07-*` — Apple Reminders integration
