#!/usr/bin/env python3
"""Render one clip and pull stills from it, for looking at framing and captions.

Why this exists: the two open pieces of work — subject framing and Arabic
caption rendering — cannot be judged from code or from unit tests. Both are
"does it look right on screen" problems, and the handover is blunt about it:
a framing change that reads correctly in the source and wrong in the output is
worthless.

This drives `clip_worker.py` directly through its re-render path, which needs
a source video, a music track and a transcript — but **no Whisper and no model
download**, because the transcript is supplied rather than produced. That
makes the iteration loop seconds-to-minutes instead of a full transcription
per attempt.

Two shapes of use:

    # Framing: render a window and pull stills across it.
    scripts/render-probe.py --source lecture.mp4 --music nasheed.mp3 \
        --start 120 --end 160 --stills 8

    # Captions: same clip in all three caption modes, side by side.
    scripts/render-probe.py --source lecture.mp4 --music nasheed.mp3 \
        --start 120 --end 160 --caption-mode all --transcript arabic.json

The transcript file is a JSON list of segments in the worker's own shape:

    [{"start": 0.0, "end": 4.0, "text": "…",
      "words": [{"word": "…", "start": 0.0, "end": 0.6}, …]}]

Word timings matter: the `word` and `dynamic-stack` caption modes position
each word separately, which is exactly where right-to-left text is most
likely to break.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAPTION_MODES = ("phrase", "word", "dynamic-stack")


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


TEMPLATE_DUMP = (
    "node -e \"import('./src/templates.js')"
    ".then(m=>process.stdout.write(JSON.stringify(m.defaultTemplateDraft(),null,2)))\""
    " > probe-template.json"
)


def default_template(template_file: Path | None = None) -> dict:
    """Borrow the app's own default template so the probe renders what users get.

    The worker image is `python:3.12-slim` and has no Node, so inside the
    container the template has to be supplied as a file. Dump it once on the
    host, where Node exists, and pass it in with --template.
    """
    if template_file:
        if not template_file.exists():
            fail(f"template file not found: {template_file}")
        template = json.loads(template_file.read_text(encoding="utf-8"))
        if not isinstance(template, dict) or not template:
            fail("the template file must contain a JSON object")
        return _stamp(template)

    if not shutil.which("node"):
        fail(
            "no Node here (expected inside the worker container), so the template "
            f"must be supplied.\n       On the host, run:\n         {TEMPLATE_DUMP}\n"
            "       then pass --template probe-template.json"
        )
    result = subprocess.run(
        ["node", "-e", "import('./src/templates.js').then(m=>process.stdout.write(JSON.stringify(m.defaultTemplateDraft())))"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        fail(f"could not read the default template from src/templates.js: {result.stderr.strip()[:400]}")
    return _stamp(json.loads(result.stdout))


def _stamp(template: dict) -> dict:
    # The worker refuses templates that are not app-owned, and the id from the
    # draft helper is a placeholder rather than a real saved template.
    template["id"] = "render-probe"
    template["name"] = "Render probe"
    return template


def even_transcript(start: float, end: float, text: str) -> list[dict]:
    """A placeholder transcript with evenly spaced word timings.

    Only used when no real transcript is supplied. Good enough to see how
    captions lay out and shape; useless for judging sync against real speech.
    """
    words = [word for word in text.split() if word]
    if not words:
        fail("--text produced no words")
    span = max(0.4, (end - start)) / len(words)
    timed = []
    for index, word in enumerate(words):
        word_start = index * span
        timed.append({"word": word, "start": round(word_start, 3), "end": round(word_start + span * 0.9, 3)})
    return [{"start": 0.0, "end": round(end - start, 3), "text": " ".join(words), "words": timed}]


def render(args, template: dict, segments: list[dict], label: str, work: Path) -> Path | None:
    job_dir = work / label
    output_dir = job_dir / "out"
    output_dir.mkdir(parents=True, exist_ok=True)
    result_path = job_dir / "result.json"
    job = {
        "mode": "rerender",
        "id": f"probe-{label}",
        "projectId": "probe",
        "clipIdOverride": f"probe-{label}",
        "sourceFile": str(Path(args.source).resolve()),
        "outputDir": str(output_dir),
        "resultPath": str(result_path),
        "ffmpeg": args.ffmpeg,
        "ffprobe": args.ffprobe,
        "template": template,
        "musicTracks": [{"name": Path(args.music).name, "path": str(Path(args.music).resolve())}],
        "settings": {"clipMinSeconds": 5, "clipMaxSeconds": 180, "clipsPerVideo": 1},
        "transcriptSegments": segments,
        "clip": {
            "id": f"probe-{label}", "title": "Render probe", "description": "",
            "transcript": " ".join(str(item.get("text", "")) for item in segments),
            "startSec": args.start, "endSec": args.end,
            "score": 80, "scoreReasons": ["render probe"], "reviewRequired": False,
        },
    }
    job_file = job_dir / "job.json"
    job_file.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n=== rendering [{label}] ===", flush=True)
    result = subprocess.run([sys.executable, str(ROOT / "worker" / "clip_worker.py"), str(job_file)], text=True)
    if result.returncode != 0:
        print(f"  render failed for [{label}] (exit {result.returncode})", file=sys.stderr)
        return None
    if not result_path.exists():
        print(f"  no result written for [{label}]", file=sys.stderr)
        return None
    clips = json.loads(result_path.read_text(encoding="utf-8")).get("clips") or []
    if not clips or not clips[0].get("clipFile"):
        print(f"  no clip produced for [{label}]", file=sys.stderr)
        return None
    return Path(clips[0]["clipFile"])


def pull_stills(args, clip_file: Path, label: str, out_dir: Path) -> list[Path]:
    """Sample frames across the clip. This is the part you actually look at."""
    duration = max(0.5, args.end - args.start)
    stills = []
    for index in range(args.stills):
        # Spread samples across the clip without landing on the very first or
        # last frame, where a fade would hide the composition.
        fraction = (index + 0.5) / args.stills
        at = round(duration * fraction, 3)
        target = out_dir / f"{label}-{index:02d}-at{at:g}s.png"
        result = subprocess.run(
            [args.ffmpeg, "-y", "-ss", str(at), "-i", str(clip_file), "-frames:v", "1", str(target)],
            capture_output=True, text=True,
        )
        if result.returncode == 0 and target.exists():
            stills.append(target)
        else:
            print(f"  could not pull a still at {at}s: {result.stderr.strip()[-200:]}", file=sys.stderr)
    return stills


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, help="source video (any talking-head footage works)")
    parser.add_argument("--music", required=True, help="nasheed track; music is mandatory in the pipeline")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=30.0)
    parser.add_argument("--caption-mode", default="", help=f"one of {', '.join(CAPTION_MODES)}, or 'all'")
    parser.add_argument("--transcript", type=Path, help="JSON transcript segments; strongly preferred for caption work")
    parser.add_argument("--text", default="", help="quick alternative to --transcript: caption this text with even timings")
    parser.add_argument("--stills", type=int, default=6, help="frames to sample per render (0 to skip)")
    parser.add_argument("--template", type=Path, help="template JSON; required where Node is unavailable (inside the container)")
    parser.add_argument("--out", type=Path, default=ROOT / "probe-output")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "ffmpeg")
    parser.add_argument("--ffprobe", default=shutil.which("ffprobe") or "ffprobe")
    parser.add_argument("--keep", action="store_true", help="keep the generated job files for inspection")
    args = parser.parse_args()

    if not Path(args.source).exists():
        fail(f"source video not found: {args.source}")
    if not Path(args.music).exists():
        fail(f"music track not found: {args.music}")
    if args.end <= args.start:
        fail("--end must be after --start")
    if not shutil.which(args.ffmpeg):
        fail(f"ffmpeg not found ({args.ffmpeg}). Run this inside the worker container, where it is installed.")

    if args.transcript:
        if not args.transcript.exists():
            fail(f"transcript not found: {args.transcript}")
        segments = json.loads(args.transcript.read_text(encoding="utf-8"))
        if not isinstance(segments, list) or not segments:
            fail("the transcript must be a non-empty JSON list of segments")
    elif args.text:
        segments = even_transcript(args.start, args.end, args.text)
    else:
        fail("supply --transcript (real timings) or --text (even placeholder timings)")

    if args.caption_mode == "all":
        modes = list(CAPTION_MODES)
    elif args.caption_mode:
        if args.caption_mode not in CAPTION_MODES:
            fail(f"--caption-mode must be one of {', '.join(CAPTION_MODES)}, or 'all'")
        modes = [args.caption_mode]
    else:
        modes = [""]  # whatever the default template specifies

    args.out.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="render-probe-"))
    produced: list[tuple[str, Path, list[Path]]] = []
    try:
        for mode in modes:
            template = default_template(args.template)
            label = mode or str(template.get("captionMode", "default"))
            if mode:
                template["captionMode"] = mode
            clip_file = render(args, template, segments, label, work)
            if not clip_file:
                continue
            kept = args.out / f"{label}.mp4"
            shutil.copy2(clip_file, kept)
            stills = pull_stills(args, kept, label, args.out) if args.stills > 0 else []
            produced.append((label, kept, stills))
    finally:
        if args.keep:
            print(f"\njob files kept in {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)

    print("\n" + "=" * 60)
    if not produced:
        print("nothing rendered — see the errors above")
        return 1
    for label, clip_file, stills in produced:
        print(f"[{label}] {clip_file}")
        for still in stills:
            print(f"    {still}")
    print("\nNow look at the stills. For framing: is the speaker off-centre in a")
    print("way that reads deliberate, and clear of the caption box? For Arabic:")
    print("are the letters joined, and is word order right-to-left in every mode?")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
