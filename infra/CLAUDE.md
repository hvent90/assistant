# Infrastructure

PostgreSQL 17 via Podman. Schema in `init.sql`.

## Gotchas

- **Non-standard port mapping:** container port 5432 → host port **5434**. Connection: `postgres://assistant:assistant@localhost:5434/assistant`
- Schema changes require recreating the container (no migration tool yet): `podman compose down -v && podman compose up -d`

## Usage

```bash
podman compose -f infra/docker-compose.yml up -d   # Start
podman compose -f infra/docker-compose.yml down     # Stop
podman exec infra_postgres_1 psql -U assistant -d assistant -c "SELECT ..."
```
