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

"$BUNDLE/usb-octo-proxy.sh" || exit 1

cd "$BUNDLE"
ANTIG_REQUIRE_USB_TETHER=0 \
ORCH_ROTATE_USB=1 \
ORCH_RESET_PROFILES=1 \
ORCH_BATCH=3 \
ORCH_EMAIL_DOMAIN=scriptsprint.org \
EXT_ZIP="$BUNDLE/gcp-auto-intern-portal-v1.5.3.zip" \
ORCH_PROXY_SERVER=socks5://127.0.0.1:1080 \
nohup ./run.sh >/tmp/orch-usb.log 2>&1 &

sleep 1
python3 "$BUNDLE/orch-ui.py" /tmp/orch-usb.log
