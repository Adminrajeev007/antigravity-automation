#!/bin/sh
# Start the orchestrator with 2 concurrent Octo profiles per batch.
# IP is toggled once per batch; the next toggle happens only after both finish.
set -eu
cd "$(dirname "$0")"

pkill -f "orchestrator.mjs" 2>/dev/null || true
sleep 1

export ORCH_BATCH=2

nohup node orchestrator.mjs > /tmp/orch.log 2>&1 &
PID=$!

echo "orchestrator started with 2 profiles per batch (pid $PID)"
echo "log:    tail -f /tmp/orch.log"
echo "health: curl -s http://127.0.0.1:8791/health"
echo "stop:   pkill -f orchestrator.mjs"
