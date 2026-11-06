#!/bin/sh
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/antig-orchestrator-mac/run.sh" ]; then
  BUNDLE="$DIR/antig-orchestrator-mac"
else
  BUNDLE="$DIR"
fi

ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
mkdir -p "$ROOT"
LOGIN_LOG="$ROOT/login-$(date +%Y%m%d-%H%M%S).log"

# 2 concurrent signup profiles, continuous batches, techvantax.com.
ORCH_BATCH=2 ORCH_MAX_RUNS=0 "$DIR/run-with-logs.sh" || exit 1

# Give the two signup slots time to open before creating the third/login profile.
sleep 25
cd "$BUNDLE"
nohup ./login-setup.sh > "$LOGIN_LOG" 2>&1 &
LOGIN_PID=$!
echo "$LOGIN_PID" > "$ROOT/login.pid"
printf '%s\n' "$LOGIN_LOG" > "$ROOT/latest-login-log"

echo "signup: 2 profiles/batch, continuous, all domains (random)"
echo "login:  1 profile started (pid $LOGIN_PID)"
echo "login log: $LOGIN_LOG"
