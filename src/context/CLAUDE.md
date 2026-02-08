# Context

Builds LLM context for both agents: system prompts, memory loading, message projection.

## Key Concepts

- `buildSystemPrompt` assembles personality + user facts + active agent status + skills into one system message.
- Memory files (`memories/soul.md`, `user.md`, `instructions.md`) are read at prompt-build time and injected verbatim — see @memories/CLAUDE.md for file conventions.
- `nodesToMessages` projects llm-gateway graph nodes into the `Message[]` format expected by the LLM API. Heartbeat signals become assistant-role messages.

## Testing

`bun test src/context/__test__/`
