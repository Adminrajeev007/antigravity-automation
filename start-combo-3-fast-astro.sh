#!/bin/sh
# Fast combo: 3 profiles per batch, blocker attached per profile,
# rotate IP after each batch, backend sheet queue, instant close on API 200.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/antig-orchestrator-mac/run.sh" ]; then
  BUNDLE="$DIR/antig-orchestrator-mac"
else
  BUNDLE="$DIR"
fi
ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
mkdir -p "$ROOT"

pkill -f 'orchestrator\.mjs' 2>/dev/null || true
pkill -f 'profile-trace\.mjs' 2>/dev/null || true
pkill -f 'block-fx\.mjs' 2>/dev/null || true
pkill -f 'orch-ui\.py' 2>/dev/null || true
pkill -f 'signup-live\.py' 2>/dev/null || true
sleep 1

ORCH_BATCH=3 \
ORCH_MAX_RUNS="${ORCH_MAX_RUNS:-0}" \
ORCH_RESET_PROFILES="${ORCH_RESET_PROFILES:-1}" \
ORCH_ROTATE_IP=0 \
ANTIG_PROXY_CONFIG="$DIR/proxy.astro.json" \
ORCH_PROXY_CONFIG="$DIR/proxy.astro.json" \
ORCH_BATCH_TIMEOUT_MS="${ORCH_BATCH_TIMEOUT_MS:-510000}" \
ORCH_COMBO=1 \
EXT_ZIP="$BUNDLE/gcp-combo-portal-v1.0.24.zip" \
  "$DIR/run-with-logs.sh"

RUN="$(ls -td "$ROOT"/run-* 2>/dev/null | head -1)"
LOG="$RUN/orchestrator.log"
NODE="$BUNDLE/runtime/node/bin/node"
echo "combo fast: 3 profiles/batch, blocker on, IP toggles after each batch"
echo "logs: $LOG"
[ -f "$LOG" ] || exit 0
tail -n +1 -F "$LOG" | while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    *"started GCP Intern"*"port="*)
      PORT=$(printf '%s\n' "$line" | sed -n 's/.*port=\([0-9][0-9]*\).*/\1/p')
      if [ -n "$PORT" ]; then
        nohup "$NODE" --experimental-websocket "$DIR/block-fx.mjs" "$PORT" 900 >"/tmp/block-$PORT.log" 2>&1 &
        echo "blocker attached: port $PORT"
      fi
      ;;
    *" finished"|*"finished"*)
      break
      ;;
  esac
done
