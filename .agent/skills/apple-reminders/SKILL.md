---
name: apple-reminders
description: Manage Apple Reminders using remindctl. Create, list, complete, edit, and delete reminders with due dates.
---

# Apple Reminders

You can manage the user's Apple Reminders using the `remindctl` CLI tool via bash.

**Important:** Always use the wrapper script instead of calling `remindctl`
directly. The wrapper routes through a .app bundle that has macOS Reminders
permission, which is required for daemon processes (pm2, tmux, etc).

```bash
REMINDCTL=".agent/skills/apple-reminders/remindctl-wrapper.sh"
```

## Dedicated List

**ALWAYS use this list for reminders you create:**
- List name: `Assistant`
- Purpose: Reminders created or managed by the AI assistant

Keep the user's other lists untouched. You may read other lists for context,
but never create, complete, edit, or delete reminders outside the Assistant list.

## Pre-flight

Before any reminders operation, check if the wrapper works:

```bash
$REMINDCTL status --json
```

If it returns `"authorized": false`, read `.agent/skills/apple-reminders/SETUP.md`
and follow the setup process.

## Commands

All commands support `--json` for structured output. Always use `--json`
so you can parse the results.

### Show Reminders

```bash
$REMINDCTL today --list Assistant --json
$REMINDCTL tomorrow --list Assistant --json
$REMINDCTL week --list Assistant --json
$REMINDCTL overdue --list Assistant --json
$REMINDCTL upcoming --list Assistant --json
$REMINDCTL all --list Assistant --json
$REMINDCTL 2026-02-07 --list Assistant --json
```

Filters: `today`, `tomorrow`, `week`, `overdue`, `upcoming`, `completed`, `all`, or a specific date (YYYY-MM-DD).

### Add Reminder

```bash
$REMINDCTL add "Buy milk" --list Assistant --json
$REMINDCTL add --title "Call mom" --list Assistant --due tomorrow --json
$REMINDCTL add --title "Submit report" --list Assistant --due 2026-02-10 --json
```

Due date formats: `today`, `tomorrow`, ISO date (`2026-02-10`), ISO datetime (`2026-02-10T14:00:00`).

### Edit Reminder

```bash
$REMINDCTL edit <id> --title "Updated title" --json
$REMINDCTL edit <id> --due 2026-02-15 --json
$REMINDCTL edit <id> --title "New title" --due tomorrow --json
```

### Complete Reminder

```bash
$REMINDCTL complete <id> --json
$REMINDCTL complete <id1> <id2> <id3> --json
```

Multiple IDs can be completed at once.

### Delete Reminder

```bash
$REMINDCTL delete <id> --force --json
```

Always use `--force` to skip the interactive confirmation prompt.

### List Management

```bash
$REMINDCTL list --json
$REMINDCTL list Assistant --json
```

Use `$REMINDCTL list --json` to see all available lists (read-only context).

### Check Permission Status

```bash
$REMINDCTL status --json
```

## Heartbeat

On each heartbeat tick, check for due and overdue reminders:

```bash
$REMINDCTL overdue --list Assistant --json
$REMINDCTL today --list Assistant --json
```

If there are overdue or due-today items, notify the user via the `speak`
tool with a summary of what's due.

## Behavior

- **Act immediately** — do not ask for confirmation before creating,
  completing, editing, or deleting reminders. Just do it and report what
  you did.
- **Use JSON output** — always pass `--json` and parse the result. Report
  results conversationally to the user.
- **Reasonable defaults** — when the user is vague ("remind me tomorrow"),
  pick sensible defaults. For "tomorrow morning", use tomorrow with no
  specific time (all-day). For specific times, use ISO datetime.
- **Reminder IDs** — when you need to complete, edit, or delete, first
  list reminders to find the ID from the JSON output.
- **Scoping** — always pass `--list Assistant` when creating or filtering.
  Only omit `--list` when the user explicitly asks about their other lists
  (read-only).
- **Errors** — if a command fails, check if it's a permission issue
  (direct user to System Settings) or a usage error (fix and retry).
