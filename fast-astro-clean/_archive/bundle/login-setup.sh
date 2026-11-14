#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec ./runtime/node/bin/node --experimental-websocket create-login-profile.mjs
