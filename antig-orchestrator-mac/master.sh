#!/bin/sh
# One-shot master setup + run for the Mac mini.
# Does: quarantine fix -> Rosetta/Node check -> BetterTether + route watchdog
# -> Octo check -> Android check -> start the orchestrator.
#
# Run from this folder:  ./master.sh
set -u
cd "$(dirname "$0")"
BUNDLE="$PWD"
NODE="$BUNDLE/runtime/node/bin/node"
ADB="$BUNDLE/runtime/platform-tools/adb"
BATCH="${ORCH_BATCH:-3}"
USB_MODE="${ORCH_REQUIRE_USB_TETHER:-1}"
export ANTIG_REQUIRE_USB_TETHER="$USB_MODE"

say() { printf "\n== %s ==\n" "$*"; }
fail() { printf "\nERROR: %s\n" "$*" >&2; exit 1; }

say "1/6 Preparing files"
xattr -dr com.apple.quarantine "$BUNDLE" 2>/dev/null || true
chmod +x "$NODE" "$ADB" runtime/bettertether/bettertether install.sh run.sh start.sh 2>/dev/null || true
[ -f "$BUNDLE/orchestrator.mjs" ] || fail "orchestrator.mjs missing (run from the extracted folder)."
ls "$BUNDLE"/gcp-auto-intern-portal-v*.zip >/dev/null 2>&1 || fail "extension zip missing."

say "2/6 Checking Rosetta / Node"
if [ "$(uname -m)" = "arm64" ]; then
  if ! /usr/bin/arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
    echo "Installing Rosetta 2 (needs admin password)..."
    sudo softwareupdate --install-rosetta --agree-to-license || true
  fi
  /usr/bin/arch -x86_64 /usr/bin/true >/dev/null 2>&1 || fail "Rosetta 2 is not available."
fi
"$NODE" -v >/dev/null 2>&1 || fail "Bundled Node cannot run (Rosetta missing or file not executable)."
"$NODE" --experimental-websocket -e "if(typeof WebSocket!=='function')process.exit(1)" \
  >/dev/null 2>&1 || fail "Bundled Node does not support WebSocket."
echo "Node: $("$NODE" -v)"

say "3/6 USB tether support"
if [ "$USB_MODE" = "0" ]; then
  echo "VM mode: using the Mac mini host's USB tether (BetterTether runs on the host)."
  echo "Make sure the host has BetterTether running and the phone is USB-tethered."
else
  if [ ! -x /usr/local/bin/bettertether ] || [ ! -f /Library/LaunchDaemons/com.antig.usbroutewatch.plist ]; then
    echo "Installing BetterTether + route watchdog (needs admin password)..."
    ./install.sh || fail "install.sh failed."
  else
    echo "BetterTether already installed."
    launchctl kickstart -k system/com.s4wbvnny.bettertether 2>/dev/null || true
    launchctl kickstart -k system/com.antig.usbroutewatch 2>/dev/null || true
  fi
  curl -s -m 4 http://127.0.0.1:9400/api/status >/dev/null 2>&1 \
    || echo "note: BetterTether API not answering yet; the orchestrator will keep retrying."
fi

say "4/6 Checking Octo Browser"
[ -d "/Applications/Octo Browser.app" ] || fail "Octo Browser is not installed in /Applications."
PORT=""
for i in $(seq 1 30); do
  if [ -f "$HOME/.Octo Browser/local_port" ]; then
    PORT="$(cat "$HOME/.Octo Browser/local_port" 2>/dev/null || true)"
  fi
  if [ -n "$PORT" ] && curl -s -m 2 "http://127.0.0.1:$PORT/api/username" | grep -q '"username"'; then
    break
  fi
  PORT=""
  if [ "$i" = "1" ]; then
    echo "Opening Octo Browser, waiting for it to sign in..."
    open -a "Octo Browser" 2>/dev/null || true
  fi
  sleep 2
done
[ -n "$PORT" ] || fail "Octo Browser local API not reachable. Open Octo and sign in, then re-run."
echo "Octo API OK on port $PORT: $(curl -s -m 3 "http://127.0.0.1:$PORT/api/username")"

say "5/6 Checking Android device"
DEV=""
for i in $(seq 1 60); do
  DEV="$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1; exit}')"
  [ -n "$DEV" ] && break
  if [ "$i" = "1" ]; then
    echo "Waiting for the phone. Enable USB debugging and accept the prompt on it."
  fi
  sleep 2
done
[ -n "$DEV" ] || fail "No Android device found. Connect the phone, enable USB debugging, accept the prompt."
echo "Android device: $DEV"
"$ADB" -s "$DEV" shell svc usb setFunctions rndis,adb >/dev/null 2>&1 || true

say "6/6 Starting orchestrator (${BATCH} profiles per batch)"
echo "Stop with Ctrl+C. Logs are printed below."
echo
export ORCH_BATCH="$BATCH"
export ANTIG_ADB="$ADB"
exec "$NODE" --experimental-websocket orchestrator.mjs
