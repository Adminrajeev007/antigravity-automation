#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  exec sudo "$SELF" "$@"
fi

PORT="${SOCKS_PORT:-1080}"
IFACE="${SOCKS_IF:-}"

if [ -z "$IFACE" ]; then
  IP=""
  for _ in $(seq 1 30); do
    BT="$(curl -s -m 3 http://127.0.0.1:9400/api/status || true)"
    IP="$(printf '%s' "$BT" | sed -n 's/.*"clientIP":"\([^"]*\)".*/\1/p')"
    [ -n "$IP" ] && break
    sleep 2
  done
  if [ -z "$IP" ]; then
    echo "BetterTether is not connected. Connect USB tether first."
    exit 1
  fi
  IFACE="$(ifconfig | awk -v ip="$IP" '/^[a-z0-9]+:/{i=$1; sub(":","",i)} $1=="inet" && $2==ip {print i; exit}')"
  if [ -z "$IFACE" ]; then
    echo "Could not find USB interface for $IP"
    exit 1
  fi
fi

PYTHON_BIN="$(command -v python3 || true)"
if [ -z "$PYTHON_BIN" ] && [ -x /usr/bin/python3 ]; then
  PYTHON_BIN=/usr/bin/python3
fi
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 not found"
  exit 1
fi

echo "USB interface: $IFACE"
printf '%s\n' "$IFACE" > /tmp/usb-octo-iface
DEFIF="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
echo "Host default interface: ${DEFIF:-none}"

case "$DEFIF" in
  utun*)
    for I in en0 en1; do
      GW="$(ipconfig getoption "$I" router 2>/dev/null || true)"
      if [ -n "$GW" ]; then
        route change default "$GW" >/dev/null 2>&1 || true
        echo "Restored host default to $I gateway $GW"
        break
      fi
    done
    ;;
esac

if command -v tailscale >/dev/null 2>&1; then
  tailscale set --accept-dns=false >/dev/null 2>&1 || true
elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
  /Applications/Tailscale.app/Contents/MacOS/Tailscale set --accept-dns=false >/dev/null 2>&1 || true
fi

if [ -f /tmp/usb-octo-socks.pid ]; then
  kill "$(cat /tmp/usb-octo-socks.pid)" 2>/dev/null || true
fi
pkill -f 'usb-octo-socks.py' 2>/dev/null || true

cat > /tmp/usb-octo-socks.py <<'PY'
#!/usr/bin/env python3
import os, socket, struct, threading, select

PORT = int(os.environ.get('SOCKS_PORT', '1080'))
IFACE_ENV = os.environ.get('SOCKS_IF', '')
IFACE_FILE = '/tmp/usb-octo-iface'
BUFSIZE = 65536
IP_BOUND_IF = getattr(socket, 'IP_BOUND_IF', 25)


def ifindex():
    iface = IFACE_ENV
    try:
        value = open(IFACE_FILE).read().strip()
        if value:
            iface = value
    except Exception:
        pass
    return socket.if_nametoindex(iface)


def recv_exact(conn, n):
    out = b''
    while len(out) < n:
        chunk = conn.recv(n - len(out))
        if not chunk:
            return None
        out += chunk
    return out


def reply(conn, code):
    conn.sendall(b'\x05' + bytes([code]) + b'\x00\x01' + b'\x00\x00\x00\x00' + b'\x00\x00')


def pipe(a, b):
    try:
        while True:
            r, _, _ = select.select([a, b], [], [], 120)
            if not r:
                break
            for s in r:
                data = s.recv(BUFSIZE)
                if not data:
                    return
                (b if s is a else a).sendall(data)
    except Exception:
        pass
    finally:
        for s in (a, b):
            try:
                s.close()
            except Exception:
                pass


def handle(conn):
    try:
        conn.settimeout(30)
        head = recv_exact(conn, 2)
        if not head or head[0] != 5:
            return
        methods = recv_exact(conn, head[1])
        if methods is None or 0 not in methods:
            conn.sendall(b'\x05\xff')
            return
        conn.sendall(b'\x05\x00')

        hdr = recv_exact(conn, 4)
        if not hdr:
            return
        ver, cmd, _, atyp = hdr
        if cmd != 1:
            reply(conn, 7)
            return

        if atyp == 1:
            raw = recv_exact(conn, 4)
            if not raw:
                return
            host = socket.inet_ntoa(raw)
        elif atyp == 3:
            ln = recv_exact(conn, 1)
            if not ln:
                return
            raw = recv_exact(conn, ln[0])
            if not raw:
                return
            host = raw.decode('utf-8', 'replace')
        elif atyp == 4:
            raw = recv_exact(conn, 16)
            if not raw:
                return
            host = socket.inet_ntop(socket.AF_INET6, raw)
        else:
            reply(conn, 8)
            return

        raw = recv_exact(conn, 2)
        if not raw:
            return
        port = struct.unpack('!H', raw)[0]

        try:
            infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
            dst = infos[0][4]
        except Exception:
            reply(conn, 4)
            return

        out = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        out.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, ifindex())
        out.settimeout(20)
        try:
            out.connect(dst)
        except Exception:
            out.close()
            reply(conn, 5)
            return

        conn.sendall(b'\x05\x00\x00\x01' + b'\x00\x00\x00\x00' + b'\x00\x00')
        conn.settimeout(None)
        out.settimeout(None)
        pipe(conn, out)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', PORT))
    srv.listen(200)
    print(f'socks5 127.0.0.1:{PORT} -> {IFACE_ENV}', flush=True)
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=handle, args=(conn,), daemon=True).start()


