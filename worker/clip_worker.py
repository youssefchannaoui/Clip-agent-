#!/usr/bin/env python3
"""Self-hosted DeenClipped worker.

The Node app writes one JSON job file and launches this process. The worker:
1. downloads/copies the source,
2. transcribes or translates it with faster-whisper,
3. creates and scores complete candidate excerpts,
4. renders vertical clips with app-owned captions and a real nasheed mix,
5. verifies the media streams and writes result.json.

It never calls Opus or a paid AI API.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import time
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None


def cv2_problem() -> str | None:
    """Return a readable reason if OpenCV cannot actually be used, else None.

    Importing cv2 successfully is not enough. Some builds — particularly
    slimmer headless wheels, or an install whose native extension only
    partially loaded — import fine but are missing the pieces face
    detection needs. Touching those attributes then raises AttributeError
    part-way through an analysis, which surfaces to the user as a raw
    traceback rather than something actionable.

    Checking up front means a broken install degrades to manual framing
    with an explanation, instead of failing loudly and unhelpfully.
    """
    if cv2 is None:
        return "OpenCV is not installed on this server."
    for attribute in ("CascadeClassifier", "VideoCapture", "cvtColor"):
        if not hasattr(cv2, attribute):
            return (
                f"The installed OpenCV is incomplete (missing {attribute}). "
                "Reinstall opencv-python-headless, or rebuild with the build cache cleared."
            )
    haarcascades = getattr(getattr(cv2, "data", None), "haarcascades", None)
    if not haarcascades or not os.path.isdir(haarcascades):
        return (
            "OpenCV is installed but its face-detection data files are missing. "
            "Reinstall opencv-python-headless."
        )
    return None


def emit(kind: str, **payload: Any) -> None:
    print(json.dumps({"type": kind, **payload}, ensure_ascii=False), flush=True)


_progress_state: dict[str, Any] = {
    "stage": "Starting",
    "progress": 0,
    "startedAt": time.time(),
    "stageStartedAt": time.time(),
}
_progress_lock = threading.Lock()
_heartbeat_stop = threading.Event()


def progress(stage: str, percent: int, **details: Any) -> None:
    now = time.time()
    bounded = max(0, min(100, int(percent)))
    with _progress_lock:
        if stage != _progress_state.get("stage"):
            _progress_state["stageStartedAt"] = now
        _progress_state.update({"stage": stage, "progress": bounded, **details})
        payload = dict(_progress_state)
    payload["elapsedSec"] = round(now - float(payload.get("startedAt", now)), 1)
    payload["updatedAt"] = int(now * 1000)
    emit("progress", **payload)


def _heartbeat_loop() -> None:
    while not _heartbeat_stop.wait(10):
        now = time.time()
        with _progress_lock:
            payload = dict(_progress_state)
        payload["elapsedSec"] = round(now - float(payload.get("startedAt", now)), 1)
        payload["updatedAt"] = int(now * 1000)
        emit("heartbeat", **payload)


def run(command: list[str], timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout)[-1800:]
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command[:4])}\n{detail}")
    return result


def safe_slug(value: str, fallback: str = "clip") -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-").lower()
    return value[:60] or fallback


def escape_filter_path(value: Path) -> str:
    # FFmpeg filter values require escaping backslashes, colons, quotes and commas.
    text = str(value.resolve()).replace("\\", "/")
    return text.replace("'", "\\'").replace(":", "\\:").replace(",", "\\,")


def ffprobe_json(ffprobe: str, media: Path) -> dict[str, Any]:
    result = run([
        ffprobe, "-v", "error", "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate",
        "-of", "json", str(media),
    ])
    return json.loads(result.stdout or "{}")


def media_duration(ffprobe: str, media: Path) -> float:
    info = ffprobe_json(ffprobe, media)
    try:
        return float(info.get("format", {}).get("duration") or 0)
    except (TypeError, ValueError):
        return 0.0


def copy_or_download(job: dict[str, Any], destination: Path) -> tuple[Path, str]:
    source = str(job["url"]).strip()
    title = str(job.get("title") or "").strip()

    if source.startswith("file://"):
        local = Path(source[7:]).expanduser().resolve()
        if not local.exists():
            raise RuntimeError("The local source file does not exist.")
        shutil.copy2(local, destination)
        return destination, title or local.stem

    local_candidate = Path(source).expanduser()
    if local_candidate.exists():
        shutil.copy2(local_candidate.resolve(), destination)
        return destination, title or local_candidate.stem

    if not re.match(r"^https?://", source, re.I):
        raise RuntimeError("The source must be an http(s) link or a local file path.")

    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("yt-dlp is not installed. Run pip install -r worker/requirements.txt.") from exc

    output_stem = destination.with_suffix("")
    options: dict[str, Any] = {
        "format": "bv*[height<=1080]+ba/b[height<=1080]/best",
        "outtmpl": str(output_stem) + ".%(ext)s",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "fragment_retries": 3,
        "continuedl": True,
        "overwrites": True,
        "js_runtimes": {"node": {"path": None}},
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(source, download=True)
        detected_title = str(info.get("title") or "").strip()
        prepared = Path(ydl.prepare_filename(info))

    candidates = [destination, prepared, prepared.with_suffix(".mp4")]
    candidates.extend(sorted(destination.parent.glob(output_stem.name + ".*")))
    actual = next((candidate for candidate in candidates if candidate.exists() and candidate.is_file()), None)
    if actual is None:
        raise RuntimeError("The downloader finished but no source video was produced.")
    if actual.resolve() != destination.resolve():
        if destination.exists():
            destination.unlink()
        shutil.move(str(actual), str(destination))
    return destination, title or detected_title or "Untitled lecture"


def trim_source_window(ffmpeg: str, source: Path, destination: Path, start_sec: float, duration_sec: float) -> None:
    if duration_sec <= 0:
        raise RuntimeError("The selected source range is empty.")
    run([
        ffmpeg, "-y", "-ss", f"{max(0.0, start_sec):.3f}", "-i", str(source),
        "-t", f"{duration_sec:.3f}", "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", str(destination),
    ], timeout=60 * 60)
    if not destination.exists() or destination.stat().st_size <= 0:
        run([
            ffmpeg, "-y", "-ss", f"{max(0.0, start_sec):.3f}", "-i", str(source),
            "-t", f"{duration_sec:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", str(destination),
        ], timeout=60 * 60)


def extract_audio(ffmpeg: str, source: Path, audio_file: Path) -> None:
    run([
        ffmpeg, "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(audio_file),
    ], timeout=60 * 60)


class TranscriptionBackend:
    """Backend boundary for CPU Faster-Whisper today and optional CUDA later."""

    def transcribe(self, job: dict[str, Any], audio_file: Path, duration_sec: float) -> list[dict[str, Any]]:
        raise NotImplementedError


class FasterWhisperBackend(TranscriptionBackend):
    def transcribe(self, job: dict[str, Any], audio_file: Path, duration_sec: float) -> list[dict[str, Any]]:
        return _transcribe_with_faster_whisper(job, audio_file, duration_sec)


def _transcribe_with_faster_whisper(job: dict[str, Any], audio_file: Path, duration_sec: float) -> list[dict[str, Any]]:
    supplied = job.get("transcriptSegments")
    if isinstance(supplied, list) and supplied:
        return [
            {
                "start": float(item["start"]),
                "end": float(item["end"]),
                "text": str(item.get("text") or "").strip(),
                "words": [
                    {
                        "start": float(word.get("start", item["start"])),
                        "end": float(word.get("end", item["end"])),
                        "word": str(word.get("word") or "").strip(),
                    }
                    for word in (item.get("words") or [])
                    if str(word.get("word") or "").strip()
                ],
            }
            for item in supplied
            if float(item.get("end", 0)) > float(item.get("start", 0))
        ]

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("faster-whisper is not installed. Run pip install -r worker/requirements.txt.") from exc

    settings = job["settings"]
    device = settings.get("device") or "auto"
    compute_type = settings.get("computeType") or "int8"
    model_name = settings.get("model") or "small"
    progress(
        "Loading transcription model", 13,
        model=model_name, device=device, computeType=compute_type,
        sourceDurationSec=round(duration_sec, 2), etaSec=None,
    )
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    kwargs: dict[str, Any] = {
        "beam_size": 5,
        "vad_filter": True,
        "vad_parameters": {"min_silence_duration_ms": 450},
        "word_timestamps": True,
        "condition_on_previous_text": True,
        "task": settings.get("task") or "translate",
    }
    language = str(settings.get("language") or "").strip()
    if language:
        kwargs["language"] = language

    segments, _info = model.transcribe(str(audio_file), **kwargs)
    output: list[dict[str, Any]] = []
    transcription_started = time.time()
    last_percent = 15
    for segment in segments:
        processed_sec = max(0.0, min(duration_sec, float(segment.end or 0.0)))
        fraction = processed_sec / max(duration_sec, 1.0)
        current_percent = 16 + int(fraction * 44)
        current_percent = max(last_percent, min(60, current_percent))
        elapsed = max(0.1, time.time() - transcription_started)
        speed = processed_sec / elapsed
        eta = ((duration_sec - processed_sec) / speed) if speed > 0.01 and processed_sec > 15 else None
        if current_percent > last_percent or time.time() - float(_progress_state.get("lastDetailAt", 0)) >= 8:
            progress(
                "Transcribing speech", current_percent,
                model=model_name, device=device, computeType=compute_type,
                sourceDurationSec=round(duration_sec, 2),
                processedSec=round(processed_sec, 2),
                transcriptionSpeed=round(speed, 3),
                etaSec=round(eta, 1) if eta is not None else None,
                lastDetailAt=time.time(),
            )
            last_percent = current_percent
        text = str(segment.text or "").strip()
        if not text:
            continue
        output.append({
            "start": float(segment.start),
            "end": float(segment.end),
            "text": text,
            "words": [
                {"start": float(word.start), "end": float(word.end), "word": str(word.word)}
                for word in (segment.words or [])
                if word.start is not None and word.end is not None
            ],
        })
    if not output:
        raise RuntimeError("The transcription model did not find any speech in the source.")
    return output


def transcribe(job: dict[str, Any], audio_file: Path, duration_sec: float) -> list[dict[str, Any]]:
    return FasterWhisperBackend().transcribe(job, audio_file, duration_sec)


FILLER = {
    "um", "uh", "erm", "like", "basically", "literally", "you know", "i mean",
    "sort of", "kind of", "okay okay", "right right",
}
HOOKS = {
    "allah", "quran", "prophet", "remember", "imagine", "never", "always", "why",
    "what if", "the truth", "important", "biggest", "most", "brothers", "sisters",
    "heart", "death", "jannah", "paradise", "dua", "prayer", "salah", "repent",
}
WEAK_START = ("and ", "but ", "so ", "because ", "then ", "he ", "she ", "they ", "this ", "that ", "it ")
INTRO_WORDS = {"welcome", "subscribe", "channel", "podcast", "episode", "sponsor", "like and subscribe"}
QUOTE_RISK = re.compile(r"\b(quran says|allah says|prophet said|hadith|verse|surah)\b", re.I)


@dataclass
class Candidate:
    start: float
    end: float
    text: str
    segments: list[dict[str, Any]]
    score: int
    reasons: list[str]
    quote_risk: bool
    ai_title: str = ""
    ai_reason: str = ""

    @property
    def duration(self) -> float:
        return self.end - self.start


def punctuation_boundary(text: str) -> bool:
    return bool(re.search(r"[.!?…]['\"]?$", text.strip()))


def score_candidate(start: float, end: float, text: str, segments: list[dict[str, Any]]) -> tuple[int, list[str], bool]:
    duration = end - start
    lower = " ".join(text.lower().split())
    words = re.findall(r"[a-zA-Z']+", lower)
    reasons: list[str] = []
    score = 34.0

    if 35 <= duration <= 70:
        score += 18
        reasons.append("strong short-form duration")
    elif 25 <= duration <= 85:
        score += 12
    else:
        score += 4

    if punctuation_boundary(text):
        score += 10
        reasons.append("complete ending")
    else:
        score -= 8

    if lower and not lower.startswith(WEAK_START):
        score += 8
        reasons.append("stands alone")
    else:
        score -= 10

    hook_hits = [hook for hook in HOOKS if hook in lower]
    if hook_hits:
        score += min(15, 6 + len(hook_hits) * 2)
        reasons.append("strong reminder language")

    if "?" in text:
        score += 5
        reasons.append("question hook")

    word_rate = len(words) / max(duration, 1) * 60
    if 95 <= word_rate <= 195:
        score += 8
        reasons.append("clear speaking pace")
    elif word_rate < 60 or word_rate > 235:
        score -= 8

    filler_count = sum(lower.count(item) for item in FILLER)
    score -= min(14, filler_count * 2.5)

    intro_hits = sum(1 for item in INTRO_WORDS if item in lower)
    score -= intro_hits * 10
    if intro_hits:
        reasons.append("contains intro or promotion")

    if len(words) < 35:
        score -= 10
    elif len(words) > 75:
        score += 4

    gaps = [
        max(0.0, float(b["start"]) - float(a["end"]))
        for a, b in zip(segments, segments[1:])
    ]
    long_silence = sum(gap for gap in gaps if gap > 1.5)
    score -= min(12, long_silence * 3)

    quote_risk = bool(QUOTE_RISK.search(text))
    if quote_risk:
        reasons.append("religious quotation needs human review")

    return max(1, min(100, int(round(score)))), reasons[:4], quote_risk


def build_candidates(segments: list[dict[str, Any]], minimum: float, maximum: float) -> list[Candidate]:
    candidates: list[Candidate] = []
    count = len(segments)
    for start_index in range(count):
        start = float(segments[start_index]["start"])
        group: list[dict[str, Any]] = []
        for end_index in range(start_index, count):
            segment = segments[end_index]
            end = float(segment["end"])
            duration = end - start
            if duration > maximum + 1.5:
                break
            group.append(segment)
            if duration < minimum:
                continue

            is_good_boundary = punctuation_boundary(str(segment["text"]))
            near_target = 38 <= duration <= 68
            final_possible = end_index == count - 1
            if not (is_good_boundary or near_target or final_possible):
                continue

            text = " ".join(str(item["text"]).strip() for item in group).strip()
            score, reasons, quote_risk = score_candidate(start, end, text, group.copy())
            candidates.append(Candidate(start, end, text, group.copy(), score, reasons, quote_risk))

            # Avoid creating dozens of almost-identical windows for one start.
            if duration >= 62 and is_good_boundary:
                break
    return candidates


def overlap_ratio(a: Candidate, b: Candidate) -> float:
    intersection = max(0.0, min(a.end, b.end) - max(a.start, b.start))
    if not intersection:
        return 0.0
    return intersection / min(a.duration, b.duration)


def overlap_with_existing(candidate: Candidate, item: dict[str, Any]) -> float:
    start = float(item.get("startSec", item.get("start", 0)) or 0)
    end = float(item.get("endSec", item.get("end", 0)) or 0)
    duration = max(0.001, end - start)
    intersection = max(0.0, min(candidate.end, end) - max(candidate.start, start))
    if not intersection:
        return 0.0
    return intersection / min(candidate.duration, duration)


def remove_existing_moments(candidates: list[Candidate], existing: list[dict[str, Any]]) -> list[Candidate]:
    if not existing:
        return candidates
    return [
        candidate for candidate in candidates
        if not any(overlap_with_existing(candidate, item) > 0.30 for item in existing)
    ]


def select_candidates(candidates: list[Candidate], limit: int) -> list[Candidate]:
    selected: list[Candidate] = []
    for candidate in sorted(candidates, key=lambda item: (-item.score, item.start)):
        if any(overlap_ratio(candidate, previous) > 0.48 for previous in selected):
            continue
        selected.append(candidate)
        if len(selected) >= limit:
            break
    return sorted(selected, key=lambda item: (-item.score, item.start))


def refine_with_ollama(candidates: list[Candidate], settings: dict[str, Any]) -> list[Candidate]:
    base_url = str(settings.get("ollamaUrl") or "").rstrip("/")
    model = str(settings.get("ollamaModel") or "qwen3:4b")
    if not base_url or not candidates:
        return candidates

    shortlist = sorted(candidates, key=lambda item: -item.score)[:24]
    items = [
        {
            "index": index,
            "duration": round(candidate.duration, 1),
            "heuristicScore": candidate.score,
            "text": candidate.text[:1400],
        }
        for index, candidate in enumerate(shortlist)
    ]
    prompt = (
        "You rank candidate short clips from Islamic lectures. Return JSON only with a key named clips. "
        "For every candidate, return index, score from 0 to 100, a respectful English title under 12 words, "
        "and one short reason. Reward a strong standalone reminder, a clear opening, a complete ending, useful "
        "meaning and low filler. Penalize intros, promotions, missing context and sentences cut in half. Never "
        "invent or rewrite Quran or hadith quotations. Scoring candidates:\n" + json.dumps(items, ensure_ascii=False)
    )
    request_body = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1},
    }).encode("utf-8")
    request = urllib.request.Request(
        base_url + "/api/generate",
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            outer = json.loads(response.read().decode("utf-8"))
        inner = json.loads(str(outer.get("response") or "{}"))
        rows = inner.get("clips") if isinstance(inner, dict) else None
        if not isinstance(rows, list):
            raise ValueError("Local model did not return a clips list")
        for row in rows:
            index = int(row.get("index", -1))
            if index < 0 or index >= len(shortlist):
                continue
            candidate = shortlist[index]
            ai_score = max(0, min(100, int(round(float(row.get("score", candidate.score))))))
            candidate.score = int(round(candidate.score * 0.45 + ai_score * 0.55))
            candidate.ai_title = str(row.get("title") or "").strip()[:90]
            candidate.ai_reason = str(row.get("reason") or "").strip()[:180]
            if candidate.ai_reason:
                candidate.reasons = ([candidate.ai_reason] + candidate.reasons)[:4]
        return candidates
    except Exception as exc:
        emit("warning", warning=f"Local Ollama scoring was unavailable; using built-in scoring instead: {exc}")
        return candidates


def ass_color(hex_color: str, alpha: str = "00") -> str:
    value = str(hex_color or "#FFFFFF").lstrip("#")
    if len(value) != 6:
        value = "FFFFFF"
    red, green, blue = value[0:2], value[2:4], value[4:6]
    return f"&H{alpha}{blue}{green}{red}"


def ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    sec = seconds % 60
    return f"{hours}:{minutes:02d}:{sec:05.2f}"


def ass_escape(text: str) -> str:
    value = html.unescape(text)
    value = value.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
    return value.replace("\n", "\\N")


def contains_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]", str(text)))


def caption_word_override(
    text: str,
    *,
    active: bool,
    primary: str,
    highlight: str,
    highlight_font: str,
    arabic_font: str,
    highlight_italic: bool,
    highlight_glow: float,
    scale_y: int,
) -> str:
    color = highlight if active else primary
    tags = [f"\\c{color.replace('&H00', '&H')}&"]
    if contains_arabic(text):
        tags.append(f"\\fn{arabic_font}")
        tags.append("\\i0")
    elif active:
        tags.append(f"\\fn{highlight_font}")
        tags.append(f"\\i{1 if highlight_italic else 0}")
    if active and highlight_glow > 0:
        tags.append(f"\\blur{highlight_glow:g}")
    if active:
        tags.extend(["\\fscx108", f"\\fscy{int(scale_y * 1.08)}", f"\\t(0,120,\\fscx100\\fscy{scale_y})"])
    return "{" + "".join(tags) + "}" + ass_escape(text) + "{\\rCaption}"


def wrap_caption(text: str, width: int = 28) -> str:
    words = text.strip().split()
    lines: list[str] = []
    line: list[str] = []
    length = 0
    for word in words:
        projected = length + len(word) + (1 if line else 0)
        if line and projected > width:
            lines.append(" ".join(line))
            line = [word]
            length = len(word)
        else:
            line.append(word)
            length = projected
    if line:
        lines.append(" ".join(line))
    return "\\N".join(lines[:3])


def opacity_alpha(percent: float) -> str:
    # ASS alpha: 00 opaque, FF transparent.
    value = max(0.0, min(100.0, float(percent)))
    alpha = int(round(255 * (1 - value / 100.0)))
    return f"{alpha:02X}"


def alignment_for(position: str, horizontal: str = "center") -> int:
    rows = {"top": (7, 8, 9), "middle": (4, 5, 6), "bottom": (1, 2, 3)}
    columns = {"left": 0, "center": 1, "right": 2}
    return rows.get(str(position), rows["middle"])[columns.get(str(horizontal), 1)]


def watermark_alignment(position: str) -> int:
    return {
        "top-left": 7, "top-center": 8, "top-right": 9,
        "bottom-left": 1, "bottom-center": 2, "bottom-right": 3,
    }.get(str(position), 8)


def candidate_words(candidate: Candidate) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in candidate.segments:
        for word in segment.get("words") or []:
            start = max(0.0, float(word.get("start", segment["start"])) - candidate.start)
            end = min(candidate.duration, float(word.get("end", segment["end"])) - candidate.start)
            text = str(word.get("word") or "").strip()
            if text and end > start:
                words.append({"start": start, "end": end, "word": text})
    return words


def chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for index in range(0, len(items), max(1, size)):
        yield items[index:index + max(1, size)]


def _stable_fraction(value: str) -> float:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF


def dynamic_caption_frames(candidate: Candidate, template: dict[str, Any]) -> list[dict[str, Any]]:
    """Build TikTok-style caption states: mostly one word, sometimes a growing stack."""
    words = candidate_words(candidate)
    if not words:
        return []
    max_stack = max(1, min(6, int(template.get("captionStackMaxWords", 4))))
    probability = max(0.0, min(1.0, float(template.get("captionStackProbability", 0.42))))
    clear_pause = max(0.15, min(2.0, float(template.get("captionClearPause", 0.42))))
    frames: list[dict[str, Any]] = []
    stack: list[dict[str, Any]] = []
    target = 1
    run_number = 0

    for index, word in enumerate(words):
        previous = words[index - 1] if index else None
        pause = float(word["start"]) - float(previous["end"]) if previous else clear_pause
        previous_text = str(previous.get("word") or "") if previous else ""
        forced_clear = (
            previous is None
            or pause >= clear_pause
            or bool(re.search(r"[.!?…][\"']?$", previous_text.strip()))
            or len(stack) >= target
        )
        if forced_clear:
            stack = []
            run_number += 1
            chance = _stable_fraction(f"{candidate.text}|run|{run_number}")
            stack_period = max(3, int(round(1.0 / max(probability, 0.01))))
            force_stack = max_stack > 1 and probability > 0 and run_number % stack_period == 0
            if max_stack <= 1 or (chance >= probability and not force_stack):
                target = 1
            else:
                depth = _stable_fraction(f"{candidate.text}|depth|{run_number}")
                target = 2 + min(max_stack - 2, int(depth * max(1, max_stack - 1)))
        stack.append(word)

        if index + 1 < len(words):
            next_start = float(words[index + 1]["start"])
            gap = max(0.0, next_start - float(word["end"]))
            end = next_start if gap < clear_pause else float(word["end"]) + min(0.14, gap * 0.35)
        else:
            end = float(word["end"])
        frames.append({
            "start": float(word["start"]),
            "end": max(float(word["start"]) + 0.08, min(candidate.duration, end)),
            "words": list(stack),
        })
    return frames


def write_ass(candidate: Candidate, template: dict[str, Any], ass_file: Path) -> None:
    width = int(template.get("width", 1080))
    height = int(template.get("height", 1920))
    font = str(template.get("captionFont", "DejaVu Sans"))
    highlight_font = str(template.get("captionHighlightFont", "DejaVu Serif"))
    arabic_font = str(template.get("captionArabicFont", "Amiri"))
    highlight_italic = bool(template.get("captionHighlightItalic", True))
    highlight_glow = max(0.0, min(30.0, float(template.get("captionHighlightGlow", 0))))
    font_size = int(template.get("captionFontSize", 62))
    margin_v = int(template.get("captionMarginV", 220))
    outline_width = float(template.get("captionOutlineWidth", 5))
    shadow = float(template.get("captionShadow", 1))
    alignment = alignment_for(
        str(template.get("captionPosition", "middle")),
        str(template.get("captionHorizontal", "right")),
    )
    margin_h = int(template.get("captionMarginH", 90))
    line_height = max(0.65, min(1.4, float(template.get("captionLineHeight", 0.88))))
    scale_y = int(round(line_height * 100))
    primary = ass_color(template.get("captionPrimary", "#FFFFFF"))
    highlight = ass_color(template.get("captionHighlight", "#D9B478"))
    outline = ass_color(template.get("captionOutline", "#000000"))
    background_opacity = float(template.get("captionBackgroundOpacity", 0))
    back = ass_color(template.get("captionBackground", "#000000"), opacity_alpha(background_opacity))
    border_style = 3 if background_opacity > 0 else 1
    uppercase = bool(template.get("captionUppercase", False))
    max_words = int(template.get("captionMaxWords", 6))

    watermark_opacity = float(template.get("watermarkOpacity", 100))
    watermark_color = ass_color(template.get("watermarkColor", "#FFFFFF"), opacity_alpha(watermark_opacity))
    watermark = ass_escape(str(template.get("watermark", "DEENCLIPPED")))
    watermark_size = int(template.get("watermarkFontSize", 27))
    watermark_margin_v = int(template.get("watermarkMarginV", 80))
    watermark_margin_h = int(template.get("watermarkMarginH", 48))
    watermark_align = watermark_alignment(str(template.get("watermarkPosition", "top-center")))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{font},{font_size},{primary},{highlight},{outline},{back},-1,0,0,0,100,{scale_y},0,0,{border_style},{outline_width},{shadow},{alignment},{margin_h},{margin_h},{margin_v},1
Style: Watermark,{font},{watermark_size},{watermark_color},{watermark_color},{outline},&H00000000,1,0,0,0,100,100,2,0,1,1,0,{watermark_align},{watermark_margin_h},{watermark_margin_h},{watermark_margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    if watermark:
        events.append(f"Dialogue: 1,0:00:00.00,{ass_time(candidate.duration)},Watermark,,0,0,0,,{watermark}")

    mode = str(template.get("captionMode", "dynamic-stack"))
    words = candidate_words(candidate)
    if mode == "dynamic-stack" and words:
        for frame in dynamic_caption_frames(candidate, template):
            lines: list[str] = []
            for line_index, word in enumerate(frame["words"]):
                raw_value = word["word"].upper() if uppercase else word["word"]
                is_active = line_index == len(frame["words"]) - 1
                lines.append(caption_word_override(
                    raw_value, active=is_active, primary=primary, highlight=highlight,
                    highlight_font=highlight_font, arabic_font=arabic_font,
                    highlight_italic=highlight_italic, highlight_glow=highlight_glow, scale_y=scale_y,
                ))
            text = "\\N".join(lines)
            events.append(f"Dialogue: 2,{ass_time(frame['start'])},{ass_time(frame['end'])},Caption,,0,0,0,,{text}")
    elif mode == "word" and words:
        for group in chunked(words, max_words):
            for active_index, active in enumerate(group):
                text_parts: list[str] = []
                for index, word in enumerate(group):
                    raw_value = word["word"].upper() if uppercase else word["word"]
                    text_parts.append(caption_word_override(
                        raw_value, active=index == active_index, primary=primary, highlight=highlight,
                        highlight_font=highlight_font, arabic_font=arabic_font,
                        highlight_italic=highlight_italic, highlight_glow=highlight_glow, scale_y=scale_y,
                    ))
                start = float(active["start"])
                end = max(start + 0.08, float(active["end"]))
                events.append(f"Dialogue: 2,{ass_time(start)},{ass_time(end)},Caption,,0,0,0,,{' '.join(text_parts)}")
    else:
        for segment in candidate.segments:
            start = max(0.0, float(segment["start"]) - candidate.start)
            end = min(candidate.duration, float(segment["end"]) - candidate.start)
            if end <= start:
                continue
            raw = str(segment["text"])
            raw = raw.upper() if uppercase else raw
            text = wrap_caption(ass_escape(raw), 28)
            events.append(f"Dialogue: 2,{ass_time(start)},{ass_time(end)},Caption,,0,0,0,,{text}")
    ass_file.write_text(header + "\n".join(events) + "\n", encoding="utf-8")


def title_from_text(text: str, number: int) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    first = re.split(r"(?<=[.!?])\s+", cleaned)[0]
    words = first.split()
    if len(words) > 11:
        first = " ".join(words[:11]).rstrip(",;:") + "…"
    if len(first) < 8:
        first = f"Important reminder {number}"
    return first[:90]


def description_from_text(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) > 300:
        cleaned = cleaned[:297].rsplit(" ", 1)[0] + "…"
    return cleaned


def fitted_crop_size(
    src_w: int,
    src_h: int,
    target_ratio: float,
    zoom: float = 1.0,
) -> tuple[int, int]:
    """Pick a crop box that exactly matches the output aspect ratio.

    This fixes a real stretching bug. The previous code sized width and
    height independently and clamped each to the source separately::

        crop_w = min(src_w, round(src_h * target_ratio / zoom))
        crop_h = min(src_h, round(src_h / zoom))

    With any zoom below 1.0 the wanted height exceeded the source height, so
    the height clamped to the source while the width kept its larger value.
    The resulting box no longer matched the output ratio, and because the
    render then does a plain ``scale=W:H`` (no aspect preservation), the
    picture came out visibly stretched — up to 33% at the minimum zoom.

    Deriving one dimension from the other, and re-deriving after any clamp,
    guarantees the box always matches the target ratio, so the later scale
    is a pure resize and never a distortion.
    """
    zoom = max(0.05, float(zoom))
    target_ratio = max(0.0001, float(target_ratio))

    crop_h = min(src_h, int(round(src_h / zoom)))
    crop_w = int(round(crop_h * target_ratio))

    # If that width does not fit the source, drive from width instead so the
    # ratio is still exact rather than clamped into a different shape.
    if crop_w > src_w:
        crop_w = src_w
        crop_h = int(round(crop_w / target_ratio))
        if crop_h > src_h:
            crop_h = src_h
            crop_w = int(round(crop_h * target_ratio))

    # Encoders reject odd dimensions for common pixel formats.
    crop_w = max(2, crop_w - (crop_w % 2))
    crop_h = max(2, crop_h - (crop_h % 2))
    return crop_w, crop_h


def crop_origin_from_center(
    center_x: float,
    center_y: float | None,
    src_w: int,
    src_h: int,
    crop_w: int,
    crop_h: int,
    padding: float = 0.18,
    vertical_face_ratio: float = 0.38,
) -> tuple[int, int]:
    """Given where the subject actually is, compute the crop's top-left corner.

    This is the fix for a real bug: the previous code positioned the crop
    vertically at a fixed 36% of the source frame no matter where the
    detected face actually was, so a subject framed differently than that
    one assumption got their head cut off. Horizontal placement already
    used the detected position — vertical placement now does too, using
    the same kind of "keep the subject inboard of the crop edge, not
    pinned exactly in the middle" logic as horizontal already had.

    When no vertical detection is available at all (e.g. the edge-detection
    fallback, which only finds a horizontal position), center_y is None and
    this falls back to the original fixed assumption — a reasonable guess
    is better than no guess when there's truly nothing to go on, but it
    should not override a real detection when one exists.
    """
    padding = max(0.05, min(0.45, float(padding)))

    desired_ratio = 0.5
    # Put a speaker near the outside edge closer to that same edge of the
    # portrait crop. This leaves substantially more room toward the centre of
    # the original landscape frame, where their shoulders, torso and gestures
    # normally extend. The old 38/62 placement centred the face too aggressively
    # and visibly sliced half of side-seated speakers out of the portrait.
    if center_x < src_w * 0.42:
        desired_ratio = 0.22 + padding * 0.10
    elif center_x > src_w * 0.58:
        desired_ratio = 0.78 - padding * 0.10
    x = int(max(0, min(src_w - crop_w, round(center_x - crop_w * desired_ratio))))

    if center_y is None:
        y = int(round((src_h - crop_h) * 0.36))
    else:
        y = int(round(center_y - crop_h * vertical_face_ratio))
    y = max(0, min(src_h - crop_h, y))

    return x, y


def detect_main_face_crop(source: Path, ffprobe: str, candidate: Candidate, out_width: int, out_height: int, bias: str = "auto", padding: float = 0.18, zoom: float = 1.0) -> dict[str, Any] | None:
    """Choose one stable crop that keeps the main speaker visible.

    This intentionally avoids frame-by-frame camera movement. It samples a few
    frames, finds the dominant face/upper body, and uses the median horizontal
    position for the whole clip.
    """
    if cv2_problem():
        return None
    info = ffprobe_json(ffprobe, source)
    video_stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    src_w = int(video_stream.get("width") or 0)
    src_h = int(video_stream.get("height") or 0)
    if not src_w or not src_h:
        return None
    target_ratio = out_width / max(1, out_height)
    source_ratio = src_w / max(1, src_h)
    if source_ratio <= target_ratio:
        return None
    zoom = max(0.75, min(1.35, float(zoom)))
    crop_w, crop_h = fitted_crop_size(src_w, src_h, target_ratio, zoom)
    if crop_w >= src_w:
        return None

    if bias in {"left", "center", "right"}:
        center = {"left": crop_w * 0.5, "center": src_w * 0.5, "right": src_w - crop_w * 0.5}[bias]
        x = int(max(0, min(src_w - crop_w, round(center - crop_w / 2))))
        y = max(0, (src_h - crop_h) // 2)
        return {"x": x, "y": y, "w": crop_w, "h": crop_h, "method": f"bias-{bias}"}

    detector_names = [
        "haarcascade_frontalface_alt2.xml",
        "haarcascade_frontalface_default.xml",
        "haarcascade_profileface.xml",
    ]
    detectors = [cv2.CascadeClassifier(cv2.data.haarcascades + name) for name in detector_names]
    upper_body = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_upperbody.xml")
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        return None
    sample_points = [0.10, 0.25, 0.40, 0.55, 0.70, 0.85]
    face_centers: list[float] = []
    face_centers_y: list[float] = []
    body_centers: list[float] = []
    body_centers_y: list[float] = []
    min_face = max(28, min(src_w, src_h) // 24)
    min_body = max(70, min(src_w, src_h) // 7)
    for fraction in sample_points:
        sample_time = max(0.0, candidate.start + candidate.duration * fraction)
        cap.set(cv2.CAP_PROP_POS_MSEC, sample_time * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        found: list[tuple[int, int, int, int]] = []
        for detector_index, detector in enumerate(detectors):
            if detector.empty():
                continue
            detections = detector.detectMultiScale(
                gray,
                scaleFactor=1.08 if detector_index == 0 else 1.10,
                minNeighbors=3 if detector_index == 0 else 4,
                minSize=(min_face, min_face),
            )
            found.extend(tuple(map(int, item)) for item in detections)
        # Profile detector can miss the mirrored orientation.
        profile = detectors[-1]
        if not profile.empty():
            flipped = cv2.flip(gray, 1)
            mirrored = profile.detectMultiScale(flipped, scaleFactor=1.10, minNeighbors=4, minSize=(min_face, min_face))
            for x, y, w, h in mirrored:
                found.append((src_w - int(x) - int(w), int(y), int(w), int(h)))
        if found:
            x, y, w, h = max(found, key=lambda item: item[2] * item[3])
            face_centers.append(float(x + w / 2))
            face_centers_y.append(float(y + h / 2))
            continue
        if not upper_body.empty():
            bodies = upper_body.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=3, minSize=(min_body, min_body))
            if len(bodies):
                x, y, w, h = max(bodies, key=lambda item: item[2] * item[3])
                body_centers.append(float(x + w / 2))
                # An upper-body box's own vertical center sits too low for
                # good headroom — the box spans down to the shoulders/chest,
                # so bias toward its top edge, closer to where the head is.
                body_centers_y.append(float(y + h * 0.22))
    cap.release()
    centers = face_centers if face_centers else body_centers
    centers_y = face_centers_y if face_centers else body_centers_y
    if not centers:
        # Fallback: find the horizontal area with the strongest foreground/edge detail.
        # This gives no vertical information at all.
        cap = cv2.VideoCapture(str(source))
        edge_centers: list[float] = []
        for fraction in [0.2, 0.5, 0.8]:
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, candidate.start + candidate.duration * fraction) * 1000.0)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(gray, 70, 160)
            columns = edges.sum(axis=0)
            if columns.max() > 0:
                edge_centers.append(float(columns.argmax()))
        cap.release()
        centers = edge_centers
        centers_y = []
    if not centers:
        return None
    centers.sort()
    center = centers[len(centers) // 2]
    center_y = None
    if centers_y:
        centers_y_sorted = sorted(centers_y)
        center_y = centers_y_sorted[len(centers_y_sorted) // 2]
    # Add a small look-room bias toward the middle so the face is not pinned
    # against the crop edge, and — critically — actually use the detected
    # vertical position instead of a fixed guess. The fixed guess used to
    # apply no matter where the subject really was, which is what cut
    # heads off when a video's framing didn't match that one assumption.
    x, y = crop_origin_from_center(center, center_y, src_w, src_h, crop_w, crop_h, padding)
    method = "face" if face_centers else ("upper-body" if body_centers else "foreground")
    return {"x": x, "y": y, "w": crop_w, "h": crop_h, "method": method}

def filter_values(template: dict[str, Any]) -> tuple[float, float, float, float]:
    preset = str(template.get("filterPreset", "natural"))
    presets = {
        "natural": (0.0, 1.0, 1.0, 1.0),
        "crisp": (0.015, 1.09, 1.08, 1.0),
        "warm": (0.025, 1.04, 1.12, 0.98),
        "cinematic": (-0.015, 1.13, 0.88, 0.96),
        "monochrome": (0.0, 1.08, 0.0, 1.0),
    }
    if preset != "custom" and preset in presets:
        return presets[preset]
    return (
        float(template.get("brightness", 0)),
        float(template.get("contrast", 1)),
        float(template.get("saturation", 1)),
        float(template.get("gamma", 1)),
    )


def build_video_filter(template: dict[str, Any], ass_file: Path, crop_plan: dict[str, Any] | None = None) -> str:
    width = int(template.get("width", 1080))
    height = int(template.get("height", 1920))
    subtitle = escape_filter_path(ass_file)
    fit_mode = str(template.get("fitMode") or "contain")
    if fit_mode == "crop":
        if crop_plan:
            crop_w = int(crop_plan.get("w") or width)
            crop_h = int(crop_plan.get("h") or height)
            crop_x = int(crop_plan.get("x") or 0)
            crop_y = int(crop_plan.get("y") or 0)
            graph = (
                f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
                f"scale={width}:{height},setsar=1[base]"
            )
        else:
            graph = (
                f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height},setsar=1[base]"
            )
    elif fit_mode == "contain":
        background = str(template.get("frameBackground", "#000000")).replace("#", "0x")
        graph = (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color={background},setsar=1[base]"
        )
    else:
        blur = float(template.get("blurStrength", 28))
        graph = (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},gblur=sigma={blur:.2f}[bg2];"
            f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[fg2];"
            f"[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1[base]"
        )

    brightness, contrast, saturation, gamma = filter_values(template)
    filters = [f"eq=brightness={brightness:.3f}:contrast={contrast:.3f}:saturation={saturation:.3f}:gamma={gamma:.3f}"]
    sharpen = float(template.get("sharpen", 0.45))
    if sharpen > 0:
        filters.append(f"unsharp=5:5:{sharpen:.3f}:5:5:0")
    vignette = float(template.get("vignette", 0))
    if vignette > 0:
        filters.append(f"vignette=PI/{max(3.0, 8.0 - vignette * 4.5):.3f}")
    filters.append(f"subtitles='{subtitle}'")
    if bool(template.get("brandLineEnabled", False)):
        color = str(template.get("brandLineColor", "#D9B478")).replace("#", "0x")
        line_height = int(template.get("brandLineHeight", 8))
        filters.append(f"drawbox=x=0:y=ih-{line_height}:w=iw:h={line_height}:color={color}:t=fill")
    graph += ";[base]" + ",".join(filters) + "[vout]"
    return graph


def quality_report(candidate: Candidate, template: dict[str, Any]) -> dict[str, Any]:
    words = re.findall(r"[A-Za-z']+", candidate.text)
    word_rate = len(words) / max(candidate.duration, 1) * 60
    hook = min(100, max(1, candidate.score + (8 if "?" in candidate.text[:180] else 0)))
    pacing = int(max(1, min(100, 100 - abs(word_rate - 145) * 0.75)))
    max_words = int(template.get("captionMaxWords", 6))
    readability = int(max(1, min(100, 104 - max(0, max_words - 7) * 6 - max(0, int(template.get("captionFontSize", 62)) < 44) * 25)))
    context = 92 if not candidate.text.lower().startswith(WEAK_START) and punctuation_boundary(candidate.text) else 62
    overall = int(round(candidate.score * 0.5 + pacing * 0.18 + readability * 0.17 + context * 0.15))
    warnings: list[str] = []
    if word_rate > 210: warnings.append("very fast speech")
    if word_rate < 70: warnings.append("slow pacing")
    if candidate.quote_risk: warnings.append("religious quotation needs review")
    if int(template.get("captionFontSize", 62)) < 44: warnings.append("caption text may be too small")
    return {
        "overall": max(1, min(100, overall)),
        "hook": hook,
        "pacing": pacing,
        "readability": readability,
        "context": context,
        "wordsPerMinute": round(word_rate, 1),
        "warnings": warnings,
    }


def render_clip(
    job: dict[str, Any], candidate: Candidate, index: int, source: Path,
    track: dict[str, Any], output_dir: Path,
) -> dict[str, Any]:
    ffmpeg = job["ffmpeg"]
    ffprobe = job["ffprobe"]
    template = job["template"]
    settings = job["settings"]
    ffmpeg_threads = str(max(1, int(settings.get("ffmpegThreads") or os.getenv("FFMPEG_THREADS", "4"))))
    clip_id = str(job.get("clipIdOverride") or f"{job['id']}-{index:02d}")
    output_dir.mkdir(parents=True, exist_ok=True)
    clip_file = output_dir / f"{clip_id}.mp4"
    thumb_file = output_dir / f"{clip_id}.jpg"
    ass_file = output_dir / f"{clip_id}.ass"
    write_ass(candidate, template, ass_file)

    volume = max(0.01, min(0.5, float(settings.get("musicVolumePercent", 13)) / 100.0))
    voice_chain = "highpass=f=75,lowpass=f=15000,acompressor=threshold=-18dB:ratio=2.5:attack=12:release=160," if bool(template.get("voiceEnhance", True)) else ""
    crop_plan = None
    if bool(template.get("smartFramingEnabled")) and str(template.get("fitMode") or "contain") == "crop":
        try:
            crop_plan = detect_main_face_crop(
                source,
                ffprobe,
                candidate,
                int(template.get("width", 1080)),
                int(template.get("height", 1920)),
                str(template.get("smartFramingBias") or "auto"),
                float(template.get("smartFramingPadding", 0.18)),
                float(template.get("smartFramingZoom", 1.0)),
            )
        except Exception:
            crop_plan = None
    filter_complex = (
        build_video_filter(template, ass_file, crop_plan=crop_plan)
        + ";"
        + f"[0:a]{voice_chain}asetpts=PTS-STARTPTS,asplit=2[voice_mix][voice_sidechain];"
        + f"[1:a]volume={volume:.3f}[music];"
        + "[music][voice_sidechain]sidechaincompress="
          "threshold=0.025:ratio=10:attack=15:release=650[ducked];"
        + "[voice_mix][ducked]amix=inputs=2:duration=first:dropout_transition=2,"
        + "loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
    )

    run([
        ffmpeg, "-y", "-ss", f"{candidate.start:.3f}", "-t", f"{candidate.duration:.3f}",
        "-i", str(source), "-stream_loop", "-1", "-i", str(track["path"]),
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-threads", ffmpeg_threads, "-preset", "veryfast", "-crf", "19",
        "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", "-shortest", str(clip_file),
    ], timeout=60 * 60)

    info = ffprobe_json(ffprobe, clip_file)
    streams = info.get("streams", [])
    stream_types = {stream.get("codec_type") for stream in streams}
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    rendered_duration = media_duration(ffprobe, clip_file)
    expected_width = int(template.get("width", 1080))
    expected_height = int(template.get("height", 1920))
    if (
        "video" not in stream_types or "audio" not in stream_types
        or rendered_duration < max(2, candidate.duration - 2.5)
        or int(video_stream.get("width") or 0) != expected_width
        or int(video_stream.get("height") or 0) != expected_height
    ):
        raise RuntimeError(f"Rendered clip {index} failed media/template verification.")

    run([
        ffmpeg, "-y", "-ss", "1", "-i", str(clip_file), "-frames:v", "1",
        "-vf", "scale=480:-2", "-q:v", "3", str(thumb_file),
    ], timeout=120)

    ass_file.unlink(missing_ok=True)
    report = quality_report(candidate, template)
    return {
        "id": clip_id,
        "projectId": job.get("projectId") or job["id"],
        "clipFile": str(clip_file),
        "thumbFile": str(thumb_file),
        "title": candidate.ai_title or title_from_text(candidate.text, index),
        "description": description_from_text(candidate.text),
        "hashtags": "#IslamicReminder #DeenClipped",
        "transcript": candidate.text,
        "startSec": round(candidate.start, 3),
        "endSec": round(candidate.end, 3),
        "durationMs": int(round(candidate.duration * 1000)),
        "score": candidate.score,
        "scoreReasons": candidate.reasons,
        "quality": report,
        "reviewRequired": candidate.quote_risk,
        "musicName": track.get("name") or "Nasheed",
        "musicVerified": True,
        "templateId": template["id"],
        "templateName": template["name"],
        "templateVersion": int(template.get("version", 1)),
        "templateSnapshot": template,
        "renderVerified": True,
        "renderedWidth": expected_width,
        "renderedHeight": expected_height,
        "createdAt": int(time.time() * 1000),
    }

def doctor() -> int:
    checks: dict[str, Any] = {"python": sys.version.split()[0]}
    for module in ("yt_dlp", "faster_whisper"):
        try:
            __import__(module)
            checks[module] = True
        except Exception as exc:  # pragma: no cover - diagnostic output
            checks[module] = str(exc)
    for binary in (os.environ.get("FFMPEG_PATH", "ffmpeg"), os.environ.get("FFPROBE_PATH", "ffprobe")):
        try:
            first = run([binary, "-version"], timeout=15).stdout.splitlines()[0]
            checks[binary] = first
        except Exception as exc:
            checks[binary] = str(exc)
    # Smart framing needs more than a successful `import cv2` — verify the
    # pieces face detection actually uses, so a broken install shows up here
    # rather than only when someone clicks the button in the editor.
    problem = cv2_problem()
    checks["opencv"] = problem if problem else f"{getattr(cv2, '__version__', 'unknown')} (framing available)"
    print(json.dumps(checks, ensure_ascii=False))
    return 0 if checks.get("yt_dlp") is True and checks.get("faster_whisper") is True else 1



def process_rerender(job: dict[str, Any], job_file: Path) -> None:
    result_file = Path(job["resultPath"])
    output_dir = Path(job["outputDir"])
    source_file = Path(job["sourceFile"])
    if not source_file.exists():
        raise RuntimeError("The original source file is unavailable, so this clip cannot be re-rendered.")
    tracks = [track for track in job.get("musicTracks", []) if Path(track.get("path", "")).exists()]
    if not tracks:
        raise RuntimeError("Music is mandatory. Upload at least one nasheed before re-rendering.")
    if not job.get("template", {}).get("id"):
        raise RuntimeError("A valid app-owned template is mandatory.")

    clip = job.get("clip") or {}
    start = float(clip.get("startSec", 0))
    end = float(clip.get("endSec", 0))
    if end <= start:
        raise RuntimeError("The clip timestamps are invalid.")
    all_segments = job.get("transcriptSegments") or []
    segments = [
        segment for segment in all_segments
        if float(segment.get("end", 0)) > start and float(segment.get("start", 0)) < end
    ]
    if not segments:
        segments = [{"start": start, "end": end, "text": str(clip.get("transcript") or clip.get("description") or "Reminder"), "words": []}]
    text = " ".join(str(segment.get("text") or "").strip() for segment in segments).strip()
    score = int(clip.get("score") or 70)
    candidate = Candidate(
        start=start,
        end=end,
        text=text,
        segments=segments,
        score=score,
        reasons=list(clip.get("scoreReasons") or []),
        quote_risk=bool(clip.get("reviewRequired")),
        ai_title=str(clip.get("title") or ""),
    )
    seed = int(hashlib.sha256(str(job.get("clipIdOverride") or job["id"]).encode()).hexdigest()[:12], 16)
    track = tracks[seed % len(tracks)]
    progress("Re-rendering clip with the saved template", 25)
    rendered = render_clip(job, candidate, 1, source_file, track, output_dir)
    progress("Verifying template, captions, video and music", 92)
    result_file.write_text(json.dumps({"project": {"id": job.get("projectId")}, "clips": [rendered]}, ensure_ascii=False, indent=2), encoding="utf-8")
    progress("Complete", 100)
    emit("result", resultPath=str(result_file))

def process_more_clips(job: dict[str, Any], job_file: Path) -> None:
    result_file = Path(job["resultPath"])
    output_dir = Path(job["outputDir"])
    source_file = Path(job["sourceFile"])
    if not source_file.exists():
        raise RuntimeError("The saved source video is unavailable. Generate-more cannot re-download the lecture because that would create a duplicate project.")

    tracks = [track for track in job.get("musicTracks", []) if Path(track.get("path", "")).exists()]
    if not tracks:
        raise RuntimeError("Music is mandatory. Upload at least one nasheed before generating more clips.")
    if not job.get("template", {}).get("id"):
        raise RuntimeError("A valid app-owned template is mandatory.")

    segments = job.get("transcriptSegments") or []
    if not segments:
        transcript_path = Path(str(job.get("transcriptFile") or ""))
        if transcript_path.exists():
            segments = json.loads(transcript_path.read_text(encoding="utf-8"))
    if not segments:
        raise RuntimeError("The saved transcript is unavailable. This lecture must be processed again before more clips can be generated.")

    settings = job["settings"]
    requested = max(1, min(20, int(job.get("requestedCount") or settings.get("clipsPerVideo", 8))))
    progress("Loading saved lecture and transcript", 5, requestedClips=requested, reusedSource=True, reusedTranscript=True)

    candidates = build_candidates(
        segments,
        float(settings.get("clipMinSeconds", 20)),
        float(settings.get("clipMaxSeconds", 90)),
    )
    progress("Removing moments already used", 25, candidateCount=len(candidates), requestedClips=requested)
    candidates = remove_existing_moments(candidates, list(job.get("existingRanges") or []))
    progress("Scoring unused moments", 40, candidateCount=len(candidates), requestedClips=requested)
    candidates = refine_with_ollama(candidates, settings)
    selected = select_candidates(candidates, requested)
    if not selected:
        raise RuntimeError("No unused moments remain within the selected clip-duration range. Try a different duration range.")

    seed = int(hashlib.sha256(str(job["id"]).encode()).hexdigest()[:12], 16)
    shuffled_tracks = tracks.copy()
    random.Random(seed).shuffle(shuffled_tracks)

    rendered: list[dict[str, Any]] = []
    total = len(selected)
    for index, candidate in enumerate(selected, 1):
        percent = 50 + int((index - 1) / max(total, 1) * 44)
        progress(
            f"Rendering new clip {index} of {total}", percent,
            currentClip=index, totalClips=total, requestedClips=requested,
            reusedSource=True, reusedTranscript=True, etaSec=None,
        )
        track = shuffled_tracks[(index - 1) % len(shuffled_tracks)]
        rendered.append(render_clip(job, candidate, index, source_file, track, output_dir))

    result = {
        "project": {
            "id": job.get("projectId"),
            "title": str(job.get("projectTitle") or "Lecture"),
            "clipCount": len(rendered),
            "reusedSource": True,
            "reusedTranscript": True,
        },
        "clips": rendered,
    }
    progress("Verifying new clips", 96, currentClip=total, totalClips=total, reusedSource=True, reusedTranscript=True)
    result_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    progress("More clips are ready", 100, currentClip=total, totalClips=total, etaSec=0, reusedSource=True, reusedTranscript=True)
    emit("result", resultPath=str(result_file))


def process(job_file: Path) -> None:
    job = json.loads(job_file.read_text(encoding="utf-8"))
    if job.get("mode") == "rerender":
        process_rerender(job, job_file)
        return
    if job.get("mode") == "more_clips":
        process_more_clips(job, job_file)
        return
    job_dir = job_file.parent
    source_dir = Path(job["sourceDir"])
    output_dir = Path(job["outputDir"])
    source_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    source_file = source_dir / f"{job['id']}.mp4"
    audio_file = job_dir / "speech.wav"
    transcript_file = job_dir / "transcript.json"
    result_file = Path(job["resultPath"])

    tracks = [track for track in job.get("musicTracks", []) if Path(track.get("path", "")).exists()]
    if not tracks:
        raise RuntimeError("Music is mandatory. Upload at least one nasheed before processing.")
    if not job.get("template", {}).get("id"):
        raise RuntimeError("A valid app-owned template is mandatory.")

    progress("Downloading source video", 1, etaSec=None)
    requested_start = max(0.0, float(job.get("sourceStartSec") or 0.0))
    requested_end_raw = job.get("sourceEndSec")
    requested_end = float(requested_end_raw) if requested_end_raw is not None else None
    wants_window = requested_start > 0.05 or (requested_end is not None and requested_end > requested_start)
    raw_source_file = job_dir / "downloaded_source.mp4" if wants_window else source_file
    raw_source_file, detected_title = copy_or_download(job, raw_source_file)
    full_duration = media_duration(job["ffprobe"], raw_source_file)
    if full_duration <= 0:
        raise RuntimeError("The downloaded source could not be read as video.")
    if full_duration > float(job["settings"].get("maxSourceMinutes", 180)) * 60:
        raise RuntimeError("The source is longer than the configured processing limit.")
    selected_start = min(requested_start, max(0.0, full_duration - 1.0))
    selected_end = full_duration if requested_end is None else min(max(selected_start + 0.5, requested_end), full_duration)
    if selected_end <= selected_start:
        raise RuntimeError("The selected source range is empty.")
    if wants_window:
        progress("Preparing selected source range", 6, sourceDurationSec=round(full_duration, 2), etaSec=None)
        trim_source_window(job["ffmpeg"], raw_source_file, source_file, selected_start, selected_end - selected_start)
        raw_source_file.unlink(missing_ok=True)
    duration = media_duration(job["ffprobe"], source_file)
    if duration <= 0:
        raise RuntimeError("The selected source range could not be read as video.")

    progress("Extracting speech audio", 9, sourceDurationSec=round(duration, 2), etaSec=None)
    extract_audio(job["ffmpeg"], source_file, audio_file)

    progress("Preparing transcription", 12, sourceDurationSec=round(duration, 2), etaSec=None)
    segments = transcribe(job, audio_file, duration)
    transcript_file.write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")

    progress("Analysing transcript", 61, sourceDurationSec=round(duration, 2), processedSec=round(duration, 2), etaSec=None)
    settings = job["settings"]
    candidates = build_candidates(
        segments,
        float(settings.get("clipMinSeconds", 20)),
        float(settings.get("clipMaxSeconds", 90)),
    )
    progress("Finding and scoring clips", 69, candidateCount=len(candidates), etaSec=None)
    candidates = refine_with_ollama(candidates, settings)
    selected = select_candidates(candidates, int(settings.get("clipsPerVideo", 8)))
    if not selected:
        raise RuntimeError("No complete clip candidates fit the selected duration range.")

    # Deterministic shuffle per project: variety without random changes on retry.
    seed = int(hashlib.sha256(str(job["id"]).encode()).hexdigest()[:12], 16)
    shuffled_tracks = tracks.copy()
    random.Random(seed).shuffle(shuffled_tracks)

    rendered: list[dict[str, Any]] = []
    total = len(selected)
    for index, candidate in enumerate(selected, 1):
        percent = 75 + int((index - 1) / max(total, 1) * 20)
        progress(f"Rendering clip {index} of {total}", percent, currentClip=index, totalClips=total, etaSec=None)
        track = shuffled_tracks[(index - 1) % len(shuffled_tracks)]
        rendered.append(render_clip(job, candidate, index, source_file, track, output_dir))

    audio_file.unlink(missing_ok=True)
    result = {
        "project": {
            "id": job["id"],
            "title": detected_title,
            "durationSec": duration,
            "sourceFullDurationSec": full_duration,
            "sourceStartSec": selected_start,
            "sourceEndSec": selected_end,
            "templateId": job["template"]["id"],
            "templateName": job["template"]["name"],
            "musicRequired": True,
            "clipCount": len(rendered),
            "sourceFile": str(source_file),
            "transcriptFile": str(transcript_file),
        },
        "clips": rendered,
    }
    progress("Verifying rendered clips", 96, currentClip=total, totalClips=total, etaSec=None)
    result_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    progress("Complete", 100, currentClip=total, totalClips=total, etaSec=0)
    emit("result", resultPath=str(result_file))


def track_speaker_keyframes(
    source: Path,
    ffprobe: str,
    start: float,
    duration: float,
    out_width: int,
    out_height: int,
    bias: str = "auto",
    padding: float = 0.18,
    zoom: float = 1.0,
    smoothing: float = 0.82,
    sample_hz: float = 2.0,
    speech_spans: list[tuple[float, float]] | None = None,
) -> dict[str, Any]:
    """Follow the active speaker across a clip and return smoothed keyframes.

    Unlike `detect_main_face_crop`, which picks one static box for the whole
    clip, this samples repeatedly over time so the crop can move as the
    speaker moves or as conversation passes between people.

    Choosing who is speaking uses three signals together:

    * **Face position** — Haar cascades locate candidate faces per sample.
    * **Mouth movement** — the lower half of each face box is compared with
      the same region in the previous sample. A talking face changes far
      more than a listening one, which is what separates the speaker from
      other people in frame.
    * **Speech activity** — `speech_spans` carries the Whisper word timings.
      During silence nobody is speaking, so the crop holds its previous
      position instead of chasing noise in the detector.

    The raw per-sample choice is then run through an exponential smoother so
    the crop glides rather than snapping between faces on a single bad frame.
    """
    problem = cv2_problem()
    if problem:
        return {"available": False, "reason": problem}

    try:
        info = ffprobe_json(ffprobe, source)
    except Exception:
        return {"available": False, "reason": "The original video could not be read on this server."}
    video_stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    src_w = int(video_stream.get("width") or 0)
    src_h = int(video_stream.get("height") or 0)
    if not src_w or not src_h:
        return {"available": False, "reason": "The source video dimensions could not be read."}

    target_ratio = out_width / max(1, out_height)
    if src_w / max(1, src_h) <= target_ratio:
        return {"available": False, "reason": "This video is already narrower than the output, so no crop is needed."}

    crop_w, crop_h = fitted_crop_size(src_w, src_h, target_ratio, max(0.75, min(1.35, zoom)))
    if crop_w >= src_w:
        return {"available": False, "reason": "The whole width is already used."}

    # A fixed bias needs no detection at all.
    if bias in {"left", "center", "right"}:
        centre = {"left": crop_w * 0.5, "center": src_w * 0.5, "right": src_w - crop_w * 0.5}[bias]
        x, y = crop_origin_from_center(centre, None, src_w, src_h, crop_w, crop_h, padding)
        return {
            "available": True, "method": f"bias-{bias}", "srcW": src_w, "srcH": src_h,
            "w": crop_w, "h": crop_h,
            "keyframes": [{"t": 0.0, "x": x, "y": y, "w": crop_w, "h": crop_h}],
        }

    detectors = [
        cv2.CascadeClassifier(cv2.data.haarcascades + name)
        for name in (
            "haarcascade_frontalface_alt2.xml",
            "haarcascade_frontalface_default.xml",
            "haarcascade_profileface.xml",
        )
    ]
    if all(d.empty() for d in detectors):
        return {"available": False, "reason": "No face detector is available on this server."}

    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        return {"available": False, "reason": "The source video could not be opened."}

    step = 1.0 / max(0.5, min(8.0, sample_hz))
    samples = max(2, int(duration / step))
    min_face = max(28, min(src_w, src_h) // 24)

    def speaking_at(t: float) -> bool:
        if not speech_spans:
            return True  # no timing info, so assume speech throughout
        return any(s <= t <= e for s, e in speech_spans)

    raw: list[tuple[float, float, float]] = []  # (t, cx, cy)
    previous_gray = None
    previous_center: tuple[float, float] | None = None
    for index in range(samples + 1):
        offset = min(duration, index * step)
        cap.set(cv2.CAP_PROP_POS_MSEC, (start + offset) * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        faces: list[tuple[int, int, int, int]] = []
        for i, detector in enumerate(detectors):
            if detector.empty():
                continue
            found = detector.detectMultiScale(
                gray, scaleFactor=1.08 if i == 0 else 1.10,
                minNeighbors=3 if i == 0 else 4, minSize=(min_face, min_face),
            )
            faces.extend(tuple(map(int, f)) for f in found)

        if faces:
            best = None
            best_score = -1.0
            for (fx, fy, fw, fh) in faces:
                # Bigger faces are more likely to be the subject.
                score = float(fw * fh) / float(src_w * src_h)
                # Mouth movement: compare the lower half of the face with the
                # same region last sample. A speaking mouth changes more.
                if previous_gray is not None and speaking_at(offset):
                    my0, my1 = fy + fh // 2, min(src_h, fy + fh)
                    mx0, mx1 = max(0, fx), min(src_w, fx + fw)
                    if my1 > my0 and mx1 > mx0:
                        now_mouth = gray[my0:my1, mx0:mx1].astype("float32")
                        was_mouth = previous_gray[my0:my1, mx0:mx1].astype("float32")
                        if now_mouth.shape == was_mouth.shape and now_mouth.size:
                            movement = float(abs(now_mouth - was_mouth).mean()) / 255.0
                            score += movement * 2.5  # weight movement heavily
                # Prefer continuity. A one-frame false face at the other side
                # of a two-person interview must not make the crop jump away from
                # the current speaker.
                if previous_center is not None:
                    candidate_x, candidate_y = fx + fw / 2.0, fy + fh / 2.0
                    distance = ((candidate_x - previous_center[0]) ** 2 + (candidate_y - previous_center[1]) ** 2) ** 0.5
                    score += max(0.0, 1.0 - distance / max(src_w, src_h)) * 0.42
                if score > best_score:
                    best_score = score
                    best = (fx, fy, fw, fh)
            if best:
                fx, fy, fw, fh = best
                previous_center = (fx + fw / 2.0, fy + fh / 2.0)
                raw.append((offset, previous_center[0], previous_center[1]))
        elif previous_center is not None:
            # Hold the speaker through short detector misses instead of falling
            # back to a centre crop that cuts them out.
            raw.append((offset, previous_center[0], previous_center[1]))
        previous_gray = gray
    cap.release()

    if not raw:
        return {"available": False, "reason": "No face or speaker could be detected in this clip."}

    # Exponential smoothing so the crop glides instead of snapping.
    alpha = 1.0 - max(0.0, min(0.98, smoothing))
    keyframes: list[dict[str, Any]] = []
    smooth_x, smooth_y = raw[0][1], raw[0][2]
    for (t, cx, cy) in raw:
        smooth_x += (cx - smooth_x) * alpha
        smooth_y += (cy - smooth_y) * alpha
        x, y = crop_origin_from_center(smooth_x, smooth_y, src_w, src_h, crop_w, crop_h, padding)
        keyframes.append({"t": round(t, 3), "x": x, "y": y, "w": crop_w, "h": crop_h})

    return {
        "available": True, "method": "active-speaker", "srcW": src_w, "srcH": src_h,
        "w": crop_w, "h": crop_h, "keyframes": keyframes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", nargs="?", type=Path)
    parser.add_argument("--doctor", action="store_true")
    parser.add_argument("--framing", type=Path, help="analyse active-speaker framing from a request JSON file")
    args = parser.parse_args()
    if args.doctor:
        return doctor()
    if args.framing:
        request = json.loads(args.framing.read_text(encoding="utf-8"))
        spans = [(float(a), float(b)) for a, b in (request.get("speechSpans") or [])]
        plan = track_speaker_keyframes(
            Path(request["source"]),
            request.get("ffprobe") or "ffprobe",
            float(request.get("start") or 0.0),
            float(request.get("duration") or 0.0),
            int(request.get("width") or 1080),
            int(request.get("height") or 1920),
            str(request.get("bias") or "auto"),
            float(request.get("padding") or 0.18),
            float(request.get("zoom") or 1.0),
            float(request.get("smoothing") or 0.82),
            speech_spans=spans or None,
        )
        print(json.dumps({"plan": plan}))
        return 0
    if not args.job:
        parser.error("a job JSON path is required")
    heartbeat = threading.Thread(target=_heartbeat_loop, name="worker-heartbeat", daemon=True)
    heartbeat.start()
    try:
        process(args.job.resolve())
        return 0
    except Exception as exc:
        emit("error", error=str(exc))
        return 1
    finally:
        _heartbeat_stop.set()


if __name__ == "__main__":
    raise SystemExit(main())
