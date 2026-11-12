#!/bin/sh
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
mkdir -p "$ROOT"

pkill -f 'orchestrator\.mjs' 2>/dev/null || true
pkill -f 'profile-trace\.mjs' 2>/dev/null || true
pkill -f 'orch-ui\.py' 2>/dev/null || true
sleep 1

# Free all slots, including any old login profile, for 3 signup profiles.
python3 - <<'PY' >> "$ROOT/start-3signup.log" 2>&1
import json, os, time, urllib.request
base='http://127.0.0.1:58888'
def call(path, body=None, method='GET'):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(base+path,data=data,method=method,headers={'content-type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=15) as r: return json.loads(r.read().decode() or '{}')
    except Exception as e: return {'error':str(e)}
active=call('/api/profiles/active'); rows=active if isinstance(active,list) else []
for p in rows:
    u=p.get('uuid'); pid=p.get('browser_pid')
    if u:
        try: call('/api/profiles/force_stop',{'uuid':u},'POST')
        except Exception: pass
    if pid:
        try: os.kill(int(pid),15)
        except Exception: pass
time.sleep(2)
lst=call('/api/v2/profiles/list',{'start':0,'length':100},'POST')
profs=(lst.get('data') or {}).get('profiles') or []
for p in profs:
    u=p.get('uuid')
    if not u: continue
    try: call('/api/profiles/force_stop',{'uuid':u},'POST')
    except Exception: pass
    try: call('/api/v2/profiles/delete',{'uuids':[u]},'POST')
    except Exception: pass
    time.sleep(0.3)
print('cleared profiles:', len(profs)+len(rows))
PY

# Make the dashboard show no stale login profile.
touch "$ROOT/login-$(date +%Y%m%d-%H%M%S).log"
printf '%s\n' "$(ls -t "$ROOT"/login-*.log | head -1)" > "$ROOT/latest-login-log"

ORCH_BATCH=3 \
ORCH_MAX_RUNS="${ORCH_MAX_RUNS:-0}" \
ORCH_EMAIL_DOMAIN="${ORCH_EMAIL_DOMAIN:-}" \
"$DIR/run-with-logs.sh"

echo
echo "3 signup profiles started with logs. Opening live dashboard..."
exec python3 "$DIR/antig-live.py"
