#!/usr/bin/env bash
# Verifies a worker deploy actually took, on the box.
#
#   cd /opt/deenclipped && bash worker/verify-deploy.sh
#
# Exists because a clean build log proves nothing: Docker will happily rebuild an
# identical image from cache, so the only trustworthy check is reading the code
# out of the *running* container and asking ffmpeg what it can do.

set -u
CONTAINER="${CONTAINER:-worker-deenclipped-worker-1}"
fails=0

say()  { printf '%-46s %s\n' "$1" "$2"; }
ok()   { say "$1" "OK"; }
bad()  { say "$1" "FAIL — $2"; fails=$((fails + 1)); }

echo "Container: $CONTAINER"
echo

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "The container is not running. Start it with:"
  echo "  docker compose -f worker/docker-compose.yml up -d --build"
  exit 1
fi
ok "container running"

# ── the code that is actually inside the image ────────────────────────────────
# Each of these is a distinct change; a cached image will miss all of them.
check_code() {
  local label="$1" pattern="$2" file="$3"
  if docker exec "$CONTAINER" grep -q "$pattern" "$file" 2>/dev/null; then
    ok "$label"
  else
    bad "$label" "not in the running container — rebuild with --no-cache"
  fi
}

check_code "pipeline phase enum"        "def phase_for"      /app/worker/clip_worker.py
check_code "caption timings persisted"  "def caption_blocks" /app/worker/clip_worker.py
check_code "AI-off warning"             "ollama_not_configured" /app/worker/clip_worker.py
check_code "readable fallback titles"   "TITLE_OPENERS"      /app/worker/clip_worker.py
check_code "requested-clip count"       "clipsRequested"     /app/worker/clip_worker.py
check_code "grain / warmth filters"     "colorbalance"       /app/worker/clip_worker.py
check_code "heartbeat recorded"         "heartbeatAt"        /app/worker/service.py

echo

# ── what ffmpeg in the image can actually do ──────────────────────────────────
# The filters are built as strings, so a missing one fails at render time, on a
# real customer job, not here.
for filter in colorbalance noise vignette subtitles unsharp gblur; do
  if docker exec "$CONTAINER" sh -c "ffmpeg -hide_banner -filters 2>/dev/null | awk '{print \$2}' | grep -qx $filter"; then
    ok "ffmpeg filter: $filter"
  else
    bad "ffmpeg filter: $filter" "renders using it will fail"
  fi
done

echo

# ── dependencies the pipeline needs ───────────────────────────────────────────
doctor=$(docker exec "$CONTAINER" python /app/worker/clip_worker.py --doctor 2>/dev/null)
if [ -z "$doctor" ]; then
  bad "worker doctor" "produced no output"
else
  echo "doctor: $doctor"
  for dep in yt_dlp faster_whisper; do
    if printf '%s' "$doctor" | grep -q "\"$dep\": \"No module"; then
      bad "dependency: $dep" "missing from the image"
    else
      ok "dependency: $dep"
    fi
  done
fi

echo

# ── the service itself ────────────────────────────────────────────────────────
# 401 is the healthy answer: the endpoint requires HMAC, so an unsigned request
# being rejected means it is up and authenticating.
code=$(docker exec "$CONTAINER" sh -c 'curl -s -o /dev/null -w "%{http_code}" localhost:8080/health' 2>/dev/null)
case "$code" in
  200|401) ok "service responding (HTTP $code)" ;;
  "")      bad "service responding" "no answer on :8080" ;;
  *)       bad "service responding" "HTTP $code" ;;
esac

echo
if [ "$fails" -eq 0 ]; then
  echo "All checks passed. The running worker has the current code."
  echo
  echo "Not covered here: whether a real job completes. Run one short lecture and"
  echo "watch it through all five stages, then check the new clip has editable"
  echo "caption blocks in the editor."
else
  echo "$fails check(s) failed."
  echo "If the code checks failed, the image was cached:"
  echo "  docker compose -f worker/docker-compose.yml build --no-cache"
  echo "  docker compose -f worker/docker-compose.yml up -d"
fi
exit "$fails"
