#!/bin/sh
# GCP Combo Portal: signup + inline OAuth login, 2 profiles per batch.
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
pkill -f 'orch-ui\.py' 2>/dev/null || true
pkill -f 'signup-live\.py' 2>/dev/null || true
sleep 1

ORCH_BATCH=2 \
ORCH_MAX_RUNS="${ORCH_MAX_RUNS:-0}" \
ORCH_RESET_PROFILES="${ORCH_RESET_PROFILES:-1}" \
ORCH_ROTATE_IP=1 \
ORCH_COMBO=1 \
EXT_ZIP="$BUNDLE/gcp-combo-portal-v1.0.19.zip" \
  "$DIR/run-with-logs.sh"

echo
echo "combo: 2 profiles/batch, signup -> billing -> OAuth -> completed"
echo "logs: $ROOT"
