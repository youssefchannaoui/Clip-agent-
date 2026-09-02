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

    # Window sizes tried at each position when searching blind. The small end
    # matters far more than it looks: "وَكَأْسًا دِهَاقًا" is three words, and the
    # smallest window used to be six -- more than half of it somebody else's
    # verse. Measured on a real recitation of Surah An-Naba, 78:31-34 are all
    # three or four words and not one of them was ever captioned.
    WINDOWS = (3, 4, 5, 6, 8, 10, 14, 20, 28, 40)

    # A verse found by CONTINUING may score lower than one found blind, and
    # that is the point: a reciter goes in order, so "is this the next ayah?"
    # is one hypothesis rather than a search over 6236, and a hypothesis can
    # be held to a looser standard than a guess. This is what rescues a verse
    # Whisper mangled -- it rendered "إلى جهنم زمرا" as "بجها لمذمرا", which
    # matches nothing on its own and is plainly 39:71 once you are asking.
    CONTINUE_FLOOR = 0.5

    # A two- or three-word span produces a noisy ratio, because short strings
    # share letters by accident. Measured on the same recitation: "أولئك هم
    # الخاسرون" matched 23:10 -- الوارثون, the wrong word in the wrong surah --
    # at 0.667, while the verse actually recited was 39:63. Short spans found
    # blind have to clear a higher bar. A short span found by CONTINUATION does
    # not: there the identity is already known.
    SHORT_SPAN_WORDS = 4
    SHORT_SPAN_FLOOR = 0.82

    # How many verses ahead the continuation will reach past the one it
    # expects. Three covers a verse Whisper swallowed without letting the walk
    # wander: every position tried is still a NAMED verse in recitation order,
    # which is what makes the loose floor above safe.
    LOOKAHEAD = 3

    def _shortlist(self, query: str) -> list[int]:
        """Ayah positions worth scoring, from the inverted index."""
        words = [w for w in query.split() if len(w) > 1]
        if not words:
            return []
        counts: dict[int, int] = {}
        for word in set(words):
            hits = self.index.get(word)
            # Rare words are the informative ones; "من" appears in most of the
            # book and narrows nothing.
            if not hits or len(hits) > 400:
                continue
            for position in hits:
                counts[position] = counts.get(position, 0) + 1
        if not counts:
            return []
        return sorted(counts, key=lambda p: counts[p], reverse=True)[:40]

    def _best_position(self, query: str) -> int | None:
        """Closest ayah to this query, with NO passage-length guard.

        match() refuses to answer when the query is much longer than the verse
        it matched, because for a caller holding a whole passage that answer
        would caption one ayah over everything else that was recited. The walk
        is not that caller -- it trims the window to the verse's own span and
        rescores -- so there the guard only ever cost it the short ayat: a
        six-word window can never be within 1.6x of a three-word verse.
        """
        best, best_score = None, 0.0
        for position in self._shortlist(query):
            score = difflib.SequenceMatcher(None, query, self.normalised[position]).ratio()
            if score > best_score:
                best, best_score = position, score
        return best

    def _align(self, words: list[str], index: int, position: int):
        """Score the words at `index` against ONE named ayah.

        The lengths tried bracket the verse's own, so a verse the reciter ran
        into the next one is still measured against itself.
        """
        verse = self.normalised[position]
        if not verse:
            return None
        length = max(1, len(verse.split()))
        best = None
        for extra in (0, 2, 6):
            window = words[index:index + length + extra]
            if len(window) < 2:
                continue
            fit = _fit(window, verse)
            if fit is None:
                continue
            score, first, last = fit
            if best is None or score > best[0]:
                best = (score, (first, last))
        return best

    def _fill_back(self, words: list[str], found: list[dict[str, Any]]) -> None:
        """Walk backwards from the first ayah found, into the words before it.

        The forward walk can only continue from a verse it has already found,
        and the ones it misses are usually those BEFORE the first it
        recognised: a clip that opens mid-verse gives its opening ayah a poor
        partial score, so the walk gets no purchase until several verses in.
        Measured on a real clip, 39:65 and 39:66 opened it and neither was
        captioned while 39:67 after them matched at 0.78. Recitation runs in
        both directions, so once 39:67 is known 39:66 is a named hypothesis.

        Each step SCANS the start positions below the limit rather than fixing
        the window to end there. Anchoring the end scored 39:66 at 0.49 --
        under the floor by a hair -- because the window then carried the tail
        of the verse before it; letting the start move finds the same 0.72 the
        forward path would.
        """
        if not found:
            return
        position = found[0]["ayah"]["_position"] - 1
        limit = found[0]["wordStart"]
        while position >= 0 and limit >= 2:
            length = max(1, len(self.normalised[position].split()))
            best = None
            for start in range(max(0, limit - length - 8), limit - 1):
                aligned = self._align(words, start, position)
                if aligned is None:
                    continue
                score, (first, last) = aligned
                # Two verses recited without a pause share a boundary word, and
                # the alignment hands it to whichever it is asked about -- so
                # the good candidates came back reaching exactly ONE word into
                # the verse already placed, and rejecting an overlap outright
                # threw away 39:66 at 0.72 and 78:34 at 0.76 while keeping
                # fragments scoring 0.44. The word is trimmed instead: the
                # score says which verse this is, the span only says where to
                # put it.
                first_abs, last_abs = start + first, min(start + last, limit)
                if last_abs - first_abs < 1:
                    continue
                if best is None or score > best[0]:
                    best = (score, first_abs, last_abs)
            if best is None or best[0] < self.CONTINUE_FLOOR:
                break
            score, first, last = best
            found.insert(0, {
                "ayah": self._row(position, score),
                "wordStart": first,
                "wordEnd": last,
                "score": round(score, 3),
            })
            limit = first
            position -= 1

    def _search(self, words: list[str], index: int, minimum: float):
        """Find any ayah starting at `index`, searching the whole corpus."""
        best = None
        for size in self.WINDOWS:
            if index + 2 > len(words):
                break
            window = words[index:index + size]
            if len(window) < 2:
                continue
            position = self._best_position(normalise(" ".join(window)))
            if position is None:
                continue
            # Where the verse actually sits inside the window, not where the
            # window happened to start. normalise() drops Latin text, so a
            # window whose first words are the speaker talking still scores a
            # perfect match -- consuming from the window's start then swallowed
            # the aside and left the ayah to be matched a second time.
            fit = _fit(window, self.normalised[position])
            if fit is None:
                continue
            score, first, last = fit
            span = (first, last)
            floor = self.SHORT_SPAN_FLOOR if (last - first) < self.SHORT_SPAN_WORDS else minimum
            # A window can clear the floor on the strength of the verse buried
            # in it and still align poorly once the speaker's own words are
            # excluded. Measured on a real recitation: the verses actually
            # recited aligned at 0.68-0.97, a spurious ayah from another surah
            # at 0.40. Below the floor it is a guess, and a confident wrong
            # ayah on screen is worse than none.
            if score < floor:
                continue
            if best is None or score > best["score"]:
                best = {"position": position, "score": score, "span": span}
        return best

    def match_sequence(self, transcript: str, minimum: float = 0.70) -> list[dict[str, Any]]:
        """Every ayah recited across a long passage, in order.

        `match` compares a whole query against ONE ayah, so it answers None for
        anything longer than a verse: a re-render hands it the clip's entire
        stored transcript, 169 words of it, and the ayah treatment silently
        fell back to ordinary captions -- no medallion, no translation, the
        verse wrapped into three cramped lines. This walks the passage instead.

        It walks it the way a reciter reads it. Once an ayah is identified the
        next one is TRIED BY NAME before anything is searched for, because
        recitation is sequential and a named hypothesis survives transcription
        damage that no blind search could. Measured on five real clips from one
        recitation: 5 of 12 recited ayat were found before, 12 of 12 after.

        Each result carries the word span it consumed so the caller can give
        each ayah its share of the segment's time.
        """
        words = str(transcript or "").split()
        if not words:
            return []
        found: list[dict[str, Any]] = []
        index = 0
        expect: int | None = None
        while index < len(words):
            chosen = None
            # The next verse in the mushaf, tried by name. Kept as the standing
            # expectation even when it does not match here: a reciter who
            # pauses, or a word Whisper dropped entirely, must not cost the
            # rest of the passage its continuation.
            # A short lookahead, not just the very next verse: Whisper drops a
            # whole ayah often enough that insisting on strict succession
            # stalls the walk and hands the rest of the passage back to blind
            # search -- which is where the wrong verses came from. Measured on
            # a real clip: 39:62 was transcribed as three words and could not
            # be matched at all, and with no lookahead 39:63 was then found by
            # blind search as 5:10, the wrong surah.
            if expect is not None:
                for ahead in range(self.LOOKAHEAD):
                    position = expect + ahead
                    if not 0 <= position < len(self.records):
                        break
                    aligned = self._align(words, index, position)
                    if aligned is not None and aligned[0] >= self.CONTINUE_FLOOR:
                        if chosen is None or aligned[0] > chosen["score"]:
                            chosen = {"position": position, "score": aligned[0], "span": aligned[1]}
            if chosen is None:
                chosen = self._search(words, index, minimum)
            if chosen is None:
                index += 1
                continue
            first, last = chosen["span"]
            found.append({
                "ayah": self._row(chosen["position"], chosen["score"]),
                "wordStart": index + first,
                "wordEnd": index + last,
                # How well this piece matched, so a caller can refuse a walk
                # that only holds together because one of its verses is a
                # guess. A confident wrong ayah on screen is the worst outcome
                # this module has.
                "score": round(chosen["score"], 3),
            })
            expect = chosen["position"] + 1
            index += max(1, last)
        self._fill_back(words, found)
        return found

    def _row(self, position: int, confidence: float) -> dict[str, Any]:
        row = self.records[position]
        return {
            # Where this ayah sits in the corpus, so a caller can step to the
            # verse before or after it without searching for it again.
            "_position": position,
            "surah": row["surah"],
            "ayah": row["ayah"],
            "surahName": row["surahName"],
            "surahArabic": row["surahArabic"],
            "arabic": row["arabic"],
            "translation": row["translation"],
            "confidence": round(confidence, 3),
        }

    def match(self, transcript: str, minimum: float = 0.55) -> dict[str, Any] | None:
        """Best matching ayah for a chunk of transcript, or None.

        `minimum` guards against captioning an ayah that was never recited:
        speech about the Quran shares a lot of vocabulary with it, and a
        confident wrong ayah on screen is far worse than no ayah at all.
        """
        query = normalise(transcript)
        best, best_score = None, 0.0
        for position in self._shortlist(query):
            score = difflib.SequenceMatcher(None, query, self.normalised[position]).ratio()
            if score > best_score:
                best, best_score = position, score
        if best is None or best_score < minimum:
            return None

        row = self.records[best]
        # A query far longer than the verse it matched is a passage, not that
        # verse: half of it matching is enough to clear `minimum`, and the
        # caption would then show one ayah over everything else that was
        # recited. Let the caller split it with match_sequence instead.
        if len(query.split()) > len(normalise(row["arabic"]).split()) * 1.6:
            return None
        return self._row(best, best_score)


