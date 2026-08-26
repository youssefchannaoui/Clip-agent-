#!/usr/bin/env bash
# Nightly census of the residential proxy pool.
#
# YouTube burned one exit within an hour of the pool going live, and nothing
# counts how many still pass. Each address fetches the metadata of one tiny
# public video through yt-dlp inside the worker container; an address that
# answers with the bot wall is burned. Alerts when fewer than MIN_OK pass --
# the pool thins gradually, and the time to replace addresses (Webshare
# replaces 10/month free) is before imports start failing, not after.
set -u
ENV_FILE="/opt/deenclipped/worker/.env"
MIN_OK=10
TOPIC=$(grep -E "^ALERT_NTFY_TOPIC=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
POOL=$(grep -E "^VIDEO_IMPORT_PROXIES=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
[ -z "$TOPIC" ] || [ -z "$POOL" ] && exit 0

ok=0; total=0; burned=""
IFS=',' read -ra ADDRS <<< "$POOL"
for proxy in "${ADDRS[@]}"; do
  proxy=$(echo "$proxy" | tr -d ' ')
  [ -z "$proxy" ] && continue
  total=$((total+1))
  if docker exec -e PROBE_PROXY="$proxy" worker-deenclipped-worker-1 timeout 45 python3 -c "
import os, yt_dlp
opts = {'quiet': True, 'skip_download': True, 'proxy': os.environ['PROBE_PROXY']}
yt_dlp.YoutubeDL(opts).extract_info('https://www.youtube.com/watch?v=jNQXAC9IVRw', download=False)
" >/dev/null 2>&1; then
    ok=$((ok+1))
  else
    burned="$burned ${proxy##*@}"
  fi
done

echo "$(date -u +%FT%TZ) pool check: $ok/$total passing;burned:$burned" >> /var/log/deenclipped-proxy-pool.log
if [ "$ok" -lt "$MIN_OK" ]; then
  curl -fsS -m 10 -H "Title: DeenClipped proxy pool is thin" -H "Priority: high" -H "Tags: rotating_light" \
    -d "Only $ok of $total proxy addresses still pass YouTube. Burned:$burned
Replace them at dashboard.webshare.io (Proxy -> List -> Replace, 10 free per month), then update VIDEO_IMPORT_PROXIES in worker/.env and restart the worker." \
    "https://ntfy.sh/$TOPIC" >/dev/null 2>&1 || true
fi
