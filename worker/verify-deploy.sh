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
# Scripture is captioned from the Quran on every template, not only the Quran
# one, and a line mixing Arabic with English gets a face per word. Both are
# invisible in a build log and show up only in a finished clip -- which is the
# failure this script exists to catch.
check_code "ayah detection on every style" "auto_ayahs"        /app/worker/clip_worker.py
check_code "mixed Arabic/English captions" "mixed_script_line" /app/worker/clip_worker.py
# Re-rendering an imported lecture reads back "projects/<id>/source.mp4". Only
# "uploads/" was accepted, so every re-render of a link import failed.
check_code "re-render reads stored sources"  "projects/"        /app/worker/import_providers.py
check_code "ayahs stored on the clip"        "matched_ayahs"     /app/worker/clip_worker.py
# The AI ran zero jobs while its container sat green: nothing checked that the
# worker was configured to CALL it, only that it was up. The worker now
# defaults to its sidecar; this catches the default being lost again.
check_code "worker calls its own clip AI"   "http://ollama:11434" /app/worker/clip_worker.py
check_code "viral titling prompt"           "TRANSCRIPT DATA"     /app/worker/clip_worker.py
# CRF alone has no ceiling: a grainy 52s clip rendered at 453MB and silently
# failed to publish. The ceiling is the difference between posting and not.
check_code "render bitrate ceiling"         "maxrate"             /app/worker/clip_worker.py
# The 2 Sept 2026 audit: the scoring request declares its context window and
# pins the answer to the batch by schema; the translate pass is clipped to the
# Arabic; a hung job is stopped at its budget. Each is invisible in a build
# log and shows up only as a worse clip or a held slot.
check_code "AI request declares num_ctx"     "AI_NUM_CTX"          /app/worker/clip_worker.py
check_code "AI answer pinned by schema"      "clip_rows_schema"    /app/worker/clip_worker.py
check_code "translate clipped to the Arabic" "clip_timestamps"     /app/worker/clip_worker.py
check_code "job wall-clock budget"           "job_budget_seconds"  /app/worker/service.py

echo

# ── the faces the captions are set in ─────────────────────────────────────────
# The ASS styles ask for these families by name. When fontconfig cannot
# resolve one it silently substitutes -- a worker image built before the
# fonts were bundled drew Outfit as a typewriter face ~1.7x wider, and the
# pre-broken caption lines ran off both edges of a real customer render.
# A build log cannot catch this; only the running image's font list can.
for family in "Outfit" "Montserrat" "Amiri" "KFGQPC HAFS Uthmanic Script"; do
  if docker exec "$CONTAINER" fc-list 2>/dev/null | grep -qi "$family"; then
    ok "font: $family"
  else
    bad "font: $family" "captions will render in a fallback face"
  fi
