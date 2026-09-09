"""Who is speaking, measured against the audio, and a crop that CUTS to them.

Youssef, 9 Sept 2026, on a two-person podcast: "it doesn't even know who's
speaking ... it was framing the opposite guy. Second off, it's not stable. It
moves while they speak ... It should be CUTTING to the person who's speaking."

Three faults, and each is answered by a different mechanism:

1. IT DID NOT KNOW WHO WAS SPEAKING. The shipped tracker's "mouth movement"
   was the mean absolute pixel difference of the lower half of a Haar box
   against the same region half a second earlier. A Haar box jitters between
   frames, and its jitter scales with the box, so that number measured FACE
   SIZE far more than it measured speech -- the nearest face won whether or
   not its mouth was open, which is "it was framing the opposite guy".
   Here the signal is the LIP APERTURE: the gap between the inner upper and
   lower lip, divided by the face's own height, so it is dimensionless and a
   face twice as big scores exactly the same. And it is correlated against the
   AUDIO -- a mouth that opens and closes in time with the sound is the one
   making it. That is the cheap half of SyncNet, which is what every serious
   active-speaker detector is built on; the expensive half is a learned
   embedding, and this needs no weights.

2. IT MOVED WHILE THEY SPOKE. The shipped tracker eased the crop toward the
   newest detection on every sample (`smooth_x += (cx - smooth_x) * 0.35`), so
   a box wobbling by twenty pixels dragged the frame about for the whole clip.
   Here a shot's crop is ONE number -- the median of where that person was
   over the shot -- and it does not move until the shot ends. A median over
   twenty samples is unmoved by a wobbling detection by construction.

3. IT PANNED WHERE AN EDITOR WOULD CUT. Every change of framing here is a
   step: one value up to the instant and another after it. That also makes the
   ffmpeg crop expression a handful of constants instead of a chain of ramps --
   and a chain of ramps is what ffmpeg refused in production on 9 Sept 2026,
   taking a whole lecture with it.

THE MEASUREMENT AND THE DECISION ARE SEPARATE, and that is load-bearing rather
than tidy. Measuring needs MediaPipe, a decoder and a real face, so it can only
run on the box; WHO IS TALKING and WHERE THE CROP GOES are arithmetic, and
arithmetic is tested here against a described shot. v3.179.0 established that
split after a rebuild that could not be tested at all; this module keeps it.

Everything fails soft. No model, no MediaPipe, no face, no audio: plan()
returns a reason and the caller falls back to the static crop, which is what
every render did before any of this existed.
"""
from __future__ import annotations

import math
import statistics
import subprocess
import time
from array import array
from pathlib import Path
from typing import Any

# Vendored beside this module rather than downloaded at render time, for the
# reason models/NOTICE.md already gives: a render must not depend on Google's
# CDN being reachable. Apache-2.0.
MODEL = Path(__file__).resolve().parent / "models" / "face_landmarker.task"

# A mouth opens and closes several times a second, so the sample rate has to be
# fast enough to see a syllable. The shipped tracker ran at 2Hz, which cannot:
# at that rate a mouth is open in one frame and open in the next and the shape
# of the movement is gone. 12.5Hz is 80ms a sample, and it divides the audio
# window evenly.
SAMPLE_HZ = 12.5

# Frames are scaled to this before the landmarker sees them. Its own detector
# works on a small input anyway, and decoding 1080p at 12.5Hz costs more than
# the landmarks do. A face 200px wide in a 1920 source is still 100px here,
# which is comfortably above the ~64px the mesh needs.
SAMPLE_WIDTH = 960

# How many faces to look for. A podcast panel is three or four; asking for more
# costs a mesh pass per face per frame and finds furniture.
MAX_FACES = 4

# The inner lip centres in MediaPipe's 478-point face mesh. The OUTER pair
# (0 and 17) moves with the jaw as well as the mouth, so it reads a chewing
# listener as loudly as a talker.
UPPER_LIP, LOWER_LIP = 13, 14

# The correlation window, in seconds. SyncNet averages its per-frame scores
# over 10-100 frames for exactly this reason: one frame of a mouth being open
# says nothing, and a second of a mouth tracking the audio says a great deal.
WINDOW_SECONDS = 1.2

