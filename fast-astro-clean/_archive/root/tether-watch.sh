#!/bin/sh
set -u

ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
mkdir -p "$ROOT"
LOG="$ROOT/tether-watch.log"
touch "$LOG"

while :; do
  TS="$(date '+%Y-%m-%d %H:%M:%S')"
  IFACE="$(cat /tmp/usb-octo-iface 2>/dev/null || true)"
  BT="$(curl -s -m 3 http://127.0.0.1:9400/api/status || true)"
  HOST="$(curl -4 -s -m 6 https://api.ipify.org || true)"
  PROXY="$(curl -4 -s -m 8 --socks5-hostname 127.0.0.1:1080 https://api.ipify.org || true)"
  DIRECT=""
  if [ -n "$IFACE" ]; then
    DIRECT="$(curl -4 -s -m 8 --interface "$IFACE" https://api.ipify.org || true)"
  fi
  DEFAULT="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  ADB="$(adb devices 2>/dev/null | awk 'NR==2{print $1" "$2}')"
  {
    echo "=== $TS iface=${IFACE:-none} default=${DEFAULT:-none} ==="
    echo "bettertether=$BT"
    echo "host=$HOST"
    echo "proxy=$PROXY"
    echo "direct_${IFACE:-none}=$DIRECT"
    echo "adb=$ADB"
  } >> "$LOG"
  sleep 5
done
