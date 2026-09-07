#!/usr/bin/env python3
"""Measure how far a Qur'an caption sits from the recitation it captions.

Youssef, 7 Sept 2026: "The Qur'an caption system already works and usually
identifies the correct ayahs ... Fix the cases where the correct captions fall
out of sync with the reciter. First determine where the error begins."

The export side was ruled out first, off the box: a 30ms click at every whole
second, trimmed at three NON-keyframe offsets, and a caption burned in at a
known ASS time -- the clicks land at exactly the expected fractional offsets
and the caption's ink appears at exactly its ASS time, in the same file. So
`-ss` before `-i`, the ass filter and asetpts=PTS-STARTPTS introduce no drift,
and any error is in the ASS TIMES. Those are what this measures.

WHERE THIS RUNS. Inside the worker container on the Hetzner box, launched by
deploy-worker.yml with `quran_sync: true` -- which SKIPS the deploy, so asking
a question never restarts a worker mid-job. It imports the container's own
clip_worker and quran, walks a cached transcript with the real
`lecture_ayat`, hands a real clip window to the real `attach_lecture_ayat`,
and reads the real `ayah_events` back. The numbers are the numbers a render
would have used.

WHAT NEVER LEAVES THE BOX. Not one word of any transcript. The corpus Arabic
IS printed, because it is scripture -- public, canonical, and the thing being
captioned -- but Whisper's reading of somebody's lecture is not: only the
TIMES of its words travel, as numbers. That pair is exactly enough to replay
this alignment locally against the same corpus.

WHAT IT MEASURES, per drawn page: the page's ASS start against the start of
the first transcript word that page's text covers, and the page's ASS end
against that word run's end. A page that goes up before its words are recited
is the visual delay being chased; the sign says which way.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from pathlib import Path

# Replaced on the runner with the dispatch inputs, as a JSON object literal.
PARAMS = {}

HOURS = float(PARAMS.get("hours") or 72)
# How many cached transcripts to walk, newest first.
FILES = int(PARAMS.get("files") or 3)
# Emit the machine-readable block that can be replayed locally.
# 1 or 0 -- never a JSON `true`, which is not a Python name (see the workflow).
DUMP = bool(PARAMS.get("dump", 1))
DATA = Path(os.getenv("WORKER_DATA_DIR", "/var/lib/deenclipped")).resolve()
CODE = Path(os.getenv("DC_WORKER_CODE", "/app/worker")).resolve()


def out(line: str = "") -> None:
    print(line, flush=True)


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def transcripts() -> list[Path]:
    folder = DATA / "cache" / "transcripts"
    if not folder.is_dir():
        return []
    cutoff = time.time() - HOURS * 3600
    files = [p for p in folder.glob("*.json") if not p.name.startswith(".") and p.stat().st_mtime >= cutoff]
    return sorted(files, key=lambda p: -p.stat().st_mtime)


def page_word_span(chunk_index: int, chunks, words_total: int, word_offset: int,
                   word_count: int, timed) -> tuple[float, float] | None:
    """The real audio span of the transcript words a page's text covers.

    The same proportion-of-index carry-across ayah_events uses, so this asks
    "when was what is on screen actually recited" rather than inventing a
    second alignment to grade the first against.
    """
    total = max(1, int(word_count or (word_offset + len(timed))))
    taken = 0
    for index, chunk in enumerate(chunks):
        lo = int(round(taken / words_total * total))
        taken += len(chunk)
        hi = max(lo, int(round(taken / words_total * total)))
        if index != chunk_index:
            continue
        first = max(0, lo - word_offset)
        last = min(len(timed), hi - word_offset)
        if first >= last:
            return None
        return timed[first][0], timed[last - 1][1]
    return None


def ass_seconds(stamp: str) -> float:
    hours, minutes, rest = stamp.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(rest)


def measure(cw, quran, corpus, path: Path) -> dict | None:
    segments = read_json(path)
    if not isinstance(segments, list) or not segments:
        return None
    ayat = cw.lecture_ayat(segments, corpus)
    if not ayat:
        return None

    out(f"transcript {path.name[:44]}...  {len(segments)} segments  {len(ayat)} ayat walked")
    for hit in ayat[:12]:
        a = hit["ayah"]
        out(f"  {a['surah']}:{a['ayah']:<4} {hit['start']:8.2f}..{hit['end']:8.2f}s"
            f"  {len(hit.get('words') or [])} words  conf {a.get('confidence')}")

    # A clip over the recitation, exactly as the pipeline would cut one: from
    # the first verse's start to the last verse's end, capped at 60s.
    first, last = ayat[0], ayat[min(len(ayat) - 1, 3)]
    clip_start = float(first["start"])
    clip_end = min(float(last["end"]), clip_start + 60.0)
    candidate = cw.Candidate(
        start=clip_start, end=clip_end, text="", segments=[], score=0,
        reasons=[], quote_risk=True)
    cw.attach_lecture_ayat([candidate], ayat)
    if not candidate.ayat:
        out("  no verse landed inside the clip window")
        return None

    out(f"  clip window {clip_start:.2f}..{clip_end:.2f}s ({clip_end - clip_start:.2f}s),"
        f" {len(candidate.ayat)} verses inside")

    errors: list[float] = []
    rows: list[dict] = []
    dump: list[dict] = []
    for hit in candidate.ayat:
        # match_sequence already returns the corpus ROW -- arabic,
        # translation, surahName and the alignment confidence -- so nothing is
        # looked up a second time and the text below is the corpus's own.
        ayah = hit["ayah"]
        arabic = str(ayah.get("arabic") or "")
        events = cw.ayah_events(
            {"arabic": arabic, "translation": str(ayah.get("translation") or "")},
            ornament="", start=hit["start"], end=hit["end"], latin_font="Outfit",
            translation_size=40, show_translation=True, ayah_size=120, mark_size=60,
            ayah_font="Amiri", word_times=hit.get("words"),
            word_offset=int(hit.get("wordFrom") or 0),
            word_count=int(hit.get("wordCount") or 0))

        words = cw.strip_unattachable_marks(arabic, "Amiri").split()
        chunk_count = max(1, -(-len(words) // cw.AYAH_MAX_WORDS))
        base, extra = divmod(len(words), chunk_count)
        chunks, taken = [], 0
        for index in range(chunk_count):
            size = base + (1 if index < extra else 0)
            chunks.append(words[taken:taken + size])
            taken += size
        timed = [(float(a), float(b)) for a, b in (hit.get("words") or []) if float(b) > float(a)]

        # Which pages ayah_events drew, in order, matched back to their index.
        drawn = []
        for index in range(chunk_count):
            span = page_word_span(index, chunks, len(words), int(hit.get("wordFrom") or 0),
                                  int(hit.get("wordCount") or 0), timed)
            if span:
                drawn.append((index, span))

        out(f"  -- {ayah['surah']}:{ayah['ayah']}  clip-local {hit['start']:.2f}..{hit['end']:.2f}s"
            f"  {len(events)} pages drawn, {len(drawn)} pages with words")
        for position, event in enumerate(events):
            parts = event.split(",", 4)
            page_start, page_end = ass_seconds(parts[1]), ass_seconds(parts[2])
            if position >= len(drawn):
                out(f"     page {position + 1}: {page_start:6.2f}..{page_end:6.2f}s   (no word span)")
                continue
            index, (word_start, word_end) = drawn[position]
            delta_in = page_start - word_start
            delta_out = page_end - word_end
            errors.append(abs(delta_in))
            out(f"     page {position + 1}: shown {page_start:6.2f}..{page_end:6.2f}s"
                f"   recited {word_start:6.2f}..{word_end:6.2f}s"
                f"   start {delta_in:+7.3f}s   end {delta_out:+7.3f}s")
            rows.append({"delta_in": delta_in, "delta_out": delta_out})

        dump.append({
            "surah": ayah["surah"], "ayah": ayah["ayah"],
            "arabic": arabic, "translation": str(ayah.get("translation") or ""),
            "surahName": str(ayah.get("surahName") or ""),
            "confidence": ayah.get("confidence"),
            "start": round(float(hit["start"]), 3), "end": round(float(hit["end"]), 3),
            "wordFrom": int(hit.get("wordFrom") or 0),
            "wordCount": int(hit.get("wordCount") or 0),
            # TIMES only. Whisper's words themselves never leave the box.
            "words": [[round(a, 3), round(b, 3)] for a, b in timed],
        })

    if errors:
        out(f"  == page-start error over {len(errors)} pages:"
            f" median {statistics.median(errors) * 1000:.0f}ms"
            f"  worst {max(errors) * 1000:.0f}ms"
            f"  over 250ms: {sum(1 for e in errors if e > 0.25)}/{len(errors)}")
    out()
    return {"clip": [round(clip_start, 3), round(clip_end, 3)], "ayat": dump, "errors": errors}


def main() -> int:
    sys.path.insert(0, str(CODE))
    try:
        import clip_worker as cw  # type: ignore
        import quran  # type: ignore
    except Exception as error:  # pragma: no cover - the container decides
        out(f"could not import the worker: {error}")
        return 1

    corpus = quran.load()
    if corpus is None:
        out("the Quran corpus is not cached on this box, so nothing can be walked")
        return 1
    out(f"corpus: {len(corpus)} ayahs")
    out(f"AYAH_MAX_WORDS={cw.AYAH_MAX_WORDS}  fade {cw.AYAH_FADE_IN_MS}/{cw.AYAH_FADE_OUT_MS}ms")
    out()

    found = transcripts()
    if not found:
        out(f"no transcript cached in the last {HOURS:g}h under {DATA / 'cache' / 'transcripts'}")
        return 1

    payloads: list = []
    every: list = []
    for path in found[:FILES]:
        try:
            result = measure(cw, quran, corpus, path)
        except Exception as error:
            out(f"  {path.name[:44]}: {type(error).__name__}: {error}")
            continue
        if result:
            payloads.append(result)
            every.extend(result["errors"])

    if not payloads:
        out("no cached transcript held a recited ayah")
        return 1

    out("== ALL PAGES ==")
    out(f"pages {len(every)}   median {statistics.median(every) * 1000:.0f}ms"
        f"   worst {max(every) * 1000:.0f}ms"
        f"   over 250ms: {sum(1 for e in every if e > 0.25)}/{len(every)}")

    if DUMP:
        out()
        out("== REPLAY (corpus text and word TIMES; no transcript words) ==")
        out("BEGIN_QURAN_SYNC_JSON")
        out(json.dumps({"clips": [{"clip": p["clip"], "ayat": p["ayat"]} for p in payloads]},
                       ensure_ascii=False))
        out("END_QURAN_SYNC_JSON")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
