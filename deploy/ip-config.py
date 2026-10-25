#!/usr/bin/env python3
"""Generate HTTP challenge-only or HTTPS configuration; publication is explicit."""
import argparse
import ipaddress
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("ip", type=ipaddress.ip_address)
parser.add_argument("--tls", action="store_true")
parser.add_argument("--publish", action="store_true")
a = parser.parse_args()
if a.publish and not a.tls:
    parser.error("Public app requires HTTPS")
root = Path(__file__).resolve().parent / "runtime"
root.mkdir(mode=0o700, exist_ok=True)
for name in ("challenges", "letsencrypt", "certbot-log"):
    (root / name).mkdir(mode=0o700, exist_ok=True)
# Nginx worker needs to read the public challenge directory.
(root / "challenges").chmod(0o755)
challenge = "location ^~ /.well-known/acme-challenge/ { root /var/www/acme; default_type text/plain; try_files $uri =404; }"
http_rest = "location / { return 503; }"
if a.tls:
    http_rest = f"location / {{ return 308 https://{a.ip}$request_uri; }}"
conf = f"server {{ listen 80; server_name {a.ip}; {challenge} {http_rest} }}\n"
if a.tls:
    certificate = root / "letsencrypt/live/chunguorizi-ip/fullchain.pem"
    private_key = root / "letsencrypt/live/chunguorizi-ip/privkey.pem"
    if not certificate.is_file() or not private_key.is_file():
        parser.error("Issue the production certificate before enabling TLS")
    route = """error_page 503 /holding.html;
      location = /holding.html { internal; root /usr/share/nginx/html; }
      location / { add_header Retry-After \"Sat, 28 Nov 2026 00:00:00 +0800\" always; return 503; }"""
    if a.publish:
        route = """location / {
          proxy_pass http://app:4173;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $remote_addr;
          proxy_set_header X-Forwarded-Proto https;
          proxy_read_timeout 120s;
        }"""
    conf += f"""server {{
      listen 443 ssl;
      server_name {a.ip};
      ssl_certificate /etc/letsencrypt/live/chunguorizi-ip/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/chunguorizi-ip/privkey.pem;
      ssl_protocols TLSv1.2 TLSv1.3;
      server_tokens off;
      client_max_body_size 9m;
      add_header X-Content-Type-Options nosniff always;
      add_header Referrer-Policy strict-origin-when-cross-origin always;
      add_header Permissions-Policy "microphone=(self), camera=()" always;
      {route}
    }}\n"""
(root / "nginx.conf").write_text(conf)
print("Configuration written; validate and reload Nginx. Public app:", a.publish)