done

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
  # Speaker framing was broken for weeks while this script exited 0, because the
  # doctor line was printed and never checked. If OpenCV cannot detect faces,
  # framing silently falls back to a centre crop on every job -- say so.
  if printf '%s' "$doctor" | grep -q '"opencv": ".*framing available'; then
    ok "opencv: face detection"
  else
    bad "opencv: face detection" "$(printf '%s' "$doctor" | sed -n 's/.*"opencv": "\([^"]*\)".*/\1/p')"
  fi
fi

# yt-dlp needs an external JavaScript runtime to solve YouTube's signature
# challenge. Without one YouTube answers 403 on the media URLs, and the error
# says only "unable to download video data: HTTP Error 403: Forbidden" -- which
# reads like a blocked IP and cost days of chasing proxies and cookies.
#
# Checked by running the binary rather than by reading the doctor line, and
# outside the `if doctor` block above: a doctor that fails to run must not make
# this check disappear. That is the whole point of this script.
if deno=$(docker exec "$CONTAINER" deno --version 2>/dev/null) && [ -n "$deno" ]; then
  ok "deno: JS runtime ($(printf '%s' "$deno" | head -n1))"
else
  bad "deno: JS runtime" "missing — every YouTube import will fail with HTTP 403. The Dockerfile COPYs it from denoland/deno; rebuild with --no-cache"
fi

# The PO-token server, which answers YouTube's "Sign in to confirm you're not
# a bot" wall on this datacenter IP. Probed from inside the worker container
# because that is the network path the plugin actually uses; a server that is
# up but unreachable from the worker is still a broken deploy.
pot=$(docker exec "$CONTAINER" sh -c 'curl -s -m 5 http://bgutil-provider:4416/ping' 2>/dev/null)
if printf '%s' "$pot" | grep -q "server_uptime\|version"; then
  ok "po-token server: reachable"
else
  bad "po-token server: unreachable" "guarded videos will die on YouTube's bot wall. Is the bgutil-provider service up? docker compose -f worker/docker-compose.yml up -d"
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

# ── the clip AI ───────────────────────────────────────────────────────────────
# Without a reachable Ollama, refine_with_ollama() returns its candidates
# untouched: clips are picked by the built-in scoring and titled from raw
# transcript fragments. That is a supported mode, so this reports which mode the
# box is actually in rather than failing — but it must never be a silent guess.
# The model is read out of the RUNNING WORKER, not from this shell.
#
# This used to say ${OLLAMA_MODEL:-qwen3:4b}. OLLAMA_MODEL is set inside
# docker-compose.yml, for the container -- it is not in the deploy shell's
# environment, so the default always won and this checked qwen3:4b. The box
# actually runs qwen3:1.7b, and 4b happens to be pulled as well, so the check
# printed a confident "clip AI: qwen3:4b loaded OK" while telling us nothing
# about the model that titles the clips. It would not have caught the real one
# missing, which is the entire point of the check.
model=$(docker exec "$CONTAINER" printenv OLLAMA_MODEL 2>/dev/null | tr -d '\r')
if [ -z "$model" ]; then
  bad "clip AI: model not configured" "OLLAMA_MODEL is unset in $CONTAINER, so refine_with_ollama falls back to its built-in default. Set it in worker/docker-compose.yml."
else
  ai=$(docker exec "$CONTAINER" sh -c 'curl -s -m 5 http://ollama:11434/api/tags' 2>/dev/null)
  if printf '%s' "$ai" | grep -q '"models"'; then
    if printf '%s' "$ai" | grep -q "\"$model\""; then
      ok "clip AI: $model loaded (the model the worker is configured to use)"
    else
      bad "clip AI: model missing" "Ollama is up but $model -- the model this worker is configured to use -- is not pulled. Run: docker compose -f worker/docker-compose.yml exec ollama ollama pull $model"
    fi
  else
    bad "clip AI: unreachable" "no Ollama on http://ollama:11434 — clips will be scored and titled without the AI"
  fi
fi

# ── what the running build reports about itself ───────────────────────────────
# The same report /health now serves, so this and the app agree on the answer to
# "did the rebuild take".
caps=$(docker exec "$CONTAINER" python -c 'import sys; sys.path.insert(0,"/app/worker"); import json, clip_worker; print(json.dumps(clip_worker.capabilities()))' 2>/dev/null)
if [ -n "$caps" ]; then
  echo "capabilities: $caps"
  for feature in captionAnimation clipBreakdown potProvider; do
    if printf '%s' "$caps" | grep -q "\"$feature\": true"; then
      ok "capability: $feature"
    else
      bad "capability: $feature" "this image predates it — rebuild"
    fi
  done
  missing=$(printf '%s' "$caps" | sed -n 's/.*"missingFonts": \[\([^]]*\)\].*/\1/p')
  if [ -z "$missing" ]; then ok "capability: caption fonts"; else bad "capability: caption fonts" "missing $missing"; fi
else
  bad "capability report" "the worker could not describe its own build"
fi

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
