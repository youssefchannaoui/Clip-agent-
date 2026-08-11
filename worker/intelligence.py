"""Deterministic intelligence primitives for DeenClipped's clip pipeline.

The worker can optionally ask a local language model to refine a shortlist, but
the core ranking and metadata must remain useful, explainable, multilingual and
safe when that model is unavailable.  This module deliberately has no network
or heavyweight dependencies so it is fast to evaluate and straightforward to
test.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any, Iterable


TOKEN_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)
SENTENCE_RE = re.compile(r"(?<=[.!?؟…])\s+", re.UNICODE)

HOOK_TERMS = (
    "remember", "imagine", "why", "what if", "the truth", "never", "always",
    "most important", "biggest", "the mistake", "the secret", "did you know",
    "تذكر", "تذكّر", "تخيل", "تخيّل", "لماذا", "الحقيقة", "أهم", "أكبر",
    "هل تعلم", "ماذا لو", "لا تنس", "انتبه",
)
PAYOFF_TERMS = (
    "the lesson", "the answer", "this means", "the reason", "what matters",
    "therefore", "instead", "remember this", "you can", "we should", "do this",
    "الدرس", "الإجابة", "هذا يعني", "السبب", "المهم", "لذلك", "بدلاً", "تذكر هذا",
)
ACTION_TERMS = (
    "start", "stop", "avoid", "choose", "ask", "return", "repair", "practice",
    "reflect", "save", "share", "remember", "ابدأ", "توقف", "تجنب", "اختر",
    "اسأل", "ارجع", "تأمل", "تذكّر",
)
WEAK_OPENINGS = (
    "and ", "but ", "so ", "because ", "then ", "he ", "she ", "they ",
    "this ", "that ", "it ", "كما ", "ثم ", "وهو ", "وهي ", "قال ", "هذا ",
)
VAGUE_OPENINGS = (
    "he said", "she said", "they said", "this is", "that is", "it was", "as i said",
    "قال هو", "قالت هي", "كما قلت", "هذا هو", "كانت هذه",
)
FILLERS = (
    "um", "uh", "erm", "you know", "i mean", "basically", "literally", "sort of",
    "kind of", "يعني", "اممم", "آه", "بصراحة",
)
PROMOTION_TERMS = (
    "subscribe", "like and subscribe", "sponsor", "our channel", "this podcast",
    "اشترك", "القناة", "الراعي",
)


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def tokens(text: str) -> list[str]:
    """Return Unicode-aware word tokens for English, Arabic and mixed speech."""
    return [match.group(0).casefold().replace("’", "'") for match in TOKEN_RE.finditer(text or "")]


def contains_any(text: str, terms: Iterable[str]) -> list[str]:
    normal = " ".join((text or "").casefold().split())
    return [term for term in terms if term.casefold() in normal]


def _timing_confidence(segments: list[dict[str, Any]]) -> int:
    probabilities: list[float] = []
    for segment in segments or []:
        for word in segment.get("words") or []:
            try:
                value = float(word.get("probability"))
            except (TypeError, ValueError):
                continue
            if math.isfinite(value):
                probabilities.append(clamp(value, 0.0, 1.0))
        try:
            average_log_probability = float(segment.get("avgLogProb"))
        except (TypeError, ValueError):
            continue
        if math.isfinite(average_log_probability):
            probabilities.append(clamp(math.exp(average_log_probability), 0.0, 1.0))
    if not probabilities:
        # Existing/imported transcripts do not always include probabilities.
        # Unknown confidence should be visible but must not condemn good clips.
        return 82
    probabilities.sort()
    # Weight the weakest quartile so one hallucinated phrase cannot hide behind
    # a high overall mean.
    weak = probabilities[: max(1, len(probabilities) // 4)]
    weighted = (sum(probabilities) / len(probabilities)) * 0.65 + (sum(weak) / len(weak)) * 0.35
    return int(round(clamp(weighted * 100)))


def _pacing_score(word_count: int, duration: float) -> tuple[int, float]:
    wpm = word_count / max(duration, 1.0) * 60.0
    if 105 <= wpm <= 185:
        score = 96 - abs(wpm - 145) * 0.22
    elif 80 <= wpm < 105:
        score = 76 - (105 - wpm) * 0.8
    elif 185 < wpm <= 220:
        score = 83 - (wpm - 185) * 1.0
    else:
        score = 42 - min(30.0, abs(wpm - 145) * 0.18)
    return int(round(clamp(score, 10, 100))), round(wpm, 1)


def _delivery_scores(audio: dict[str, Any]) -> tuple[int, int]:
    """Turn acoustic measurements into two scored dimensions.

    `delivery` is how forcefully the moment is spoken; `cleanEdges` is whether
    it begins and ends on a natural break. Both are deliberately shallow
    formulas over `audio_features` output — the point is that a human can read
    them and predict what they will do to a clip's rank.
    """
    energy = float(audio.get("energy", 1.0))
    emphasis = float(audio.get("emphasis", 1.0))
    dynamics = float(audio.get("dynamics", 0.0))
    silence_ratio = float(audio.get("silenceRatio", 0.0))
    opening_energy = float(audio.get("openingEnergy", 1.0))
    leading = float(audio.get("leadingPauseSec", 0.0))
    trailing = float(audio.get("trailingPauseSec", 0.0))

    delivery = 50.0
    # Louder than this speaker's own median, not louder in absolute terms.
    delivery += max(-18.0, min(20.0, (energy - 1.0) * 40.0))
    # The raised voice before a point lands. Below 1.4x median this pays nothing.
    delivery += min(22.0, max(0.0, emphasis - 1.4) * 22.0)
    # Flat, monotone reading scores near zero here; an expressive passage gains.
    delivery += min(14.0, dynamics * 20.0)
    delivery -= min(30.0, silence_ratio * 60.0)

    clean_edges = 50.0
    # Half a second of quiet on an edge is enough to sound intentional.
    clean_edges += min(25.0, leading * 50.0)
    clean_edges += min(25.0, trailing * 50.0)
    # Opening much quieter than the body usually means the cut lands mid-word.
    clean_edges -= min(15.0, max(0.0, 0.8 - opening_energy) * 40.0)

    return int(round(clamp(delivery))), int(round(clamp(clean_edges)))


def evaluate_clip(
    start: float,
    end: float,
    text: str,
    segments: list[dict[str, Any]],
    *,
    quote_risk: bool = False,
    audio: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Score one candidate on transparent retention and trust dimensions.

    `audio` is the optional acoustic summary of this window from
    `audio_features.AudioEnvelope.features()`. When it is absent — a re-render,
    a generate-more run on a lecture whose audio is gone, or any failure to
    read `speech.wav` — scoring falls back to exactly the transcript-only
    behaviour that came before it, weights included.
    """
    duration = max(0.01, float(end) - float(start))
    normal = " ".join((text or "").split())
    lower = normal.casefold()
    word_list = tokens(normal)
    # Retention is decided disproportionately early. Prefer actual word timing
    # for the first three seconds and fall back to a short lexical window for
    # imported transcripts that predate word timestamps.
    opening_timed: list[str] = []
    closing_timed: list[str] = []
    for segment in segments or []:
        for word in segment.get("words") or []:
            value = str(word.get("word") or "").strip()
            if not value:
                continue
            word_start = float(word.get("start", start) or start)
            word_end = float(word.get("end", word_start) or word_start)
            if word_start <= float(start) + 3.2:
                opening_timed.append(value)
            if word_end >= float(end) - 6.0:
                closing_timed.append(value)
    opening = " ".join(tokens(" ".join(opening_timed))) if opening_timed else " ".join(word_list[:18])
    closing = " ".join(tokens(" ".join(closing_timed))) if closing_timed else " ".join(word_list[-32:])
    ending_complete = bool(re.search(r"[.!?؟…]['\"]?$", normal.strip()))
    hook_hits = contains_any(opening, HOOK_TERMS)
    payoff_hits = contains_any(lower, PAYOFF_TERMS)
    action_hits = contains_any(lower, ACTION_TERMS)
    promotion_hits = contains_any(lower, PROMOTION_TERMS)
    filler_count = sum(lower.count(term) for term in FILLERS)
    weak_opening = lower.startswith(WEAK_OPENINGS)
    vague_opening = lower.startswith(VAGUE_OPENINGS)
    question_opening = "?" in normal[:180] or "؟" in normal[:180]
    opening_specificity = len(set(tokens(opening))) / max(1, len(tokens(opening)))
    closing_payoff_hits = contains_any(closing, PAYOFF_TERMS) + contains_any(closing, ACTION_TERMS)

    gaps = [
        max(0.0, float(right.get("start", 0)) - float(left.get("end", 0)))
        for left, right in zip(segments or [], (segments or [])[1:])
    ]
    long_silence = sum(gap for gap in gaps if gap > 1.35)
    silence_ratio = long_silence / duration
    pacing, wpm = _pacing_score(len(word_list), duration)
    confidence = _timing_confidence(segments)

    hook = 46 + min(30, len(hook_hits) * 9) + (14 if question_opening else 0)
    hook -= 18 if weak_opening else 0
    hook -= 14 if vague_opening else 0
    hook -= min(22, filler_count * 4)

    opening_strength = 48 + min(28, len(hook_hits) * 10) + (14 if question_opening else 0)
    opening_strength += min(10, opening_specificity * 12)
    opening_strength -= 20 if weak_opening else 0
    opening_strength -= 14 if vague_opening else 0
    opening_strength -= min(24, filler_count * 5)

    flow = 64 + (15 if ending_complete else -18) + (9 if not weak_opening else -12)
    flow -= min(35, silence_ratio * 150)
    flow -= min(20, filler_count * 3)

    value = 48 + min(30, len(payoff_hits) * 10) + min(18, len(action_hits) * 5)
    value += 8 if any(char.isdigit() for char in normal) else 0
    value -= len(promotion_hits) * 20

    clarity = 76 + (8 if ending_complete else -8) - min(28, filler_count * 4)
    clarity -= 15 if vague_opening else 0
    clarity -= 14 if len(word_list) < 28 else 0
    clarity -= 8 if len(word_list) > 175 else 0

    completeness = 54 + (27 if ending_complete else -18) + (10 if payoff_hits else 0)
    completeness -= 18 if vague_opening else 0
    payoff_strength = 44 + min(34, len(closing_payoff_hits) * 11) + (16 if ending_complete else -18)
    payoff_strength += 8 if len(tokens(closing)) >= 8 else 0

    unique_ratio = len(set(word_list)) / max(1, len(word_list))
    specificity = 46 + min(32, unique_ratio * 44)
    specificity += 8 if any(char.isdigit() for char in normal) else 0
    specificity -= 14 if vague_opening else 0

    safety = 96 - (27 if quote_risk else 0) - max(0, 72 - confidence) * 0.65
    duration_fit = 96 if 32 <= duration <= 68 else 82 if 24 <= duration <= 85 else 48

    dimensions = {
        "hook": int(round(clamp(hook))),
        "flow": int(round(clamp(flow))),
        "value": int(round(clamp(value))),
        "clarity": int(round(clamp(clarity))),
        "completeness": int(round(clamp(completeness))),
        "specificity": int(round(clamp(specificity))),
        "pacing": pacing,
        "confidence": confidence,
        "safety": int(round(clamp(safety))),
        "durationFit": duration_fit,
        "openingStrength": int(round(clamp(opening_strength))),
        "payoffStrength": int(round(clamp(payoff_strength))),
    }
    dimensions["shareability"] = int(round(clamp((
        dimensions["openingStrength"] + dimensions["value"]
        + dimensions["specificity"] + dimensions["payoffStrength"]
    ) / 4)))
    weights = {
        "hook": 0.11, "openingStrength": 0.12, "flow": 0.10, "value": 0.14,
        "clarity": 0.09, "completeness": 0.10, "payoffStrength": 0.10,
        "specificity": 0.06, "pacing": 0.06, "confidence": 0.06,
        "safety": 0.03, "durationFit": 0.03,
    }
    if audio:
        dimensions["delivery"], dimensions["cleanEdges"] = _delivery_scores(audio)
        # How the moment sounds is real evidence, but it is evidence about
        # delivery, not about whether the point is worth hearing. The
        # transcript keeps 86% of the decision; the microphone gets 14%.
        # Same reasoning as the 45/55 blend with the local model — a signal
        # that informs the heuristic rather than overruling it.
        weights = {key: weight * 0.86 for key, weight in weights.items()}
        weights["delivery"] = 0.09
        weights["cleanEdges"] = 0.05
    overall = int(round(sum(dimensions[key] * weight for key, weight in weights.items())))

    ranked = sorted(
        ((value, label) for label, value in dimensions.items() if label not in {"safety", "durationFit"}),
        reverse=True,
    )
    labels = {
        "hook": "strong opening hook", "flow": "smooth standalone flow", "value": "clear viewer value",
        "clarity": "easy to understand", "completeness": "complete thought and payoff",
        "specificity": "specific and searchable", "pacing": "strong short-form pace",
        "confidence": "high-confidence transcript",
        "openingStrength": "strong first three seconds", "payoffStrength": "clear ending payoff",
        "shareability": "strong save-and-share potential",
        "delivery": "forceful spoken delivery", "cleanEdges": "clean pause boundaries",
    }
    reasons = [labels[key] for value, key in ranked if value >= 72][:3]
    if quote_risk:
        reasons.append("religious quotation needs human review")
    if confidence < 68:
        reasons.append("transcript confidence needs review")
    if not reasons:
        reasons.append("usable standalone moment")
    return {
        "score": max(1, min(100, overall)),
        "dimensions": dimensions,
        "confidence": confidence,
        "wordsPerMinute": wpm,
        "reasons": reasons[:4],
        "signals": {
            "hookTerms": hook_hits[:4], "payoffTerms": payoff_hits[:4],
            "actionTerms": action_hits[:4], "promotionTerms": promotion_hits[:3],
            "longSilenceSec": round(long_silence, 2),
            # Empty when the clip was scored on transcript alone, which is how
            # a reader tells the two paths apart after the fact.
            "audio": dict(audio) if audio else {},
            "firstThreeSeconds": " ".join(opening_timed).strip()[:220] or " ".join(word_list[:18])[:220],
            "endingPayoff": " ".join(closing_timed).strip()[:320] or " ".join(word_list[-32:])[:320],
            "dropOffRisks": [
                label for condition, label in (
                    (weak_opening, "weak opening connector"),
                    (vague_opening, "missing opening context"),
                    (filler_count >= 2, "opening filler"),
                    (silence_ratio > 0.12, "long silence"),
                    (not ending_complete, "cut-off ending"),
                    # Heard rather than inferred from segment gaps: dead air the
                    # transcript timings do not show, and a cut that lands
                    # mid-sentence with no breath before it.
                    (bool(audio) and float((audio or {}).get("silenceRatio", 0)) > 0.35, "dead air on the recording"),
                    (bool(audio) and float((audio or {}).get("leadingPauseSec", 1)) < 0.12, "starts mid-breath"),
                ) if condition
            ],
        },
    }


