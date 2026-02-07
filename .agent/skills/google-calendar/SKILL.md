---
name: google-calendar
description: Manage Google Calendar events using the gog CLI. Create, list, update, delete events and check availability.
---

# Google Calendar

You can manage the user's Google Calendar using the `gog` CLI tool via bash.

## AI Calendar

**ALWAYS use this calendar for events you create:**
- Calendar ID: `km0dp70e6opan39d1kpse3a7ro@group.calendar.google.com`
- Name: "Assistant" (user will rename from "Habits")
- Purpose: Events created by the AI assistant (reminders, habits, tasks)

Events synced from memos/reminders, habits, and task tracking go here. Keep the primary calendar clean for personal/manual entries.

## Pre-flight

Before any calendar operation, check if gog is available:

```bash
which gog
```

If not found, read `.agent/skills/google-calendar/SETUP.md` and follow
the setup process.

If a command returns an authentication error, tell the user their Google
Calendar connection needs to be re-authorized and follow Phase 3 of SETUP.md.

## Commands

All commands support `--json` for structured output. Always use `--json`
so you can parse the results.

**Default calendar for AI events:** `km0dp70e6opan39d1kpse3a7ro@group.calendar.google.com`

### List Events

```bash
gog calendar events primary --today --json
gog calendar events primary --tomorrow --json
gog calendar events primary --week --json
gog calendar events primary --days 3 --json
gog calendar events primary --from 2026-02-07 --to 2026-02-14 --json
```

Flags: `--today`, `--tomorrow`, `--week`, `--days N`, `--from DATE`, `--to DATE`, `--max N`, `--all` (all calendars)

### Search Events

```bash
gog calendar search "meeting" --today --json
gog calendar search "standup" --from 2026-02-07 --to 2026-02-14 --json
```

### Get Single Event

```bash
gog calendar event primary EVENT_ID --json
```

### Create Event

```bash
gog calendar create "km0dp70e6opan39d1kpse3a7ro@group.calendar.google.com" \
  --summary "Team Standup" \
  --from 2026-02-07T09:00:00-08:00 \
  --to 2026-02-07T09:30:00-08:00 \
  --json
```

Optional flags:
- `--description "..."` — event description
- `--location "..."` — event location
- `--attendees "a@x.com,b@x.com"` — comma-separated attendee emails
- `--all-day` — all-day event (use date-only for --from/--to)
- `--rrule "RRULE:FREQ=WEEKLY;BYDAY=MO"` — recurrence
- `--reminder "popup:10m"` — reminder (popup or email, duration like 10m, 1h, 1d)
- `--with-meet` — add Google Meet link
- `--visibility private` — event visibility

### Update Event

```bash
gog calendar update "km0dp70e6opan39d1kpse3a7ro@group.calendar.google.com" EVENT_ID \
  --summary "New Title" \
  --from 2026-02-07T10:00:00-08:00 \
  --to 2026-02-07T11:00:00-08:00 \
  --json
```

All create flags work for update too, plus:
- `--add-attendee "c@x.com"` — add attendees without replacing existing

### Delete Event

```bash
gog calendar delete "km0dp70e6opan39d1kpse3a7ro@group.calendar.google.com" EVENT_ID --force
```

Always use `--force` to skip the interactive confirmation prompt.

### Check Availability

```bash
gog calendar freebusy \
  --calendars "primary" \
  --from 2026-02-07T00:00:00-08:00 \
  --to 2026-02-08T00:00:00-08:00 \
  --json
```

### Respond to Invitation

```bash
gog calendar respond primary EVENT_ID --status accepted
```

Status options: `accepted`, `declined`, `tentative`

## Behavior

- **Act immediately** — do not ask for confirmation before creating, updating,
  or deleting events. Just do it and report what you did.
- **Use JSON output** — always pass `--json` and parse the result. Report
  results conversationally to the user.
- **Timezone** — use the user's local timezone in ISO 8601 format for all
  datetimes (e.g. `2026-02-07T14:00:00-08:00`). Check the system timezone
  if unsure.
- **Reasonable defaults** — when the user is vague ("tomorrow afternoon"),
  pick sensible defaults: 1 hour duration, 2pm start. For "morning", use
  9am. For "end of day", use 5pm.
- **Event IDs** — when you need to update or delete, first list/search events
  to find the event ID from the JSON output.
- **Errors** — if a command fails, check if it's an auth issue (re-auth via
  SETUP.md Phase 3) or a usage error (fix the command and retry).