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

WHAT A JOB ASKED FOR, BESIDE WHAT THE BOX DECIDED. Every other readout in this
script reports the CONTAINER's own configuration, so they all agreed with each
other while every job ran a Whisper model none of them named: clip_worker read
settings["model"] out of the job payload and never looked at WHISPER_MODEL, so
a box configured for `medium` transcribed on `small` through a fortnight of
green deploy logs. A monitor that reads one side of a disagreement reports
success while the thing it watches is broken -- so each job below prints what
its own payload requested BESIDE what capacity.plan() decided, and says so
loudly where the two differ.

WHAT NEVER LEAVES THE BOX. Not one word of any transcript: only counts,
timings, lengths and setting names are printed. Job errors are already scrubbed
by the worker's clean_error and are redacted again here for anything shaped
like a credential. `PARAMS` is substituted on the runner as a JSON literal
rather than interpolated into a shell command, so a dispatch input can never
become a command on the box.
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
    "ollamaModel",
)
# The settings a job REQUESTS that the box also DECIDES for itself -- the only
# ones where the two can disagree, and where a disagreement means the run did
# not use what this container is configured for. See the module docstring.
#   (key in the job payload's settings, key in capacity.plan(), what to call it)
JOB_VS_BOX = (
    ("model", "model", "whisper model"),
    ("device", "device", "whisper device"),
    ("computeType", "computeType", "whisper compute type"),
    ("ollamaModel", "ollamaModel", "clip AI model"),
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


def import_posture() -> None:
    """WHAT THE DOWNLOADER ACTUALLY HAS, because the refusal makes a claim.

    A YouTube 403 comes back to the customer as one of two sentences, and
    which one is chosen decides whether they read it as their video or as our
    server:

        "A proxy or cookies are configured and were used, so this looks like
         the video itself rather than the address it was asked from."
        "Every client failed, which usually means this server's IP is blocked."

    _download_failure picks between them by asking whether the options dict
    carries a proxy or a cookie file -- so the first sentence is a claim about
    this box's configuration, and until now NOTHING anywhere could check it.
    A pool file that failed to parse, or an empty VIDEO_IMPORT_PROXIES, leaves
    the second sentence unreachable while the first is false, and the customer
    is told to go and download a video that our own address was refused.

    COUNTS AND SHAPES ONLY. A proxy URL carries its credentials in its
    userinfo, so not one address is printed here -- the pool's SIZE is what
    answers the question, and a burned pool and a missing pool look identical
    from the message alone.
    """
    out("== the way in ==")
    try:
        import import_providers  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        out(f"  import_providers did not import: {type(exc).__name__}: {redact(str(exc))[:160]}")
        out()
        return
    try:
        pool = import_providers.proxy_pool()
        options = import_providers.youtube_network_options()
    except Exception as exc:  # noqa: BLE001
        out(f"  could not read the network options: {type(exc).__name__}: {redact(str(exc))[:160]}")
        out()
        return

    provider = str(os.getenv("VIDEO_IMPORT_PROVIDER", "") or "").strip() or "(unset)"
    pool_file = str(os.getenv("VIDEO_IMPORT_PROXY_FILE", "") or "").strip()
    where = "pool file" if pool_file and Path(pool_file).is_file() else "VIDEO_IMPORT_PROXIES"
    cookie_file = str(options.get("cookiefile") or "")
    out(f"  provider           {provider}")
    out(f"  proxy pool         {len(pool)} address(es), from {where}")
    # THE BOX'S OWN DEFAULT, WHICH IS NOT WHAT A REAL IMPORT CARRIES. Cookies
    # pasted at /admin/import-network are sealed in the app's store and travel
    # on the job's own `network.cookiesText`, written to the job's scratch
    # directory by youtube_options_for_source(). So `no` here means the BOX has
    # none of its own; it says nothing about whether the dashboard holds a set.
    # Reading this line as "cookies are not configured" was a wrong call once.
    out(f"  cookies (box)      {'yes' if cookie_file else 'no'}"
        + (f" ({Path(cookie_file).name})" if cookie_file else "")
        + " -- a real job carries whatever /admin/import-network holds")
    out(f"  PO token server    {'yes' if options.get('extractor_args') else 'no'}")
    out(f"  clients tried      {len(getattr(import_providers, 'YOUTUBE_CLIENTS', []))} per plan, two plans")
    try:
        import yt_dlp  # noqa: PLC0415
        out(f"  yt-dlp             {yt_dlp.version.__version__}")
    except Exception:  # noqa: BLE001
        out("  yt-dlp             not importable here")

    # THE CLAIM ITSELF, stated rather than left to be worked out. This is the
    # branch _download_failure takes, evaluated against what is really set.
    blames_video = bool(options.get("proxy") or options.get("cookiefile")
                        or options.get("cookiesfrombrowser"))
    if blames_video:
        out("  a 403 on every client will be reported as THE VIDEO"
            " (a proxy or cookies were used), which is true here.")
    else:
        out("::warning::a 403 will be reported as this server being blocked -- no proxy and no cookies are live")
        out("  !! a 403 on every client will be reported as THIS SERVER'S ADDRESS being blocked,")
        out("     because neither a proxy nor cookies reached the downloader. If the pool is")
        out("     configured but reads 0 above, the pool file or VIDEO_IMPORT_PROXIES is the fault.")
    out()


def resolved_for(settings: dict) -> dict[str, str]:
    """What THIS JOB would actually run, by asking the code that decides.

    Not a comparison of two numbers: clip_worker's own resolver, called under
    the same environment service.py launches a child with. Anything else is a
    second implementation of the precedence rule, and the precedence rule is
    the thing being checked.
    """
    try:
        import capacity  # noqa: F401  (imported for its side-effect-free plan)
        import service
        import clip_worker
    except Exception as exc:  # pragma: no cover - reported, never fatal
        return {"error": f"{type(exc).__name__}: {exc}"}
    saved = dict(os.environ)
    try:
        os.environ.update(service.child_env(1))
        model, device, compute = clip_worker.whisper_settings(settings)
        ollama = str(os.getenv("OLLAMA_MODEL") or "").strip() or str(settings.get("ollamaModel") or "qwen3:1.7b")
    except Exception as exc:  # pragma: no cover
        return {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        os.environ.clear()
        os.environ.update(saved)
    return {"model": model, "device": device, "computeType": compute, "ollamaModel": ollama}


def compare_to_box(job_id: str, settings: dict, decided: dict) -> int:
    """What this job asked for, what the box decided, AND WHAT ACTUALLY RAN.

    Returns how many settings the JOB PAYLOAD won -- which is the fault, and is
    not the same question as whether the two differ.

    THIS CHECK USED TO WARN ON THE CORRECT BEHAVIOUR. It was written when
    clip_worker read settings["model"] and never looked at the environment, so
    "asked small, box says medium" meant the run used small and the box's
    configuration was a lie. v3.162.0 made the environment win, so that same
    line now means the box won -- exactly as designed -- and the warning fired
    on four of four jobs, on every run, for ever. An alarm that is always on
    says nothing on the day it is right, which is the failure alerts.js exists
    to prevent, pointed at the box instead of at the operator.

    So the question is no longer "do these two differ". It is "did the payload
    WIN", and the only honest way to answer it is to run the resolver.
    """
    resolved = resolved_for(settings)
    if resolved.get("error"):
        out("  could not resolve what this job would run: " + resolved["error"])
        return 0
    payload_won = 0
    lines, agree, absent = [], [], []
    for payload_key, box_key, label in JOB_VS_BOX:
        asked = str(settings.get(payload_key) or "").strip()
        box = str(decided.get(box_key) or "").strip()
        ran = str(resolved.get(payload_key) or "").strip()
        if not asked:
            # The self-hosted engine spawns clip_worker with no such payload,
            # and an older payload predates the key. Silence is nothing.
            absent.append(payload_key)
            continue
        if ran and ran == asked and box and box != asked:
            # The payload beat the box. THE fault this check exists for.
            payload_won += 1
            out(f"::warning::job {job_id}: {label} -- the PAYLOAD won: asked {asked!r}, "
                f"box configured {box!r}, and {asked!r} is what ran")
            out(f"  !! PAYLOAD WON  {label}: asked {asked!r}, box {box!r}, ran {asked!r}")
        elif box and ran and ran != box:
            # Neither side's value -- something else is setting it. Worth a look.
            payload_won += 1
            out(f"::warning::job {job_id}: {label} ran {ran!r}, which is neither the "
                f"payload's {asked!r} nor the box's {box!r}")
            out(f"  !! UNEXPECTED  {label}: ran {ran!r}, payload {asked!r}, box {box!r}")
        elif asked != box:
            # The box overrode the app's guess. Correct, and the normal state on
            # every remote deployment -- reported as a line, never as an alarm.
            lines.append(f"{label}: box {box!r} over the payload's {asked!r}")
        else:
            agree.append(f"{payload_key}={asked}")
    if lines:
        out("  the box won (as designed): " + "; ".join(lines))
    if agree:
        out("  payload and box already agree on: " + ", ".join(agree))
    if absent:
        out("  not named by this payload: " + ", ".join(absent))
    return payload_won


def describe_job(mtime: float, folder: Path, status: dict, decided: dict) -> dict:
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
    # WHERE EVERY PHASE'S SECONDS WENT. v3.77.0 put `timings` on every result
    # for exactly one reason -- the rescale and the render-lane count are
    # decisions about this and there was no number to make them with -- and
    # then nothing ever printed it, so it sat unread for a fortnight. The share
    # is what actually answers "which phase is worth attacking": a phase at 5%
    # of the job cannot be made to matter however well it is optimised.
    result = status.get("result") if isinstance(status.get("result"), dict) else {}
    # ON result["project"], NOT on the result. upload_result returns
    # {"project": ..., "clips": ...} and clip_worker hangs the clock off the
    # project -- which is why this file has always called it `project.timings`.
    # Read at the top level it is simply absent, and a job prints nothing while
    # looking perfectly healthy: the first cut of this did exactly that, and
    # its test passed because the FIXTURE had the same wrong shape.
    project = result.get("project") if isinstance(result.get("project"), dict) else {}
    timings = project.get("timings") if isinstance(project.get("timings"), dict) else {}
    if timings:
        total = float(timings.get("total") or 0) or 1.0
        parts = " ".join(
            f"{name} {float(value):.0f}s ({float(value) / total * 100:.0f}%)"
            for name, value in timings.items()
            if name != "total" and isinstance(value, (int, float)) and float(value) > 0)
        out(f"  timings: total {float(timings.get('total') or 0):.0f}s -- {parts}")
        clips = result.get("clips") or project.get("clipCount")
        if isinstance(clips, int):
            clips = [None] * clips
        if isinstance(clips, list) and clips and float(timings.get("render") or 0) > 0:
            out(f"           {len(clips)} clip(s), so"
                f" {float(timings['render']) / len(clips):.0f}s a clip rendered")
    mismatched = compare_to_box(folder.name, settings, decided)
    return {"settings": settings, "template": template, "status": status, "mismatches": mismatched}


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


def machine() -> dict[str, str]:
    """WHAT THIS BOX ACTUALLY IS, measured rather than taken on trust.

    A server plan is a claim ("we moved to a bigger one") and this is the only
    place it can be checked. It matters more than it sounds: worker/capacity.py
    picks the Whisper model, the concurrency and the ffmpeg threads FROM the
    machine -- but an explicit environment variable always wins, and
    docker-compose.yml sets three of them. So a box can double in size and
    change nothing at all, and the only way to tell is to print what the
    machine has BESIDE what the worker decided.

    Returns what this container DECIDED, so the job block below can compare a
    payload against it rather than working the answer out a second time -- two
    derivations of "what model is this box on" is how the two halves of a
    monitor come to disagree in the first place.

    Counts and sizes only; nothing here is customer data.
    """
    out("== the machine ==")
    try:
        import capacity  # noqa: PLC0415
        plan = capacity.plan()
    except Exception as exc:  # noqa: BLE001
        out(f"  capacity.plan() failed: {type(exc).__name__}: {redact(str(exc))[:160]}")
        plan = {}

    # os.cpu_count() is the HOST's cores even inside a container; the cgroup
    # quota is what this process may actually use, and reading the wrong one is
    # how you size a worker for cores it does not have.
    host_cores = os.cpu_count() or 0
    try:
        usable = capacity.cpu_cores()
        ram, reserved = capacity.memory_budget()
    except Exception:  # noqa: BLE001
        usable, ram, reserved = 0, 0.0, 0.0
    try:
        host_ram = (os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")) / (1024 ** 3)
    except (ValueError, OSError, AttributeError):
        host_ram = 0.0

    out(f"  host           {host_cores} cores, {host_ram:.1f}G RAM")
    out(f"  this container {usable} cores, {ram:.1f}G (reserve {reserved}G)")
    for key in ("model", "device", "computeType", "maxConcurrentJobs", "ffmpegThreads"):
        forced = {
            "model": "WHISPER_MODEL", "device": "WHISPER_DEVICE",
            "computeType": "WHISPER_COMPUTE_TYPE",
            "maxConcurrentJobs": "WORKER_MAX_CONCURRENT_JOBS",
            "ffmpegThreads": "FFMPEG_THREADS",
        }[key]
        override = str(os.getenv(forced, "") or "").strip()
        # THE POINT OF THIS BLOCK. "forced" means the environment overruled the
        # machine -- so growing the box changed nothing for that setting.
        note = f"  <- FORCED by {forced}" if override else ""
        out(f"  {key:<18} {plan.get(key, '?')}{note}")
    ollama = str(os.getenv("OLLAMA_MODEL", "") or "").strip()
    out(f"  ollama model       {ollama or '(unset)'}")
    # What the machine WOULD choose if nothing were forcing it, so the cost of
    # each override is visible rather than inferred.
    try:
        would = capacity.whisper_model_for(bool(plan.get("gpus")), ram)
        by_cpu = usable // 2
        by_ram = int((ram - reserved) // 1.5)
        out(f"  unforced it would pick: whisper={would}, jobs={max(1, min(by_cpu, by_ram))}")
    except Exception:  # noqa: BLE001
        pass
    out()
    import_posture()
    # capacity.plan() already folds each environment override in, so this IS
    # what the container decided rather than a heuristic beside it. Ollama's
    # model is not part of that plan -- it is read straight from the container's
    # own environment, which is the only thing it has to decide with.
    decided = {key: str(plan.get(key) or "") for key in ("model", "device", "computeType")}
    decided["ollamaModel"] = ollama
    return decided


def main() -> int:
    out(f"python {sys.version.split()[0]}  data={DATA} ({'present' if DATA.is_dir() else 'MISSING'})  code={CODE}")
    version_file = CODE.parent / "package.json"
    version = read_json(version_file) if version_file.is_file() else None
    out(f"worker version: {version.get('version') if isinstance(version, dict) else 'unknown'}")
    sys.path.insert(0, str(CODE))
    out()
    decided = machine()
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
    described = [describe_job(*row, decided=decided) for row in jobs]

    # THE HEADLINE, and it counts the FAULT rather than the difference. A job
    # asking for something the box overrides is the normal state of every
    # remote deployment -- the app has never seen this machine -- so counting
    # that put a warning on every job of every run and made the real one
    # invisible. What is counted here is the payload having WON, measured by
    # running the resolver rather than by comparing two numbers.
    overridden = sum(1 for item in described if item["mismatches"])
    if described and overridden:
        out()
        out(f"::warning::{overridden} of the {len(described)} newest jobs did NOT run what this box decided")
        out(f"  !! {overridden} of the {len(described)} newest jobs did NOT run what this box decided.")
        out("     The box is authoritative: worker/service.py's child_env puts capacity's device,")
        out("     compute type and model into clip_worker's environment, and whisper_settings reads")
        out("     the environment FIRST. A build that reads the payload first runs the job's value")
        out("     instead and nothing anywhere says so -- which is this drift exactly.")
    elif described:
        out()
        out(f"  all {len(described)} newest jobs ran what this box decided.")

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
