#!/bin/sh
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${ANTIG_LOG_ROOT:-$HOME/Desktop/antig-logs}"
mkdir -p "$ROOT"

"$DIR/start-2signup-1login.sh" || exit 1

RUN="$(ls -td "$ROOT"/run-* 2>/dev/null | head -1 || true)"
LOGIN="$(cat "$ROOT/latest-login-log" 2>/dev/null || ls -t "$ROOT"/login-*.log 2>/dev/null | head -1 || true)"

echo
echo "Live logs:"
echo "  signup: ${RUN:-not started}"
echo "  login:  ${LOGIN:-not started}"
echo "Ctrl+C stops only this log viewer; processes keep running."
echo

exec python3 "$DIR/antig-live.py"
