#!/bin/sh
# Recover the USB-tether + SOCKS path and clear stuck Octo profiles.
# Run as the normal user. It will ask for sudo for BetterTether only.
set -u

BUNDLE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
LOG="$ROOT/antig-recover.log"
mkdir -p "$ROOT"
touch "$LOG"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

ADB="$(command -v adb || echo /opt/homebrew/bin/adb)"
IFACE="$(cat /tmp/usb-octo-iface 2>/dev/null || true)"
[ -n "$IFACE" ] || IFACE="utun10"

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

# 2. USB tether function, then BetterTether.
"$ADB" -s "${ANTIG_ANDROID_SERIAL:-QWXSKBCQCUHUXKXS}" shell 'svc usb setFunctions rndis,adb' >/dev/null 2>&1 || true
sleep 3
if ! curl -s -m 3 http://127.0.0.1:9400/api/status | grep -q '"connected":true'; then
  log "restarting BetterTether (sudo required)"
  sudo launchctl kickstart -k system/com.s4wbvnny.bettertether || true
fi
sleep 8

# 3. Start a fresh user-owned proxy (avoids the no-tty/nohup failure).
pkill -f 'usb-octo-socks.py' 2>/dev/null || true
sleep 1
SRC="$(curl -s -m 3 http://127.0.0.1:9400/api/status | sed -n 's/.*"clientIP":"\([^"]*\)".*/\1/p')"
python3 - "$SRC" "$IFACE" >>"$LOG" 2>&1 <<'PY'
import os, subprocess, sys
src, iface = (sys.argv[1] if len(sys.argv) > 1 else ''), (sys.argv[2] if len(sys.argv) > 2 else 'utun10')
log = open('/tmp/usb-octo-socks-recover.log', 'ab')
env = os.environ.copy()
env.update(SOCKS_PORT='1080', SOCKS_IF=iface, SOCKS_SRC=src)
p = subprocess.Popen(['/opt/anaconda3/bin/python3', '/tmp/usb-octo-socks.py'],
    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
    start_new_session=True, env=env)
open('/tmp/usb-octo-socks-recover.pid', 'w').write(str(p.pid))
print('proxy pid', p.pid, 'iface', iface, 'src', src)
PY
sleep 2

DIRECT="$(curl -4 -s -m 10 --interface "$IFACE" https://api.ipify.org || true)"
PROXY="$(curl -4 -s -m 10 --socks5-hostname 127.0.0.1:1080 https://api.ipify.org || true)"
log "direct=$DIRECT proxy=$PROXY iface=$IFACE"
if [ -n "$PROXY" ]; then
  log "recovery OK"
  exit 0
fi
log "recovery FAILED — check USB tether/phone data or reconnect the cable"
exit 1
