"""Where the crop actually lands on this box's own footage, and why.

Youssef, 9 Sept 2026, with a two-person podcast clip on screen: "see if its 2
people in one frame the framing is not doing well, but once theres 2 people on
oppisite sides it does well so who ever talks its must be central."

That pair of observations is a fingerprint, and reading the code gives a
candidate cause: `detect_main_face_crop` takes the LARGEST face in each sampled
frame and then the MEDIAN of those centres across the clip. With two faces of
similar size the largest alternates between them from sample to sample, so the
median of a two-humped set lands in the VALLEY -- between the heads -- and the
person talking ends up at the edge of the crop. Two people far apart at
different sizes have one that dominates every sample, so the median lands on
them and it looks right.

That is a hypothesis until something measures it, and it cannot be measured
anywhere but here: this container is the only place with OpenCV, the Haar
cascades and real lectures at the same time. So this probe reports, per sampled
frame of a real source:

* how many faces the shipped detector finds, and where;
* what the shipped static crop chooses, and whether that centre sits between
  two clusters of faces rather than on one;
* what `track_speaker_keyframes` -- the active-speaker tracker that has been
  written, unit-tested and wired to NOTHING since it was built -- chooses over
  the same window, and whether it moves.

It changes nothing and renders nothing. CLAUDE.md has carried "wiring active
speaker framing in unseen is the failure this file exists to prevent" as an
open item for weeks; this is the measurement that has to come first.
"""
import json
import math
import os
import statistics
import sys
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
    people: dict[int, list[int]] = {}
    for row in per_frame:
        for x, h in row:
            people.setdefault(round(x / 4) * 4, []).append(h)
    real = {pos: hs for pos, hs in people.items() if len(hs) >= max(2, len(per_frame) // 4)}
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
        out("   the shipped crop returned nothing (already narrow, or nothing found)")
        return {}
    centre = (crop["x"] + crop["w"] / 2) / src_w * 100
    left_edge, right_edge = crop["x"] / src_w * 100, (crop["x"] + crop["w"]) / src_w * 100
    out(f"   SHIPPED crop: {crop.get('method')}, centre {centre:.1f}%, keeps "
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
            "source": source, "people": len(real)}


def main() -> int:
    sys.path.insert(0, "/app/worker")
    try:
        import clip_worker as cw
    except Exception as exc:  # noqa: BLE001
        out(f"clip_worker did not import: {type(exc).__name__}: {exc}")
        return 1

    problem = cw.cv2_problem()
    out("== the detector ==")
    if problem:
        # Not a failed run: it is the answer, and the honest one. A box with no
        # working OpenCV falls back to a centre crop for every job, which is a
        # far bigger finding than any number below.
        out(f"  !! OpenCV is unusable here: {problem}")
        out("  Every auto-framed clip on this box is therefore a centre crop.")
        return 0
    import cv2
    out(f"  cv2 {cv2.__version__}")

    sources = pick_sources()
    if not sources:
        out("  no cached source to look at -- import a lecture and run this again")
        return 0
    out(f"  sweeping {len(sources)} cached source(s), {FRAMES} frames each over {SECONDS:g}s")

    out()
    out("== where the faces are, and what the shipped crop keeps ==")
    results = [r for r in (analyse(cw, cv2, path) for path in sources) if r]

    tight = [r for r in results if r.get("verdict") == "TIGHT two-shot"]
    out()
    out("== summary ==")
    for r in results:
        out(f"  {r['source'].name[:28]:28s} {r['people']} person(s)  {r['verdict']}")
    if not tight:
        out("  No tight two-shot among these. The reported clip is a different lecture;")
        out("  re-run with framing_duration set to its length to reach it.")

    # The tracker is slow -- around thirty seconds a source -- so it is asked
    # about the case that matters rather than about all of them.
    target = (tight or results)[:1]
    for r in target:
        out()
        out(f"== what the ACTIVE-SPEAKER tracker would choose for {r['source'].name[:28]} ==")
        out("   (it is written, unit-tested and wired to NOTHING: the render calls")
        out("    detect_main_face_crop instead)")
        plan = cw.track_speaker_keyframes(r["source"], "ffprobe", 0.0, r["duration"], 1080, 1920)
        if not plan.get("available"):
            out(f"   unavailable: {plan.get('reason')}")
            continue
        keys = plan.get("keyframes") or []
        xs = [(k["x"] + k["w"] / 2) / r["src_w"] * 100 for k in keys]
        out(f"   method {plan.get('method')}  {len(keys)} keyframe(s)")
        if xs:
            step = max((abs(b - a) for a, b in zip(xs, xs[1:])), default=0.0)
            out(f"   centre: first {xs[0]:.1f}%  last {xs[-1]:.1f}%  "
                f"range {min(xs):.1f}%..{max(xs):.1f}%  travel {max(xs) - min(xs):.1f}%")
            out(f"   largest step between keyframes: {step:.1f}% of width")
            out(f"   against the shipped static centre of {r['centre']:.1f}%: "
                f"{statistics.fmean(xs) - r['centre']:+.1f}% on average")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