# A challenger must out-score the person currently framed by this much. Not a
# hysteresis counter as well -- the correlation window above is already a
# second of smoothing, and the minimum shot below is what actually stops the
# frame ping-ponging.
SPEAKER_MARGIN = 1.25

# No shot is shorter than this. This is the rule that makes the result watchable:
# without it a sentence traded back and forth cuts every half second, which is
# a worse fault than the one being fixed.
MIN_SHOT_SECONDS = 1.6

# How far the person being framed may drift from where the shot framed them
# before the shot ends and a new one begins on them, as a fraction of the crop
# WIDTH. On a seated podcast this never fires. On somebody walking across a
# stage it fires a handful of times, which is how a locked camera follows a
# walker: by cutting, not by panning. It scales with the crop so it means the
# same thing on every shot size.
SHOT_DRIFT = 0.22

# A wall-clock ceiling on the measurement. It runs once per clip on a box that
# renders several at a time, so a pathological source must cost a partial
# answer rather than the job's whole budget. What has been measured so far is
# still used: the last shot simply holds for the rest of the clip.
MEASURE_BUDGET_SECONDS = 180.0

# The speech band, and the RMS window. Band-limiting keeps room rumble and hiss
# out of the envelope the lips are correlated against.
AUDIO_RATE = 16000
AUDIO_BAND = "highpass=f=200,lowpass=f=3500"


def available() -> str | None:
    """None when the speaker can be measured, otherwise why not."""
    if not MODEL.exists():
        return f"face landmark model missing at {MODEL}"
    try:
        import mediapipe  # noqa: F401
        from mediapipe.tasks.python import vision  # noqa: F401
    except Exception as error:  # pragma: no cover - environment dependent
        return f"mediapipe unavailable ({error.__class__.__name__}: {error})"
    try:
        import numpy  # noqa: F401
    except Exception as error:  # pragma: no cover - environment dependent
        return f"numpy unavailable ({error.__class__.__name__})"
    return None


# ---------------------------------------------------------------------------
# Measurement. Needs MediaPipe, a decoder and a real face, so it is exercised
# on the box and by nothing here.
# ---------------------------------------------------------------------------

def measure(
    *, ffmpeg: str, source: Path, start: float, duration: float,
    src_w: int, src_h: int, sample_hz: float = SAMPLE_HZ, max_faces: int = MAX_FACES,
) -> list[tuple[float, list[tuple[float, float, float, float]]]]:
    """Per sampled frame: (t, [(cx, cy, size, aperture), ...]) in SOURCE pixels.

    Landmarks come back normalised to the image, so multiplying by the source's
    own width and height puts every position straight into the coordinate space
    the crop is computed in -- the frames themselves are decoded small and their
    size never leaves this function.
    """
    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    width = max(2, int(round(min(SAMPLE_WIDTH, src_w) / 2)) * 2)
    height = max(2, int(round(width * src_h / max(1, src_w) / 2)) * 2)
    frame_bytes = width * height * 3
    step = 1.0 / max(1.0, sample_hz)

    decode = [
        ffmpeg, "-v", "error", "-nostdin",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source),
        "-an", "-vf", f"fps={sample_hz:g},scale={width}:{height}",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=max(1, int(max_faces)),
    )

    samples: list[tuple[float, list[tuple[float, float, float, float]]]] = []
    reader: subprocess.Popen[bytes] | None = None
    deadline = time.monotonic() + MEASURE_BUDGET_SECONDS
    try:
        reader = subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert reader.stdout is not None
        with vision.FaceLandmarker.create_from_options(options) as model:
            index = 0
            while time.monotonic() < deadline:
                raw = reader.stdout.read(frame_bytes)
                if len(raw) < frame_bytes:
                    break
                frame = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3).copy()
                stamp = int(round(index * step * 1000))
                found = model.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), stamp)
                faces: list[tuple[float, float, float, float]] = []
                for marks in (getattr(found, "face_landmarks", None) or []):
                    face = _face_from_landmarks(marks, src_w, src_h)
                    if face is not None:
                        faces.append(face)
                samples.append((index * step, faces))
                index += 1
    finally:
        if reader is not None:
            if reader.stdout is not None:
                reader.stdout.close()
            if reader.poll() is None:
                reader.kill()
            reader.wait(timeout=10)
    return samples


