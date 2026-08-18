#!/usr/bin/env bash
# Installs a YouTube cookies file for the local downloader.
#
#   1. scp the exported cookies.txt to /opt/deenclipped/cookies.txt
#   2. cd /opt/deenclipped && bash worker/install-cookies.sh
#
# The cookies answer YouTube's "Sign in to confirm you're not a bot" wall,
# which this box's datacenter IP hits even with PO tokens (probed 18 Aug 2026:
# every client in the rotation, LOGIN_REQUIRED on all of them).
#
# The account behind the cookies should be a THROWAWAY -- never the account
# that owns the channel. YouTube sometimes flags accounts whose session is
# used for automated downloads, and the channel must not be the thing at risk.
set -u
CONTAINER="${CONTAINER:-worker-deenclipped-worker-1}"
SRC="${1:-/opt/deenclipped/cookies.txt}"
ENVFILE="worker/.env"
DEST="/var/lib/deenclipped/cookies.txt"

if [ ! -f "$SRC" ]; then
  echo "No cookies file at $SRC"
  echo "Export cookies.txt from a browser signed into the throwaway account,"
  echo "then from your own computer:  scp cookies.txt root@135.181.149.182:$SRC"
  exit 1
fi
if ! grep -q "youtube.com" "$SRC"; then
  echo "$SRC has no youtube.com entries -- that is not a YouTube cookies export."
  exit 1
fi
chmod 600 "$SRC"

# Into the data volume, so it survives container rebuilds.
docker cp "$SRC" "$CONTAINER":"$DEST"
docker exec "$CONTAINER" chmod 600 "$DEST"

if grep -q '^VIDEO_IMPORT_COOKIES=' "$ENVFILE" 2>/dev/null; then
  sed -i "s|^VIDEO_IMPORT_COOKIES=.*|VIDEO_IMPORT_COOKIES=$DEST|" "$ENVFILE"
else
  echo "VIDEO_IMPORT_COOKIES=$DEST" >> "$ENVFILE"
fi

docker compose -f worker/docker-compose.yml up -d

caps=$(docker exec "$CONTAINER" python -c 'import sys; sys.path.insert(0,"/app/worker"); import json, clip_worker; print(json.dumps(clip_worker.capabilities()))' 2>/dev/null)
if printf '%s' "$caps" | grep -q '"importCookies": true'; then
  # The host copy is a live account credential; the container has it now.
  rm -f "$SRC"
  echo "Cookies installed and active (importCookies: true). Host copy removed."
  echo "Next: bash worker/probe-import.sh VIDEOID"
else
  echo "Cookies copied but the worker does not report importCookies: true yet."
  echo "The host copy at $SRC was kept so this can be retried."
  exit 1
fi
