#!/usr/bin/env bash
# The box watches what the app cannot: the public site from outside, its own
# disk, and the worker container. Runs from cron every 5 minutes.
#
# Alert-on-transition only: a state file per check remembers whether it was
# already failing, so a weekend outage is one alert and one recovery, not 576
# pings. The channel is the same ntfy topic the app uses (ALERT_NTFY_TOPIC in
# worker/.env), so everything arrives in one place.
set -u
ENV_FILE="/opt/deenclipped/worker/.env"
STATE_DIR="/var/lib/deenclipped-monitor"
mkdir -p "$STATE_DIR"

TOPIC=$(grep -E "^ALERT_NTFY_TOPIC=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
[ -z "$TOPIC" ] && exit 0

send() { # send <title> <body>
  curl -fsS -m 10 -H "Title: $1" -H "Priority: high" -H "Tags: rotating_light" \
    -d "$2" "https://ntfy.sh/$TOPIC" >/dev/null 2>&1 || true
}

check() { # check <name> <failing:0|1> <fail-body> <ok-body>
  local name="$1" failing="$2" fail_body="$3" ok_body="$4"
  local flag="$STATE_DIR/$name.failing"
  if [ "$failing" = "1" ]; then
    if [ ! -f "$flag" ]; then
      date +%s > "$flag"
      send "DeenClipped problem: $name" "$fail_body"
    fi
  else
    if [ -f "$flag" ]; then
      local since mins
      since=$(cat "$flag" 2>/dev/null || echo 0)
      mins=$(( ( $(date +%s) - since ) / 60 ))
      rm -f "$flag"
      send "DeenClipped recovered: $name" "$ok_body (was failing for ${mins}m)"
    fi
  fi
}

# 1. The public site, from outside its own datacenter.
site_fail=0
curl -fsS -m 20 https://deenclipped.online/healthz >/dev/null 2>&1 || {
  sleep 5
  curl -fsS -m 20 https://deenclipped.online/healthz >/dev/null 2>&1 || site_fail=1
}
check "site" "$site_fail" \
  "deenclipped.online is not answering its health check from the worker box." \
  "deenclipped.online is answering again"

# 2. This box's disk. 85% is the alarm line: the build cache once took it to
#    69% and read exactly like a box running out of room for customer data.
disk_pct=$(df / | awk 'NR==2 {gsub("%",""); print $5}')
disk_fail=0; [ "${disk_pct:-0}" -ge 85 ] && disk_fail=1
check "disk" "$disk_fail" \
  "The worker box disk is at ${disk_pct}%. Run: docker builder prune -f, then df -h /" \
  "The worker box disk is back to ${disk_pct}%"

# 3. The worker container itself.
worker_state=$(docker inspect -f '{{.State.Health.Status}}' worker-deenclipped-worker-1 2>/dev/null || echo missing)
worker_fail=0; [ "$worker_state" != "healthy" ] && worker_fail=1
check "worker-container" "$worker_fail" \
  "The worker container is '$worker_state'. Jobs cannot process. On the box: docker compose -f /opt/deenclipped/worker/docker-compose.yml up -d" \
  "The worker container is healthy again"