def _face_from_landmarks(marks: Any, src_w: int, src_h: int,
                         ) -> tuple[float, float, float, float] | None:
    """One face's centre, size and lip aperture, in source pixels.

    THE APERTURE IS DIVIDED BY THE FACE'S OWN HEIGHT and is therefore
    dimensionless. That single division is what stops the nearest face winning:
    the shipped signal was a pixel difference, which grows with the box whether
    or not anything is being said.
    """
    if len(marks) <= max(UPPER_LIP, LOWER_LIP):
        return None
    xs = [float(point.x) for point in marks]
    ys = [float(point.y) for point in marks]
    face_h = (max(ys) - min(ys)) * src_h
    face_w = (max(xs) - min(xs)) * src_w
    if face_h <= 1.0 or face_w <= 1.0:
        return None
    cx = (min(xs) + max(xs)) / 2.0 * src_w
    cy = (min(ys) + max(ys)) / 2.0 * src_h
    gap = abs(float(marks[LOWER_LIP].y) - float(marks[UPPER_LIP].y)) * src_h
    return (cx, cy, max(face_w, face_h), gap / face_h)


def audio_envelope(
    *, ffmpeg: str, source: Path, start: float, duration: float,
    count: int, sample_hz: float = SAMPLE_HZ, timeout: float = 120.0,
) -> list[float]:
    """How loud the speech band is at each sample, 0..1 against this clip.

    Relative to the clip's OWN loudest moment rather than to an absolute, for
    the same reason the lip signal is compared within the frame: a quietly
    recorded lecture and a loud one must produce the same envelope shape.
    Deliberately free of numpy -- it is the one half of the measurement that
    can be driven with real ffmpeg on a machine with no MediaPipe on it.
    """
    if count <= 0 or duration <= 0:
        return []
    command = [
        ffmpeg, "-v", "error", "-nostdin",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source),
        "-vn", "-af", AUDIO_BAND, "-ac", "1", "-ar", str(AUDIO_RATE),
        "-f", "s16le", "-",
    ]
    try:
        done = subprocess.run(command, capture_output=True, timeout=timeout)
    except Exception:
        return []
    raw = done.stdout or b""
    if len(raw) < 2:
        return []
    pcm = array("h")
    pcm.frombytes(raw[: len(raw) // 2 * 2])
    window = max(1, int(AUDIO_RATE / max(1.0, sample_hz)))
    levels: list[float] = []
    for index in range(count):
        at = int(index * AUDIO_RATE / max(1.0, sample_hz))
        chunk = pcm[at: at + window]
        if not chunk:
            levels.append(0.0)
            continue
        levels.append(math.sqrt(sum(float(v) * v for v in chunk) / len(chunk)))
    return _normalise(levels)


def _normalise(levels: list[float]) -> list[float]:
    """Scale to 0..1 against a high percentile, so one clap cannot flatten it."""
    if not levels:
        return []
    ranked = sorted(levels)
    ceiling = ranked[min(len(ranked) - 1, int(len(ranked) * 0.95))]
    if ceiling <= 1e-9:
        return [0.0] * len(levels)
    return [max(0.0, min(1.0, value / ceiling)) for value in levels]


# ---------------------------------------------------------------------------
# The decision. Pure arithmetic, and every test in test_active_speaker.py
# drives these directly.
# ---------------------------------------------------------------------------

def assign_subjects(
    samples: list[tuple[float, list[tuple[float, float, float, float]]]],
) -> list[list[tuple[float, float, float, float, int]]]:
    """Give every detection the id of the PERSON it belongs to.

    Two detections are the same person when they are closer than the face is
    wide. The face's own size is the merge distance, so it scales with the shot
    where a threshold in pixels or per cent could not -- and telling "the same
    person one sample later" from "the other person" is what everything below
    rests on. Landmark detection re-orders its results between frames, so
    position is the only thing that can carry identity here.

    THE SMALLER OF THE TWO SIZES, not the larger. A big face beside a small one
    reaches far enough to swallow it, and then both people are one subject whose
    position alternates between them -- which is the averaged crop this whole
    module exists to remove, arriving through the back door. Measured: a 320px
    face at x=1500 and a 140px face at x=1250 merged under `max` and are two
    people under `min`.
    """
    subjects: list[tuple[float, float, float]] = []
    out: list[list[tuple[float, float, float, float, int]]] = []
    for _t, faces in samples:
        row: list[tuple[float, float, float, float, int]] = []
        for cx, cy, size, aperture in faces:
            best, best_distance = -1, None
            for index, (sx, _sy, ssize) in enumerate(subjects):
                distance = abs(cx - sx)
                if distance <= min(size, ssize) * 0.9 and (best_distance is None or distance < best_distance):
                    best, best_distance = index, distance
            if best < 0:
                subjects.append((cx, cy, size))
                best = len(subjects) - 1
            else:
                subjects[best] = (cx, cy, size)
            row.append((cx, cy, size, aperture, best))
        out.append(row)
    return out


def correlate(a: list[float], b: list[float]) -> float:
    """Pearson correlation, and 0 rather than an error when either is flat.

    A mouth that never moves has no variance, so there is nothing for the audio
    to agree with -- and 0 is the honest answer rather than a division by zero
    or a spurious 1.0.
    """
    n = min(len(a), len(b))
    if n < 3:
        return 0.0
    xs, ys = a[:n], b[:n]
    mx = sum(xs) / n
    my = sum(ys) / n
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 1e-12 or vy <= 1e-12:
        return 0.0
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return max(-1.0, min(1.0, cov / math.sqrt(vx * vy)))


def subject_series(rows: list[list[tuple[float, float, float, float, int]]],
                   ) -> dict[int, list[float | None]]:
    """{subject: [aperture or None per sample]} -- None where they were missed."""
    series: dict[int, list[float | None]] = {}
    for index, row in enumerate(rows):
        for _cx, _cy, _size, aperture, sid in row:
            if sid not in series:
                series[sid] = [None] * len(rows)
            series[sid][index] = aperture
    return series


def speech_scores(
    rows: list[list[tuple[float, float, float, float, int]]],
    envelope: list[float],
    window: int,
) -> list[dict[int, float]]:
    """How strongly each subject is speaking at each sample.

    TWO THINGS MUST BOTH BE TRUE, and neither is enough alone:

    * the mouth is MOVING -- the mean change in aperture across the window. A
      listener's mouth is still, and stillness scores zero whatever else it
      correlates with;
    * it moves IN TIME WITH THE AUDIO -- the correlation of the aperture with
      the envelope over the same window. A listener who happens to be chewing
      moves a great deal and matches nothing.

    Movement is the base and correlation is a multiplier between 0.55 and 1.0,
    rather than the other way round: correlation is noisy over a short window
    and a confident wrong sign must never be able to outvote a mouth that is
    plainly working.
    """
    count = len(rows)
    series = subject_series(rows)
    half = max(1, window // 2)
    scores: list[dict[int, float]] = []
    for index in range(count):
        low = max(0, index - half)
        high = min(count, index + half + 1)
        env = envelope[low:high] if envelope else []
        row: dict[int, float] = {}
        for sid, values in series.items():
            slice_ = values[low:high]
            present = [(offset, v) for offset, v in enumerate(slice_) if v is not None]
            if len(present) < 2:
                continue
            moves = [abs(b - a) for (_i, a), (_j, b) in zip(present, present[1:])]
            energy = sum(moves) / len(moves) if moves else 0.0
            agreement = 0.0
            if env and len(env) == len(slice_):
                paired = [(v, env[offset]) for offset, v in present]
                agreement = correlate([p[0] for p in paired], [p[1] for p in paired])
            row[sid] = energy * (0.55 + 0.45 * max(0.0, agreement))
        scores.append(row)
    return scores


def speaking_subject(
    scores: list[dict[int, float]],
    speaking: list[bool],
    margin: float = SPEAKER_MARGIN,
) -> list[int | None]:
    """Which subject holds the frame at each sample.

    The frame is HELD until a challenger beats the person in it by `margin`.
    Through silence it is held outright -- nobody is speaking, so nothing about
    a pause is a reason to move the camera, and every face's mouth twitches a
    little when its owner is listening.
    """
    held: int | None = None
    chosen: list[int | None] = []
    for index, row in enumerate(scores):
        quiet = index < len(speaking) and not speaking[index]
        if not row or quiet:
            chosen.append(held)
            continue
        # The lowest id breaks a tie, so an equal pair is decided by who was
        # seen first rather than by dictionary order. It matters only on the
        # opening sample: after that the frame is held unless it is beaten.
        best = max(row, key=lambda sid: (row[sid], -sid))
        if held is None or held not in row:
            held = best
        elif best != held and row[best] >= max(row[held], 1e-9) * margin:
            held = best
        chosen.append(held)
    return chosen


def last_seen(rows: list[list[tuple[float, float, float, float, int]]],
              ) -> list[dict[int, tuple[float, float]]]:
    """Where each subject was last seen, at each sample.

    A frame the detector missed must not recentre the crop, so the last known
    position of everybody is carried forward rather than going blank.
    """
    known: dict[int, tuple[float, float]] = {}
    out: list[dict[int, tuple[float, float]]] = []
    for row in rows:
        for cx, cy, _size, _aperture, sid in row:
            known[sid] = (cx, cy)
        out.append(dict(known))
    return out


def shots(
    times: list[float],
    chosen: list[int | None],
    seen: list[dict[int, tuple[float, float]]],
    duration: float,
    crop_width: float,
    min_shot: float = MIN_SHOT_SECONDS,
    drift: float = SHOT_DRIFT,
) -> list[dict[str, Any]]:
    """The cuts: a list of {start, end, subject, x, y, reason}.

    A SHOT'S FRAMING IS ITS OWN MEDIAN and never moves. That is fault 2 -- "it
    moves while they speak" -- answered by construction rather than by a gentler
    smoother: a median over twenty samples cannot be dragged by a wobbling
    detection, and it is always a real position of one real person, so it can
    never land in the gap between two of them.

    A shot ends for one of two reasons and they are treated differently:

    * the SPEAKER changed. Bounded by `min_shot`, because a sentence traded
      back and forth would otherwise cut every half second, which is worse to
      watch than the fault being fixed.
    * the person being framed DRIFTED out of where the shot framed them. Not
      bounded by `min_shot`: the alternative to cutting is letting them walk
      out of the picture. It is the same person either way, so this is a
      re-frame rather than a change of subject.
    """
    runs: list[dict[str, Any]] = []
    limit = max(1.0, crop_width) * max(0.02, drift)
    for index, sid in enumerate(chosen):
        if sid is None or sid not in seen[index]:
            continue
        point = seen[index][sid]
        current = runs[-1] if runs else None
        if current is not None and current["subject"] == sid:
            xs = current["xs"] + [point[0]]
            ys = current["ys"] + [point[1]]
            if abs(point[0] - statistics.median(current["xs"])) <= limit:
                current["xs"], current["ys"] = xs, ys
                current["last"] = times[index]
                continue
            reason = "reframe"
        else:
            reason = "speaker"
        runs.append({
            "subject": sid, "reason": reason, "at": times[index], "last": times[index],
            "xs": [point[0]], "ys": [point[1]],
        })
    if not runs:
        return []

    merged = _merge_short_runs(runs, min_shot)
    out: list[dict[str, Any]] = []
    for position, run in enumerate(merged):
        start = 0.0 if position == 0 else run["at"]
        end = merged[position + 1]["at"] if position + 1 < len(merged) else max(duration, run["last"])
        shot = {
            "start": round(start, 3), "end": round(end, 3), "subject": run["subject"],
            "reason": run["reason"] if position else "open",
            "x": statistics.median(run["xs"]), "y": statistics.median(run["ys"]),
        }
        # TWO SHOTS FRAMED AT THE SAME PLACE ARE ONE SHOT, whoever the detector
        # thought they were. Identity is carried by position and a detection
        # that comes back small for a frame can split one person into two ids;
        # the framing is what a viewer sees, so the framing is what decides.
        if out and abs(shot["x"] - out[-1]["x"]) <= 2.0 and abs(shot["y"] - out[-1]["y"]) <= 2.0:
            out[-1]["end"] = shot["end"]
            continue
        out.append(shot)
    return out


def _merge_short_runs(runs: list[dict[str, Any]], min_shot: float) -> list[dict[str, Any]]:
    """Absorb a change of speaker that did not last, and join equal neighbours.

    A run is measured against the START of the run after it rather than its own
    last sample: a shot lasts until it is replaced, so a subject seen once and
    then missed for two seconds still held the frame for those two seconds.
    """
    kept: list[dict[str, Any]] = []
    for index, run in enumerate(runs):
        following = runs[index + 1]["at"] if index + 1 < len(runs) else None
        length = (following - run["at"]) if following is not None else float("inf")
        brief = length < min_shot and run["reason"] == "speaker"
        if not kept and brief:
            # The opening run, and it did not last. There is nothing behind it
            # to absorb it, so it is dropped and the clip opens on whoever
            # takes over -- which is what an editor does rather than cutting a
            # second in. A lone run is never brief: with nothing after it, its
            # length is the rest of the clip.
            continue
        # A REFRAME IS NEVER JOINED BACK ON. It is the same subject by
        # definition -- that is what makes it a reframe rather than a cut to
        # somebody else -- so a bare same-subject join would undo every split
        # the drift rule just made and a walker would be lost again.
        same = bool(kept) and kept[-1]["subject"] == run["subject"]
        if kept and (brief or (same and run["reason"] != "reframe")):
            # ONLY THE SAME PERSON'S POSITIONS BUILD A SHOT'S FRAMING. A brief
            # run absorbed from somebody ELSE brings its own positions with it,
            # and under crosstalk those can outnumber the held speaker's inside
            # one shot -- which puts the median on the wrong person, or between
            # the two of them. That is the averaged crop this module exists to
            # remove, arriving through the merge.
            if same:
                kept[-1]["xs"].extend(run["xs"])
                kept[-1]["ys"].extend(run["ys"])
            kept[-1]["last"] = max(kept[-1]["last"], run["last"])
            continue
        kept.append(dict(run))
    return kept


def shot_keyframes(plan: list[dict[str, Any]], tolerance: float = 2.0,
                   ) -> list[tuple[float, float, float]]:
    """(t, x, y) per shot, or one entry when the framing never really changes.

    A plan that survives as a single keyframe becomes a plain static crop --
    four integers rather than an expression -- which is exactly the behaviour
    every render had before any of this existed.
    """
    if not plan:
        return []
    points = [(float(shot["start"]), float(shot["x"]), float(shot["y"])) for shot in plan]
    if max(abs(p[1] - points[0][1]) for p in points) <= tolerance and \
            max(abs(p[2] - points[0][2]) for p in points) <= tolerance:
        return [points[0]]
    return points


def plan(
    *, ffmpeg: str, source: Path, start: float, duration: float,
    src_w: int, src_h: int, crop_width: float,
    speech_spans: list[tuple[float, float]] | None = None,
    sample_hz: float = SAMPLE_HZ, max_faces: int = MAX_FACES,
) -> dict[str, Any]:
    """Measure the clip and answer with the shots, or with why it could not."""
    reason = available()
    if reason:
        return {"available": False, "reason": reason}
    if duration <= 0 or src_w <= 0 or src_h <= 0:
        return {"available": False, "reason": "The clip has no length or no dimensions."}
    try:
        samples = measure(
            ffmpeg=ffmpeg, source=source, start=start, duration=duration,
            src_w=src_w, src_h=src_h, sample_hz=sample_hz, max_faces=max_faces,
        )
    except Exception as error:  # pragma: no cover - environment dependent
        return {"available": False, "reason": f"{error.__class__.__name__}: {error}"}
    if not any(faces for _t, faces in samples):
        return {"available": False, "reason": "No face was found in this clip."}

    times = [t for t, _faces in samples]
    envelope = audio_envelope(
        ffmpeg=ffmpeg, source=source, start=start, duration=duration,
        count=len(samples), sample_hz=sample_hz,
    )
    rows = assign_subjects(samples)
    window = max(3, int(round(WINDOW_SECONDS * sample_hz)))
    scores = speech_scores(rows, envelope, window)
    speaking = speech_flags(times, speech_spans)
    chosen = speaking_subject(scores, speaking)
    cuts = shots(times, chosen, last_seen(rows), duration, crop_width)
    if not cuts:
        return {"available": False, "reason": "Nobody could be followed in this clip."}
    return {
        "available": True, "shots": cuts, "samples": len(samples),
        "subjects": len({shot["subject"] for shot in cuts}),
        "audio": bool(envelope),
    }


def speech_flags(times: list[float], spans: list[tuple[float, float]] | None) -> list[bool]:
    """Whether somebody is talking at each sample, from Whisper's own timings.

    Nothing new is measured for this: the transcript already knows. With no
    spans at all every sample counts as speech, which is what the tracker did
    before this existed.
    """
    if not spans:
        return [True] * len(times)
    return [any(low <= t <= high for low, high in spans) for t in times]
