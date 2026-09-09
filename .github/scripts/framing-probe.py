"""Where the crop actually lands on this box's own footage, and why.

Youssef, 9 Sept 2026, on a two-person podcast: "it doesn't even know who's
speaking ... it was framing the opposite guy. Second off, it's not stable. It
moves while they speak ... It should be CUTTING to the person who's speaking."

Both halves can only be measured where MediaPipe, real lectures and the shipped
code are in one place, which is here. So this reports, on a real source:

* what the LANDMARKER sees -- how many faces, where, and how far each mouth
  actually opens, which is the signal the whole rebuild rests on;
* what the tracker CHOOSES -- the shots, who holds each one, where it frames
  them and why it ended;
* what the static fallback would have chosen over the same window, so a run
  says what the render did and what the other method would have done.

It changes nothing, renders nothing, and prints geometry only: positions as
percentages of the frame, box heights in pixels, apertures as fractions of a
face. A run log is public, and a frame would be somebody's lecture and a face
in it.
"""
import json
import math
import os
import statistics
import sys
import time
from pathlib import Path

# Substituted by the workflow. NUMBERS AND STRINGS ONLY -- this literal is
# written into a Python file and JSON.stringify spells a boolean `true`, which
# Python reads as an undefined name and the probe dies on line one.
PARAMS = {}

DATA = Path(os.getenv("WORKER_DATA_DIR") or "/app/data")
SECONDS = float(PARAMS.get("seconds") or 30)
WANT = float(PARAMS.get("duration") or 0)
FRAMES = int(PARAMS.get("frames") or 12)
# How many cached sources to sweep. The fault is a property of the shot, so one
# source answers almost nothing.
SOURCES = max(1, min(8, int(PARAMS.get("sources") or 4)))
# Where in the source to ask about who is speaking. The opening of a lecture is
# a title card, a wide establishing shot and an introduction, so a measurement
# taken from zero reports mostly empty frames and says very little about the
# two people talking. The diagnose probe carries `diagnose_from` for exactly
# this reason.
FROM = max(0.0, float(PARAMS.get("start") or 0))


def out(line: str = "") -> None:
    print(line, flush=True)


def pick_sources() -> list[Path]:
    """The cached sources to look at, newest first.

    SEVERAL, not one. The fault being chased is a property of the SHOT -- two
    people close together and similar in size -- so the newest cached lecture is
    very unlikely to be the one somebody is complaining about, and one source
    cannot tell a tight two-shot from a wide one. `duration` still narrows to a
    particular lecture when its length is known.
    """
    folder = DATA / "cache" / "sources"
    files = [p for p in folder.glob("*.mp4") if not p.name.startswith(".")] if folder.is_dir() else []
    if not files:
        return []
    if WANT > 0:
        import subprocess
        def length(path: Path) -> float:
            try:
                probe = subprocess.run(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "default=nw=1:nk=1", str(path)],
                    capture_output=True, text=True, timeout=30)
                return float((probe.stdout or "0").strip() or 0)
            except Exception:
                return 0.0
        scored = [(abs(length(p) - WANT), p) for p in files]
        scored.sort(key=lambda item: item[0])
        return [scored[0][1]]
    return sorted(files, key=lambda p: -p.stat().st_mtime)[:SOURCES]


