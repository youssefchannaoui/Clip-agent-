#!/usr/bin/env python3
"""Ask the box what happened to its recent jobs -- counts, never content.

A failed import says one sentence ("No complete clip candidates fit the
selected duration range") and the evidence behind it lives ONLY on the box:
the job's payload and status under WORKER_DATA_DIR/jobs, and the transcript
the run wrote to the cache a moment before it gave up. The job's own working
directory is removed on failure and the service does not echo the child's
progress events, so `docker logs` cannot answer the question either.

WHERE THIS RUNS. Inside the worker container on the Hetzner box, launched by
deploy-worker.yml with `diagnose: true` -- which SKIPS the deploy, so asking a
question never restarts a worker mid-job. It imports the container's own
clip_worker and replays the candidate pipeline over the cached transcript at
the job's real settings, so the numbers below are the numbers the run saw.

WHAT NEVER LEAVES THE BOX. Not one word of any transcript: only counts,
timings and lengths are printed. Job errors are already scrubbed by the
worker's clean_error and are redacted again here for anything shaped like a
credential. `PARAMS` is substituted on the runner as a JSON literal rather
than interpolated into a shell command, so a dispatch input can never become
a command on the box.
"""

from __future__ import annotations

import json
import os
import re
import statistics
import sys
import time
from pathlib import Path

# Replaced on the runner with the dispatch inputs, as a JSON object literal.
PARAMS = {}

HOURS = float(PARAMS.get("hours") or 12)
JOBS = int(PARAMS.get("jobs") or 4)
DATA = Path(os.getenv("WORKER_DATA_DIR", "/var/lib/deenclipped")).resolve()
# The container keeps the code under /app/worker; a local dry run points this
# at a checkout instead.
CODE = Path(os.getenv("DC_WORKER_CODE", "/app/worker")).resolve()
SETTING_KEYS = (
    "clipMinSeconds", "clipMaxSeconds", "clipLengthBands", "clipsPerVideo",
    "language", "task", "translateCaptions", "model", "device", "computeType",
)
TEMPLATE_KEYS = ("id", "name", "captionMode")
# Userinfo in a URL, and anything that names itself a credential.
_USERINFO = re.compile(r"://[^@/\s]+@")
_CREDENTIAL = re.compile(r"(?i)(secret|token|signature|password|key)=[^&\s]+")


def out(line: str = "") -> None:
    print(line, flush=True)


def redact(text: str) -> str:
    return _CREDENTIAL.sub(r"\1=***", _USERINFO.sub("://***@", str(text or "")))


def age(mtime: float) -> str:
    seconds = max(0, int(time.time() - mtime))
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}m"
    return f"{seconds // 86400}d"


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def recent_jobs() -> list[tuple[float, Path, dict]]:
    rows = []
    for status_path in (DATA / "jobs").glob("*/status.json"):
        status = read_json(status_path)
        if not isinstance(status, dict):
            continue
        rows.append((status_path.stat().st_mtime, status_path.parent, status))
    rows.sort(key=lambda row: -row[0])
    return rows[:JOBS]


def describe_job(mtime: float, folder: Path, status: dict) -> dict:
    payload = read_json(folder / "payload.json")
    payload = payload if isinstance(payload, dict) else {}
    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    template = payload.get("template") if isinstance(payload.get("template"), dict) else {}
    out(f"job {folder.name}  updated {age(mtime)} ago")
    out(f"  status={status.get('status')!r} stage={status.get('stage')!r} progress={status.get('progress')}")
    error = str(status.get("error") or "")
    if error:
        out("  error: " + redact(error)[:400])
    out("  title: " + redact(str(payload.get("title") or ""))[:120])
    out(f"  mode={payload.get('mode') or 'clips'} window={payload.get('sourceStartSec')}..{payload.get('sourceEndSec')}")
    out("  settings: " + json.dumps({k: settings.get(k) for k in SETTING_KEYS if k in settings}, ensure_ascii=False))
    out("  template: " + json.dumps({k: template.get(k) for k in TEMPLATE_KEYS if k in template}, ensure_ascii=False))
    return {"settings": settings, "template": template, "status": status}


def recent_transcripts() -> list[Path]:
    folder = DATA / "cache" / "transcripts"
    if not folder.is_dir():
        return []
    cutoff = time.time() - HOURS * 3600
    files = [p for p in folder.glob("*.json") if not p.name.startswith(".") and p.stat().st_mtime >= cutoff]
    return sorted(files, key=lambda p: -p.stat().st_mtime)


def window_counts(starts: list[float], ends: list[float], minimum: float, maximum: float) -> tuple[int, int]:
    """How many segment windows exist at all, and how many reach the range --
    the shape build_candidates walks, without its boundary rules."""
    tried = inside = 0
    for i in range(len(starts)):
        for j in range(i, len(ends)):
            duration = ends[j] - starts[i]
            if duration > maximum + 1.5:
                break
            tried += 1
            if duration >= minimum:
                inside += 1
    return tried, inside


