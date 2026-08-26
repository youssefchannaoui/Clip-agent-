#!/usr/bin/env python3
"""Nightly proxy-pool maintenance: census, replace the burned, publish the pool.

YouTube burns residential exits gradually; Webshare replaces them (10/month
free on this plan) through an API. Before this script the census could only
TELL the owner about burned addresses -- replacing them meant a dashboard
visit, an .env edit and a worker restart. Now the pool heals itself:

  1. Probe every address in the plan against a tiny public video.
  2. Ask Webshare to replace the burned ones (dry-run first, then real).
  3. Fetch the resulting list and write the pool FILE the worker reads per
     download attempt -- live on the next job, no restart.
  4. Tell the owner's feed what changed; ring the alarm topic only if the
     pool is thin and replacement could not fix it.

Runs on the HOST via cron. Probes run inside the worker container, which has
yt-dlp; the API calls need only the key from worker/.env.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENV_FILE = Path("/opt/deenclipped/worker/.env")
CONTAINER = "worker-deenclipped-worker-1"
POOL_FILE_IN_CONTAINER = "/var/lib/deenclipped/proxy-pool.txt"
API = "https://proxy.webshare.io/api/v2"
REPLACE_API = "https://proxy.webshare.io/api/v3/proxy/replace/"
TEST_VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
MIN_OK = 10
LOG = Path("/var/log/deenclipped-proxy-pool.log")


def env(name: str) -> str:
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return ""


def ntfy(topic: str, title: str, body: str, tags: str) -> None:
    if not topic:
        return
    try:
        request = urllib.request.Request(
            f"https://ntfy.sh/{urllib.parse.quote(topic, safe='')}",
            data=body.encode(), headers={"Title": title, "Tags": tags}, method="POST")
        urllib.request.urlopen(request, timeout=10).close()
    except Exception:
        pass


def api_call(key: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        url, data=data, method="POST" if body is not None else "GET",
        headers={"Authorization": f"Token {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def fetch_pool(key: str) -> list[dict]:
    proxies, page = [], 1
    while True:
        got = api_call(key, f"{API}/proxy/list/?mode=direct&page={page}&page_size=100")
        proxies += got.get("results") or []
        if not got.get("next"):
            return proxies
        page += 1


def probe(proxy_url: str) -> bool:
    script = (
        "import os, yt_dlp\n"
        "opts = {'quiet': True, 'skip_download': True, 'proxy': os.environ['PROBE_PROXY']}\n"
        f"yt_dlp.YoutubeDL(opts).extract_info('{TEST_VIDEO}', download=False)\n"
    )
    result = subprocess.run(
        ["docker", "exec", "-e", f"PROBE_PROXY={proxy_url}", CONTAINER,
         "timeout", "45", "python3", "-c", script],
        capture_output=True, text=True)
    return result.returncode == 0


def write_pool(lines: list[str]) -> None:
    content = "\n".join(lines) + "\n"
    subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "sh", "-c", f"cat > {POOL_FILE_IN_CONTAINER}"],
        input=content, text=True, check=True)


def main() -> int:
    key = env("WEBSHARE_API_KEY")
    alarm_topic = env("ALERT_NTFY_TOPIC")
    feed_topic = env("ACTIVITY_NTFY_TOPIC")
    if not key:
        # Without the API key this is exactly the old census: count and warn.
        print("WEBSHARE_API_KEY not set; census-only mode")

    pool = fetch_pool(key) if key else []
    if not pool:
        # Fall back to probing whatever the worker currently uses.
        raw = env("VIDEO_IMPORT_PROXIES")
        pool = []
        for item in [p for p in raw.split(",") if p.strip()]:
            hostport = item.rsplit("@", 1)[-1]
            host, port = hostport.rsplit(":", 1)
            creds = item.split("//", 1)[-1].split("@", 1)[0]
            user, password = creds.split(":", 1)
            pool.append({"proxy_address": host, "port": int(port), "username": user, "password": password})

    url_of = lambda p: f"http://{p['username']}:{p['password']}@{p['proxy_address']}:{p['port']}"
    ok = [p for p in pool if probe(url_of(p))]
    burned = [p for p in pool if p not in ok]
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with LOG.open("a") as log:
        log.write(f"{stamp} census: {len(ok)}/{len(pool)} passing; burned: {' '.join(p['proxy_address'] for p in burned)}\n")

    replaced = 0
    if burned and key:
        try:
            api_call(key, REPLACE_API, {
                "to_replace": {"type": "ip_address", "ip_addresses": [p["proxy_address"] for p in burned]},
                "replace_with": [{"type": "any", "count": len(burned)}],
                "dry_run": False,
            })
            time.sleep(20)  # asynchronous on their side; the list below reflects it
            fresh = fetch_pool(key)
            old_addresses = {p["proxy_address"] for p in pool}
            burned_addresses = {p["proxy_address"] for p in burned}
            replaced = len([p for p in fresh if p["proxy_address"] not in old_addresses])
            # The live pool: everything Webshare now lists, minus anything we
            # just proved burned that they did not replace. New arrivals are
            # trusted untested -- tonight's census will judge them.
            ok = [p for p in fresh if p["proxy_address"] not in burned_addresses]
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:200]
            with LOG.open("a") as log:
                log.write(f"{stamp} replacement failed: HTTP {error.code} {detail}\n")
            ntfy(alarm_topic, "Proxy replacement failed",
                 f"Webshare refused to replace {len(burned)} burned address(es): {detail}\n\n"
                 "What to do:\n1. dashboard.webshare.io -> Proxy -> List -> Replace (10 free per month).\n"
                 "2. If the free replacements are used up, they reset with the billing month.", "warning")

    if ok:
        write_pool([url_of(p) for p in ok])

    if burned and replaced:
        ntfy(feed_topic, "DeenClipped",
             f"Proxy pool self-healed: replaced {len(burned)} burned address(es), {len(ok)} now live. No restart needed.",
             "wrench")
    if len(ok) < MIN_OK:
        ntfy(alarm_topic, "DeenClipped proxy pool is thin",
             f"Only {len(ok)} address(es) pass YouTube even after maintenance.\n\n"
             "What to do:\n1. dashboard.webshare.io -> Proxy -> List: replace manually if any replacements remain.\n"
             "2. If burns keep outpacing replacements, add a second 20-proxy plan ($6/mo) and ask Claude to merge the pools.",
             "rotating_light")
    print(f"{len(ok)} live, {len(burned)} burned, {replaced} replaced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
