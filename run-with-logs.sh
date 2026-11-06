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
printf '%s\n' "run=$RUN" "domain=${DOMAIN:-random-all-domains}" "batch=$BATCH" "runs=$RUNS" "extension=1.5.4" > "$RUN/metadata.txt"

PROXY_EG="$(curl -4 -s -m 10 --socks5-hostname 127.0.0.1:1080 https://api.ipify.org || true)"
if [ -z "$PROXY_EG" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') proxy egress empty; starting anyway so rotation can recover it" >> "$RUN/errors.log"
  echo "warning: USB proxy egress is empty; starting anyway"
fi

pkill -f 'orchestrator\.mjs' 2>/dev/null || true
pkill -f 'profile-trace\.mjs' 2>/dev/null || true
pkill -f 'orch-ui\.py' 2>/dev/null || true
sleep 1

cd "$BUNDLE"
ANTIG_REQUIRE_USB_TETHER=0 \
ORCH_ROTATE_USB=1 \
ORCH_RESET_PROFILES=1 \
ORCH_BATCH="$BATCH" \
ORCH_MAX_RUNS="$RUNS" \
ORCH_EMAIL_DOMAIN="$DOMAIN" \
EXT_ZIP="$BUNDLE/gcp-auto-intern-portal-v1.5.4.zip" \
ORCH_PROXY_SERVER=socks5://127.0.0.1:1080 \
nohup ./run.sh > "$RUN/orchestrator.log" 2>&1 &
ORCH_PID=$!
echo "$ORCH_PID" > "$RUN/orchestrator.pid"

nohup node "$DIR/profile-trace.mjs" "$RUN/orchestrator.log" "$RUN/trace.log" >> "$RUN/trace.out" 2>&1 &
TRACE_PID=$!
echo "$TRACE_PID" > "$RUN/trace.pid"

cat > "$RUN/health.sh" <<'HEALTH'
#!/bin/sh
PID="$1"
while kill -0 "$PID" 2>/dev/null; do
  {
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
    printf 'bettertether='; curl -s -m 3 http://127.0.0.1:9400/api/status || true; echo
    printf 'host='; curl -4 -s -m 6 https://api.ipify.org || true; echo
    printf 'proxy='; curl -4 -s -m 8 --socks5-hostname 127.0.0.1:1080 https://api.ipify.org || true; echo
    printf 'active='; curl -s -m 3 http://127.0.0.1:58888/api/profiles/active || true; echo
    printf 'default='; route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}'
    printf 'adb='; adb devices 2>/dev/null | awk 'NR==2{print $1" "$2}'
  } >> "$2" 2>&1
  sleep 5
done
HEALTH
chmod +x "$RUN/health.sh"
nohup "$RUN/health.sh" "$ORCH_PID" "$RUN/health.log" >/dev/null 2>&1 &

nohup python3 "$DIR/log-errors.py" "$RUN/orchestrator.log" "$RUN/trace.log" >> "$RUN/errors.log" 2>&1 &

echo "orchestrator pid=$ORCH_PID"
echo "trace pid=$TRACE_PID"
echo "logs=$RUN"
echo "proxy egress=$PROXY_EG"
