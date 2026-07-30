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
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


def emit(kind: str, **payload: Any) -> None:
    print(json.dumps({"type": kind, **payload}, ensure_ascii=False), flush=True)


def progress(stage: str, percent: int) -> None:
    emit("progress", stage=stage, progress=max(0, min(100, int(percent))))


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
    # Newer yt-dlp builds can use Node for YouTube's JS challenges. Unknown
    # options are intentionally avoided so older builds still work.
    cookie_path = os.environ.get("YOUTUBE_COOKIES_PATH", "").strip()
    if not cookie_path:
        cookie_path = str(Path(os.environ.get("DATA_DIR", "data")) / "youtube-cookies.txt")
    cookie_file = Path(cookie_path)
    if cookie_file.exists() and cookie_file.is_file():
        options["cookiefile"] = str(cookie_file)

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


def extract_audio(ffmpeg: str, source: Path, audio_file: Path) -> None:
    run([
        ffmpeg, "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(audio_file),
    ], timeout=60 * 60)


def transcribe(job: dict[str, Any], audio_file: Path) -> list[dict[str, Any]]:
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
    for segment in segments:
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


def alignment_for(position: str) -> int:
    return {"top": 8, "middle": 5, "bottom": 2}.get(str(position), 2)


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


def write_ass(candidate: Candidate, template: dict[str, Any], ass_file: Path) -> None:
    width = int(template.get("width", 1080))
    height = int(template.get("height", 1920))
    font = str(template.get("captionFont", "DejaVu Sans"))
    font_size = int(template.get("captionFontSize", 62))
    margin_v = int(template.get("captionMarginV", 220))
    outline_width = float(template.get("captionOutlineWidth", 5))
    shadow = float(template.get("captionShadow", 1))
    alignment = alignment_for(str(template.get("captionPosition", "bottom")))
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

    hook_color = ass_color(template.get("hookColor", "#FFFFFF"))
    hook_back = ass_color(template.get("hookBackground", "#09090A"), opacity_alpha(float(template.get("hookBackgroundOpacity", 72))))
    hook_size = int(template.get("hookFontSize", 56))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{font},{font_size},{primary},{highlight},{outline},{back},-1,0,0,0,100,100,0,0,{border_style},{outline_width},{shadow},{alignment},70,70,{margin_v},1
Style: Watermark,{font},{watermark_size},{watermark_color},{watermark_color},{outline},&H00000000,1,0,0,0,100,100,2,0,1,1,0,{watermark_align},{watermark_margin_h},{watermark_margin_h},{watermark_margin_v},1
Style: Hook,{font},{hook_size},{hook_color},{hook_color},{outline},{hook_back},-1,0,0,0,100,100,0,0,3,2,1,8,90,90,135,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    if watermark:
        events.append(f"Dialogue: 1,0:00:00.00,{ass_time(candidate.duration)},Watermark,,0,0,0,,{watermark}")

    if bool(template.get("hookEnabled", True)):
        hook_duration = min(candidate.duration, float(template.get("hookDuration", 2.4)))
        hook = candidate.ai_title or title_from_text(candidate.text, 1)
        hook = ass_escape(hook.upper() if uppercase else hook)
        events.append(f"Dialogue: 3,0:00:00.00,{ass_time(hook_duration)},Hook,,0,0,0,,{{\\fad(120,220)}}{wrap_caption(hook, 23)}")

    mode = str(template.get("captionMode", "word"))
    words = candidate_words(candidate)
    if mode == "word" and words:
        for group in chunked(words, max_words):
            for active_index, active in enumerate(group):
                text_parts: list[str] = []
                for index, word in enumerate(group):
                    value = ass_escape(word["word"].upper() if uppercase else word["word"])
                    color = highlight if index == active_index else primary
                    override = color.replace("&H00", "&H") + "&"
                    text_parts.append(f"{{\\c{override}}}{value}")
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


def build_video_filter(template: dict[str, Any], ass_file: Path) -> str:
    width = int(template.get("width", 1080))
    height = int(template.get("height", 1920))
    subtitle = escape_filter_path(ass_file)
    if template.get("fitMode") == "crop":
        graph = (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},setsar=1[base]"
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
    clip_id = str(job.get("clipIdOverride") or f"{job['id']}-{index:02d}")
    output_dir.mkdir(parents=True, exist_ok=True)
    clip_file = output_dir / f"{clip_id}.mp4"
    thumb_file = output_dir / f"{clip_id}.jpg"
    ass_file = output_dir / f"{clip_id}.ass"
    write_ass(candidate, template, ass_file)

    volume = max(0.01, min(0.5, float(settings.get("musicVolumePercent", 13)) / 100.0))
    voice_chain = "highpass=f=75,lowpass=f=15000,acompressor=threshold=-18dB:ratio=2.5:attack=12:release=160," if bool(template.get("voiceEnhance", True)) else ""
filter_complex = (
    build_video_filter(template, ass_file)
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
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
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

def process(job_file: Path) -> None:
    job = json.loads(job_file.read_text(encoding="utf-8"))
    if job.get("mode") == "rerender":
        process_rerender(job, job_file)
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

    progress("Downloading the source video", 4)
    source_file, detected_title = copy_or_download(job, source_file)
    duration = media_duration(job["ffprobe"], source_file)
    if duration <= 0:
        raise RuntimeError("The downloaded source could not be read as video.")
    if duration > float(job["settings"].get("maxSourceMinutes", 180)) * 60:
        raise RuntimeError("The source is longer than the configured processing limit.")

    progress("Extracting speech audio", 14)
    extract_audio(job["ffmpeg"], source_file, audio_file)

    progress("Transcribing and translating speech", 24)
    segments = transcribe(job, audio_file)
    transcript_file.write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")

    progress("Finding complete important moments", 52)
    settings = job["settings"]
    candidates = build_candidates(
        segments,
        float(settings.get("clipMinSeconds", 20)),
        float(settings.get("clipMaxSeconds", 90)),
    )
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
        percent = 58 + int((index - 1) / max(total, 1) * 37)
        progress(f"Rendering clip {index} of {total} with captions and music", percent)
        track = shuffled_tracks[(index - 1) % len(shuffled_tracks)]
        rendered.append(render_clip(job, candidate, index, source_file, track, output_dir))

    audio_file.unlink(missing_ok=True)
    result = {
        "project": {
            "id": job["id"],
            "title": detected_title,
            "durationSec": duration,
            "templateId": job["template"]["id"],
            "templateName": job["template"]["name"],
            "musicRequired": True,
            "clipCount": len(rendered),
            "sourceFile": str(source_file),
            "transcriptFile": str(transcript_file),
        },
        "clips": rendered,
    }
    result_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    progress("Complete", 100)
    emit("result", resultPath=str(result_file))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", nargs="?", type=Path)
    parser.add_argument("--doctor", action="store_true")
    args = parser.parse_args()
    if args.doctor:
        return doctor()
    if not args.job:
        parser.error("a job JSON path is required")
    try:
        process(args.job.resolve())
        return 0
    except Exception as exc:
        emit("error", error=str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
