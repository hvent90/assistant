# Apple Reminders Setup

Follow these steps to set up Apple Reminders access. You (the agent) should
execute every command you can directly. Only ask the user when a step
requires their interaction with a system dialog.

## Phase 1: Install remindctl

Run:

```bash
brew install steipete/tap/remindctl
```

Verify:

```bash
remindctl --version
```

## Phase 2: Authorize the Helper App

The wrapper uses a minimal .app bundle (`RemindctlHelper.app`) so that
macOS grants it Reminders permission independently of the calling process.

Launch it via `open` to trigger the macOS permission dialog:

```bash
open .agent/skills/apple-reminders/RemindctlHelper.app --args authorize
```

Tell the user to click **Allow** when the system dialog appears.

Verify permission via the wrapper:

```bash
.agent/skills/apple-reminders/remindctl-wrapper.sh status --json
```

Should return `"authorized": true`. If not, tell the user to go to
System Settings > Privacy & Security > Reminders and enable
RemindctlHelper.

## Phase 3: Create the Assistant List

Check if the list already exists:

```bash
.agent/skills/apple-reminders/remindctl-wrapper.sh list --json
```

If "Assistant" is not in the output, create it:

```bash
.agent/skills/apple-reminders/remindctl-wrapper.sh list Assistant --create
```

## Phase 4: Verify

Run:

```bash
.agent/skills/apple-reminders/remindctl-wrapper.sh today --list Assistant --json
```

If this returns reminders (or an empty list with no error), setup is complete.
If it returns a permission error, re-run Phase 2.
