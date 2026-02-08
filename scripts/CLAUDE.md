# Scripts

Ad-hoc utility scripts for debugging and inspection. Run with `bun run scripts/<name>.ts`.

## Scripts

- **`count-context-tokens.ts`** — Builds the full conversation agent context (history + memory + status board) and prints per-message character counts with an approximate token estimate. Requires Postgres running.
- **`query-messages.ts`** — Fetches the 10 most recent messages from Postgres and prints role, source, agent, and timestamp. Requires Postgres running.

## Notes

Both scripts read `DATABASE_URL` from `.env` and call `process.exit(0)` when done.
