#!/usr/bin/env bash
# Probes a YouTube download from inside the running worker container, with the
# exact format string the importer uses.
#
#   bash worker/probe-import.sh VIDEOID          (the part after v= in the URL)
#   bash worker/probe-import.sh https://www.youtube.com/watch?v=VIDEOID
#
# Exists because the Hetzner web console mangles shell metacharacters -- every
# "|" arrives as "\", "*" as "8", "+" as "=" -- so any one-liner with pipes or
# globs runs as something else entirely. This keeps console input to letters
# and digits; the metacharacters all live in here.
set -u
CONTAINER="${CONTAINER:-worker-deenclipped-worker-1}"

target="${1:-}"
if [ -z "$target" ]; then
  echo "usage: bash worker/probe-import.sh VIDEOID   (or a full YouTube URL)"
  exit 2
fi
case "$target" in
  http*) url="$target" ;;
  *)     url="https://www.youtube.com/watch?v=$target" ;;
esac

echo "== last job on this box =="
last=$(docker exec "$CONTAINER" sh -c 'ls -t /var/lib/deenclipped/jobs/*/status.json 2>/dev/null | head -n 1')
if [ -n "$last" ]; then
  docker exec "$CONTAINER" cat "$last" | grep -E '"(status|stage|error|importProvider)"' || true
else
  echo "(no jobs recorded)"
fi

echo
echo "== probing $url through the production import path =="
# The app's own downloader: the full client rotation, the PO-token wiring,
# every option a real job gets. A raw `yt-dlp URL` tests the defaults instead
# and can disagree with production in both directions.
#
# The download is capped small on purpose; hitting the cap means bytes were
# flowing, which is the entire question.
out=$(docker exec -e WORKER_MAX_DOWNLOAD_MB=80 "$CONTAINER" \
  python /app/worker/import_providers.py --probe "$url" 2>&1)
printf '%s\n' "$out" | tail -n 12

echo
if printf '%s' "$out" | grep -q "PROBE OK\|exceeds the configured download limit"; then
  echo "VERDICT: downloading fine -- the import route works for this video."
elif printf '%s' "$out" | grep -qi "sign in to confirm\|login.required"; then
  echo "VERDICT: YouTube's bot wall, even with PO tokens -- this needs cookies"
  echo "         (VIDEO_IMPORT_COOKIES) or a residential proxy (VIDEO_IMPORT_PROXY)."
else
  echo "VERDICT: failed -- read the error above."
fi
