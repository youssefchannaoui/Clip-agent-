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
echo "== probing $url =="
# timeout on purpose: being killed mid-download is a PASS -- it means YouTube
# served the media bytes and the 403 is gone.
out=$(docker exec "$CONTAINER" sh -c "rm -f /tmp/probe.*; timeout 75 yt-dlp -v -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b' --merge-output-format mp4 -o '/tmp/probe.%(ext)s' '$url' 2>&1; rm -f /tmp/probe.*" 2>&1)
printf '%s\n' "$out" | tail -n 45

echo
if printf '%s' "$out" | grep -q "HTTP Error 403"; then
  echo "VERDICT: still 403 -- the runtime is in, so this video wants more (likely a PO token)."
  printf '%s' "$out" | grep -i "po.token\|proof.of.origin" | head -n 3 || true
elif printf '%s' "$out" | grep -qE '\[download\] +[0-9]'; then
  echo "VERDICT: downloading fine -- the 403 is gone for this video."
else
  echo "VERDICT: failed before the download stage -- read the error above."
fi
