"""Acoustic features for clip selection.

Clip scoring reads the transcript and nothing else, which means it is deaf to
how a lecture is actually delivered. In oratory the strongest moment is
usually the one where the speaker raises their voice, slows down, or pauses
before landing a point — none of which leaves a trace in the text. Two
passages can be word-for-word equally good and completely different on air.

`extract_audio()` already writes `speech.wav` as 16 kHz mono PCM before
transcription, so the signal is sitting on disk unused. This module turns it
into a small set of cheap, explainable numbers.

Design constraints, in the order that mattered:

* **No new dependencies.** Everything here is standard library. The worker
  container is memory-constrained and already carries Whisper and OpenCV.
* **Streaming, never fully loaded.** A three-hour lecture at 16 kHz/16-bit is
  345 MB of samples. Only the envelope is kept: at 50 ms frames that is about
  216,000 floats, under 2 MB.
* **Relative, not absolute.** Every loudness figure is expressed against the
  median level of *this* recording. A quiet lapel mic and a hot desk mic must
  score the same speaker the same way.
* **Never fatal.** Missing, malformed or unreadable audio returns `None` and
  scoring silently continues on text alone. Audio is an enhancement to a
  working pipeline, not a new way for a job to die.
"""

from __future__ import annotations

import contextlib
import math
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:  # Removed in Python 3.13; the container pins 3.12, so this is the fast path.
    import audioop  # type: ignore
except Exception:  # pragma: no cover - exercised on 3.13+ only
    audioop = None  # type: ignore

FRAME_MS = 50
# Frames quieter than this fraction of the recording's median level count as
# silence. Speech pauses in a lecture hall are rarely true digital silence —
# there is breath, room tone and audience noise — so an absolute threshold
# finds nothing on real recordings.
SILENCE_FRACTION = 0.22
# Longest pause worth measuring at a clip boundary. Past a couple of seconds
# the distinction stops mattering for the cut.
MAX_PAUSE_SEC = 3.0
# Samples stepped over in the dependency-free fallback. An energy envelope
# survives decimation easily; per-sample exactness buys nothing here.
FALLBACK_STRIDE = 4


def _rms(block: bytes, width: int) -> float:
    if audioop is not None:
        try:
            return float(audioop.rms(block, width))
        except Exception:
            return 0.0
    if width != 2:
        return 0.0
    samples = array("h")
    samples.frombytes(block[: len(block) - (len(block) % 2)])
    if not samples:
        return 0.0
    stepped = samples[::FALLBACK_STRIDE]
    if not stepped:
        return 0.0
    return math.sqrt(sum(value * value for value in stepped) / len(stepped))


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0


