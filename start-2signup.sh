#!/bin/sh
# Continuous 2-profile signup runner.
# The orchestrator rotates the proxy IP before every batch.
# No login profile is created or maintained.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
mkdir -p "$ROOT"

echo "== stopping previous signup runner (no login profile involved) =="
pkill -f 'orchestrator\.mjs' 2>/dev/null || true
pkill -f 'profile-trace\.mjs' 2>/dev/null || true
pkill -f 'orch-ui\.py' 2>/dev/null || true
pkill -f 'login-keepalive\.sh' 2>/dev/null || true
pkill -f 'login-monitor\.mjs' 2>/dev/null || true
sleep 1

echo "== starting continuous 2-profile signup (IP rotates before each batch) =="
ORCH_BATCH=2 \
ORCH_MAX_RUNS="${ORCH_MAX_RUNS:-0}" \
ORCH_RESET_PROFILES="${ORCH_RESET_PROFILES:-1}" \
ORCH_ROTATE_IP=1 \
  "$DIR/run-with-logs.sh"

echo
echo "signup: 2 profiles/batch, continuous (ORCH_MAX_RUNS=${ORCH_MAX_RUNS:-0})"
echo "logs:   $ROOT"
