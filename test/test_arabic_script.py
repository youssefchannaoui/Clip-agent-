"""Spoken Arabic reaches the frame in Arabic script, and only the frame.

Youssef, on a clip captioned "fikulli qarni min ummati": "whenever they speak
Arabic ... I wanted to come up in Arabic ... with all templates, of course.
And then with Quran recitation, leave it as is." Then, restating it: "in all
types of Islamic lectures there should be an auto detect that ... regardless of
anything, will pick through -- if they speak Arabic, it will come up with
Arabic writing. Every single Arabic word will turn into an Arabic writing, and
it can be in the same sentence as an English sentence."

Two mechanisms, and each covers what the other cannot:

  * v3.180.0 turned the voice filter off, so a STRETCH of Arabic -- a
    quotation, a du'a, a whole sentence -- is detected as Arabic and written in
    Arabic script. Measured on the box: 0 Arabic segments of 26 before, 10 of
    24 after.
  * This: a single Arabic word inside an English sentence, which no language
    choice can reach, because Whisper commits to one language per SEGMENT.

The tests below are about the SECOND, and about the size the first has been
drawing at all along.
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
sys.modules["clip_worker"] = worker
spec.loader.exec_module(worker)

ARABIC = re.compile(r"[؀-ۿ]")
LATIN = re.compile(r"[A-Za-z]")


def render(template_extra: dict | None = None, *, text: str, words: list[dict] | None = None) -> str:
    spoken = words if words is not None else [
        {"start": i * 0.4, "end": i * 0.4 + 0.35, "word": w}
        for i, w in enumerate(text.split())
    ]
    end = max(1.0, (spoken[-1]["end"] if spoken else 1.0))
    segments = [{"start": 0.0, "end": end, "text": text, "words": spoken}]
    candidate = worker.Candidate(0, end, text, segments, 90, [], False)
    template = {
        "width": 1080, "height": 1920, "captionFont": "Outfit", "captionFontSize": 62,
        "captionArabicFont": "Amiri", **(template_extra or {}),
    }
    out = pathlib.Path(tempfile.mkdtemp()) / "c.ass"
    worker.write_ass(candidate, template, out)
    return out.read_text(encoding="utf-8")


def events(ass: str) -> list[str]:
    return [line for line in ass.splitlines() if line.startswith("Dialogue: 2")]


class LexiconTests(unittest.TestCase):
    def test_every_entry_is_arabic_and_only_arabic(self):
        for key, value in worker.ARABIC_TRANSLITERATIONS.items():
            self.assertTrue(ARABIC.search(value), f"{key} maps to {value!r}, which holds no Arabic")
            self.assertIsNone(LATIN.search(value), f"{key} maps to {value!r}, which holds Latin")

    def test_every_key_is_its_own_lookup_form(self):
        # The lookup lowercases and strips punctuation. A key that does not
        # survive that is a key nothing can ever match, and it would sit in the
        # table looking like it worked.
        for key in worker.ARABIC_TRANSLITERATIONS:
            self.assertEqual(worker.transliteration_key(key), key)

    def test_no_particle_is_in_the_lexicon(self):
        # A particle would convert ONE word in the middle of a transliterated
        # quotation and leave the line half in each script -- worse than the
        # all-Latin line it started as.
        for particle in ("min", "wa", "fi", "bi", "li", "la", "an", "ila", "ala", "ma", "fee"):
            self.assertNotIn(particle, worker.ARABIC_TRANSLITERATIONS, particle)

    def test_an_english_loanword_is_left_in_english(self):
        # The rule: a token is here when the speaker is SPEAKING ARABIC, not
        # when they are using a word English has taken. A false positive puts
        # Arabic script on an English word, which is visible and wrong; a miss
        # is only yesterday's behaviour.
        for word in ("Quran", "Koran", "Ramadan", "hajj", "halal", "haram", "hijab",
                     "imam", "sheikh", "shaykh", "mufti", "hadith", "sunnah", "surah",
                     "mosque", "Muslim", "Islam", "jihad", "fatwa", "sharia", "Eid",
                     "Muhammad", "Ahmad", "Yusuf", "Amin", "Iman"):
            self.assertEqual(worker.arabise_word(word), word, word)

    def test_an_ordinary_english_sentence_is_untouched(self):
        line = "The door does not close because you walked through it yesterday"
        self.assertEqual(worker.arabise_text(line), line)


class SubstitutionTests(unittest.TestCase):
    def test_a_transliterated_word_becomes_arabic(self):
        self.assertEqual(worker.arabise_word("alhamdulillah"), "الحمد لله")
        self.assertEqual(worker.arabise_word("Alhamdulillah"), "الحمد لله")
        self.assertEqual(worker.arabise_word("Insha'Allah"), worker.arabise_word("inshaallah"))

    def test_the_punctuation_the_word_was_wearing_is_kept(self):
        self.assertEqual(worker.arabise_word("Alhamdulillah,"), "الحمد لله,")
        self.assertEqual(worker.arabise_word('"sabr."'), '"صبر."')

    def test_it_is_idempotent(self):
        once = worker.arabise_text("He said alhamdulillah and carried on")
        self.assertEqual(worker.arabise_text(once), once)

    def test_one_spoken_word_keeps_one_timing_slot(self):
        # Word and karaoke modes redraw a group once per word against Whisper's
        # own timings, so a substitution that changed the word COUNT would
        # slide the highlight off the word being spoken. An entry may hold
        # spaces -- "ما شاء الله" is three Arabic words -- but it occupies the
        # single slot of the single token that was spoken.
        text = "one alhamdulillah two mashallah three"
        words = [{"start": i * 0.4, "end": i * 0.4 + 0.35, "word": w}
                 for i, w in enumerate(text.split())]
        segments = [{"start": 0.0, "end": 2.0, "text": text, "words": words}]
        candidate = worker.Candidate(0, 2.0, text, segments, 90, [], False)
        whisper = worker.candidate_words(candidate)
        drawn = worker.caption_words(candidate)
        self.assertEqual(len(whisper), len(drawn))
        for before, after in zip(whisper, drawn):
            self.assertEqual((before["start"], before["end"]), (after["start"], after["end"]))

    def test_arabic_already_in_arabic_is_returned_untouched(self):
        for text in ("الحمد لله", "وسيق الذين كفروا إلى جهنم زمرا"):
            self.assertEqual(worker.arabise_word(text), text)
            self.assertEqual(worker.arabise_text(text), text)


class WhatTheCustomerKeepsTests(unittest.TestCase):
    """The substitution is a DRAWING. Whisper's own words survive everywhere."""

    def _candidate(self):
        text = "He said alhamdulillah and carried on"
        words = [{"start": i * 0.4, "end": i * 0.4 + 0.35, "word": w}
                 for i, w in enumerate(text.split())]
        segments = [{"start": 0.0, "end": 2.4, "text": text, "words": words}]
        return worker.Candidate(0, 2.4, text, segments, 90, [], False)

    def test_the_editors_caption_blocks_are_whispers_words(self):
        # "The editor must never save what it only draws." A block holding our
        # substitution could be written back over the transcript on Save.
        blocks = worker.caption_blocks(self._candidate())
        self.assertTrue(blocks)
        joined = " ".join(b["text"] for b in blocks)
        self.assertIn("alhamdulillah", joined)
        self.assertIsNone(ARABIC.search(joined))

    def test_candidate_words_are_whispers_words_and_caption_words_are_not(self):
        candidate = self._candidate()
        self.assertIn("alhamdulillah", [w["word"] for w in worker.candidate_words(candidate)])
        drawn = " ".join(w["word"] for w in worker.caption_words(candidate))
        self.assertIn("الحمد لله", drawn)
        # ...and asking for Whisper's words again still gets Whisper's.
        self.assertIn("alhamdulillah", [w["word"] for w in worker.candidate_words(candidate)])

    def test_the_render_never_rewrites_the_transcript(self):
        candidate = self._candidate()
        out = pathlib.Path(tempfile.mkdtemp()) / "c.ass"
        worker.write_ass(candidate, {"width": 1080, "height": 1920}, out)
        self.assertEqual(candidate.text, "He said alhamdulillah and carried on")
        self.assertEqual(candidate.segments[0]["text"], "He said alhamdulillah and carried on")
        self.assertEqual([w["word"] for w in candidate.segments[0]["words"]][2], "alhamdulillah")

    def test_the_title_is_still_written_from_english(self):
        # is_english_title refuses Arabic script, so a title built from our
        # substitution would be rejected and fall back to "Important reminder
        # N". clip_english must never see it.
        candidate = self._candidate()
        self.assertIsNone(ARABIC.search(worker.clip_english(candidate)))


