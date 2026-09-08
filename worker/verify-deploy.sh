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
warns=0

say()  { printf '%-46s %s\n' "$1" "$2"; }
ok()   { say "$1" "OK"; }
bad()  { say "$1" "FAIL — $2"; fails=$((fails + 1)); }
# A finding that must be READ but must not refuse the deploy. A job that
# disagrees with this box is usually the reason someone is deploying; failing
# the run over it would block the very fix. See the newest-job section.
# Counted, so the summary can point at it rather than printing a legend for a
# line that is not there -- a note nobody needed is how a real one gets skimmed.
warn() { say "$1" "!! $2"; warns=$((warns + 1)); }

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
# 6 Sept 2026: a stopped job takes its ffmpeg and Whisper with it, a restart
# marks running jobs interrupted and resumes them from the saved plan rather
# than from the import, and the deploy waits for the slot to empty first.
check_code "children stopped as a group"     "start_new_session"   /app/worker/service.py
check_code "restart resumes, not restarts"   "def shutdown"        /app/worker/service.py
check_code "render plan checkpoint"          "def write_plan"      /app/worker/clip_worker.py

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

# HOW OLD IS THE EXTRACTOR, because a stale one fails as a 403 on the media
# fetch -- indistinguishable from a blocked address, and it sent two sessions
# looking at proxies and cookies. Measured 9 Sept 2026: the box was carrying
# yt-dlp 2026.08.19, three weeks old, on a container rebuilt that morning,
# because the pip layer is cached on requirements.txt's own bytes and that file
# had not changed. worker/Dockerfile's YTDLP_REFRESH layer is the fix; this is
# the alarm that says whether it worked, so a deploy log stops being silent
# about the one dependency YouTube breaks on purpose.
ytdlp_version=$(docker exec "$CONTAINER" python -c 'import yt_dlp;print(yt_dlp.version.__version__)' 2>/dev/null || true)
if [ -z "$ytdlp_version" ]; then
  bad "yt-dlp version" "could not be read from the running container"
else
  # yt-dlp versions are dates (2026.09.09), so the age is arithmetic rather
  # than a lookup -- no network call, and it works on a box with no registry.
  ytdlp_days=$(python3 - "$ytdlp_version" <<'PYAGE' 2>/dev/null || echo -1
import datetime, re, sys
match = re.match(r"^(\d{4})\.(\d{2})\.(\d{2})", sys.argv[1])
if not match:
    print(-1)
else:
    released = datetime.date(*(int(part) for part in match.groups()))
    print((datetime.date.today() - released).days)
PYAGE
)
  if [ "$ytdlp_days" -lt 0 ] 2>/dev/null; then
    ok "yt-dlp $ytdlp_version (age unknown)"
  elif [ "$ytdlp_days" -gt 21 ]; then
    # Not fatal: an old yt-dlp still imports most videos, and failing the
    # deploy would leave the box on something older still.
    warn "yt-dlp $ytdlp_version is $ytdlp_days days old -- YouTube breaks older extractors, and it fails as a 403"
  else
    ok "yt-dlp $ytdlp_version ($ytdlp_days days old)"
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
#
# AND IT SAID MORE THAN IT CHECKED. The line used to read "the model the worker
# is configured to use", which reads as a promise that a job will run on it --
# and this check cannot see a job at all. It reads two things and now claims
# exactly those two: OLLAMA_MODEL inside the container, and whether Ollama has
# that model pulled. What a JOB asks for is a separate question, asked below,
# because those two have been different in production while this said OK.
model=$(docker exec "$CONTAINER" printenv OLLAMA_MODEL 2>/dev/null | tr -d '\r')
if [ -z "$model" ]; then
  bad "clip AI: model not configured" "OLLAMA_MODEL is unset in $CONTAINER, so refine_with_ollama falls back to its built-in default. Set it in worker/docker-compose.yml."
else
  ai=$(docker exec "$CONTAINER" sh -c 'curl -s -m 5 http://ollama:11434/api/tags' 2>/dev/null)
  if printf '%s' "$ai" | grep -q '"models"'; then
    if printf '%s' "$ai" | grep -q "\"$model\""; then
      ok "clip AI: $model pulled (OLLAMA_MODEL in $CONTAINER)"
    else
      bad "clip AI: model missing" "Ollama is up but $model -- the model this worker is configured to use -- is not pulled. Run: docker compose -f worker/docker-compose.yml exec ollama ollama pull $model"
    fi
  else
    bad "clip AI: unreachable" "no Ollama on http://ollama:11434 — clips will be scored and titled without the AI"
  fi
