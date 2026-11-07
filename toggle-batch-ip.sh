#!/bin/sh
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
LOG="$ROOT/batch-ip.log"
CFG="${ANTIG_PROXY_CONFIG:-$DIR/proxy.local.json}"
[ -f "$CFG" ] || CFG="$DIR/antig-orchestrator-mac/proxy.local.json"
mkdir -p "$ROOT"
touch "$LOG"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

cfg() {
  python3 -c '
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
value = data.get(sys.argv[2], "")
print("" if value is None else value)
' "$CFG" "$1" 2>/dev/null
}

PROXY_URL="$(cfg url)"
API_BASE="$(cfg ipApiBase)"
API_KEY="$(cfg ipApiKey)"
TIMEOUT="$(cfg pollTimeoutMs)"
TIMEOUT="${TIMEOUT:-180000}"
INTERVAL="$(cfg pollIntervalMs)"
INTERVAL="${INTERVAL:-3000}"

if [ -z "$PROXY_URL" ] || [ -z "$API_BASE" ] || [ -z "$API_KEY" ]; then
  log "missing proxy url / ip api config in $CFG"
  exit 1
fi
BASE="${API_BASE%/}"

egress() {
  curl -4 -sS -m 12 --proxy "$PROXY_URL" https://api.ipify.org 2>/dev/null | tr -d '\r\n'
}

api_ip() {
  curl -4 -sS -m 12 "$BASE/api/ip?key=$API_KEY" 2>/dev/null
}

json_value() {
  printf '%s' "$1" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get(sys.argv[1], ""))
except Exception:
    print("")
' "$2" 2>/dev/null
}

json_running() {
  printf '%s' "$1" | python3 -c '
import json, sys
try:
    print(str(json.load(sys.stdin).get("running", False)).lower())
except Exception:
    print("false")
' 2>/dev/null
}

sleep_sec=$((INTERVAL / 1000))
[ "$sleep_sec" -ge 1 ] || sleep_sec=1

BEFORE="$(egress)"
if [ -z "$BEFORE" ]; then
  BEFORE="$(json_value "$(api_ip)" ip)"
fi
log "IP toggle start: before=${BEFORE:-none}"

attempt=1
while [ "$attempt" -le 3 ]; do
  log "rotate API attempt $attempt/3"
  curl -4 -sS -m 20 "$BASE/api/rotate?key=$API_KEY" >/dev/null 2>&1 || log "rotate API request failed"

  waited=0
  NOW=""
  while [ "$waited" -lt "$TIMEOUT" ]; do
    sleep "$sleep_sec"
    waited=$((waited + INTERVAL))
    INFO="$(api_ip)"
    [ "$(json_running "$INFO")" = "true" ] && continue
    NOW="$(egress)"
    if [ -z "$NOW" ]; then
      NOW="$(json_value "$INFO" ip)"
    fi
    if [ -n "$NOW" ] && [ "$NOW" != "$BEFORE" ]; then
      log "IP toggled: ${BEFORE:-none} -> $NOW"
      exit 0
    fi
  done

  log "IP unchanged after attempt $attempt (last=${NOW:-none})"
  attempt=$((attempt + 1))
done

log "IP toggle failed; keeping prior IP ${BEFORE:-none}"
exit 1
