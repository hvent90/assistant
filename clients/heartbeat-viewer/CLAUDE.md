# clients/heartbeat-viewer/

Web UI for browsing heartbeat sessions, conversation threads, and scheduled tasks. React SPA backed by a Bun server that queries Postgres directly.

## Tech Stack

React, Vite, Tailwind CSS, TypeScript. Backend: Bun HTTP server (`server.ts`) serving the API and static files.

## Commands

```bash
bun run viewer:dev       # Vite dev server (port 5101, proxies /api to backend)
bun run viewer:build     # Build to dist/
bun run viewer:serve     # Production server (port 5100)
```

## Structure

- `server.ts` — API endpoints (`/api/sessions`, `/api/scheduled-tasks`, `/api/heartbeat-status`)
- `src/` — React components, graph rendering, CSS
- `vite.config.ts` — Vite config with API proxy to backend
