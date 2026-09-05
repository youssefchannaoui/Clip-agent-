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
# Seconds of the newest cached SOURCE to run Whisper over, in the variants
# below; 0 skips it. It loads the model on the box, so only ask when the box
# is idle -- the workflow input says so.
AUDIO = float(PARAMS.get("audio") or 0)
# Which cached source: the one whose length is nearest this many seconds, or
# the newest when 0.
DURATION_HINT = float(PARAMS.get("duration") or 0)
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


def run(args: list[str], timeout: float = 600) -> tuple[int, str, str]:
    import subprocess  # noqa: PLC0415
    done = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    return done.returncode, done.stdout, done.stderr


def probe_source(path: Path) -> dict:
    """Length and audio shape of a cached download, from ffprobe."""
    code, stdout, _ = run(["ffprobe", "-v", "error", "-show_entries",
                           "format=duration:stream=codec_type,codec_name,sample_rate,channels",
                           "-of", "json", str(path)], timeout=60)
    info = read_json_text(stdout) if code == 0 else None
    duration = float((info or {}).get("format", {}).get("duration") or 0)
    audio = [s for s in (info or {}).get("streams", []) if s.get("codec_type") == "audio"]
    return {"duration": duration, "audio": audio}


def read_json_text(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return None


def probe_audio(cw, settings: dict) -> None:
    """Run Whisper over the first AUDIO seconds of the chosen cached source, in
    the variants that tell VAD apart from the no-speech gate. Counts only."""
    folder = DATA / "cache" / "sources"
    sources = [p for p in folder.glob("*.mp4") if not p.name.startswith(".")] if folder.is_dir() else []
    cutoff = time.time() - HOURS * 3600
    sources = [p for p in sources if p.stat().st_mtime >= cutoff]
    if not sources:
        out("  no cached source in the window")
        return
    probed = []
    for path in sorted(sources, key=lambda p: -p.stat().st_mtime):
        meta = probe_source(path)
        out(f"  source {path.name[:16]}...  written {age(path.stat().st_mtime)} ago  {path.stat().st_size // 1024 // 1024} MB"
            f"  duration={meta['duration']:.1f}s  audio={json.dumps(meta['audio'])}")
        probed.append((path, meta))
    if DURATION_HINT > 0:
        path, meta = min(probed, key=lambda item: abs(item[1]["duration"] - DURATION_HINT))
    else:
        path, meta = probed[0]
    out(f"  probing {path.name[:16]}... ({meta['duration']:.1f}s), first {AUDIO:g}s")
    wav = Path("/tmp/dc-probe-audio.wav")
    try:
        code, _, err = run(["ffmpeg", "-y", "-v", "error", "-i", str(path), "-t", str(AUDIO),
                            "-vn", "-ac", "1", "-ar", "16000", str(wav)], timeout=300)
        if code != 0:
            out("  ffmpeg could not extract the audio: " + redact(err)[-300:])
            return
        code, _, err = run(["ffmpeg", "-v", "info", "-i", str(wav), "-af", "volumedetect", "-f", "null", "-"], timeout=300)
        levels = re.findall(r"(mean_volume|max_volume): ([-\d.]+) dB", err)
        out("  levels: " + ", ".join(f"{k}={v} dB" for k, v in levels))
        try:
            from faster_whisper import WhisperModel  # noqa: PLC0415
        except ImportError:
            out("  faster-whisper is not importable here")
            return
        model_name = os.getenv("WHISPER_MODEL") or settings.get("model") or "small"
        model = WhisperModel(model_name, device=os.getenv("WHISPER_DEVICE") or "cpu",
                             compute_type=os.getenv("WHISPER_COMPUTE_TYPE") or "int8")
        language = str(settings.get("language") or "").strip() or None
        base = {"beam_size": 1, "word_timestamps": True, "condition_on_previous_text": False, "task": "transcribe"}
        lang = {"language": language} if language else {"multilingual": True}
        variants = [
            ("as shipped (vad on, min_silence 450)", {**base, **lang, "vad_filter": True, "vad_parameters": {"min_silence_duration_ms": 450}}),
            ("vad off", {**base, **lang, "vad_filter": False}),
            ("vad on, no-speech gate off", {**base, **lang, "vad_filter": True, "vad_parameters": {"min_silence_duration_ms": 450}, "no_speech_threshold": None}),
            ("vad off, no-speech gate off", {**base, **lang, "vad_filter": False, "no_speech_threshold": None}),
        ]
        if language:
            variants.append(("language auto, multilingual, vad on", {**base, "multilingual": True, "vad_filter": True, "vad_parameters": {"min_silence_duration_ms": 450}}))
        for label, options in variants:
            started = time.time()
            try:
                segments, info = model.transcribe(str(wav), **options)
                rows = list(segments)
            except TypeError as exc:
                out(f"  variant [{label}]: unsupported here ({redact(str(exc))[:120]})")
                continue
            except Exception as exc:  # noqa: BLE001
                out(f"  variant [{label}] failed: {type(exc).__name__}: {redact(str(exc))[:160]}")
                continue
            spoken = [r for r in rows if str(r.text or "").strip()]
            speech = sum(float(r.end) - float(r.start) for r in spoken)
            nsp = [float(getattr(r, "no_speech_prob", 0) or 0) for r in spoken]
            lp = [float(getattr(r, "avg_logprob", 0) or 0) for r in spoken]
            after_vad = getattr(info, "duration_after_vad", None)
            out(f"  variant [{label}]: segments={len(spoken)} span={(float(spoken[0].start) if spoken else 0):.1f}.."
                f"{(float(spoken[-1].end) if spoken else 0):.1f}s speech={speech:.1f}s"
                f" of {float(getattr(info, 'duration', 0) or 0):.1f}s"
                + (f" (after vad {float(after_vad):.1f}s)" if after_vad is not None else "")
                + f" lang={getattr(info, 'language', '?')}@{float(getattr(info, 'language_probability', 0) or 0):.2f}"
                + (f" no_speech mean/max={statistics.mean(nsp):.2f}/{max(nsp):.2f} logprob mean={statistics.mean(lp):.2f}" if nsp else "")
                + f" took {time.time() - started:.0f}s")
    finally:
        try:
            wav.unlink()
        except OSError:
            pass


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
    if AUDIO > 0:
        out()
        out(f"== whisper over the first {AUDIO:g}s of a cached source ==")
        probe_audio(cw, replays[0][1] if replays else {})
    return 0


if __name__ == "__main__":
    sys.exit(main())
