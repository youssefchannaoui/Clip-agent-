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


def out(line: str = "") -> None:
    print(line, flush=True)


def pick_source() -> Path | None:
    """The cached source to look at: nearest WANT seconds, else the newest."""
    folder = DATA / "cache" / "sources"
    files = [p for p in folder.glob("*.mp4") if not p.name.startswith(".")] if folder.is_dir() else []
    if not files:
        return None
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
        return scored[0][1]
    return max(files, key=lambda p: p.stat().st_mtime)


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

    source = pick_source()
    if source is None:
        out("  no cached source to look at -- import a lecture and run this again")
        return 0
    out(f"  source {source.name}  ({source.stat().st_size / 1_048_576:.0f} MB)")

    info = cw.ffprobe_json("ffprobe", source)
    stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    src_w, src_h = int(stream.get("width") or 0), int(stream.get("height") or 0)
    out(f"  frame {src_w}x{src_h}")
    if not src_w:
        return 0

    # Every face in each sampled frame, using the SHIPPED detector set and the
    # shipped thresholds -- a probe that tunes its own detector answers a
    # question nobody asked.
    names = ("haarcascade_frontalface_alt2.xml", "haarcascade_frontalface_default.xml",
             "haarcascade_profileface.xml")
    detectors = [cv2.CascadeClassifier(cv2.data.haarcascades + n) for n in names]
    min_face = max(28, min(src_w, src_h) // 24)
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        out("  the source could not be opened")
        return 0

    out()
    out(f"== faces per frame, over the first {SECONDS:g}s ==")
    out("   t     faces  centres (x as % of width, box height in px)")
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
        row = [((b[0] + b[2] / 2) / src_w * 100, b[3]) for b in kept]
        per_frame.append(row)
        shown = "  ".join(f"{x:5.1f}% h{h}" for x, h in sorted(row))
        out(f"  {t:5.1f}s  {len(kept):3d}    {shown or '(none)'}")

    cap.release()
    faces = [x for row in per_frame for x, _ in row]
    multi = sum(1 for row in per_frame if len(row) > 1)
    out()
    out(f"  frames with more than one face: {multi} of {len(per_frame)}")

    # THE HYPOTHESIS, stated as a number. Split the face centres at the midpoint
    # between the extremes and see whether they form two groups with the shipped
    # crop's centre sitting in the gap between them.
    out()
    out("== what the SHIPPED static crop chooses ==")
    duration = max(5.0, min(SECONDS, 60.0))
    candidate = cw.Candidate(start=0.0, end=duration, text="", segments=[], score=0, reasons=[], quote_risk=False)
    crop = cw.detect_main_face_crop(source, "ffprobe", candidate, 1080, 1920)
    if not crop:
        out("  no crop was returned (already narrow enough, or nothing found)")
    else:
        centre = (crop["x"] + crop["w"] / 2) / src_w * 100
        out(f"  method {crop.get('method')}  centre {centre:.1f}% of width  "
            f"box {crop['w']}x{crop['h']} at x={crop['x']}")
        if len(faces) >= 4:
            lo, hi = min(faces), max(faces)
            mid = (lo + hi) / 2
            left = [x for x in faces if x < mid]
            right = [x for x in faces if x >= mid]
            spread = hi - lo
            if left and right and spread > 12:
                lc, rc = statistics.fmean(left), statistics.fmean(right)
                out(f"  face clusters: {len(left)} near {lc:.1f}% and {len(right)} near {rc:.1f}%"
                    f"  (gap {rc - lc:.1f}% of the width)")
                between = min(lc, rc) < centre < max(lc, rc)
                nearest = min(abs(centre - lc), abs(centre - rc))
                if between and nearest > (rc - lc) * 0.25:
                    out(f"  !! THE CROP IS CENTRED BETWEEN THEM, {nearest:.1f}% from the nearer face.")
                    out("     This is the reported fault: with two faces of similar size the")
                    out("     largest alternates per sample and the median lands in the valley.")
                else:
                    out(f"  the crop sits on a cluster ({nearest:.1f}% from the nearer face)")
            else:
                out("  one cluster of faces -- the case that already looks right")
        # THE DIRECT MEASURE OF THE COMPLAINT: which faces the crop actually
        # keeps. A centre that reads as reasonable can still cut a person out.
        left_edge = crop["x"] / src_w * 100
        right_edge = (crop["x"] + crop["w"]) / src_w * 100
        out(f"  the crop keeps {left_edge:.1f}% to {right_edge:.1f}% of the width")
        for row in per_frame:
            if not row:
                continue
        seen: dict[int, list[float]] = {}
        for row in per_frame:
            for x, h in row:
                seen.setdefault(round(x / 5) * 5, []).append(h)
        for bucket in sorted(seen):
            heights = seen[bucket]
            inside = left_edge <= bucket <= right_edge
            out(f"    a face near {bucket:3d}% (seen {len(heights):2d}x, median height "
                f"{int(statistics.median(heights)):3d}px) is {'INSIDE' if inside else 'OUTSIDE'} the crop")

    out()
    out("== what the ACTIVE-SPEAKER tracker would choose (wired to nothing today) ==")
    plan = cw.track_speaker_keyframes(source, "ffprobe", 0.0, duration, 1080, 1920)
    if not plan.get("available"):
        out(f"  unavailable: {plan.get('reason')}")
    else:
        keys = plan.get("keyframes") or []
        xs = [(k["x"] + k["w"] / 2) / src_w * 100 for k in keys]
        out(f"  method {plan.get('method')}  {len(keys)} keyframe(s)")
        if xs:
            out(f"  centre: first {xs[0]:.1f}%  last {xs[-1]:.1f}%  "
                f"min {min(xs):.1f}%  max {max(xs):.1f}%  travel {max(xs) - min(xs):.1f}% of width")
            step = max((abs(b - a) for a, b in zip(xs, xs[1:])), default=0.0)
            out(f"  largest step between keyframes: {step:.1f}% of width")
            if crop:
                shipped = (crop["x"] + crop["w"] / 2) / src_w * 100
                out(f"  against the shipped static centre of {shipped:.1f}%: "
                    f"the tracker sits {statistics.fmean(xs) - shipped:+.1f}% from it on average")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
