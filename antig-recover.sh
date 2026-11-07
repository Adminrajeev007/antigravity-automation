#!/bin/sh
# Recover the HTTP proxy path and clear stuck Octo profiles.
set -u

BUNDLE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
LOG="$ROOT/antig-recover.log"
CFG="${ANTIG_PROXY_CONFIG:-$BUNDLE/proxy.local.json}"
[ -f "$CFG" ] || CFG="$BUNDLE/antig-orchestrator-mac/proxy.local.json"
mkdir -p "$ROOT"
touch "$LOG"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

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

log "recovery start"

# 1. Clear stuck active profiles.
python3 - <<'PY' >>"$LOG" 2>&1
import json, os, time, urllib.request
base = 'http://127.0.0.1:58888'
def call(path, body=None, method='GET'):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
        headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode() or '{}')
    except Exception as e:
        return {'error': str(e)}
active = call('/api/profiles/active')
rows = active if isinstance(active, list) else (active.get('data') or [])
print('active before:', [(p.get('uuid'), p.get('state')) for p in rows])
for p in rows:
    uuid = p.get('uuid')
    if not uuid:
        continue
    call('/api/profiles/force_stop', {'uuid': uuid}, 'POST')
    pid = p.get('browser_pid')
    if pid:
        try: os.kill(int(pid), 15)
        except Exception: pass
    time.sleep(1.5)
    print(uuid, call('/api/v2/profiles/delete', {'uuids': [uuid]}, 'POST'))
print('active after:', call('/api/profiles/active'))
PY

if [ -z "$PROXY_URL" ]; then
  log "recovery FAILED — proxy url missing in $CFG"
  exit 1
fi

# 2. Verify the proxy, rotate the IP once if the egress is empty.
PROXY="$(curl -4 -s -m 12 --proxy "$PROXY_URL" https://api.ipify.org || true)"
if [ -z "$PROXY" ]; then
  log "proxy egress empty; rotating IP"
  "$BUNDLE/toggle-batch-ip.sh" >>"$LOG" 2>&1 || true
  PROXY="$(curl -4 -s -m 12 --proxy "$PROXY_URL" https://api.ipify.org || true)"
fi
log "proxy=$PROXY"

if [ -n "$PROXY" ]; then
  log "recovery OK"
  exit 0
fi
log "recovery FAILED — proxy $PROXY_URL is not reachable"
exit 1
