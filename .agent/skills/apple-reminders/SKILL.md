---
name: apple-reminders
description: Manage Apple Reminders using remindctl via the wrapper script. IMPORTANT - never call remindctl directly, always use the wrapper at .agent/skills/apple-reminders/remindctl-wrapper.sh (relative to project root).
---

# Apple Reminders

You can manage the user's Apple Reminders using the `remindctl` CLI tool via bash.

**NEVER call `remindctl` directly.** Always use the wrapper script:

```
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh
```

The wrapper routes through a .app bundle that has macOS Reminders
permission. Calling `remindctl` directly will fail with a permission error
because the agent runs as a daemon process (pm2/tmux).

## Dedicated List

**ALWAYS use this list for reminders you create:**
- List name: `Assistant`
- Purpose: Reminders created or managed by the AI assistant

Keep the user's other lists untouched. You may read other lists for context,
but never create, complete, edit, or delete reminders outside the Assistant list.

## Pre-flight

Before any reminders operation, check if the wrapper works:

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh status --json
```

If it returns `"authorized": false`, read the SETUP.md in this skill's
directory and follow the setup process.

## Commands

All commands support `--json` for structured output. Always use `--json`
so you can parse the results. Replace `<project-root>` with the actual
project root path from the system prompt.

### Show Reminders

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh today --list Assistant --json
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh tomorrow --list Assistant --json
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh week --list Assistant --json
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh overdue --list Assistant --json
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh upcoming --list Assistant --json
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh all --list Assistant --json
```

Filters: `today`, `tomorrow`, `week`, `overdue`, `upcoming`, `completed`, `all`, or a specific date (YYYY-MM-DD).

### Add Reminder

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh add "Buy milk" --list Assistant --json
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh add --title "Call mom" --list Assistant --due tomorrow --json
```

Due date formats: `today`, `tomorrow`, ISO date (`2026-02-10`), ISO datetime (`2026-02-10T14:00:00`).

### Edit Reminder

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh edit <id> --title "Updated title" --json
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh edit <id> --due 2026-02-15 --json
```

### Complete Reminder

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh complete <id> --json
```

Multiple IDs can be completed at once.

### Delete Reminder

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh delete <id> --force --json
```

Always use `--force` to skip the interactive confirmation prompt.

### List Management

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh list --json
```

### Check Permission Status

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh status --json
```

## Heartbeat

On each heartbeat tick, check for due and overdue reminders:

```bash
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh overdue --list Assistant --json
<project-root>/.agent/skills/apple-reminders/remindctl-wrapper.sh today --list Assistant --json
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
