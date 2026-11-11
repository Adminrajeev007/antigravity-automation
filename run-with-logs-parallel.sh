#!/bin/sh
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/antig-orchestrator-mac/run.sh" ]; then
  BUNDLE="$DIR/antig-orchestrator-mac"
else
  BUNDLE="$DIR"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
RUNS="${ORCH_MAX_RUNS:-10}"
BATCH="${ORCH_BATCH:-1}"
DOMAIN="${ORCH_EMAIL_DOMAIN:-}"
RUN_ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
RUN="$RUN_ROOT/run-$STAMP"
mkdir -p "$RUN"
touch "$RUN/orchestrator.log" "$RUN/trace.log" "$RUN/health.log" "$RUN/errors.log"
printf '%s\n' "run=$RUN" "domain=${DOMAIN:-random-all-domains}" "batch=$BATCH" "runs=$RUNS" "extension=1.5.7" > "$RUN/metadata.txt"

PROXY_CFG="${ANTIG_PROXY_CONFIG:-$BUNDLE/proxy.local.json}"
PROXY_URL="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("url",""))' "$PROXY_CFG" 2>/dev/null || true)"
PROXY_URL="${ORCH_PROXY_URL:-$PROXY_URL}"
if [ -z "$PROXY_URL" ]; then
  echo "error: proxy URL is missing; set it in $PROXY_CFG"
  exit 1
fi

PROXY_EG="$(curl -4 -s -m 10 --proxy "$PROXY_URL" https://api.ipify.org || true)"
if [ -z "$PROXY_EG" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') proxy egress empty; starting anyway so rotation can recover it" >> "$RUN/errors.log"
  echo "warning: proxy egress is empty; starting anyway"
fi

pkill -f 'orchestrator\.mjs' 2>/dev/null || true
pkill -f 'profile-trace\.mjs' 2>/dev/null || true
pkill -f 'orch-ui\.py' 2>/dev/null || true
sleep 1

cd "$BUNDLE"
ANTIG_REQUIRE_USB_TETHER=0 \
ORCH_PROXY_CONFIG="$PROXY_CFG" \
ORCH_ROTATE_IP=1 \
ORCH_RESET_PROFILES="${ORCH_RESET_PROFILES:-1}" \
ORCH_BATCH="$BATCH" \
ORCH_MAX_RUNS="$RUNS" \
ORCH_EMAIL_DOMAIN="$DOMAIN" \
EXT_ZIP="${EXT_ZIP:-$BUNDLE/gcp-auto-intern-portal-v1.5.7.zip}" \
nohup ./run.sh > "$RUN/orchestrator.log" 2>&1 &
ORCH_PID=$!
echo "$ORCH_PID" > "$RUN/orchestrator.pid"

nohup node "$DIR/profile-trace.mjs" "$RUN/orchestrator.log" "$RUN/trace.log" >> "$RUN/trace.out" 2>&1 &
TRACE_PID=$!
echo "$TRACE_PID" > "$RUN/trace.pid"

cat > "$RUN/health.sh" <<'HEALTH'
#!/bin/sh
PID="$1"
PROXY="$3"
while kill -0 "$PID" 2>/dev/null; do
  {
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
    printf 'host='; curl -4 -s -m 6 https://api.ipify.org || true; echo
    printf 'proxy='; curl -4 -s -m 8 --proxy "$PROXY" https://api.ipify.org || true; echo
    printf 'active='; curl -s -m 3 http://127.0.0.1:58888/api/profiles/active || true; echo
  } >> "$2" 2>&1
  sleep 5
done
HEALTH
chmod +x "$RUN/health.sh"
nohup "$RUN/health.sh" "$ORCH_PID" "$RUN/health.log" "$PROXY_URL" >/dev/null 2>&1 &

nohup python3 "$DIR/log-errors.py" "$RUN/orchestrator.log" "$RUN/trace.log" >> "$RUN/errors.log" 2>&1 &

echo "orchestrator pid=$ORCH_PID"
echo "trace pid=$TRACE_PID"
echo "logs=$RUN"
echo "proxy egress=$PROXY_EG"
