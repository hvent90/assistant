# Context

Shared utilities for building LLM context: system prompts, memory loading, message projection, and agent output collection. Used by both conversation and heartbeat agents.

## Public API

See `index.ts` for exports:

- `buildSystemPrompt(statusBoard, memory, memoriesDir, repoRoot, skillsPrompt?)` — Assembles the system prompt including personality, user facts, active agents, and skills
- `readMemoryFiles(memoriesDir)` — Reads `soul.md`, `user.md`, `instructions.md` from the memories directory
- `nodesToMessages(nodes)` — Projects `llm-gateway` graph nodes into the `Message[]` format expected by the LLM API
- `collectAgentOutput(events, onEvent?)` — Consumes an async iterable of orchestrator events, reduces them into a graph, and returns the final nodes

## Dependencies

- **Depends on:** `llm-gateway` (`Graph`, `Node`, `Message` types, `createGraph`/`reduceEvent`), `format-time`
- **Used by:** `agents/conversation/`, `agents/heartbeat/`

## Testing

Tests in `__test__/`. Run: `bun test src/context/__test__/`