class EveryModeTests(unittest.TestCase):
    LINE = "He said alhamdulillah and carried on"

    def test_every_caption_mode_draws_it_in_arabic(self):
        for mode in ("dynamic-stack", "stack-build", "cards", "fill", "word", "phrase"):
            with self.subTest(mode=mode):
                ass = render({"captionMode": mode}, text=self.LINE)
                drawn = "\n".join(events(ass))
                self.assertIn("الحمد لله", drawn, mode)
                self.assertNotIn("alhamdulillah", drawn.lower(), mode)

    def test_a_recitation_is_left_exactly_as_it_is(self):
        # Whisper's Arabic is a search query on the Quran path, never the
        # caption -- and no Latin lexicon can match Arabic script anyway.
        arabic = "وسيق الذين كفروا إلى جهنم زمرا"
        ass = render({"captionMode": "phrase"}, text=arabic)
        self.assertIn(arabic.split()[0], "\n".join(events(ass)))


class SizeTests(unittest.TestCase):
    """Arabic at a Latin nominal size draws a quarter the height. Measured."""

    def test_the_arabic_run_is_asked_for_the_measured_multiple(self):
        ass = render({"captionMode": "phrase", "captionFontSize": 62},
                     text="He said alhamdulillah and carried on")
        want = worker.arabic_inline_size(62)
        self.assertIn(f"\\fs{want}", "\n".join(events(ass)))
        self.assertGreater(want, 62 * 2, "an Arabic word must not be drawn near the Latin nominal")

    def test_the_size_is_closed_the_moment_the_arabic_ends(self):
        # An override block holds until something changes it, so an \fs on one
        # word draws every word AFTER it at that size. Rendered on the box
        # before this was written: "and carried on" came out three times its
        # own size and wrapped onto a second line.
        line = events(render({"captionMode": "phrase", "captionFontSize": 62},
                             text="He said alhamdulillah and carried on"))[0]
        big = f"\\fs{worker.arabic_inline_size(62)}"
        tail = line[line.index(big) + len(big):]
        self.assertIn("\\fs62", tail, "the Latin after the Arabic must be named back to its own size")
        self.assertLess(tail.index("\\fs62"), tail.lower().index("carried"),
                        "the size is restored BEFORE the next Latin word, not after it")

    def test_a_card_names_the_latin_back_after_the_arabic(self):
        # Cards pass tag_latin=False -- their Latin words carry no tag of their
        # own -- so the Arabic run has to be closed explicitly or every word
        # after it is drawn in Amiri at the Arabic size. This is the branch the
        # phrase test above cannot reach.
        line = worker.mixed_script_line(
            "He said alhamdulillah and carried on",
            font="Outfit", arabic_font="Amiri", uppercase=False, tag_latin=False,
            arabic_size=worker.arabic_inline_size(62), latin_size=62,
        )
        tail = line[line.index("الحمد"):]
        self.assertIn("{\\fnOutfit\\fs62}", tail,
                      "the face and the size are both named back before the next English word")
        self.assertLess(tail.index("{\\fnOutfit\\fs62}"), tail.index("and"))

    def test_a_line_with_no_arabic_in_it_is_drawn_exactly_as_before(self):
        # The size is only ever named where there is Arabic, so an English
        # caption's layout -- and its tracking -- cannot move.
        ass = render({"captionMode": "phrase"}, text="The door does not close")
        self.assertNotIn("\\fs", "\n".join(events(ass)))


if __name__ == "__main__":
    unittest.main()
