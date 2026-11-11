#!/bin/sh
# Chrome-for-Testing runner: 3 fresh Chrome profiles, 1.0.20 astro extension,
# astro proxy, blockers, sheet backend, instant close, 8.5-min batch timer.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$DIR/antig-orchestrator-mac/runtime/node/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
CFT="/tmp/cft/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
EXT="/tmp/antig-ext-1.0.20"

pkill -f 'chrome-combo.mjs' 2>/dev/null || true
pkill -f 'block-fx.mjs' 2>/dev/null || true
pkill -f 'Google Chrome for Testing' 2>/dev/null || true
sleep 1

# Chrome for Testing
if [ ! -x "$CFT" ]; then
  echo "downloading Chrome for Testing..."
  mkdir -p /tmp/cft && rm -rf /tmp/cft/*
  /usr/bin/curl -sS -m 20 "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json" -o /tmp/cft.json
  URL=$(/usr/local/bin/python3 - <<'PY'
import json
d=json.load(open('/tmp/cft.json'))['channels']['Stable']
for x in d['downloads']['chrome']:
    if x['platform']=='mac-arm64': print(x['url']); break
PY
)
  /usr/bin/curl -L -sS -m 300 "$URL" -o /tmp/cft/chrome.zip
  /usr/bin/unzip -oq /tmp/cft/chrome.zip -d /tmp/cft
fi

# extension
rm -rf "$EXT" && mkdir -p "$EXT"
/usr/bin/unzip -oq "$DIR/antig-orchestrator-mac/gcp-combo-portal-v1.0.20.zip" -d "$EXT"

mkdir -p "${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
CHROME_BIN="$CFT" CHROME_EXT="$EXT" \
CHROME_PROXY='http://proxy-admin.astroai.eu.cc:8082' \
ORCH_BATCH="${ORCH_BATCH:-3}" ORCH_BATCH_TIMEOUT_MS="${ORCH_BATCH_TIMEOUT_MS:-510000}" \
CHROME_PORT_BASE="${CHROME_PORT_BASE:-9410}" ORCH_PORT="${ORCH_PORT:-8791}" \
ANTIG_LOG_ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}" \
  "$NODE" "$DIR/chrome-combo.mjs"
