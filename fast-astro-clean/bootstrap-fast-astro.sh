#!/bin/sh
# One-command setup + run for the fast-astro (HID TOS) setup on a new Mac.
#
#   ./bootstrap-fast-astro.sh                 # 1 profile/batch
#   ORCH_BATCH=3 ./bootstrap-fast-astro.sh    # 3 profiles/batch
#   PROXY_URL='http://user:pass@host:port' ./bootstrap-fast-astro.sh
#
# What it does:
#   1. Ensures Octo Browser is installed, open, and its API responds.
#   2. Ensures a Node runtime for the orchestrator (system node or download).
#   3. Ensures Python + Quartz (pyobjc) for real OS-level (HID) mouse clicks.
#   4. Requests macOS Accessibility permission (required for real clicks).
#   5. Starts the fast-astro runner.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$DIR/antig-orchestrator-mac"
OCTO_PORT_FILE="$HOME/.Octo Browser/local_port"

echo "== fast-astro bootstrap =="

# Optional: override the proxy config for this Mac/network.
if [ -n "${PROXY_URL:-}" ]; then
  echo "== writing proxy.astro.json from PROXY_URL =="
  IP_API_BASE="${IP_API_BASE:-http://192.168.31.250:8000}"
  PROXY_API_KEY="${PROXY_API_KEY:-}"
  cat > "$DIR/proxy.astro.json" <<JSON
{
  "url": "$PROXY_URL",
  "ipApiBase": "$IP_API_BASE",
  "ipApiKey": "$PROXY_API_KEY",
  "pollTimeoutMs": 180000,
  "pollIntervalMs": 15000,
  "tetherIp": ""
}
JSON
  chmod 600 "$DIR/proxy.astro.json" 2>/dev/null || true
fi

# 1) Octo Browser -----------------------------------------------------------
if [ ! -d "/Applications/Octo Browser.app" ] && [ ! -d "$HOME/Applications/Octo Browser.app" ]; then
  echo "ERROR: Octo Browser is not installed in /Applications."
  echo "Install Octo Browser and log in, then re-run this script."
  exit 1
fi
open -a "Octo Browser" 2>/dev/null || true
OCTO_PORT="$(cat "$OCTO_PORT_FILE" 2>/dev/null || echo 58888)"
echo "waiting for Octo API on 127.0.0.1:$OCTO_PORT ..."
i=0
OCTO_UP=0
while [ "$i" -lt 30 ]; do
  if curl -s -m 3 "http://127.0.0.1:$OCTO_PORT/api/username" >/dev/null 2>&1 || \
     curl -s -m 3 "http://127.0.0.1:$OCTO_PORT/api/profiles/active" >/dev/null 2>&1; then
    OCTO_UP=1
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$OCTO_UP" -eq 1 ]; then
  echo "Octo API ready"
else
  echo "WARNING: Octo API not responding. Open Octo Browser, log in, then continue."
fi
if ! curl -s -m 4 "http://127.0.0.1:$OCTO_PORT/api/username" >/dev/null 2>&1; then
  echo "WARNING: Octo does not look logged in (/api/username failed). Log in to Octo."
fi

# 2) Node runtime -----------------------------------------------------------
NODE_BIN="$BUNDLE/runtime/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  mkdir -p "$(dirname "$NODE_BIN")"
  if command -v node >/dev/null 2>&1; then
    ln -sf "$(command -v node)" "$NODE_BIN"
    echo "Node: linked $(command -v node)"
  else
    echo "== downloading Node.js =="
    ARCH="$(uname -m)"
    case "$ARCH" in
      arm64|aarch64) NODE_ARCH=arm64 ;;
      *) NODE_ARCH=x64 ;;
    esac
    NODE_VER="v20.19.0"
    TMP_NODE="$(mktemp -d)"
    curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-darwin-$NODE_ARCH.tar.gz" -o "$TMP_NODE/node.tgz"
    tar -xzf "$TMP_NODE/node.tgz" -C "$TMP_NODE"
    rm -rf "$BUNDLE/runtime/node"
    mkdir -p "$BUNDLE/runtime"
    mv "$TMP_NODE/node-$NODE_VER-darwin-$NODE_ARCH" "$BUNDLE/runtime/node"
    rm -rf "$TMP_NODE"
    echo "Node: installed $("$NODE_BIN" --version)"
  fi
fi

# 3) Python + Quartz (pyobjc) ----------------------------------------------
if command -v python3 >/dev/null 2>&1 && python3 -c "import Quartz" >/dev/null 2>&1; then
  PY="$(command -v python3)"
  echo "Quartz: OK (system python3)"
else
  if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 not found. Install it first: xcode-select --install"
    exit 1
  fi
  echo "== preparing Python venv + pyobjc-framework-Quartz =="
  [ -x "$DIR/.venv/bin/python3" ] || python3 -m venv "$DIR/.venv"
  "$DIR/.venv/bin/python3" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || true
  "$DIR/.venv/bin/python3" -m pip install --quiet pyobjc-framework-Quartz
  PY="$DIR/.venv/bin/python3"
  echo "Quartz: OK (venv)"
fi
export ORCH_HID_PYTHON="$PY"

# 4) Accessibility permission (required to post real mouse clicks) ----------
if "$PY" -c "import Quartz,sys; sys.exit(0 if Quartz.CGPreflightPostEventAccess() else 1)" >/dev/null 2>&1; then
  echo "Accessibility: granted"
else
  echo ""
  echo "== Accessibility permission needed for real TOS clicks =="
  "$PY" -c "import Quartz; Quartz.CGRequestPostEventAccess()" >/dev/null 2>&1 || true
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true
  echo "In System Settings > Privacy & Security > Accessibility, enable the app"
  echo "you're running this from (Terminal / iTerm / OpenCode), then press Enter."
  if [ -t 0 ]; then read -r _; fi
  if ! "$PY" -c "import Quartz,sys; sys.exit(0 if Quartz.CGPreflightPostEventAccess() else 1)" >/dev/null 2>&1; then
    echo "WARNING: Accessibility still not granted; TOS HID clicks will not land."
  else
    echo "Accessibility: granted"
  fi
fi

# 5) Run --------------------------------------------------------------------
chmod +x "$DIR/start-combo-3-fast-astro.sh" "$DIR/hid_click.py" 2>/dev/null || true
export ANTIG_LOG_ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
export ORCH_BATCH="${ORCH_BATCH:-1}"
export ORCH_TOS_DRYRUN=0
mkdir -p "$ANTIG_LOG_ROOT"
echo "== starting fast-astro (batch=$ORCH_BATCH) =="
exec "$DIR/start-combo-3-fast-astro.sh"
