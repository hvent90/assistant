#!/bin/bash
# Wrapper that runs remindctl through RemindctlHelper.app via `open`.
# The .app bundle has its own TCC Reminders permission, so this works
# from any calling process (tmux, pm2, etc).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$SCRIPT_DIR/RemindctlHelper.app"
OUTFILE=$(mktemp /tmp/remindctl-XXXXXX)
DONEFILE="$OUTFILE.done"
trap 'rm -f "$OUTFILE" "$DONEFILE"' EXIT

open "$APP" --args --wrapper-outfile "$OUTFILE" "$@"

# Wait for the command to finish
for i in $(seq 1 100); do
  if [ -f "$DONEFILE" ]; then
    break
  fi
  sleep 0.1
done

if [ ! -f "$DONEFILE" ]; then
  echo "remindctl-wrapper: timed out waiting for command" >&2
  exit 1
fi

EXIT_CODE=$(cat "$DONEFILE")
cat "$OUTFILE"
exit "${EXIT_CODE:-1}"
