#!/bin/sh
# Start the continuous 2-profile signup runner and show a live terminal dashboard.
#   ./start-2signup-live.sh          start (or restart) the runner + dashboard
#   ./start-2signup-live.sh --view   attach the dashboard to a running runner
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" != "--view" ]; then
  "$DIR/start-2signup.sh"
fi

exec python3 "$DIR/signup-live.py"
