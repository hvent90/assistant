# infra/

PostgreSQL 17 via Docker/Podman. Schema in `init.sql`.

## Tables

- `messages` — conversation history (role, content JSONB, agent, session_id)
- `sessions` — session tracking
- `kv` — key-value store (JSONB values)
- `scheduled_tasks` — scheduled prompts with retry logic

## Usage

```bash
podman compose -f infra/docker-compose.yml up -d   # Start
podman compose -f infra/docker-compose.yml down     # Stop
```

## Dependencies

- **Used by:** `src/db/`

Connection: `postgres://assistant:assistant@localhost:5434/assistant`

```bash
podman exec infra_postgres_1 psql -U assistant -d assistant -c "SELECT ..."
```
