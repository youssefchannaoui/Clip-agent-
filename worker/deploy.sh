#!/usr/bin/env bash
# One-command worker deploy for the Hetzner box.
#
#   cd /opt/deenclipped && git pull && bash worker/deploy.sh
#
# Exists because the Hetzner web console mangles shifted symbols (a pipe
# arrives as a backslash, an underscore as a hyphen), so anything beyond
# plain words typed into it is a hazard. Letters, digits, dots, slashes and
# hyphens survive -- which is exactly what the two commands above use.
set -euo pipefail
cd /opt/deenclipped

# New uploads must carry the CDN domain. The r2.dev public URL is a
# rate-limited dev endpoint (five straight GET 503s in one live session);
# media.deenclipped.online is the same bucket behind Cloudflare's cache.
if grep -q '^OBJECT_STORAGE_PUBLIC_URL=' worker/.env; then
  sed -i 's|^OBJECT_STORAGE_PUBLIC_URL=.*|OBJECT_STORAGE_PUBLIC_URL=https://media.deenclipped.online|' worker/.env
else
  printf '\nOBJECT_STORAGE_PUBLIC_URL=https://media.deenclipped.online\n' >> worker/.env
fi
echo "public url now: $(grep '^OBJECT_STORAGE_PUBLIC_URL=' worker/.env)"

docker compose -f worker/docker-compose.yml up -d --build
# The layer cache from --build accumulates invisibly; eight rebuilds once
# grew it to 25.7GB and read as a full disk. See CLAUDE.md Deploys.
docker builder prune -f
bash worker/verify-deploy.sh
