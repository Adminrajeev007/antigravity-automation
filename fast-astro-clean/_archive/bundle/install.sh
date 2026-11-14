#!/bin/sh
# Install the USB-tether pieces (once). Needs your macOS admin password.
set -eu
cd "$(dirname "$0")"
BUNDLE="$PWD"

echo "== antig orchestrator installer =="

# Remove quarantine from the bundle so the bundled binaries can run.
xattr -dr com.apple.quarantine "$BUNDLE" 2>/dev/null || true

if [ "$(uname -m)" = "arm64" ]; then
  if ! /usr/bin/arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
    echo "Installing Rosetta 2 (required for BetterTether and the bundled Node)..."
    sudo softwareupdate --install-rosetta --agree-to-license || true
  fi
  /usr/bin/arch -x86_64 /usr/bin/true >/dev/null 2>&1 || {
    echo "ERROR: Rosetta 2 is not available. Install it and re-run."; exit 1;
  }
fi

"$BUNDLE/runtime/node/bin/node" -v >/dev/null 2>&1 || {
  echo "ERROR: bundled Node cannot run (install Rosetta 2)."; exit 1;
}
"$BUNDLE/runtime/platform-tools/adb" version >/dev/null 2>&1 || {
  echo "ERROR: bundled adb cannot run."; exit 1;
}

echo "Installing BetterTether (USB RNDIS tethering)..."
sudo mkdir -p /usr/local/bin /usr/local/opt/libusb/lib /etc/bettertether /var/log
sudo cp "$BUNDLE/runtime/bettertether/bettertether" /usr/local/bin/bettertether
sudo cp "$BUNDLE/runtime/bettertether/libusb-1.0.0.dylib" /usr/local/opt/libusb/lib/libusb-1.0.0.dylib
sudo chown root:wheel /usr/local/bin/bettertether /usr/local/opt/libusb/lib/libusb-1.0.0.dylib
sudo chmod 755 /usr/local/bin/bettertether /usr/local/opt/libusb/lib/libusb-1.0.0.dylib
if [ ! -f /etc/bettertether/bettertether.toml ]; then
  sudo cp "$BUNDLE/runtime/bettertether/bettertether.toml" /etc/bettertether/bettertether.toml
fi
sudo cp "$BUNDLE/runtime/bettertether/com.s4wbvnny.bettertether.plist" /Library/LaunchDaemons/com.s4wbvnny.bettertether.plist
sudo chown root:wheel /Library/LaunchDaemons/com.s4wbvnny.bettertether.plist
sudo chmod 644 /Library/LaunchDaemons/com.s4wbvnny.bettertether.plist
sudo launchctl bootout system /Library/LaunchDaemons/com.s4wbvnny.bettertether.plist 2>/dev/null || true
sudo launchctl bootstrap system /Library/LaunchDaemons/com.s4wbvnny.bettertether.plist
sudo launchctl kickstart -k system/com.s4wbvnny.bettertether 2>/dev/null || true

echo "Installing USB route watchdog..."
sudo mkdir -p /usr/local/antig/route-watch /usr/local/antig/node/bin
sudo cp "$BUNDLE/runtime/route-watch/usb_route_watch.mjs" /usr/local/antig/route-watch/usb_route_watch.mjs
sudo cp "$BUNDLE/runtime/node/bin/node" /usr/local/antig/node/bin/node
sudo chmod 755 /usr/local/antig/node/bin/node

ROUTE_PLIST="$(mktemp)"
cat > "$ROUTE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.antig.usbroutewatch</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/antig/node/bin/node</string>
    <string>/usr/local/antig/route-watch/usb_route_watch.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/antig-usbroutewatch.log</string>
  <key>StandardErrorPath</key><string>/var/log/antig-usbroutewatch.log</string>
</dict></plist>
EOF
sudo cp "$ROUTE_PLIST" /Library/LaunchDaemons/com.antig.usbroutewatch.plist
rm -f "$ROUTE_PLIST"
sudo chown root:wheel /Library/LaunchDaemons/com.antig.usbroutewatch.plist
sudo chmod 644 /Library/LaunchDaemons/com.antig.usbroutewatch.plist
sudo launchctl bootout system /Library/LaunchDaemons/com.antig.usbroutewatch.plist 2>/dev/null || true
sudo launchctl bootstrap system /Library/LaunchDaemons/com.antig.usbroutewatch.plist || true
sudo launchctl kickstart -k system/com.antig.usbroutewatch 2>/dev/null || true

echo
echo "Install complete."
echo "Next:"
echo "  1. Open Octo Browser and sign in."
echo "  2. Plug in the Android phone, enable USB debugging, accept the prompt."
echo "  3. Run:  cd \"$BUNDLE\" && ./start.sh"
echo "     or foreground:  ./run.sh"