fi

echo

# ── what a JOB actually asked for ─────────────────────────────────────────────
# EVERY CHECK ABOVE READS THIS CONTAINER'S OWN CONFIGURATION, so they all agreed
# with each other through a fortnight of green ticks while every job ran a
# Whisper model none of them named: clip_worker took settings["model"] out of
# the job payload and never looked at WHISPER_MODEL, so a box configured for
# `medium` transcribed on `small` and this script said OK each time. A monitor
# that reads one side of a disagreement is worse than no monitor.
#
# So read the newest job's own payload out of the running container and print
# what it asked for BESIDE what capacity decided. The box is authoritative --
# service.py puts capacity's device, compute type and model into clip_worker's
# environment -- so a difference here means the run did not use what this box is
# configured for.
#
# REPORTED, NEVER FAILED. A fresh box has no jobs at all, and a job recorded
# before the fix disagreeing is the reason to deploy rather than a reason to
# refuse. It is one python heredoc against files already on disk: no HTTP, no
# shared secret, and nothing the new image has to contain.
asked=$(docker exec -i "$CONTAINER" python3 - <<'PY' 2>/dev/null
import glob, json, os, sys
sys.path.insert(0, "/app/worker")
root = os.environ.get("WORKER_DATA_DIR", "/var/lib/deenclipped")
paths = glob.glob(os.path.join(root, "jobs", "*", "payload.json"))
if not paths:
    print("NONE")
    raise SystemExit
newest = max(paths, key=os.path.getmtime)
try:
    with open(newest, encoding="utf-8") as handle:
        settings = (json.load(handle) or {}).get("settings") or {}
except (OSError, ValueError):
    settings = {}
try:
    import capacity
    # plan() already folds every environment override in, so this IS what the
    # container decided rather than a second heuristic beside it.
    plan = capacity.plan()
except Exception:
    plan = {}
# Ollama's model is not part of that plan; the container's own environment is
# the only thing it has to decide with.
plan["ollamaModel"] = os.environ.get("OLLAMA_MODEL", "")
job = os.path.basename(os.path.dirname(newest))
rows = 0
for key, label in (("model", "whisper model"), ("device", "whisper device"),
                   ("computeType", "whisper compute type"), ("ollamaModel", "clip AI model")):
    want = str(settings.get(key) or "").strip()
    box = str(plan.get(key) or "").strip()
    # A payload that names nothing is the self-hosted engine or an older
    # record, not a disagreement. Silence there, rather than a false alarm.
    if not want:
        continue
    rows += 1
    verdict = "MATCH" if want == box else "DIFFER"
    print("\t".join((verdict, label, want, box or "(this container decided nothing)", job)))
# Say so explicitly: printing nothing here would reach the shell as an empty
# answer and be reported as "could not be read", which is a different fault and
# would send someone looking at the mount rather than at the payload.
if not rows:
    print("SILENT\t" + job)
PY
)
if [ -z "$asked" ]; then
  echo "newest job: could not be read out of $CONTAINER (is WORKER_DATA_DIR mounted, and does it have python3?)"
elif [ "${asked%%$'\t'*}" = "SILENT" ]; then
  echo "newest job (${asked#*$'\t'}): names no model settings — nothing to disagree about"
elif [ "$asked" = "NONE" ]; then
  echo "newest job: none on this box yet — nothing has asked this worker for a model"
else
  while IFS=$'\t' read -r verdict label want box job; do
    [ -z "$verdict" ] && continue
    if [ "$verdict" = "MATCH" ]; then
      ok "newest job ($job): $label $want"
    else
      warn "newest job ($job): $label" "asked $want — this container decided $box"
    fi
  done <<EOF
$asked
EOF
fi

echo

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
# Printed after either verdict, and only when there is one to explain: a green
# tick beside a job that ran on a model this box did not choose is exactly the
# disagreement a deploy log has hidden before.
if [ "$warns" -gt 0 ]; then
  echo
  echo "$warns '!!' line(s) above: the newest job asked for something this box did not"
  echo "decide. That is a finding, not a failure -- the box is authoritative, so read it."
fi
exit "$fails"
