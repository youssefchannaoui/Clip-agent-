"""Identify which ayah a recitation is reciting, from its transcript.

A Quran clip wants the ayah on screen in Arabic with its translation underneath,
not Whisper's approximation of what it heard. Whisper transcribes recitation
loosely -- it drops diacritics, mishears elongated tajweed, and cheerfully
invents modern spellings -- so the transcript is treated as a *search query*
against the real text rather than as the caption itself. Whatever ends up on
screen is the Quran's own words, taken from the corpus.

The corpus is fetched once and cached. It is not committed to the repo: the
Arabic text is 1MB and a translation another 1.2MB, and vendoring scripture into
a source tree invites it being edited by accident.

Licensing, deliberately chosen rather than defaulted:
  quran-uthmani   the Arabic text, which is not under copyright
  en.yusufali     Abdullah Yusuf Ali's 1934 translation; he died in 1953, so it
                  is out of copyright in life+70 jurisdictions

A different translation can be configured, but anything still in copyright is
the operator's decision to make, not a default this ships with.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import unicodedata
import urllib.request
from pathlib import Path
from typing import Any

QURAN_API = os.getenv("QURAN_API_BASE", "https://api.alquran.cloud/v1")
ARABIC_EDITION = os.getenv("QURAN_ARABIC_EDITION", "quran-uthmani")
TRANSLATION_EDITION = os.getenv("QURAN_TRANSLATION_EDITION", "en.yusufali")
CACHE_PATH = Path(os.getenv("QURAN_CACHE", "/app/worker/data/quran.json"))

# 6236 ayahs. Anything far off that means a truncated download, which must fail
# loudly rather than leave the matcher quietly missing half the book.
EXPECTED_AYAHS = 6236

# Harakat, tanween, shadda, sukun, superscript alef, and the Quranic annotation
# marks. Whisper emits almost none of these, so they are stripped from both
# sides before comparing.
_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]")
_TATWEEL = re.compile(r"ـ")
_NON_ARABIC = re.compile(r"[^ء-ي\s]")

# Letters Whisper and the Uthmani script disagree about. Folding them is what
# turns "إن" and "ان" into the same token.
_FOLD = str.maketrans({
    "أ": "ا",  # alef with hamza above
    "إ": "ا",  # alef with hamza below
    "آ": "ا",  # alef madda
    "ٱ": "ا",  # alef wasla
    "ى": "ي",  # alef maksura -> yaa
    "ة": "ه",  # taa marbuta -> haa
    "ؤ": "و",  # waw with hamza
    "ئ": "ي",  # yaa with hamza
})


def normalise(text: str) -> str:
    """Fold Arabic to the form both sides can be compared in."""
    value = unicodedata.normalize("NFC", str(text or ""))
    value = _DIACRITICS.sub("", value)
    value = _TATWEEL.sub("", value)
    value = value.translate(_FOLD)
    value = _NON_ARABIC.sub(" ", value)
    return " ".join(value.split())


def _fetch_edition(edition: str) -> list[dict[str, Any]]:
    url = f"{QURAN_API}/quran/{edition}"
    with urllib.request.urlopen(url, timeout=120) as response:
        payload = json.loads(response.read().decode("utf-8"))
    surahs = payload.get("data", {}).get("surahs") or []
    ayahs: list[dict[str, Any]] = []
    for surah in surahs:
        for ayah in surah.get("ayahs") or []:
            ayahs.append({
                "surah": int(surah.get("number")),
                "surahName": str(surah.get("englishName") or ""),
                "surahArabic": str(surah.get("name") or ""),
                "ayah": int(ayah.get("numberInSurah")),
                "text": str(ayah.get("text") or ""),
            })
    return ayahs


def build_cache(path: Path | None = None) -> Path:
    """Download the corpus and write the cache. Raises if it looks incomplete."""
    target = Path(path or CACHE_PATH)
    arabic = _fetch_edition(ARABIC_EDITION)
    translation = _fetch_edition(TRANSLATION_EDITION)
    if len(arabic) != EXPECTED_AYAHS:
        raise RuntimeError(f"{ARABIC_EDITION} returned {len(arabic)} ayahs, expected {EXPECTED_AYAHS}")
    if len(translation) != len(arabic):
        raise RuntimeError("the translation does not line up with the Arabic text")

    by_key = {(row["surah"], row["ayah"]): row for row in translation}
    records = []
    for row in arabic:
        english = by_key.get((row["surah"], row["ayah"]), {})
        records.append({
            "surah": row["surah"],
            "ayah": row["ayah"],
            "surahName": row["surahName"],
            "surahArabic": row["surahArabic"],
            "arabic": row["text"],
            "translation": english.get("text", ""),
        })
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({
        "arabicEdition": ARABIC_EDITION,
        "translationEdition": TRANSLATION_EDITION,
        "ayahs": records,
    }, ensure_ascii=False), encoding="utf-8")
    return target


class Corpus:
    """The Quran, indexed for fuzzy lookup by recited words."""

    def __init__(self, records: list[dict[str, Any]]):
        self.records = records
        self.normalised = [normalise(row["arabic"]) for row in records]
        # Inverted index: a word to the ayahs containing it. Scoring every ayah
        # with a sequence matcher is far too slow to run per caption segment, so
        # this narrows 6236 candidates to a handful first.
        self.index: dict[str, set[int]] = {}
        for position, text in enumerate(self.normalised):
            for word in set(text.split()):
                self.index.setdefault(word, set()).add(position)

    def __len__(self) -> int:
        return len(self.records)

    def match(self, transcript: str, minimum: float = 0.55) -> dict[str, Any] | None:
        """Best matching ayah for a chunk of transcript, or None.

        `minimum` guards against captioning an ayah that was never recited:
        speech about the Quran shares a lot of vocabulary with it, and a
        confident wrong ayah on screen is far worse than no ayah at all.
        """
        query = normalise(transcript)
        words = [w for w in query.split() if len(w) > 1]
        if not words:
            return None

        # Rare words are the informative ones; "من" appears in most of the book.
        counts: dict[int, int] = {}
        for word in set(words):
            hits = self.index.get(word)
            if not hits or len(hits) > 400:
                continue
            for position in hits:
                counts[position] = counts.get(position, 0) + 1
        if not counts:
            return None

        shortlist = sorted(counts, key=lambda p: counts[p], reverse=True)[:40]
        best, best_score = None, 0.0
        for position in shortlist:
            score = difflib.SequenceMatcher(None, query, self.normalised[position]).ratio()
            if score > best_score:
                best, best_score = position, score
        if best is None or best_score < minimum:
            return None

        row = self.records[best]
        return {
            "surah": row["surah"],
            "ayah": row["ayah"],
            "surahName": row["surahName"],
            "surahArabic": row["surahArabic"],
            "arabic": row["arabic"],
            "translation": row["translation"],
            "confidence": round(best_score, 3),
        }


_CORPUS: Corpus | None = None


def load(path: Path | None = None) -> Corpus | None:
    """The cached corpus, or None when it has not been downloaded.

    None rather than an exception: a worker without the corpus must still render
    ordinary clips, and the caller decides whether the Quran mode is available.
    """
    global _CORPUS
    if _CORPUS is not None:
        return _CORPUS
    target = Path(path or CACHE_PATH)
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    records = payload.get("ayahs") or []
    if len(records) != EXPECTED_AYAHS:
        return None
    _CORPUS = Corpus(records)
    return _CORPUS


def available() -> bool:
    return load() is not None


# Arabic-Indic digits, for the verse number inside the end-of-ayah ornament.
_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"


def arabic_number(value: int) -> str:
    return "".join(_ARABIC_DIGITS[int(d)] for d in str(int(value)))


def ayah_with_ornament(arabic: str, ayah: int) -> str:
    """The ayah followed by ۝ and its number, the way a mushaf prints it.

    U+06DD is the end-of-ayah mark; a Quranic font draws the following digits
    inside its circle. Amiri and Scheherazade both do, which is why the picker
    offers them.
    """
    return f"{arabic} ۝{arabic_number(ayah)}"


if __name__ == "__main__":  # pragma: no cover - build step
    import sys
    if "--build" in sys.argv:
        path = build_cache()
        corpus = load(path)
        print(f"quran: {len(corpus) if corpus else 0} ayahs cached at {path}")
        sys.exit(0 if corpus else 1)
    corpus = load()
    print(f"quran: {'ready, ' + str(len(corpus)) + ' ayahs' if corpus else 'corpus not downloaded'}")
