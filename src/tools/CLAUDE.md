# Tools

LLM-callable tool definitions conforming to `llm-gateway`'s `ToolDefinition` interface.

## Key Concepts

- `speak` sends a *thought* (context for the conversation agent), not a user-facing message. The conversation agent decides phrasing.
- `schedule` parses dates via `new Date()` — only ISO-ish formats are reliable. Natural language dates will silently produce wrong results.

## Testing

`bun test src/tools/__test__/`