def _fit(window: list[str], verse: str) -> tuple[float, int, int] | None:
    """How well `window` matches `verse`, and which of its words are the verse.

    Compared CHARACTER by character rather than word by word, because Whisper's
    Arabic is wrong INSIDE a word far more often than it is wrong about the
    whole of it: on a real recitation it wrote "للحبطا" for "ليحبطن" and
    "بجها لمذمرا" for "إلى جهنم زمرا". The previous test -- a word counted as
    part of the verse when its normalised form appeared in the verse -- threw
    every damaged word out of the span, leaving a fragment to compare against
    the whole verse and scoring 39:65 at 0.37 where it belonged. The same verse
    aligns at 0.70 on characters. Measured across five real clips that
    difference is most of the ayat that were never captioned at all.

    Returns (score, first word, last word) with the words given as indexes into
    `window`, or None when nothing lines up.
    """
    normalised = [normalise(word) for word in window]
    joined = " ".join(normalised)
    if not joined.strip() or not verse:
        return None
    # autojunk drops characters appearing in more than 1% of a long string,
    # which for Arabic means the most common letters -- exactly the ones the
    # alignment depends on.
    matcher = difflib.SequenceMatcher(None, joined, verse, autojunk=False)
    blocks = [block for block in matcher.get_matching_blocks() if block.size >= 2]
    if not blocks:
        return None
    low, high = blocks[0].a, blocks[-1].a + blocks[-1].size
    offsets, cursor = [], 0
    for word in normalised:
        offsets.append(cursor)
        cursor += len(word) + 1
    first = max(0, sum(1 for offset in offsets if offset < low) - 1)
    last = sum(1 for offset in offsets if offset < high)
    trimmed = " ".join(normalised[first:last]).strip()
    if not trimmed:
        return None
    return difflib.SequenceMatcher(None, trimmed, verse, autojunk=False).ratio(), first, last


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


def ornament_for(ayah: int) -> str:
    """Just the end-of-ayah mark and its number, with nothing joined to it.

    The caller decides how to attach this. Joining it here with an ordinary
    space let the renderer break the line between the ayah and its mark, so the
    number appeared alone on a second line -- a mushaf never does that.
    """
    return f"\u06dd{arabic_number(ayah)}"


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
