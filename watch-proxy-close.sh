#!/bin/sh
# Close active Octo profiles when the proxy/internet is unreachable > 30s.
# Runs independently; does not modify the orchestrator.
set -u
PROXY="${ORCH_PROXY_URL:-http://gcp_workspace:bombom1234@proxy-admin.astroai.eu.cc:8082}"
OCTO_PORT="${ORCH_PORT:-58888}"
OCTO="http://127.0.0.1:${OCTO_PORT}"
LIMIT="${PROXY_DOWN_LIMIT_SEC:-30}"
INTERVAL="${PROXY_CHECK_SEC:-5}"
CHECK_URL="${PROXY_CHECK_URL:-https://api.ipify.org}"

fail_start=0
while true; do
  if /usr/bin/curl -sS -m 8 -x "$PROXY" "$CHECK_URL" >/dev/null 2>&1; then
    if [ "$fail_start" -ne 0 ]; then
      echo "$(date '+%H:%M:%S') proxy/internet back"
    fi
    fail_start=0
  else
    now=$(date +%s)
    [ "$fail_start" -eq 0 ] && fail_start=$now
    down=$((now - fail_start))
    if [ "$down" -ge "$LIMIT" ]; then
      echo "$(date '+%H:%M:%S') proxy/internet down ${down}s — closing active profiles"
      /usr/bin/curl -sS -m 8 "$OCTO/api/profiles/active" 2>/dev/null | /usr/local/bin/python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: raise SystemExit
rows=d if isinstance(d,list) else (d.get("data") or [])
for p in rows:
    u=p.get("uuid")
    if u: print(u)
' | while read -r uuid; do
        [ -n "$uuid" ] || continue
        /usr/bin/curl -sS -m 8 -X POST "$OCTO/api/profiles/stop" -H 'content-type: application/json' -d "{\"uuid\":\"$uuid\"}" >/dev/null 2>&1
        /usr/bin/curl -sS -m 15 -X POST "$OCTO/api/v2/profiles/delete" -H 'content-type: application/json' -d "{\"uuids\":[\"$uuid\"]}" >/dev/null 2>&1
        echo "  closed $uuid"
      done
      fail_start=0
    fi
  fi
  sleep "$INTERVAL"
done
