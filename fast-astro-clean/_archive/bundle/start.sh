#!/bin/sh
# Start the orchestrator in the background (3 profiles at once by default).
set -eu
cd "$(dirname "$0")"

pkill -f "orchestrator.mjs" 2>/dev/null || true
sleep 1

nohup ./run.sh > /tmp/orch.log 2>&1 &
PID=$!

echo "orchestrator started (pid $PID, ${ORCH_BATCH:-3} profiles/batch)"
echo "log:    tail -f /tmp/orch.log"
echo "health: curl -s http://127.0.0.1:8791/health"
echo "stop:   pkill -f orchestrator.mjs"
