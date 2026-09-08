#!/usr/bin/env python3
"""Can this box fetch THIS video, right now? Asked of the real downloader.

An import that fails says one sentence, and until now nobody could ask the box
to try the same URL again without a customer submitting a whole job. Youssef,
9 Sept 2026, on a lecture that failed and then imported when he retried it by
hand: "I NEED TO RETRY THEN THE LECTURE WORKS." That makes the refusal
transient, and a transient refusal is exactly the thing you cannot reason about
from a log -- you have to go and ask again.

WHAT IT RUNS. YtDlpImportProvider.import_video, the production downloader, with
the box's own proxy pool, cookies and PO-token server. Not a reimplementation:
a probe that builds its own options proves nothing about the code that runs for
customers, and this file's whole value is that the two cannot differ.

WHAT IT COSTS. A few seconds of video, not the lecture. The 403 that started
this lands on the MEDIA fetch rather than on extraction, so extraction alone
would report success on the exact failure being chased -- but a full download
is ~1.5GB off a 250GB monthly plan for a question. A short window exercises
both halves for a few megabytes, and the file is deleted either way.

WHAT NEVER LEAVES THE BOX. The URL is echoed back (it is a public YouTube link
somebody pasted) and so are the title, the byte count and the timings. Proxy
credentials are scrubbed from every line printed; the pool is reported by SIZE.
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, os.getenv("DC_WORKER_CODE", "/app/worker"))

import import_providers as ip  # noqa: E402


PARAMS = {}

URL = str(PARAMS.get("url") or "").strip()
WINDOW = float(PARAMS.get("window") or 8)


def out(line: str = "") -> None:
    print(line, flush=True)


def scrub(text: str) -> str:
    return re.sub(r"://[^@/\s]+@", "://***@", str(text or ""))


def last_failed_url() -> str:
    """The URL of the newest failed import on this box.

    So the video that actually broke can be retried without anybody having to
    find the link -- which matters because the person who has it is usually the
    person asleep, and a probe you can only run with information you do not
    have is a probe nobody runs.
    """
    data = Path(os.getenv("WORKER_DATA_DIR", "/var/lib/deenclipped"))
    best: tuple[float, str] = (0.0, "")
    for status_path in (data / "jobs").glob("*/status.json"):
        try:
            import json
            status = json.loads(status_path.read_text(encoding="utf-8"))
            if str(status.get("status") or "") != "failed":
                continue
            payload = json.loads((status_path.parent / "payload.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        url = str(payload.get("url") or "")
        if not url.startswith("http"):
            continue
        stamp = status_path.stat().st_mtime
        if stamp > best[0]:
            best = (stamp, url)
    return best[1]


def main() -> int:
    url = URL
    if url == "last-failed":
        url = last_failed_url()
        if not url:
            out("no failed import on this box to retry")
            return 0
        out(f"(retrying the newest failed import, {time.strftime('%H:%M', time.localtime())})")
    if not url:
        out("no url given")
        return 0

    out("== can this box fetch this video ==")
    try:
        canonical = ip.validate_youtube_url(url)
    except ip.ImportProviderError as exc:
        out(f"  refused before any request: {exc}")
        return 1
    out(f"  url            {canonical}")
    out(f"  window         first {WINDOW:.0f}s only (a few MB, not the lecture)")

    pool = ip.proxy_pool()
    options = ip.youtube_network_options()
    out(f"  proxy pool     {len(pool)} address(es)")
    out(f"  cookies        {'yes' if options.get('cookiefile') else 'no'}")
    out(f"  PO token       {'yes' if options.get('extractor_args') else 'no'}")
    try:
        import yt_dlp
        out(f"  yt-dlp         {yt_dlp.version.__version__}")
    except Exception:  # noqa: BLE001
        pass
    out(f"  rounds         {ip.IMPORT_ROUNDS} (backoff {ip.IMPORT_BACKOFF_SEC})")
    out()

    destination = Path("/tmp") / f"dc-import-probe-{os.getpid()}.mp4"
    started = time.time()
    try:
        # The REAL provider. Its own rounds, its own backoff, its own rotation.
        result = ip.YtDlpImportProvider().import_video(
            {
                "type": "youtube",
                "url": canonical,
                "windowStartSec": 0,
                "windowEndSec": WINDOW,
            },
            destination,
            lambda *a, **k: False,
        )
    except ip.ImportProviderError as exc:
        out(f"  FAILED after {time.time() - started:.1f}s")
        out(f"  {scrub(exc)[:700]}")
        # A refusal is the ANSWER to the question asked, not a broken probe.
        # Failing the run here would make "this video is genuinely blocked"
        # indistinguishable from "the box could not be reached".
        return 0
    finally:
        size = destination.stat().st_size if destination.is_file() else 0
        destination.unlink(missing_ok=True)
        for leftover in Path("/tmp").glob(f"dc-import-probe-{os.getpid()}*"):
            leftover.unlink(missing_ok=True)

    out(f"  IMPORTED in {time.time() - started:.1f}s")
    out(f"  title          {scrub(result.title)[:120]}")
    out(f"  bytes          {size:,}")
    out(f"  windowed       {result.windowed}")
    out(f"  source length  {result.source_duration_sec}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
