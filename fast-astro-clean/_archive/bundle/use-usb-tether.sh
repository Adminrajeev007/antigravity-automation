#!/bin/sh
# Make the Mac mini use the Android USB tether for ALL internet traffic.
# Run once as root: sudo ./use-usb-tether.sh
set -u

echo "== BetterTether =="
STATUS="$(curl -s -m 3 http://127.0.0.1:9400/api/status || true)"
echo "$STATUS"
IP="$(printf '%s' "$STATUS" | sed -n 's/.*"clientIP":"\([^"]*\)".*/\1/p')"

if [ -z "$IP" ]; then
  echo "BetterTether not connected; restarting it..."
  launchctl kickstart -k system/com.s4wbvnny.bettertether 2>/dev/null || true
  sleep 5
  STATUS="$(curl -s -m 3 http://127.0.0.1:9400/api/status || true)"
  IP="$(printf '%s' "$STATUS" | sed -n 's/.*"clientIP":"\([^"]*\)".*/\1/p')"
fi

if [ -z "$IP" ]; then
  echo "ERROR: BetterTether is not connected. Plug in the phone, enable USB tethering."
  exit 1
fi
echo "clientIP=$IP"

IF="$(ifconfig | awk -v ip="$IP" '/^utun[0-9]+:/{i=$1; sub(":","",i)} $1=="inet" && $2==ip {print i; exit}')"
GW=""
if [ -n "$IF" ]; then
  GW="$(ifconfig "$IF" | awk '$1=="inet" && $3=="-->"{print $4; exit}')"
  [ -z "$GW" ] && GW="$(ifconfig "$IF" | awk '$1=="inet"{print $4; exit}')"
fi

if [ -z "$IF" ] || [ -z "$GW" ]; then
  echo "ERROR: could not find the BetterTether utun for $IP"
  ifconfig | grep -E '^utun|inet ' | head -40
  exit 1
fi
echo "iface=$IF gateway=$GW"

echo "Making $IF the default route..."
route change default "$GW" 2>/dev/null || route add default "$GW"
route -n get default | grep -E 'interface|gateway' || true

echo "Setting DNS 8.8.8.8 and disabling IPv6 on all network services..."
networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | while IFS= read -r S; do
  [ -n "$S" ] || continue
  case "$S" in \**) continue ;; esac
  networksetup -setdnsservers "$S" 8.8.8.8 >/dev/null 2>&1 || true
  networksetup -setv6off "$S" >/dev/null 2>&1 || true
done
dscacheutil -flushcache 2>/dev/null || true

echo "Restoring split routes..."
launchctl kickstart -k system/com.antig.usbroutewatch 2>/dev/null || true
sleep 2
netstat -rn -f inet | grep -E '^0/1|^128.0/1' || true

echo "Egress test (should be the phone IP):"
curl -4 -s https://api.ipify.org; echo
echo "Done. Keep Wi-Fi off if you want USB-tether-only."
