#!/bin/sh
set -eu
umask 077
if [ -n "${FLYAI_API_KEY:-}" ]; then
  flyai config set FLYAI_API_KEY "$FLYAI_API_KEY" >/dev/null
fi
exec node server.mjs