def analyse(path: Path, cw, replays: list[tuple[str, dict]]) -> None:
    out(f"transcript {path.name[:48]}...  written {age(path.stat().st_mtime)} ago  {path.stat().st_size} bytes")
    segments = read_json(path)
    if not isinstance(segments, list) or not segments:
        out("  not a segment list, or empty")
        return
    starts = [float(s.get("start") or 0) for s in segments]
    ends = [float(s.get("end") or 0) for s in segments]
    durations = [e - s for s, e in zip(starts, ends)]
    gaps = [starts[i + 1] - ends[i] for i in range(len(segments) - 1)]
    words = sum(len(s.get("words") or []) for s in segments)
    arabic = sum(1 for s in segments if cw.contains_arabic(s.get("text")))
    bounded = sum(1 for s in segments if cw.punctuation_boundary(str(s.get("text") or "")))
    english = sum(1 for s in segments if s.get("english"))
    chars = [len(str(s.get("text") or "")) for s in segments]
    count = len(segments)
    out(f"  segments={count} span={starts[0]:.1f}..{ends[-1]:.1f}s speech={sum(durations):.1f}s words-with-times={words}")
    out(f"  segment seconds min/median/max={min(durations):.1f}/{statistics.median(durations):.1f}/{max(durations):.1f}"
        f"  largest gap={max(gaps) if gaps else 0:.1f}s  gaps over 5s={sum(1 for g in gaps if g > 5)}")
    out(f"  arabic={arabic}/{count} punctuation-ending={bounded}/{count} english-lines={english}/{count}"
        f" chars/segment median={statistics.median(chars):.0f}")
    for label, rows in (("first", segments[:4]), ("last", segments[-4:])):
        out("  " + label + ": " + ", ".join(
            f"[{float(s.get('start') or 0):.1f}-{float(s.get('end') or 0):.1f}s {len(str(s.get('text') or ''))}ch {len(s.get('words') or [])}w]"
            for s in rows))
    for tag, settings in replays:
        minimum = float(settings.get("clipMinSeconds", 20) or 20)
        maximum = max(minimum, float(settings.get("clipMaxSeconds", 90) or 90))
        try:
            candidates = cw.build_candidates(segments, minimum, maximum)
            banded = cw.filter_length_bands(candidates, settings)
            picked = cw.select_candidates(banded, int(settings.get("clipsPerVideo", 8) or 8))
            tried, inside = window_counts(starts, ends, minimum, maximum)
            out(f"  replay[{tag}] range {minimum:.0f}-{maximum:.0f}s bands={settings.get('clipLengthBands')}:"
                f" windows tried={tried} in range={inside} candidates={len(candidates)} banded={len(banded)} selected={len(picked)}")
            if picked:
                out("    top: " + ", ".join(f"{c.start:.1f}-{c.end:.1f}s ({c.duration:.0f}s, score {c.score})" for c in picked[:5]))
        except Exception as exc:  # noqa: BLE001
            out(f"  replay[{tag}] failed: {type(exc).__name__}: {redact(str(exc))[:200]}")
    try:
        corpus = cw.quran.load() if getattr(cw, "quran", None) else None
        if corpus is None:
            out("  ayah walk: corpus not loaded")
        else:
            ayat = cw.lecture_ayat(segments, corpus)
            out(f"  ayah walk: {len(ayat)} verses"
                + (f", from {float(ayat[0]['start']):.1f}s to {float(ayat[-1]['end']):.1f}s" if ayat else ""))
    except Exception as exc:  # noqa: BLE001
        out(f"  ayah walk failed: {type(exc).__name__}: {redact(str(exc))[:200]}")


def main() -> int:
    out(f"python {sys.version.split()[0]}  data={DATA} ({'present' if DATA.is_dir() else 'MISSING'})  code={CODE}")
    version_file = CODE.parent / "package.json"
    version = read_json(version_file) if version_file.is_file() else None
    out(f"worker version: {version.get('version') if isinstance(version, dict) else 'unknown'}")
    sys.path.insert(0, str(CODE))
    try:
        import clip_worker as cw  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        out(f"::error::clip_worker could not be imported from {CODE}: {type(exc).__name__}: {redact(str(exc))[:200]}")
        return 1

    out()
    out(f"== newest {JOBS} jobs ==")
    jobs = recent_jobs()
    if not jobs:
        out("  none under " + str(DATA / "jobs"))
    described = [describe_job(*row) for row in jobs]

    # The newest job's own settings, then the defaults the worker would use
    # with none -- so a run that never sent a range is still replayed.
    replays: list[tuple[str, dict]] = []
    for item in described:
        if item["settings"]:
            replays.append(("newest job's settings", item["settings"]))
            break
    replays.append(("worker defaults", {"clipMinSeconds": 20, "clipMaxSeconds": 90, "clipsPerVideo": 8}))

    out()
    out(f"== transcripts cached in the last {HOURS:g}h ==")
    transcripts = recent_transcripts()
    if not transcripts:
        out("  none under " + str(DATA / "cache" / "transcripts"))
    for path in transcripts[:6]:
        analyse(path, cw, replays)
    return 0


if __name__ == "__main__":
    sys.exit(main())
