# Heartbeat Viewer

Web UI for browsing heartbeat sessions, conversation threads, and scheduled tasks. React SPA backed by a Bun HTTP server that queries Postgres directly (no auth layer).

## Commands

```bash
bun run viewer:dev       # Vite dev (port 5101, proxies /api to backend)
bun run viewer:build     # Build to dist/
bun run viewer:serve     # API server (port 5100)
```

## Key Concepts

- Two-process architecture in dev: Vite on 5101 proxies `/api/*` to Bun server on 5100.
- `server.ts` queries the same Postgres database as the main assistant — connection string from `DATABASE_URL`.
- Viewer env vars: `VIEWER_PORT` (default 5100), `VITE_PORT` (default 5101), `VIEWER_BASE_URL`, `VITE_BACKEND_URL`.
