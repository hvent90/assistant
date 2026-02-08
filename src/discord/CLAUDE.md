# Discord Module

DM-only Discord bot. Receives text, images, and voice messages; pushes them onto the signal queue; renders agent responses back with debounced streaming updates.

## Key Concepts

- Incoming DMs become `SignalQueue` items (see `src/queue.ts`), not processed directly by this module.
- The `/clear` slash command creates a new session via `db.createSession`.
- Voice messages are transcribed locally via whisper-cpp (`transcribe.ts`). Requires `ffmpeg` and `whisper-cli` at `/opt/homebrew/bin/`.
- `createStreamRenderer()` debounces Discord API calls to avoid rate limits during streaming.

## Testing

`bun test src/discord/__test__/`
