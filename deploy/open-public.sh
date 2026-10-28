#!/bin/sh
set -eu

cd /opt/chunguorizi
health=$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4173/api/health) || {
  echo "Public opening preflight failed: app is not healthy" >&2
  exit 1
}
printf '%s' "$health" | python3 -c 'import json,sys; h=json.load(sys.stdin); sys.exit(0 if h.get("ok") and h.get("bailian_ready") and h.get("amap_ready") else 1)' || {
  echo "Public opening preflight failed: Bailian or map configuration is not ready" >&2
  exit 1
}
python3 deploy/ip-config.py 47.238.228.164 --tls --publish
docker compose -f deploy/compose-ip.yaml up -d --no-deps --force-recreate web

attempt=0
until curl --fail --silent --show-error --max-time 10 https://47.238.228.164/api/health >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 6 ]; then
    echo "Public opening failed health check" >&2
    exit 1
  fi
  sleep 5
done

echo "Public demo opened and health check passed"
