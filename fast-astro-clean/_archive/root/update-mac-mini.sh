#!/bin/sh
# Push only changed files to the Mac mini, then restart the orchestrator there.
# Run from this Mac:  ./update-mac-mini.sh [--login]
set -eu

SOURCE="/Users/rahulkumar/Documents/ALL-PROJECTS/antigravity-automationand extension/antig-orchestrator-mac/"
HOST="${MINI_HOST:-logutrd@logutrds-Mac-mini.local}"
DEST="${MINI_PATH:-~/Desktop/antig-orchestrator-mac}"
SERIAL="${ANTIG_ANDROID_SERIAL:-QWXSKBCQCUHUXKXS}"
BATCH="${ORCH_BATCH:-2}"

echo "== Sync $SOURCE -> $HOST:$DEST =="
rsync -av --exclude 'runtime/' --exclude '*.tar.gz' "$SOURCE" "$HOST:$DEST/"

echo "== Restart orchestrator =="
ssh "$HOST" "cd $DEST && pkill -f orchestrator.mjs 2>/dev/null || true; sleep 1; ANTIG_ANDROID_SERIAL='$SERIAL' ORCH_BATCH='$BATCH' nohup ./run.sh >/tmp/orch.log 2>&1 & echo orchestrator-started"

if [ "${1:-}" = "--login" ]; then
  echo "== Update login extension profile =="
  ssh "$HOST" "cd $DEST && ./login-setup.sh"
fi

echo "Done. Logs: ssh $HOST 'tail -f /tmp/orch.log'"
