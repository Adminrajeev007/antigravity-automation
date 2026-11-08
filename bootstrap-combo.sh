#!/bin/sh
# One-command bootstrap for the GCP Combo setup on a fresh Mac.
#
# Usage:
#   PROXY_URL='http://testuser:testpass@192.168.31.250:1080' \
#   PROXY_API_KEY='<rotate-api-key>' \
#   ./bootstrap-combo.sh
#
# Requirements on the new Mac:
#   - Octo Browser installed, running, and logged in
#   - Node.js installed (brew install node) OR a bundled runtime
#   - Same network as the proxy (e.g. 192.168.31.x)
set -eu

REPO_URL="${REPO_URL:-https://github.com/Adminrajeev007/antigravity-automation.git}"
DIR="${COMBO_DIR:-$HOME/antigravity-automation}"

if [ ! -d "$DIR/.git" ]; then
  echo "== cloning $REPO_URL =="
  git clone "$REPO_URL" "$DIR"
else
  echo "== updating $DIR =="
  (cd "$DIR" && git pull --ff-only) || true
fi
cd "$DIR"

: "${PROXY_URL:?Set PROXY_URL, e.g. http://user:pass@192.168.31.250:1080}"
: "${PROXY_API_KEY:?Set PROXY_API_KEY (rotate API key)}"
IP_API_BASE="${IP_API_BASE:-http://192.168.31.250:8000}"
TETHER_IP="${PROXY_TETHER_IP:-10.198.246.4}"

echo "== writing proxy config =="
cat > proxy.local.json <<JSON
{
  "url": "$PROXY_URL",
  "ipApiBase": "$IP_API_BASE",
  "ipApiKey": "$PROXY_API_KEY",
  "pollTimeoutMs": 180000,
  "pollIntervalMs": 15000,
  "tetherIp": "$TETHER_IP"
}
JSON
cp proxy.local.json antig-orchestrator-mac/proxy.local.json
chmod 600 proxy.local.json antig-orchestrator-mac/proxy.local.json

NODE_BIN="antig-orchestrator-mac/runtime/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then
    mkdir -p "$(dirname "$NODE_BIN")"
    ln -sf "$(command -v node)" "$NODE_BIN"
  else
    echo "== Node.js not found; downloading a standalone Node runtime =="
    ARCH="$(uname -m)"
    case "$ARCH" in
      arm64|aarch64) NODE_ARCH=arm64 ;;
      x86_64|amd64) NODE_ARCH=x64 ;;
      *) NODE_ARCH=x64 ;;
    esac
    NODE_VER="v20.19.0"
    TMPDIR_NODE="$(mktemp -d)"
    if ! curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-darwin-$NODE_ARCH.tar.gz" -o "$TMPDIR_NODE/node.tar.gz"; then
      echo "ERROR: could not download Node.js. Install it manually: brew install node"
      rm -rf "$TMPDIR_NODE"
      exit 1
    fi
    tar -xzf "$TMPDIR_NODE/node.tar.gz" -C "$TMPDIR_NODE"
    rm -rf "antig-orchestrator-mac/runtime/node"
    mkdir -p "antig-orchestrator-mac/runtime"
    mv "$TMPDIR_NODE/node-$NODE_VER-darwin-$NODE_ARCH" "antig-orchestrator-mac/runtime/node"
    rm -rf "$TMPDIR_NODE"
    echo "== Node installed: $($NODE_BIN --version) =="
  fi
fi

ADB_BIN="antig-orchestrator-mac/runtime/platform-tools/adb"
if [ ! -x "$ADB_BIN" ] && command -v adb >/dev/null 2>&1; then
  mkdir -p "$(dirname "$ADB_BIN")"
  ln -sf "$(command -v adb)" "$ADB_BIN"
fi

OCTO_PORT=""
if [ -f "$HOME/.Octo Browser/local_port" ]; then
  OCTO_PORT="$(cat "$HOME/.Octo Browser/local_port" 2>/dev/null || true)"
fi
OCTO_PORT="${OCTO_PORT:-58888}"
if ! curl -s -m 4 "http://127.0.0.1:$OCTO_PORT/api/username" >/dev/null 2>&1 && ! curl -s -m 4 "http://127.0.0.1:$OCTO_PORT/api/profiles/active" >/dev/null 2>&1; then
  echo "ERROR: Octo Browser API is not reachable on 127.0.0.1:$OCTO_PORT"
  echo "Install Octo Browser, open it, and log in before running this."
  exit 1
fi

chmod +x start-combo.sh start-combo-3.sh start-2signup.sh run-with-logs.sh 2>/dev/null || true

echo "== starting combo: ${ORCH_BATCH:-3} profiles/batch =="
ORCH_BATCH="${ORCH_BATCH:-3}" \
ORCH_MAX_RUNS="${ORCH_MAX_RUNS:-0}" \
ORCH_RESET_PROFILES="${ORCH_RESET_PROFILES:-1}" \
ORCH_ROTATE_IP=1 \
ORCH_COMBO=1 \
EXT_ZIP="$PWD/antig-orchestrator-mac/gcp-combo-portal-v1.0.4.zip" \
  "$PWD/run-with-logs.sh"
