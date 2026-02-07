# Apple Reminders Integration Design

## Overview

Agent skill for bidirectional Apple Reminders management using `remindctl`
CLI. The agent creates, reads, completes, edits, and deletes reminders in
a dedicated "Assistant" list. The heartbeat agent proactively checks for
due/overdue items.

## Architecture

Same documentation-driven pattern as the Google Calendar skill: a SKILL.md
file teaches the agent how to use `remindctl` via bash. No TypeScript code.

### macOS TCC Permission Workaround

macOS restricts Reminders access via TCC (Transparency, Consent, and Control).
Daemon processes (tmux, pm2) can't trigger permission dialogs. Solution:

1. A minimal `.app` bundle (`RemindctlHelper.app`) wraps remindctl
2. Launched once via `open` to trigger the TCC dialog and get its own permission
3. A wrapper script (`remindctl-wrapper.sh`) launches the app via `open`,
   passing args and capturing output through temp files
4. The SKILL.md instructs the agent to use the wrapper instead of remindctl directly

### File Structure

```
.agent/skills/apple-reminders/
  SKILL.md                    # Skill documentation
  SETUP.md                    # Installation and authorization
  remindctl-wrapper.sh        # Wrapper script (calls app via open)
  RemindctlHelper.app/        # Minimal .app bundle for TCC permission
    Contents/
      Info.plist
      MacOS/remindctl-helper   # Shell script that execs remindctl
```

## Verified Operations

All tested from tmux via the wrapper:

- `status` — permission check
- `list` — enumerate reminder lists
- `add` — create reminder with due date
- `upcoming/today/overdue` — date-filtered queries
- `edit` — modify title/due date
- `complete` — mark as done
- `delete --force` — remove permanently
