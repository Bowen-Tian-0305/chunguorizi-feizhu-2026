#!/bin/sh
# Called by a root-owned systemd timer every 12 hours on the deployment host.
set -eu
cd "$(dirname "$0")"
exec 9>runtime/renew.lock
flock -n 9 || exit 0
docker compose -f compose-ip.yaml --profile tools run --rm certbot renew --quiet
docker compose -f compose-ip.yaml exec -T web nginx -t
docker compose -f compose-ip.yaml exec -T web nginx -s reload
