#!/usr/bin/env bash
# Wait for the worker's slot to empty before the container is recreated.
#
#   bash worker/drain.sh                        # up to DEPLOY_DRAIN_MINUTES (default 20)
#   DEPLOY_DRAIN_MINUTES=0 bash worker/drain.sh # do not wait (an emergency fix)
#
# `docker compose up --build` recreates the container, and a container being
# recreated takes whatever it was doing with it. On 5 Sept 2026 two deploys
# four minutes apart sent a customer's khutbah render back to its start
# twice. The worker RESUMES an interrupted job now (service.py: shutdown(),
# recover(), the plan checkpoint), but a resume still re-imports and
# re-renders whatever was mid-flight, so a deploy waits for the running jobs
# to finish first. QUEUED jobs are not waited for: they have not started and
# lose nothing by starting under the new image.
#
# It reads the job records straight out of the RUNNING container with the
# python it already has -- no HTTP, no shared secret, and nothing the NEW
# image has to contain, because the old container is the one answering. A
# container that is not running has nothing in flight.
#
# On timeout it warns and returns 0: a job that never finishes must not hold
# a deploy hostage, and the resume machinery is what covers that case.
set -u
CONTAINER="${CONTAINER:-worker-deenclipped-worker-1}"
MINUTES="${DEPLOY_DRAIN_MINUTES:-20}"
case "$MINUTES" in ''|*[!0-9]*) MINUTES=20 ;; esac

in_flight() {
  docker exec -i "$CONTAINER" python3 - <<'PY' 2>/dev/null
import glob, json, os
root = os.environ.get("WORKER_DATA_DIR", "/var/lib/deenclipped")
# queued: not started, nothing to lose. interrupted: already waiting for the
# next boot. The rest is a job with a slot, a working directory and minutes
# of work behind it.
idle = {"queued", "completed", "failed", "cancelled", "interrupted"}
rows = []
for path in glob.glob(os.path.join(root, "jobs", "*", "status.json")):
    try:
        with open(path, encoding="utf-8") as handle:
            status = json.load(handle)
    except (OSError, ValueError):
        continue
    if str(status.get("status") or "") not in idle:
        rows.append(f"{status.get('id')}: {status.get('stage')} {status.get('progress')}%")
print(len(rows))
for row in rows:
    print("  " + row)
PY
}

if [ "$MINUTES" = "0" ]; then
  echo "drain: skipped (DEPLOY_DRAIN_MINUTES=0)"
  exit 0
fi
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "drain: $CONTAINER is not running, nothing in flight"
  exit 0
fi
deadline=$(( $(date +%s) + MINUTES * 60 ))
while :; do
  report="$(in_flight || echo 0)"
  count="$(printf '%s\n' "$report" | head -n1)"
  case "$count" in ''|*[!0-9]*) count=0 ;; esac
  if [ "$count" = "0" ]; then
    echo "drain: no job in flight"
    exit 0
  fi
  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    echo "drain: WARNING -- $count job(s) still running after $MINUTES minute(s); deploying anyway, they will resume"
    printf '%s\n' "$report" | tail -n +2
    exit 0
  fi
  echo "drain: $count job(s) in flight, $(( (deadline - now) / 60 ))m left"
  printf '%s\n' "$report" | tail -n +2
  sleep 20
done
