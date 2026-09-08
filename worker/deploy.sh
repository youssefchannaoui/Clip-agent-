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

# THE CAPACITY FORCES IN .env WERE WRITTEN FOR A 2-CORE 3.7G BOX and survived
# the CPX41 resize -- compose stopped setting them at v3.162.0 and .env went on
# doing it, so the worker still read one job, two ffmpeg threads and `small` on
# a machine with four times the hardware (CLAUDE.md, v3.162.0).
#
# Retired ONCE and marked, never on every deploy: capacity.py's contract is
# that an explicit value always wins, and a deploy that quietly deletes an
# operator's override would break exactly the escape hatch this repo relies on.
# A force set deliberately after this line is left alone for ever.
if ! grep -q '^# capacity-forces-retired' worker/.env; then
  sed -i -E 's/^(WORKER_MAX_CONCURRENT_JOBS|FFMPEG_THREADS|WHISPER_DEVICE|WHISPER_COMPUTE_TYPE|WHISPER_MODEL)=/# retired, capacity.py sizes this now: \1=/' worker/.env
  printf '\n# capacity-forces-retired -- read SCALING.md before adding one back.\n' >> worker/.env
  echo "retired the stale capacity forces in worker/.env"
fi

# Let the slot empty first. Recreating the container takes whatever it was
# doing with it; the worker resumes an interrupted job, but not waiting costs
# the customer a re-import and a re-render they never asked for. See
# worker/drain.sh (DEPLOY_DRAIN_MINUTES=0 skips it for an emergency fix).
bash worker/drain.sh

docker compose -f worker/docker-compose.yml up -d --build
# The layer cache from --build accumulates invisibly; eight rebuilds once
# grew it to 25.7GB and read as a full disk. See CLAUDE.md Deploys.
docker builder prune -f
bash worker/verify-deploy.sh
