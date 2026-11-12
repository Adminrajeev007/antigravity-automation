#!/bin/sh
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/antig-orchestrator-mac/run.sh" ]; then
  BUNDLE="$DIR/antig-orchestrator-mac"
else
  BUNDLE="$DIR"
fi

pkill -f 'orchestrator\.mjs' 2>/dev/null || true
pkill -f 'orch-ui\.py' 2>/dev/null || true
sleep 1

cd "$BUNDLE"
ANTIG_REQUIRE_USB_TETHER=0 \
ORCH_PROXY_CONFIG="$BUNDLE/proxy.local.json" \
ORCH_ROTATE_IP=1 \
ORCH_RESET_PROFILES=1 \
ORCH_BATCH=3 \
EXT_ZIP="$BUNDLE/gcp-auto-intern-portal-v1.5.7.zip" \
nohup ./run.sh >/tmp/orch-usb.log 2>&1 &

sleep 1
python3 "$BUNDLE/orch-ui.py" /tmp/orch-usb.log