def _clean_title(text: str, limit: int = 70) -> str:
    value = re.sub(r"\s+", " ", text or "").strip(" \t\r\n.,;:!?؟…-–—\"'")
    value = re.sub(r"^(and|but|so|because|then)\s+", "", value, flags=re.I)
    words = value.split()[:10]
    value = " ".join(words)
    if len(value) > limit:
        value = value[: limit + 1].rsplit(" ", 1)[0]
    return value.strip(" ,.;:-")


def _sentences(text: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    return [part.strip() for part in SENTENCE_RE.split(cleaned) if len(tokens(part)) >= 3]


def _search_terms(text: str, limit: int = 6) -> list[str]:
    stop = {
        "this", "that", "with", "from", "they", "them", "then", "have", "your", "what", "when",
        "will", "into", "about", "because", "there", "where", "which", "would", "could", "should",
        "and", "the", "for", "are", "was", "were", "you", "our", "but", "not", "all", "can",
        "هذا", "هذه", "ذلك", "التي", "الذي", "على", "إلى", "في", "من", "عن", "مع", "كان", "ثم",
    }
    counts = Counter(word for word in tokens(text) if len(word) >= 3 and word not in stop)
    return [word for word, _count in counts.most_common(limit)]


def build_growth_pack(
    text: str,
    title: str,
    description: str,
    hashtags: str,
    *,
    hook: str = "",
    topic: str = "",
    audience: str = "general",
    goal: str = "education",
    tone: str = "respectful",
    avoid_phrases: list[str] | None = None,
    score: int = 0,
    score_breakdown: dict[str, Any] | None = None,
    confidence: int = 82,
) -> dict[str, Any]:
    """Build copy variants from transcript-grounded language only.

    These are suggestions, not invented claims: every title is selected from
    supplied transcript sentences or an already-reviewed local-model title.
    """
    sentences = _sentences(text)
    avoided = [str(item or "").strip().casefold() for item in (avoid_phrases or []) if str(item or "").strip()]
    candidates = [title, hook, *(sentences[:3])]
    alternatives: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        cleaned = _clean_title(candidate)
        fingerprint = cleaned.casefold()
        if not cleaned or fingerprint in seen or any(phrase in fingerprint for phrase in avoided):
            continue
        seen.add(fingerprint)
        alternatives.append(cleaned)
        if len(alternatives) >= 3:
            break
    primary = alternatives[0] if alternatives else "A Reminder Worth Hearing"
    tags = " ".join((hashtags or "").split()[:5])
    safe_description = "" if any(phrase in str(description or "").casefold() for phrase in avoided) else description
    search = _search_terms(" ".join(part for part in (topic, text) if part))
    calls_to_action = {
        "growth": "Save this reminder and share it with someone who may benefit.",
        "community": "Share your reflection respectfully and pass this reminder on.",
        "reflection": "Pause, reflect on this reminder, and return to it when you need it.",
        "education": "Save this lesson so you can revisit the key point.",
    }
    pinned_comments = {
        "students": "What is the main lesson you are taking from this clip?",
        "new-muslims": "What part of this reminder would you like explained further?",
        "families": "How could a family put this reminder into practice?",
        "creators": "What part of this message should more people hear?",
        "general": "What part of this reminder stood out to you?",
    }
    breakdown = score_breakdown or {}
    platform_fit = {
        "youtube": (int(breakdown.get("specificity", score or 70)) + int(breakdown.get("completeness", score or 70))) / 2,
        "tiktok": (int(breakdown.get("openingStrength", breakdown.get("hook", score or 70))) + int(breakdown.get("pacing", score or 70))) / 2,
        "instagram": (int(breakdown.get("value", score or 70)) + int(breakdown.get("clarity", score or 70))) / 2,
        "facebook": (int(breakdown.get("value", score or 70)) + int(breakdown.get("payoffStrength", breakdown.get("completeness", score or 70)))) / 2,
    }
    best_platforms = [name for name, _value in sorted(platform_fit.items(), key=lambda row: (-row[1], row[0]))[:2]]
    hook_preview = _clean_title(hook or (sentences[0] if sentences else primary), 120)
    payoff_preview = _clean_title(sentences[-1] if sentences else primary, 160)
    forecast = "strong" if score >= 86 and confidence >= 76 else "promising" if score >= 72 and confidence >= 66 else "review"
    cta = calls_to_action.get(goal, calls_to_action["education"])
    youtube_description = "\n\n".join(part for part in (safe_description, cta, tags) if part).strip()
    short_caption = "\n\n".join(part for part in (primary, safe_description, cta, tags) if part).strip()
    social_caption = "\n\n".join(part for part in (safe_description, cta, tags) if part).strip()
    return {
        "primaryTitle": primary,
        "alternateTitles": alternatives[1:],
        "searchTerms": search,
        "pinnedComment": pinned_comments.get(audience, pinned_comments["general"]),
        "callToAction": cta,
        "strategy": {"audience": audience, "goal": goal, "tone": tone},
        "directorBrief": {
            "forecast": forecast,
            "hookPreview": hook_preview,
            "payoffPreview": payoff_preview,
            "bestPlatforms": best_platforms,
            "platformFit": {key: int(round(value)) for key, value in platform_fit.items()},
            "transcriptConfidence": int(max(0, min(100, confidence))),
            "why": [
                label for value, label in sorted((
                    (int(breakdown.get("openingStrength", breakdown.get("hook", 0))), "Strong opening"),
                    (int(breakdown.get("value", 0)), "Clear viewer value"),
                    (int(breakdown.get("payoffStrength", breakdown.get("completeness", 0))), "Complete payoff"),
                    (int(breakdown.get("specificity", 0)), "Searchable topic"),
                ), reverse=True) if value >= 72
            ][:3],
        },
        "platforms": {
            "youtube": {"title": primary[:100], "description": youtube_description[:5000], "searchTerms": search},
            "tiktok": {"caption": short_caption[:2200]},
            "instagram": {"caption": social_caption[:2200], "altText": _clean_title(sentences[0] if sentences else primary, 180)},
            "facebook": {"title": primary[:255], "description": social_caption[:5000]},
        },
    }
