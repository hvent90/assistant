# Schedule CRUD Design

Full CRUD for the internal scheduling system. Currently only `schedule` (create) exists. Adding list, edit, and cancel.

## Decisions

- All three new tools available to both conversation and heartbeat agents
- List supports status filter + optional date range
- Edit allows changing both `fire_at` and `prompt`
- Edit/cancel only work on pending tasks

## DB Layer (`src/db/client.ts`)

### `listScheduledTasks(opts)`

```typescript
type ListOpts = { status?: string; from?: Date; to?: Date }
```

- Defaults to `status = 'pending'` when no status provided
- Builds WHERE clause dynamically from provided filters
- Returns `ScheduledTask[]` ordered by `fire_at ASC`

### `updateScheduledTask(id, updates)`

```typescript
type UpdateOpts = { fireAt?: Date; prompt?: string }
```

- Guards: only updates where `status = 'pending'`
- Returns row count (0 = not found or not editable)
- At least one field must be provided

### `cancelScheduledTask(id)`

- Sets `status = 'cancelled'` where `status = 'pending'`
- Returns row count (0 = not found or not editable)

## Tool Layer (`src/tools/tools.ts`)

### `schedule_list`

- Schema: `{ status?: string, from?: string, to?: string }`
- Parses from/to via `new Date()`
- Returns formatted table: ID, fire_at (local time), status, truncated prompt
- Empty result: "No scheduled tasks found matching filters."

### `schedule_edit`

- Schema: `{ id: number, at?: string, prompt?: string }`
- At least one of at/prompt required
- Returns confirmation with updated values or "Task #N not found or not editable (only pending tasks can be edited)."

### `schedule_cancel`

- Schema: `{ id: number }`
- Returns confirmation or "not found/not editable" message

## Wiring

- Export from `src/tools/index.ts`
- Add to tool arrays in `src/agents/conversation/run.ts` and `src/agents/heartbeat/run.ts`

## Testing

Real Postgres, no mocks.

**DB tests** (`src/db/__test__/db-scheduled.test.ts`):
- listScheduledTasks: no filters, status filter, date range, combined, empty
- updateScheduledTask: fire_at, prompt, both, not found, not pending
- cancelScheduledTask: happy path, not pending

**Tool tests** (`src/scheduling/__test__/schedule-crud-tools.test.ts`):
- schedule_list: formatted output
- schedule_edit: happy path + not editable
- schedule_cancel: happy path + not editable
- Date parsing errors
