#!/bin/sh
# Run the orchestrator in the foreground.
# ORCH_BATCH controls how many profiles run at once (default 3).
set -eu
cd "$(dirname "$0")"

export ANTIG_ADB="$PWD/runtime/platform-tools/adb"
export PATH="$PWD/runtime/node/bin:$PATH"
export ORCH_BATCH="${ORCH_BATCH:-3}"
if [ -n "${ORCH_REQUIRE_USB_TETHER:-}" ]; then
  export ANTIG_REQUIRE_USB_TETHER="$ORCH_REQUIRE_USB_TETHER"
fi

exec "$PWD/runtime/node/bin/node" --experimental-websocket orchestrator-parallel.mjs
