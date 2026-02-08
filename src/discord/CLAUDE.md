# Discord Module

Discord bot integration for DM-based conversations. Receives user messages (text, images, voice), pushes them onto the signal queue, and renders agent responses back as Discord messages with debounced streaming updates.

## Public API

See `index.ts` — exports `createDiscordChannel`, render utilities (`renderViewContent`, `renderViewNodes`, `splitMessage`), and `transcribeVoice`.

## Key Concepts

- `createDiscordChannel` returns a `DiscordChannel` object: call `start()` to connect, `send()` for one-shot messages, `createStreamRenderer()` for live-updating agent output.
- Incoming DMs are transformed into `SignalQueue` items (see `src/queue.ts`), not processed directly.
- The `/clear` slash command creates a new session via `db.createSession`.
- Voice messages are transcribed locally via whisper-cpp (`transcribe.ts`). Requires `ffmpeg` and `whisper-cli` at `/opt/homebrew/bin/`.

## Dependencies

- **Depends on:** `db/` (session/KV persistence), `llm-gateway` (graph projection, view types), `src/queue` (signal queue)
- **Used by:** `src/main.ts`, `agents/conversation/`

## Testing

Tests in `__test__/`. Run: `bun test src/discord/__test__/`
