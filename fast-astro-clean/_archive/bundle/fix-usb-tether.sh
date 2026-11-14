#!/bin/sh
# Repair Android USB tethering using ADB only. No screen/UI interaction.
set -u

ADB="${ANTIG_ADB:-/opt/homebrew/bin/adb}"
SERIAL="${ANTIG_ANDROID_SERIAL:-QWXSKBCQCUHUXKXS}"
LOG="${ANTIG_FIX_USB_LOG:-/tmp/antig-fix-usb.log}"
attempt="${1:-1}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

current() {
  "$ADB" -s "$SERIAL" shell getprop sys.usb.config 2>/dev/null | tr -d '\r'
}

CURRENT="$(current)"
if printf '%s' "$CURRENT" | grep -q 'rndis'; then
  log "usb already $CURRENT"
  exit 0
fi

log "usb repair attempt $attempt (current=${CURRENT:-unknown})"

"$ADB" -s "$SERIAL" shell 'svc usb setFunctions rndis,adb' >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell 'svc usb setScreenUnlockedFunctions rndis,adb' >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell 'svc usb resetUsbGadget' >/dev/null 2>&1 || true
sleep 5

CURRENT="$(current)"
log "usb after adb repair=${CURRENT:-unknown}"
printf '%s' "$CURRENT" | grep -q 'rndis'
