#!/bin/sh
set -u

BUNDLE="$(cd "$(dirname "$0")" && pwd)"

pkill -f 'orchestrator\.mjs' 2>/dev/null || true
sleep 1

"$BUNDLE/usb-octo-proxy.sh" || exit 1

cd "$BUNDLE"
ANTIG_REQUIRE_USB_TETHER=0 \
ORCH_ROTATE_USB=1 \
ORCH_RESET_PROFILES=1 \
ORCH_BATCH=3 \
EXT_ZIP="$BUNDLE/gcp-auto-intern-portal-v1.5.0.zip" \
ORCH_PROXY_SERVER=socks5://127.0.0.1:1080 \
nohup ./run.sh >/tmp/orch-usb.log 2>&1 &

sleep 1
python3 "$BUNDLE/orch-ui.py" /tmp/orch-usb.log
