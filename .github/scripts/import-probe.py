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

# HOW MANY ATTEMPTS TO REFUSE BEFORE LETTING THE REAL DOWNLOAD THROUGH.
#
# The retry rounds were written for a refusal that clears on a second ask, and
# they have never run on this box -- there was no 403 left to rescue by the
# time they shipped, so every claim about them rests on a test with a fake
# yt_dlp. That is the weakest kind of proof for the one path a customer meets
# at two in the morning, and waiting for YouTube to refuse again is not a plan.
#
# So the refusal is INJECTED, here in the probe and nowhere near production
# code: the real provider runs, builds its real options, picks a real proxy,
# and its first N attempts are made to fail with a 403-shaped message. Anything
# past N downloads for real. What that exercises is the whole rounds loop as
# it ships -- _looks_blocked, the plan and client rotation, the backoff, and
# the recovery -- against the box's own network.
#
# A round is len(YOUTUBE_CLIENTS) x len(plans) attempts, so a value at or above
# that forces a SECOND round and makes the real backoff run. That is the part
# worth proving: a rescue inside one rotation costs nothing and proves little.
BLOCK_FIRST = int(PARAMS.get("blockFirst") or 0)


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
    import json
    data = Path(os.getenv("WORKER_DATA_DIR", "/var/lib/deenclipped"))
    best: tuple[float, str] = (0.0, "")
    seen = failed = with_url = 0
    for status_path in sorted((data / "jobs").glob("*/status.json"),
                              key=lambda item: -item.stat().st_mtime):
        seen += 1
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
            payload = json.loads((status_path.parent / "payload.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        # A YouTube link ANYWHERE in the payload. service.py rewrites job["url"]
        # to a local path once the download lands, so the key that holds the
        # original differs by how far the job got -- and the failed job, which
        # is the one being looked for, never got that far. Searching the whole
        # record is what stops this depending on which stage it died in.
        url = ""
        for key in ("url", "sourceUrl", "youtubeUrl"):
            value = str(payload.get(key) or "")
            if "youtu" in value and value.startswith("http"):
                url = value
                break
        if not url:
            for value in re.findall(r"https?://[^\s\"']+", json.dumps(payload)):
                if "youtu" in value:
                    url = value
                    break
        state = str(status.get("status") or "")
        if state == "failed":
            failed += 1
        if url:
            with_url += 1
        # A FAILED job first, because that is the one worth retrying -- but any
        # job with a link is better than nothing: "can this box fetch YouTube
        # at all" is still the question underneath.
        weight = status_path.stat().st_mtime + (10 ** 9 if state == "failed" else 0)
        if url and weight > best[0]:
            best = (weight, url)
    out(f"  records        {seen} job(s) on the box, {failed} failed, {with_url} with a link")
    return best[1]


class Refusals:
    """Makes the provider's first N attempts fail the way a block does.

    The real yt_dlp.YoutubeDL is still constructed -- with the real options,
    the real proxy and the real cookies -- and only extract_info is replaced,
    so the failure lands exactly where a genuine 403 lands and the rounds loop
    takes exactly the branch it would take. Refusing at CONSTRUCTION would have
    been simpler and would have skipped the options being built at all, which
    is half of what is being tested.

    It also records when each attempt happened and which exit it was given, so
    the report can say whether the backoff really ran and whether the pool
    really rotated. Both are claims the tests make against a fake; neither had
    ever been watched on the box.
    """

    def __init__(self, ytdlp, refuse_first: int) -> None:
        self.ytdlp = ytdlp
        self.refuse_first = refuse_first
        self.real = ytdlp.YoutubeDL
        self.refused = 0
        self.attempts: list[tuple[float, str]] = []

    def __enter__(self) -> "Refusals":
        probe = self

        def build(options=None, *args, **kwargs):
            instance = probe.real(options, *args, **kwargs)
            proxy = str((options or {}).get("proxy") or "")
            probe.attempts.append((time.time(), proxy))
            if probe.refused < probe.refuse_first:
                probe.refused += 1

                def refuse(*_a, **_k):
                    # 403 because that is the refusal being chased, and because
                    # _looks_blocked must recognise it -- a message it does not
                    # recognise takes the "gone for ever" branch and the rounds
                    # never run, which would prove the opposite of the point.
                    raise probe.ytdlp.utils.DownloadError(
                        "ERROR: [youtube] probe: HTTP Error 403: Forbidden"
                        " (refusal injected by import-probe)")

                instance.extract_info = refuse
            return instance

        self.ytdlp.YoutubeDL = build
        return self

    def __exit__(self, *_exc) -> None:
        self.ytdlp.YoutubeDL = self.real

    def longest_gap(self) -> float:
        times = [when for when, _ in self.attempts]
        return max((b - a for a, b in zip(times, times[1:])), default=0.0)

    def distinct_exits(self) -> int:
        return len({proxy for _, proxy in self.attempts if proxy})


def fetch(canonical: str, refuse_first: int = 0):
    """One run of the REAL provider. Returns (imported, seconds, note, spy)."""
    destination = Path("/tmp") / f"dc-import-probe-{os.getpid()}.mp4"
    spy = None
    started = time.time()
    try:
        import yt_dlp
        holder = Refusals(yt_dlp, refuse_first)
        with holder as spy:
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
        size = destination.stat().st_size if destination.is_file() else 0
        return True, time.time() - started, (result, size), spy
    except ip.ImportProviderError as exc:
        return False, time.time() - started, scrub(exc)[:700], spy
    finally:
        for leftover in Path("/tmp").glob(f"dc-import-probe-{os.getpid()}*"):
            leftover.unlink(missing_ok=True)


def main() -> int:
    url = URL
    if url == "last-failed":
        url = last_failed_url()
        if not url:
            out("  no job on this box carries a YouTube link to retry")
            out("  (records age out; dispatch probe_url with the link itself)")
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
    # The box's own default. A real import also carries the cookies pasted at
    # /admin/import-network, which this probe has no way to read -- so `no`
    # here does not mean the product is importing without cookies.
    out(f"  cookies (box)  {'yes' if options.get('cookiefile') else 'no'}"
        + " -- a real job also carries /admin/import-network's")
    out(f"  PO token       {'yes' if options.get('extractor_args') else 'no'}")
    try:
        import yt_dlp
        out(f"  yt-dlp         {yt_dlp.version.__version__}")
    except Exception:  # noqa: BLE001
        pass
    out(f"  rounds         {ip.IMPORT_ROUNDS} (backoff {ip.IMPORT_BACKOFF_SEC})")
    out()

    per_round = len(ip.YOUTUBE_CLIENTS) * 2  # two plans: the section, then the full
    if BLOCK_FIRST:
        out(f"  injecting      the first {BLOCK_FIRST} attempt(s) refused with a 403"
            f" ({per_round} attempts a round, so"
            f" {'a SECOND round and a real backoff' if BLOCK_FIRST >= per_round else 'the same round'})")
    out()

    # THE CONTROL COMES FIRST, and it is what makes the injected run readable.
    # Without it a failure afterwards is ambiguous: the rounds may have broken,
    # or YouTube may simply be refusing this video this minute -- and the whole
    # reason this probe exists is that the second answer changes between one
    # ask and the next. Proving the video is fetchable NOW is what turns the
    # injected run into a statement about the code.
    ok, seconds, detail, _ = fetch(canonical)
    label = "control" if BLOCK_FIRST else "fetch"
    if not ok:
        out(f"  {label}: FAILED after {seconds:.1f}s")
        out(f"  {detail}")
        # A refusal is the ANSWER to the question asked, not a broken probe.
        # Failing the run here would make "this video is genuinely blocked"
        # indistinguishable from "the box could not be reached".
        if BLOCK_FIRST:
            out()
            out("  the rounds were NOT exercised: the video refused on its own,")
            out("  so an injected refusal afterwards would prove nothing either way.")
        return 0

    result, size = detail
    out(f"  {label}: IMPORTED in {seconds:.1f}s")
    out(f"  title          {scrub(result.title)[:120]}")
    out(f"  bytes          {size:,}")
    out(f"  windowed       {result.windowed}")
    out(f"  source length  {result.source_duration_sec}")
    if not BLOCK_FIRST:
        return 0

    out()
    out("== does the retry rescue a refusal ==")
    ok, seconds, detail, spy = fetch(canonical, refuse_first=BLOCK_FIRST)
    attempts = len(spy.attempts) if spy else 0
    refused = spy.refused if spy else 0
    gap = spy.longest_gap() if spy else 0.0
    exits = spy.distinct_exits() if spy else 0
    out(f"  attempts       {attempts} ({refused} refused, then the real download)")
    out(f"  longest pause  {gap:.1f}s between attempts"
        + (" -- the backoff ran" if gap >= 5 else ""))
    out(f"  exits used     {exits} distinct proxy address(es) across the attempts")
    if not ok:
        out(f"  NOT RESCUED after {seconds:.1f}s")
        out(f"  {detail}")
        # THE ONE CASE THAT FAILS THE RUN. The control just proved this video
        # is fetchable from this box right now, so a refusal the rounds could
        # not recover from is the rounds being broken -- which is a regression
        # in the thing this workflow exists to protect, not an answer about a
        # video.
        out("::error::the retry rounds did not rescue an injected 403"
            " that the control proved was recoverable")
        return 1

    result, size = detail
    out(f"  RESCUED in {seconds:.1f}s -- {size:,} bytes after {refused} refusal(s)")
    out(f"  title          {scrub(result.title)[:120]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
