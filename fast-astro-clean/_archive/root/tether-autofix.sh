#!/bin/sh
set -u

ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
LOG="$ROOT/tether-autofix.log"
ADB="${ANTIG_ADB:-/opt/homebrew/bin/adb}"
SERIAL="${ANTIG_ANDROID_SERIAL:-QWXSKBCQCUHUXKXS}"
mkdir -p "$ROOT"
touch "$LOG"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

bt_status() {
  curl -s -m 4 http://127.0.0.1:9400/api/status 2>/dev/null || true
}

bt_active() {
  printf '%s' "$1" | sed -n 's/.*"active":\([^,}]*\).*/\1/p'
}

bt_client_ip() {
  printf '%s' "$1" | sed -n 's/.*"clientIP":"\([^"]*\)".*/\1/p'
}

iface_for_ip() {
  [ -n "$1" ] || return 0
  ifconfig 2>/dev/null | awk -v ip="$1" '
    /^[a-z0-9]+:/ { iface=$1; sub(":","",iface) }
    $1=="inet" && $2==ip { print iface; exit }
  '
}

enable_phone_usb_tether() {
  if ! "$ADB" devices 2>/dev/null | awk 'NR==2{print $2}' | grep -q '^device$'; then
    log "phone not available via adb"
    return 1
  fi
  "$ADB" -s "$SERIAL" shell input keyevent 224 >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell svc usb setFunctions rndis,adb >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell svc usb setScreenUnlockedFunctions rndis,adb >/dev/null 2>&1 || true
  sleep 2
  if "$ADB" -s "$SERIAL" shell getprop sys.usb.config 2>/dev/null | grep -q rndis; then
    return 0
  fi

  # This phone rejects svc usb; use the on-device USB preference dialog.
  "$ADB" -s "$SERIAL" shell am start -a android.settings.TETHER_SETTINGS >/dev/null 2>&1 || true
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" pull /sdcard/window.xml /tmp/tether-window.xml >/dev/null 2>&1 || true
  INFO="$(python3 - <<'PY'
import re
import xml.etree.ElementTree as ET

def bounds(node):
    m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds') or '')
    return tuple(map(int, m.groups())) if m else None

try:
    root = ET.parse('/tmp/tether-window.xml').getroot()
    label = None
    for n in root.iter():
        text = (n.get('text') or '').strip().lower()
        desc = (n.get('content-desc') or '').strip().lower()
        if 'usb tethering' in text or 'usb tethering' in desc:
            label = bounds(n)
            break
    if label:
        x1, y1, x2, y2 = label
        best = None
        for n in root.iter():
            if 'switch' not in (n.get('class') or '').lower():
                continue
            b = bounds(n)
            if not b:
                continue
            cx = (b[0] + b[2]) // 2
            cy = (b[1] + b[3]) // 2
            if y1 - 90 <= cy <= y2 + 90:
                score = abs(cy - (y1 + y2) // 2)
                if best is None or score < best[0]:
                    best = (score, b, n.get('checked'))
        if best:
            b = best[1]
            print(f'{(b[0]+b[2])//2} {(b[1]+b[3])//2} {best[2] or "false"} switch')
        else:
            # The "Use USB for" dialog has a tappable USB tethering row,
            # not a switch node.
            print(f'{(x1+x2)//2} {(y1+y2)//2} false row')
except Exception:
    pass
PY
)"
  [ -n "$INFO" ] || return 1
  set -- $INFO
  X="$1"
  Y="$2"
  CHECKED="$3"
  MODE="$4"
  "$ADB" -s "$SERIAL" shell input tap "$X" "$Y" >/dev/null 2>&1 || true
  sleep 3
  if [ "$MODE" = "switch" ] && [ "$CHECKED" = "true" ]; then
    # The toggle can show On while RNDIS is still absent; cycle it off/on.
    "$ADB" -s "$SERIAL" shell input tap "$X" "$Y" >/dev/null 2>&1 || true
    sleep 5
  fi
  "$ADB" -s "$SERIAL" shell getprop sys.usb.config 2>/dev/null | grep -q rndis
}

LAST_UI=0
LAST_STATE=''

while :; do
  BT="$(bt_status)"
  ACTIVE="$(bt_active "$BT")"
  IP="$(bt_client_ip "$BT")"
  NOW="$(date +%s)"

  if [ "$ACTIVE" != "true" ]; then
    log "usb tether inactive; starting BetterTether daemon"
    curl -s -m 6 -X POST http://127.0.0.1:9400/api/daemon/start >/dev/null 2>&1 || true
    sleep 3
    BT="$(bt_status)"
    ACTIVE="$(bt_active "$BT")"
    if [ "$ACTIVE" != "true" ] && [ $((NOW - LAST_UI)) -ge 30 ]; then
      LAST_UI=$NOW
      log "attempting phone USB tether enable"
      enable_phone_usb_tether || true
      sleep 4
      curl -s -m 6 -X POST http://127.0.0.1:9400/api/daemon/start >/dev/null 2>&1 || true
      sleep 2
      BT="$(bt_status)"
      ACTIVE="$(bt_active "$BT")"
    fi
  fi

  IP="$(bt_client_ip "$BT")"
  IFACE="$(iface_for_ip "$IP")"
  if [ -n "$IFACE" ]; then
    printf '%s\n' "$IFACE" > /tmp/usb-octo-iface
  fi

  STATE="active=${ACTIVE:-unknown} iface=${IFACE:-none} ip=${IP:-none}"
  if [ "$STATE" != "$LAST_STATE" ]; then
    log "$STATE"
    LAST_STATE="$STATE"
  fi

  sleep 10
done
