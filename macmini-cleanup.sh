#!/bin/sh
set -u

echo "== stopping old orchestrator/loops =="
for pat in \
  'orchestrator\.mjs' \
  'run-3-usb-logs\.sh' \
  'run-3-logs\.sh' \
  'run\.sh' \
  'adb-watchdog\.sh' \
  'domain-tracker\.mjs' \
  'usb-octo-socks\.py' \
  'orch-ui\.py' \
  'fix-dns-run3\.sh' \
  'recover-usb-3\.sh'
do
  pkill -f "$pat" 2>/dev/null || true
done
sleep 2

echo "== stopping old USB route watcher (keeps BetterTether + adb) =="
sudo launchctl bootout system/com.antig.usbroutewatch 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.antig.usbroutewatch" 2>/dev/null || true

echo "== restoring Mac Wi-Fi as default =="
WIFI_IF="$(networksetup -listallhardwareports 2>/dev/null | awk '/Hardware Port: (Wi-Fi|AirPort)/{getline; print $2; exit}')"
if [ -n "${WIFI_IF:-}" ]; then
  WIFI_GW="$(ipconfig getoption "$WIFI_IF" router 2>/dev/null || true)"
  if [ -n "${WIFI_GW:-}" ]; then
    sudo route change default "$WIFI_GW" >/dev/null 2>&1 || true
    echo "default -> $WIFI_IF ($WIFI_GW)"
  fi
fi

if command -v tailscale >/dev/null 2>&1; then
  sudo tailscale set --accept-dns=false >/dev/null 2>&1 || true
elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
  sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale set --accept-dns=false >/dev/null 2>&1 || true
fi

networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | while IFS= read -r S; do
  [ -n "$S" ] || continue
  case "$S" in \**) continue ;; esac
  sudo networksetup -setdnsservers "$S" 8.8.8.8 >/dev/null 2>&1 || true
done
sudo dscacheutil -flushcache 2>/dev/null || true
sudo killall -HUP mDNSResponder 2>/dev/null || true

echo "== deleting all Octo profiles =="
/usr/bin/env python3 - <<'PY'
import json
import os
import time
import urllib.request

home = os.path.expanduser('~/.Octo Browser')
port_file = os.path.join(home, 'local_port')
try:
    port = int(open(port_file).read().strip())
except Exception:
    port = 58888
base = f'http://127.0.0.1:{port}'


def call(path, body=None, method='GET'):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={'content-type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except Exception as e:
        try:
            return {'success': False, 'error': e.read().decode()}
        except Exception:
            return {'success': False, 'error': str(e)}


def active_uuids():
    data = call('/api/profiles/active')
    rows = data if isinstance(data, list) else (data.get('data') or [])
    return [p.get('uuid') for p in rows if p.get('uuid')]


def saved_uuids():
    data = call('/api/v2/profiles/list', {'start': 0, 'length': 100}, 'POST')
    rows = (data.get('data') or {}).get('profiles') or data.get('profiles') or []
    return [p.get('uuid') for p in rows if p.get('uuid')]


def force_stop(uuid):
    return call('/api/profiles/force_stop', {'uuid': uuid}, 'POST')


def delete(uuid):
    return call('/api/v2/profiles/delete', {'uuids': [uuid]}, 'POST')

# Octo must be running for the local API.
if not active_uuids() and call('/api/profiles/active').get('error'):
    os.system('open -a "Octo Browser" >/dev/null 2>&1')
    time.sleep(8)

for attempt in range(3):
    active = active_uuids()
    for uuid in active:
        force_stop(uuid)
    time.sleep(1)

    uuids = sorted(set(saved_uuids()) | set(active))
    print(f'pass {attempt + 1}: {len(uuids)} profile(s)')
    for uuid in uuids:
        force_stop(uuid)
        time.sleep(0.2)
        result = delete(uuid)
        if result.get('success') is True:
            print('deleted', uuid)
        else:
            print('could not delete', uuid, result.get('error'))

    remaining = sorted(set(saved_uuids()) | set(active_uuids()))
    if not remaining:
        break

remaining = sorted(set(saved_uuids()) | set(active_uuids()))
print('remaining profiles:', len(remaining))
if remaining:
    for uuid in remaining:
        print(' ', uuid)
    raise SystemExit(1)
PY

echo "== cleanup done =="
echo "Wi-Fi default and DNS restored. BetterTether and the adb server were left running."