@dataclass
class AudioEnvelope:
    """A loudness reading per frame, plus the reference levels for this recording."""

    frame_sec: float
    rms: list[float]
    median: float
    silence_floor: float

    @property
    def duration(self) -> float:
        return len(self.rms) * self.frame_sec

    def _slice(self, start: float, end: float) -> list[float]:
        if end <= start or not self.rms:
            return []
        first = max(0, int(start / self.frame_sec))
        last = min(len(self.rms), int(math.ceil(end / self.frame_sec)))
        return self.rms[first:last] if last > first else []

    def _pause_before(self, moment: float) -> float:
        """Length of unbroken quiet ending at `moment`."""
        index = int(moment / self.frame_sec) - 1
        frames = 0
        limit = int(MAX_PAUSE_SEC / self.frame_sec)
        while index >= 0 and frames < limit and self.rms[index] <= self.silence_floor:
            frames += 1
            index -= 1
        return round(frames * self.frame_sec, 3)

    def _pause_after(self, moment: float) -> float:
        """Length of unbroken quiet starting at `moment`."""
        index = int(math.ceil(moment / self.frame_sec))
        frames = 0
        limit = int(MAX_PAUSE_SEC / self.frame_sec)
        while index < len(self.rms) and frames < limit and self.rms[index] <= self.silence_floor:
            frames += 1
            index += 1
        return round(frames * self.frame_sec, 3)

    def features(self, start: float, end: float) -> dict[str, float] | None:
        """Acoustic summary of one candidate window, or None if it has no audio.

        Every loudness figure is a ratio against the recording's median frame,
        so the numbers mean the same thing on a quiet recording and a loud one.
        """
        window = self._slice(start, end)
        if not window or self.median <= 0:
            return None
        mean_level = sum(window) / len(window)
        peak_level = max(window)
        spread = math.sqrt(sum((value - mean_level) ** 2 for value in window) / len(window))
        voiced = [value for value in window if value > self.silence_floor]
        opening = self._slice(start, min(end, start + 3.0)) or window
        opening_level = sum(opening) / len(opening)

        return {
            # Typical loudness of the moment. 1.0 is an ordinary passage.
            "energy": round(mean_level / self.median, 3),
            # The raised voice. A speaker landing a point peaks well above their median.
            "emphasis": round(peak_level / self.median, 3),
            # Expressive range within the clip. Flat delivery sits near zero.
            "dynamics": round(spread / max(mean_level, 1e-6), 3),
            # Does it open loud? Openings carry retention.
            "openingEnergy": round(opening_level / max(mean_level, 1e-6), 3),
            # Dead air inside the clip.
            "silenceRatio": round(1.0 - (len(voiced) / len(window)), 3),
            # A clip that begins after a breath and ends before the next one
            # sounds cut on purpose rather than cut at random.
            "leadingPauseSec": self._pause_before(start),
            "trailingPauseSec": self._pause_after(end),
        }


def load_envelope(path: Path | str, frame_ms: int = FRAME_MS) -> AudioEnvelope | None:
    """Read `speech.wav` into a loudness envelope, or None if it cannot be used.

    Deliberately total: any unreadable, empty or non-PCM file yields None so
    the caller falls back to transcript-only scoring rather than failing a job
    the user has already waited through transcription for.
    """
    audio_path = Path(path)
    if not audio_path.exists() or audio_path.stat().st_size <= 44:
        return None
    try:
        with contextlib.closing(wave.open(str(audio_path), "rb")) as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            rate = handle.getframerate()
            if width != 2 or rate <= 0 or channels <= 0:
                return None
            frames_per_block = max(1, int(rate * frame_ms / 1000))
            levels: list[float] = []
            while True:
                block = handle.readframes(frames_per_block)
                if not block:
                    break
                if channels > 1 and audioop is not None:
                    with contextlib.suppress(Exception):
                        block = audioop.tomono(block, width, 0.5, 0.5)
                levels.append(_rms(block, width))
    except (OSError, wave.Error, EOFError, MemoryError):
        return None

    if not levels:
        return None
    voiced = [value for value in levels if value > 0]
    median = _median(voiced)
    if median <= 0:
        return None
    return AudioEnvelope(
        frame_sec=frame_ms / 1000.0,
        rms=levels,
        median=median,
        silence_floor=median * SILENCE_FRACTION,
    )


def describe(features: dict[str, Any] | None) -> list[str]:
    """Plain-language notes about delivery, for clip reasons shown to the user."""
    if not features:
        return []
    notes = []
    if float(features.get("emphasis", 0)) >= 1.9:
        notes.append("speaker raises their voice here")
    if float(features.get("dynamics", 0)) >= 0.55:
        notes.append("expressive delivery")
    if float(features.get("leadingPauseSec", 0)) >= 0.35 and float(features.get("trailingPauseSec", 0)) >= 0.35:
        notes.append("clean pause on both edges")
    if float(features.get("silenceRatio", 0)) >= 0.35:
        notes.append("long dead air inside the clip")
    if float(features.get("energy", 1)) <= 0.6:
        notes.append("quietly delivered")
    return notes