if __name__ == '__main__':
    main()
PY

SOCKS_PORT="$PORT" SOCKS_IF="$IFACE" nohup "$PYTHON_BIN" /tmp/usb-octo-socks.py >/tmp/usb-octo-socks.log 2>&1 &
PID=$!
echo "$PID" > /tmp/usb-octo-socks.pid
sleep 2

pkill -f '/tmp/usb-octo-route.sh' 2>/dev/null || true
cat > /tmp/usb-octo-route.sh <<'ROUTE'
#!/bin/sh
while :; do
  BT="$(curl -s -m 2 http://127.0.0.1:9400/api/status || true)"
  IP="$(printf '%s' "$BT" | sed -n 's/.*"clientIP":"\([^"]*\)".*/\1/p')"
  IFACE=""
  if [ -n "$IP" ]; then
    IFACE="$(ifconfig | awk -v ip="$IP" '/^[a-z0-9]+:/{i=$1; sub(":","",i)} $1=="inet" && $2==ip {print i; exit}')"
  fi
  if [ -n "$IFACE" ]; then
    printf '%s\n' "$IFACE" > /tmp/usb-octo-iface
    route delete -net 0/1 >/dev/null 2>&1 || true
    route delete -net 128.0/1 >/dev/null 2>&1 || true
    route add -net default -ifscope "$IFACE" -interface "$IFACE" >/dev/null 2>&1 || true
  fi
  sleep 2
done
ROUTE
nohup sh /tmp/usb-octo-route.sh >/tmp/usb-octo-route.log 2>&1 &

networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | while IFS= read -r S; do
  [ -n "$S" ] || continue
  case "$S" in
    \**) continue ;;
  esac
  networksetup -setdnsservers "$S" 8.8.8.8 >/dev/null 2>&1 || true
done
dscacheutil -flushcache 2>/dev/null || true
killall -HUP mDNSResponder 2>/dev/null || true
sleep 2

PE="$(curl -4 -s -m 15 --socks5-hostname "127.0.0.1:$PORT" https://api.ipify.org || true)"
HE="$(curl -4 -s -m 10 https://api.ipify.org || true)"
echo "Octo proxy egress: ${PE:-none}"
echo "Mac host egress:  ${HE:-none}"

if [ -z "$PE" ]; then
  echo "Proxy failed; see /tmp/usb-octo-socks.log"
  kill "$PID" 2>/dev/null || true
  exit 1
fi

echo "Proxy running on 127.0.0.1:$PORT (pid $PID)"
echo "Set the Octo profile proxy to SOCKS5 127.0.0.1:$PORT"
echo "Stop with: sudo kill $PID"