def analyse(cw, cv2, source: Path) -> dict:
    """Where the faces are on one source, and what the shipped crop does with them."""
    out()
    out(f"-- {source.name}  ({source.stat().st_size / 1_048_576:.0f} MB)")
    info = cw.ffprobe_json("ffprobe", source)
    stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    src_w, src_h = int(stream.get("width") or 0), int(stream.get("height") or 0)
    if not src_w:
        out("   dimensions unreadable")
        return {}
    out(f"   frame {src_w}x{src_h}")

    names = ("haarcascade_frontalface_alt2.xml", "haarcascade_frontalface_default.xml",
             "haarcascade_profileface.xml")
    detectors = [cv2.CascadeClassifier(cv2.data.haarcascades + n) for n in names]
    min_face = max(28, min(src_w, src_h) // 24)
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        out("   could not be opened")
        return {}

    per_frame: list[list[tuple[float, int]]] = []
    for i in range(FRAMES):
        t = SECONDS * i / max(1, FRAMES - 1)
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        found: list[tuple[int, int, int, int]] = []
        for index, detector in enumerate(detectors):
            if detector.empty():
                continue
            for item in detector.detectMultiScale(
                    gray, scaleFactor=1.08 if index == 0 else 1.10,
                    minNeighbors=3 if index == 0 else 4, minSize=(min_face, min_face)):
                found.append(tuple(map(int, item)))
        # De-duplicate: three cascades over one face give three near-identical
        # boxes, and counting those as three people would invent the very
        # crowding this is trying to measure.
        kept: list[tuple[int, int, int, int]] = []
        for box in sorted(found, key=lambda b: -b[2] * b[3]):
            cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
            if any(abs(cx - (k[0] + k[2] / 2)) < max(box[2], k[2]) * 0.6
                   and abs(cy - (k[1] + k[3] / 2)) < max(box[3], k[3]) * 0.6 for k in kept):
                continue
            kept.append(box)
        per_frame.append([((b[0] + b[2] / 2) / src_w * 100, b[3]) for b in kept])
    cap.release()

    # Group the detections into PEOPLE. Bucketing by position is what separates
    # a genuine second person from the same person drifting, and the median box
    # height is what separates a real face from the small false positives the
    # cascades throw on patterned backgrounds.
    # MERGED BY FACE SIZE, not into fixed buckets. The first version bucketed at
    # 4% of the width and reported one person as two -- a 346px face on a 1920px
    # frame is 18% of the width wide, so its centre wobbling 4% between frames
    # is the SAME person, and the probe called that a "tight two-shot" and was
    # wrong. Two detections closer together than the face is wide cannot be two
    # people; the size is the merge distance and it scales with the shot.
    flat = sorted(((x, h) for row in per_frame for x, h in row), key=lambda item: item[0])
    groups: list[list[tuple[float, int]]] = []
    for x, h in flat:
        span = max(h, groups[-1][-1][1] if groups else 0) / src_w * 100 * 0.9
        if groups and x - groups[-1][-1][0] <= span:
            groups[-1].append((x, h))
        else:
            groups.append([(x, h)])
    real = {int(statistics.median([g[0] for g in group])): [g[1] for g in group]
            for group in groups if len(group) >= max(2, len(per_frame) // 4)}
    multi = sum(1 for row in per_frame if len(row) > 1)
    out(f"   frames with more than one face: {multi} of {len(per_frame)}")
    for pos in sorted(real):
        out(f"     a person near {pos:3d}% of the width, seen {len(real[pos]):2d}x, "
            f"median face height {int(statistics.median(real[pos])):3d}px")

    duration = max(5.0, min(SECONDS, 60.0))
    candidate = cw.Candidate(start=0.0, end=duration, text="", segments=[], score=0,
                             reasons=[], quote_risk=False)
    crop = cw.detect_main_face_crop(source, "ffprobe", candidate, 1080, 1920)
    if not crop:
        out("   the crop returned nothing (already narrow, or nothing found)")
        return {}
    centre = (crop["x"] + crop["w"] / 2) / src_w * 100
    left_edge, right_edge = crop["x"] / src_w * 100, (crop["x"] + crop["w"]) / src_w * 100
    out(f"   crop: {crop.get('method')}, centre {centre:.1f}%, keeps "
        f"{left_edge:.1f}%..{right_edge:.1f}%")

    # THE TWO SHAPES YOUSSEF DESCRIBED, told apart by the numbers. A TIGHT
    # two-shot is two people of similar size close enough that one crop could
    # hold either -- that is where the median of a two-humped set lands in the
    # valley. A WIDE one has a dominant near face and the crop settles on it.
    verdict = "one person"
    cut_out = [pos for pos in real if not (left_edge <= pos <= right_edge)]
    if len(real) >= 2:
        heights = {pos: statistics.median(hs) for pos, hs in real.items()}
        top = sorted(heights, key=lambda pos: -heights[pos])[:2]
        a, b = top[0], top[1]
        ratio = heights[a] / max(1.0, heights[b])
        gap = abs(a - b)
        span = (right_edge - left_edge)
        similar = ratio < 1.6
        both_fit = gap < span * 0.8
        out(f"   two largest faces: {a}% (h{int(heights[a])}) and {b}% (h{int(heights[b])}) -- "
            f"size ratio {ratio:.1f}x, {gap:.0f}% apart, crop spans {span:.0f}%")
        if similar and both_fit:
            verdict = "TIGHT two-shot"
            between = min(a, b) < centre < max(a, b)
            nearest = min(abs(centre - a), abs(centre - b))
            out(f"   !! TIGHT TWO-SHOT: similar sizes, close together. This is the reported case.")
            if between and nearest > gap * 0.25:
                out(f"      and the crop is centred BETWEEN them, {nearest:.0f}% from the nearer face.")
        elif similar:
            verdict = "two people, far apart"
        else:
            verdict = "one dominant face"
    for pos in cut_out:
        out(f"   a person near {pos}% is OUTSIDE the crop")
    return {"verdict": verdict, "centre": centre, "src_w": src_w, "duration": duration,
            "window": min(60.0, SECONDS), "source": source, "people": len(real)}


def speaker_view(cw, speaker, r: dict) -> None:
    """What the landmarker sees, and what the tracker does with it.

    Every number here is measured on this box's own footage by the SHIPPED
    functions -- not a copy of them with its own thresholds, which would answer
    a question nobody asked.
    """
    source = r["source"]
    duration = min(60.0, max(10.0, float(r.get("window") or 30.0)))
    out()
    out(f"== who is speaking, and where it cuts: {source.name[:38]} ==")
    out(f"   {duration:.0f}s from {FROM:.0f}s in")

    info = cw.ffprobe_json("ffprobe", source)
    stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    src_w, src_h = int(stream.get("width") or 0), int(stream.get("height") or 0)
    if not src_w:
        out("   dimensions unreadable")
        return

    started = time.monotonic()
    samples = speaker.measure(ffmpeg="ffmpeg", source=source, start=FROM, duration=duration,
                              src_w=src_w, src_h=src_h)
    took = time.monotonic() - started
    seen = [len(faces) for _t, faces in samples]
    if not samples:
        out("   the landmarker produced no samples at all")
        return
    out(f"   {len(samples)} samples over {duration:.0f}s in {took:.0f}s "
        f"({sum(seen) / len(seen):.1f} faces a frame, most {max(seen)}, "
        f"{sum(1 for n in seen if n == 0)} with none)")

    rows = speaker.assign_subjects(samples)
    series = speaker.subject_series(rows)
    where: dict[int, list[float]] = {}
    for row in rows:
        for cx, _cy, _size, _aperture, sid in row:
            where.setdefault(sid, []).append(cx)
    # A subject seen a handful of times is a false positive, not a person.
    people = {sid: xs for sid, xs in where.items() if len(xs) >= max(3, len(samples) // 10)}
    out(f"   {len(people)} person(s) of {len(where)} detected cluster(s):")
    for sid in sorted(people, key=lambda s: statistics.median(where[s])):
        values = [v for v in series.get(sid, []) if v is not None]
        moves = [abs(b - a) for a, b in zip(values, values[1:])]
        out(f"     #{sid} near {statistics.median(where[sid]) / src_w * 100:5.1f}% of the width, "
            f"seen {len(where[sid]):3d}x, mouth open {statistics.median(values or [0]):.3f} "
            f"of a face, moving {statistics.fmean(moves or [0]):.4f} a sample")

    envelope = speaker.audio_envelope(ffmpeg="ffmpeg", source=source, start=FROM,
                                      duration=duration, count=len(samples))
    out(f"   audio: {'read' if envelope else 'NOT READ -- the lips have nothing to agree with'}"
        + (f", loud on {sum(1 for v in envelope if v > 0.25)} of {len(envelope)} samples"
           if envelope else ""))

    plan = cw.speaker_crop_plan(source, "ffmpeg", "ffprobe", FROM, duration, 1080, 1920)
    if not plan.get("available"):
        out(f"   the tracker declined: {plan.get('reason')}")
        return
    keys = plan.get("keyframes") or []
    out(f"   {plan.get('shots')} shot(s) across {len(keys)} keyframe(s), motion "
        f"{plan.get('motion')}")
    for key in keys:
        centre = (key["x"] + key["w"] / 2) / src_w * 100
        out(f"     from {key['t']:6.2f}s  centre {centre:5.1f}% of the width")
    if r.get("centre") is not None and keys:
        drift = statistics.fmean([(k["x"] + k["w"] / 2) / src_w * 100 for k in keys]) - r["centre"]
        out(f"   against the static crop's {r['centre']:.1f}%: {drift:+.1f}% on average")


def main() -> int:
    sys.path.insert(0, "/app/worker")
    try:
        import clip_worker as cw
    except Exception as exc:  # noqa: BLE001
        out(f"clip_worker did not import: {type(exc).__name__}: {exc}")
        return 1

    try:
        import speaker
    except Exception as exc:  # noqa: BLE001
        out(f"the speaker module did not import: {type(exc).__name__}: {exc}")
        return 1

    out("== the detectors ==")
    # TWO OF THEM, and they answer different questions. MediaPipe is what the
    # render uses to decide who is speaking; OpenCV is what the STATIC fallback
    # uses when it cannot. Either being unusable is an answer rather than a
    # failed run -- and a far bigger finding than any number below.
    missing = speaker.available()
    out(f"  active speaker: {missing or 'MediaPipe and the landmark model are here'}")
    if missing:
        out("  !! Every clip on this box is therefore framed by the static crop.")
    problem = cw.cv2_problem()
    if problem:
        out(f"  static fallback: !! OpenCV is unusable here: {problem}")
        if missing:
            out("  With neither, every auto-framed clip is a plain centre crop.")
            return 0
    else:
        import cv2
        out(f"  static fallback: cv2 {cv2.__version__}")

    sources = pick_sources()
    if not sources:
        out("  no cached source to look at -- import a lecture and run this again")
        return 0
    out(f"  sweeping {len(sources)} cached source(s), {FRAMES} frames each over {SECONDS:g}s")

    out()
    out("== where the faces are, and what the STATIC fallback keeps ==")
    results = [r for r in (analyse(cw, cv2, path) for path in sources) if r] if not problem else []
    if problem:
        out("  skipped -- no usable OpenCV, which is what this section measures")

    tight = [r for r in results if r.get("verdict") == "TIGHT two-shot"]
    out()
    out("== summary ==")
    for r in results:
        out(f"  {r['source'].name[:28]:28s} {r['people']} person(s)  {r['verdict']}")
    if not tight:
        out("  No tight two-shot among these. The reported clip is a different lecture;")
        out("  re-run with framing_duration set to its length to reach it.")

    # The measurement is slow -- MediaPipe at 12.5Hz over a minute of video --
    # so it is asked about the case that matters rather than about all of them.
    if missing:
        return 0
    target = (tight or results)[:1] or [{"source": sources[0], "window": 60.0,
                                         "src_w": 0, "centre": None}]
    for r in target:
        speaker_view(cw, speaker, r)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
