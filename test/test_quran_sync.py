"""The Qur'an captions follow the reciter, not a ruler laid over the verse.

Youssef, 7 Sept 2026: "The Qur'an caption system already works and usually
identifies the correct ayahs. Do not rebuild or replace it. Fix the cases where
the correct captions fall out of sync with the reciter."

WHERE THE ERROR BEGINS, settled before any of this was written. The export was
ruled out by measurement rather than by argument: a 60s source with a 30ms
click at every whole second and keyframes only every 10s, trimmed at four
offsets (three of them NON-keyframe) both plainly and through the real render
chain shape, with a caption burned in at a known ASS time. The clicks landed at
exactly the expected fractional offsets and the caption's ink was lit from
exactly 2.000 to the last frame before 4.000, every time. `-ss` before `-i`,
the ass filter and asetpts=PTS-STARTPTS preserve source-to-output timing
exactly, so the error is in the ASS TIMES -- which is what these test.

THE THREE FAULTS, all one shape: a page was placed by arithmetic where a
measurement was available, and nothing could tell the two apart.

  1. Page ENDS have snapped to a real word end since v3.102.0 and page STARTS
     never did -- each page simply began where the one before it finished. A
     breath between two pages therefore put the NEXT page up for the whole
     pause.
  2. The fallback ruler accumulated from the verse's own start, so it ignored
     every successful snap before it: one page running long stayed wrong for
     the rest of the verse.
  3. lecture_word_timeline spreads a segment's words EVENLY when Whisper gave
     none, and nothing downstream could tell that ruler from measured audio.
     Three live paths produce such a segment -- reflow_segments on an edited
     clip, process_rerender's no-segment fallback, and local-engine's own
     `words: []` -- and the pages were then divided into equal slices and
     presented with full confidence.

Every test here drives the real ayah_page_plan or the real ayah_events and
reads the times back. None of them greps a source string: this repo has been
caught ten times by a source-string test passing against behaviour that had
changed underneath it.
"""

from __future__ import annotations

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "worker"))
import clip_worker as worker  # noqa: E402


def ass_seconds(stamp: str) -> float:
    hours, minutes, rest = stamp.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(rest)


def page_times(arabic: str, words, *, start: float, end: float,
               heard=None, offset: int = 0, count: int = 0):
    """The times ayah_events really writes, read back out of its Dialogue lines."""
    events = worker.ayah_events(
        {"arabic": arabic, "translation": ""}, ornament="۝",
        start=start, end=end, latin_font="Outfit", translation_size=40,
        show_translation=False, ayah_size=120, mark_size=60, ayah_font="Amiri",
        word_times=words, word_heard=heard, word_offset=offset, word_count=count)
    out = []
    for event in events:
        parts = event.split(",", 4)
        out.append((round(ass_seconds(parts[1]), 3), round(ass_seconds(parts[2]), 3)))
    return out


def page_overrides(arabic: str, words, *, start: float, end: float,
                   heard=None, offset: int = 0, count: int = 0):
    """The override block ayah_events writes in front of each page's text."""
    events = worker.ayah_events(
        {"arabic": arabic, "translation": ""}, ornament="\u06dd",
        start=start, end=end, latin_font="Outfit", translation_size=40,
        show_translation=False, ayah_size=120, mark_size=60, ayah_font="Amiri",
        word_times=words, word_heard=heard, word_offset=offset, word_count=count)
    return [event.split(",", 9)[9].split("{\\q0}")[0] for event in events]


def verse(count: int) -> str:
    """A verse of `count` distinguishable words, so the paging is exact."""
    return " ".join(f"كلم{chr(0x0627 + index % 20)}" for index in range(count))


class RecitationSyncTests(unittest.TestCase):
    """A clean recitation, and the pauses a reciter actually takes."""

    def test_a_clean_recitation_pages_on_its_own_words(self):
        # Twelve words, three pages of four, recited evenly. Every page goes up
        # exactly when its first word does.
        words = [(index * 1.0, index + 1.0) for index in range(12)]
        times = page_times(verse(12), words, start=0.0, end=12.0, count=12,
                           heard=[True] * 12)
        self.assertEqual(times, [(0.0, 4.0), (4.0, 8.0), (8.0, 12.0)])

    def test_a_breath_between_pages_holds_the_words_being_recited(self):
        """THE FAULT. The reciter finishes page one at 4.0 and does not begin
        page two until 7.0. The old code chained page two's start to page one's
        end, so it was on screen for the whole three-second pause -- twelve
        times the 250ms this is held to."""
        words = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0),
                 (7.0, 7.7), (7.7, 8.5), (8.5, 9.2), (9.2, 10.0),
                 (10.0, 10.5), (10.5, 11.0), (11.0, 11.5), (11.5, 12.0)]
        times = page_times(verse(12), words, start=0.0, end=12.0, count=12,
                           heard=[True] * 12)
        self.assertAlmostEqual(times[1][0], 7.0, places=2,
                               msg="page two must wait for its own first word")
        # And the breath is held by the words that ARE being recited, not by a
        # blank frame: a verse half-drawn mid-recitation reads as broken.
        self.assertAlmostEqual(times[0][1], 7.0, places=2)

    def test_a_madd_held_on_a_word_holds_its_page(self):
        # A five-second elongation on the last word of page two. The page must
        # stay with it -- this half already worked and must not regress.
        words = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0),
                 (4.0, 4.7), (4.7, 5.4), (5.4, 6.1), (6.1, 11.0),
                 (11.0, 11.3), (11.3, 11.6), (11.6, 11.8), (11.8, 12.0)]
        times = page_times(verse(12), words, start=0.0, end=12.0, count=12,
                           heard=[True] * 12)
        self.assertAlmostEqual(times[1][1], 11.0, places=2)
        self.assertAlmostEqual(times[2][0], 11.0, places=2)

    def test_a_change_of_pace_is_followed_rather_than_averaged(self):
        # Slow for the first third, fast for the rest. A ruler would give each
        # page a third of the time; the pages must follow the words.
        words = ([(index * 2.0, (index + 1) * 2.0) for index in range(4)] +
                 [(8.0 + index * 0.5, 8.5 + index * 0.5) for index in range(8)])
        times = page_times(verse(12), words, start=0.0, end=12.0, count=12,
                           heard=[True] * 12)
        self.assertAlmostEqual(times[0][1], 8.0, places=2,
                               msg="the slow opening keeps its page for the whole 8s")
        self.assertAlmostEqual(times[1][0], 8.0, places=2)
        self.assertAlmostEqual(times[2][0], 10.0, places=2)


class MidAyahTests(unittest.TestCase):
    """A clip that opens or closes part way through a verse."""

    def test_a_clip_opening_mid_verse_draws_only_what_it_holds(self):
        # A twelve-word verse whose last four words are inside the clip.
        words = [(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0)]
        times = page_times(verse(12), words, start=0.0, end=2.0,
                           heard=[True] * 4, offset=8, count=12)
        self.assertEqual(len(times), 1, "only the page whose words were recited here")
        self.assertAlmostEqual(times[0][0], 0.0, places=2)
        self.assertAlmostEqual(times[0][1], 2.0, places=2)

    def test_a_clip_closing_mid_verse_draws_no_verse_mark(self):
        # The ornament closes a verse; a clip that never reaches its end has
        # not closed it, and drawing the mark would claim otherwise.
        words = [(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0)]
        events = worker.ayah_events(
            {"arabic": verse(12), "translation": ""}, ornament="۝",
            start=0.0, end=2.0, latin_font="Outfit", translation_size=40,
            show_translation=False, ayah_size=120, mark_size=60, ayah_font="Amiri",
            word_times=words, word_heard=[True] * 4, word_offset=0, word_count=12)
        self.assertTrue(events)
        self.assertNotIn("۝", "".join(events))

    def test_a_whole_verse_still_closes_with_its_mark(self):
        words = [(index * 1.0, index + 1.0) for index in range(12)]
        events = worker.ayah_events(
            {"arabic": verse(12), "translation": ""}, ornament="۝",
            start=0.0, end=12.0, latin_font="Outfit", translation_size=40,
            show_translation=False, ayah_size=120, mark_size=60, ayah_font="Amiri",
            word_times=words, word_heard=[True] * 12, word_offset=0, word_count=12)
        self.assertIn("۝", events[-1])


class SequenceTests(unittest.TestCase):
    """Alignment may never run backwards or into a page it has left."""

    def test_pages_never_run_backwards_however_the_word_times_arrive(self):
        # Whisper's word times are not always monotonic across a segment
        # boundary. Whatever it hands over, the pages must go forwards.
        words = [(0.0, 3.0), (2.5, 3.2), (1.0, 4.0), (3.9, 4.4),
                 (4.4, 5.0), (4.0, 6.0), (6.0, 6.5), (6.4, 8.0),
                 (8.0, 8.4), (8.3, 9.0), (9.0, 9.5), (9.4, 10.0)]
        times = page_times(verse(12), words, start=0.0, end=10.0, count=12,
                           heard=[True] * 12)
        for before, after in zip(times, times[1:]):
            self.assertLess(before[0], after[0], f"{times} runs backwards")
            self.assertLessEqual(before[1], after[0] + 1e-6, f"{times} overlaps")

    def test_a_later_page_s_bad_time_does_not_drag_an_earlier_one_off_its_word(self):
        """Ordering alone is not enough, and a green probe proved it.

        Whisper's word times are not monotonic across a segment boundary: here
        page THREE's first word is timed at 3.0s, before page TWO's real 8.0s.
        Clamping only backwards from the end keeps the pages in order and pulls
        page two back to 2.65s -- five seconds before the word it shows. In
        order, and wrong. The earlier page keeps its own measured time and the
        untrustworthy later one is placed after it.
        """
        words = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0),
                 (8.0, 8.5), (8.5, 9.0), (9.0, 9.5), (9.5, 10.0),
                 (3.0, 3.5), (3.5, 4.0), (4.0, 4.5), (4.5, 12.0)]
        times = page_times(verse(12), words, start=0.0, end=12.0, count=12,
                           heard=[True] * 12)
        self.assertAlmostEqual(times[1][0], 8.0, places=2,
                               msg="page two must stay on its own measured word")
        self.assertGreater(times[2][0], times[1][0])

    def test_consecutive_verses_do_not_reach_into_each_other(self):
        # Two verses back to back. Each is planned inside its own window, so
        # the second cannot begin before the first has ended.
        first = page_times(verse(8), [(index * 1.0, index + 1.0) for index in range(8)],
                           start=0.0, end=8.0, count=8, heard=[True] * 8)
        second = page_times(verse(8), [(8.0 + index * 1.0, 9.0 + index * 1.0) for index in range(8)],
                            start=8.0, end=16.0, count=8, heard=[True] * 8)
        self.assertLessEqual(first[-1][1], second[0][0] + 1e-6)

    def test_a_repeated_phrase_does_not_send_a_page_back(self):
        # A reciter repeating the same words gives Whisper the same text twice.
        # The pages advance through the verse once; the repeat is time, not a
        # reason to redraw an earlier page.
        words = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0),
                 (4.0, 5.0), (5.0, 6.0), (6.0, 7.0), (7.0, 8.0),
                 (8.0, 9.0), (9.0, 10.0), (10.0, 11.0), (11.0, 14.0)]
        times = page_times(verse(12), words, start=0.0, end=14.0, count=12,
                           heard=[True] * 12)
        self.assertEqual(len(times), 3)
        self.assertEqual(times, sorted(times))

    def test_a_reciter_restarting_keeps_the_pages_in_order(self):
        # A restart lands as a long first stretch (the false start plus the
        # real one) before the verse continues. The pages still go forwards and
        # still cover the window exactly once.
        words = [(0.0, 6.0), (6.0, 6.6), (6.6, 7.2), (7.2, 8.0),
                 (8.0, 8.6), (8.6, 9.2), (9.2, 9.8), (9.8, 10.4),
                 (10.4, 11.0), (11.0, 11.6), (11.6, 12.2), (12.2, 13.0)]
        times = page_times(verse(12), words, start=0.0, end=13.0, count=12,
                           heard=[True] * 12)
        self.assertEqual(times, sorted(times))
        self.assertAlmostEqual(times[0][0], 0.0, places=2)
        self.assertAlmostEqual(times[-1][1], 13.0, places=2)
        for before, after in zip(times, times[1:]):
            self.assertAlmostEqual(before[1], after[0], places=3,
                                   msg="the verse is covered with no gap")


class WeakConfidenceTests(unittest.TestCase):
    """A time that was worked out is not a time that was heard."""

    def test_a_verse_whose_times_were_all_spread_draws_fewer_pages(self):
        """THE SILENT FAULT. Whisper gave this segment no word timings, so
        lecture_word_timeline spread them evenly -- and the old code paged
        against that ruler with full confidence. Twelve words in three pages of
        four, each a suspiciously exact third of the verse. With the spread
        marked, the verse is drawn in as few pages as stay readable: a
        correctly timed phrase rather than an inaccurately timed word split."""
        spread = [(index * 1.0, index + 1.0) for index in range(12)]
        believed = page_times(verse(12), spread, start=0.0, end=12.0, count=12,
                              heard=[True] * 12)
        marked = page_times(verse(12), spread, start=0.0, end=12.0, count=12,
                            heard=[False] * 12)
        self.assertEqual(len(believed), 3)
        self.assertLess(len(marked), len(believed),
                        "an all-spread verse must not be split as finely as a heard one")
        plan = worker.ayah_page_plan(
            verse(12).split(), start=0.0, end=12.0, word_times=spread,
            word_heard=[False] * 12, word_offset=0, word_count=12)
        self.assertEqual(plan["anchored"], 0, "nothing may be anchored to a ruler")
        self.assertEqual(plan["evidence"], 0)

    def test_a_page_with_no_heard_word_is_placed_between_the_ones_that_have(self):
        # The middle page's words were all spread; the pages either side were
        # heard. It must sit BETWEEN them rather than be measured from the
        # verse's start -- that is the re-anchoring, and it is what stops an
        # early error accumulating.
        words = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0),
                 (4.0, 5.0), (5.0, 6.0), (6.0, 7.0), (7.0, 8.0),
                 (14.0, 15.0), (15.0, 16.0), (16.0, 17.0), (17.0, 18.0)]
        heard = [True] * 4 + [False] * 4 + [True] * 4
        plan = worker.ayah_page_plan(
            verse(12).split(), start=0.0, end=18.0, word_times=words,
            word_heard=heard, word_offset=0, word_count=12)
        self.assertEqual(plan["heard"], [0, 2], "only the heard pages anchor")
        middle = plan["times"][1][0]
        self.assertGreaterEqual(middle, 4.0, "after the last word actually heard")
        self.assertLessEqual(middle, 14.0, "before the next word actually heard")

    def test_a_verse_heard_as_one_word_is_not_split_into_four_pages(self):
        # Whisper ran the whole verse together. There is one real boundary, so
        # inventing three more is exactly the inaccurate word-by-word timing
        # this replaces.
        words = [(0.0, 16.0)]
        times = page_times(verse(16), words, start=0.0, end=16.0, count=1,
                           heard=[True])
        self.assertLessEqual(len(times), 3,
                             "one heard word cannot support four honest pages")

    def test_no_word_times_at_all_still_draws_the_whole_verse(self):
        # An older transcript, or a re-render. Every page is drawn and the
        # window is shared out -- exactly the behaviour that shipped, because
        # there is genuinely nothing better to do.
        times = page_times(verse(12), None, start=0.0, end=12.0)
        self.assertEqual(times, [(0.0, 4.0), (4.0, 8.0), (8.0, 12.0)])


class SilenceAndEdgeTests(unittest.TestCase):
    """The shapes that must not produce a flash, a gap or an exception."""

    def test_silence_inside_a_verse_leaves_no_blank_frame(self):
        # Ten seconds of nothing in the middle of the verse. Scripture must not
        # vanish from the screen part way through a verse being recited.
        words = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0),
                 (14.0, 15.0), (15.0, 16.0), (16.0, 17.0), (17.0, 18.0)]
        times = page_times(verse(8), words, start=0.0, end=18.0, count=8,
                           heard=[True] * 8)
        for before, after in zip(times, times[1:]):
            self.assertAlmostEqual(before[1], after[0], places=3,
                                   msg=f"a blank frame at {before[1]:.2f}s")
        self.assertAlmostEqual(times[0][0], 0.0, places=3)
        self.assertAlmostEqual(times[-1][1], 18.0, places=3)

    def test_a_window_too_short_for_its_pages_shares_it_out_evenly(self):
        # Four pages into one second. There is no arrangement that anchors
        # them, so an even share is the honest answer rather than a stack of
        # zero-length flashes.
        words = [(0.0, 0.9), (0.9, 0.95), (0.95, 0.98), (0.98, 1.0)]
        times = page_times(verse(16), words, start=0.0, end=1.0, count=4,
                           heard=[True] * 4)
        self.assertEqual(times, sorted(times))
        for before, after in zip(times, times[1:]):
            self.assertGreater(after[0], before[0])
        self.assertAlmostEqual(times[-1][1], 1.0, places=3)

    def test_a_zero_length_word_does_not_shift_the_flags(self):
        # A dropped word must drop its flag with it, or every anchor after it
        # is read off the wrong word.
        words = [(0.0, 2.0), (2.0, 2.0), (2.0, 4.0), (4.0, 6.0)]
        plan = worker.ayah_page_plan(
            verse(8).split(), start=0.0, end=6.0, word_times=words,
            word_heard=[True, False, True, True], word_offset=0, word_count=4)
        self.assertTrue(plan["live"])
        self.assertEqual(plan["times"][plan["live"][0]][0], 0.0)

    def test_an_empty_verse_returns_nothing_rather_than_raising(self):
        self.assertEqual(page_times("", [(0.0, 1.0)], start=0.0, end=1.0, count=1), [])


class ReviewGateTests(unittest.TestCase):
    """Every Qur'an clip is reviewed by a person before it can post."""

    def _candidate(self, start, end):
        return worker.Candidate(start=start, end=end, text="a lecture",
                                segments=[], score=50, reasons=[], quote_risk=False)

    def test_a_clip_holding_a_matched_verse_is_flagged_for_review(self):
        """quote_risk is otherwise a regex over the transcript -- a good guess.
        A corpus match is not a guess, and Whisper mangles recitation badly
        enough to slip a regex: that is the entire reason the lecture walk
        exists. Unflagged, and with auto-approve on, such a clip could post
        without anyone reading the ayah on the frame."""
        clip = self._candidate(0.0, 30.0)
        self.assertFalse(clip.quote_risk)
        worker.attach_lecture_ayat([clip], [{
            "start": 5.0, "end": 12.0, "words": [(5.0, 12.0)], "heard": [True],
            "ayah": {"surah": 112, "ayah": 1, "surahName": "Al-Ikhlaas",
                     "arabic": "قل هو الله احد", "translation": "Say He is Allah the One"},
        }])
        self.assertTrue(clip.ayat)
        self.assertTrue(clip.quote_risk, "a matched verse must force human review")

    def test_a_clip_with_no_verse_inside_it_is_left_alone(self):
        # The gate must not fire on every clip of every lecture -- forcing
        # review on an ordinary talk would make the flag mean nothing.
        clip = self._candidate(0.0, 30.0)
        worker.attach_lecture_ayat([clip], [{
            "start": 90.0, "end": 96.0, "words": [(90.0, 96.0)], "heard": [True],
            "ayah": {"surah": 112, "ayah": 1, "surahName": "Al-Ikhlaas",
                     "arabic": "قل هو الله احد", "translation": "Say He is Allah the One"},
        }])
        self.assertEqual(clip.ayat, [])
        self.assertFalse(clip.quote_risk)


class WrongMatchTests(unittest.TestCase):
    """A wrong verse must not be rescued by good timing."""

    def test_an_intentionally_incorrect_match_is_refused_by_the_corpus(self):
        # The timing layer takes whatever verse it is given -- it is not the
        # matcher, and pretending otherwise would hide a bad match behind a
        # confident-looking caption. The refusal belongs upstream, so that is
        # where it is tested: an English sentence must reach no ayah at all.
        corpus = worker.quran.Corpus([
            {"surah": 1, "ayah": 1, "surahName": "Al-Faatiha", "surahArabic": "",
             "arabic": "بسم الله الرحمن الرحيم", "translation": "In the name of Allah"},
            {"surah": 112, "ayah": 1, "surahName": "Al-Ikhlaas", "surahArabic": "",
             "arabic": "قل هو الله احد", "translation": "Say He is Allah the One"},
        ])
        self.assertIsNone(corpus.match("and so my brothers and sisters we must remember"))

    def test_a_match_carries_its_confidence_so_a_weak_one_can_be_seen(self):
        """A wrong verse cannot be caught by the timing layer -- it takes
        whatever it is handed, and pretending otherwise would hide a bad match
        behind a confident-looking caption. What it CAN do is refuse to hide
        it: the confidence travels with the verse, so a review screen can show
        a weak match rather than a caption that merely looks certain.

        Measured on the real recitation this was tuned against: 'اولئك هم
        الخاسرون' scores 0.882 against 23:10's الوارثون -- the wrong word in
        the wrong surah, and high enough that no threshold here would separate
        them. That is the matcher's problem, and the honest answer is to carry
        the number rather than to invent a bar this layer cannot police.
        """
        corpus = worker.quran.Corpus([
            {"surah": 39, "ayah": 63, "surahName": "Az-Zumar", "surahArabic": "",
             "arabic": "له مقاليد السماوات والارض", "translation": "To Him belong the keys"},
            {"surah": 23, "ayah": 10, "surahName": "Al-Muminoon", "surahArabic": "",
             "arabic": "اولئك هم الوارثون", "translation": "Those are the inheritors"},
        ])
        wrong = corpus.match("اولئك هم الخاسرون")
        self.assertIsNotNone(wrong)
        self.assertIn("confidence", wrong)
        self.assertLess(wrong["confidence"], 1.0)
        self.assertEqual((wrong["surah"], wrong["ayah"]), (23, 10))

    def test_the_timing_layer_never_invents_scripture(self):
        # Whatever the alignment does, the words on screen are the corpus's
        # own. A page is a slice of the verse it was given and nothing else.
        arabic = "قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد"
        plan = worker.ayah_page_plan(
            arabic.split(), start=0.0, end=16.0,
            word_times=[(index * 1.0, index + 1.0) for index in range(16)],
            word_heard=[True] * 16, word_offset=0, word_count=16)
        drawn = [word for chunk in plan["chunks"] for word in chunk]
        self.assertEqual(drawn, arabic.split(),
                         "every word drawn is the corpus's, in the corpus's order")



class ArrivalTests(unittest.TestCase):
    """WHEN A PAGE BECOMES READABLE, which is not when its event starts.

    The anchors were already within 140ms of the reciter and every page was
    still late, because a \\fad ramps from nothing at the event's own start.
    Measured from the pixels of a real render (An-Nisaa 4:94, 1080x1920, real
    libass, real Amiri, against a click track of the reciter's own word
    onsets): half the ink at 291ms and full ink at 509ms, on ELEVEN OF ELEVEN
    pages. The earlier pass missed it because matching each frame to the page
    it most RESEMBLES flips at the crossover -- a caption at 8% opacity
    resembles itself perfectly and cannot be read.
    """

    def test_a_page_is_readable_within_the_knee_not_half_a_second_later(self):
        tags = page_overrides(verse(12), [(i * 1.0, i * 1.0 + 1.0) for i in range(12)],
                              start=0.0, end=12.0, heard=[True] * 12, count=12)
        self.assertTrue(tags)
        for tag in tags:
            rise = re.search(r"\\t\(0,(\d+),\\alpha&H([0-9A-F]{2})&\)", tag)
            self.assertIsNotNone(rise, f"no first stage in {tag}")
            knee_ms, alpha = int(rise.group(1)), int(rise.group(2), 16)
            self.assertLessEqual(knee_ms, worker.AYAH_FADE_KNEE_MS)
            # Readable means most of the way there, not merely non-zero.
            self.assertLessEqual(alpha, 0x50, "the knee must be plainly legible")

    def test_the_arrival_still_takes_about_half_a_second(self):
        # The point of two stages is that the fix costs nothing visually. A
        # page that snapped straight to full would pass the test above and
        # read as abrupt next to the reference clips.
        tags = page_overrides(verse(12), [(i * 1.0, i * 1.0 + 1.0) for i in range(12)],
                              start=0.0, end=12.0, heard=[True] * 12, count=12)
        for tag in tags:
            settle = re.search(r"\\t\(\d+,(\d+),\\alpha&H00&\)", tag)
            self.assertIsNotNone(settle, f"no settle stage in {tag}")
            self.assertGreaterEqual(int(settle.group(1)), 300)

    def test_the_ayah_never_uses_a_plain_fade_again(self):
        # \fad and \alpha drive the same channel, so one \fad anywhere on an
        # ayah page puts the third of a second straight back.
        tags = page_overrides(verse(12), [(i * 1.0, i * 1.0 + 1.0) for i in range(12)],
                              start=0.0, end=12.0, heard=[True] * 12, count=12)
        for tag in tags:
            self.assertNotIn("\\fad(", tag)

    def test_a_page_still_leaves_softly(self):
        tags = page_overrides(verse(12), [(i * 1.0, i * 1.0 + 1.0) for i in range(12)],
                              start=0.0, end=12.0, heard=[True] * 12, count=12)
        for tag in tags:
            self.assertRegex(tag, r"\\t\(\d+,\d+,\\alpha&HFF&\)")

    def test_a_short_page_is_not_all_fade(self):
        # Every stage is clamped to the page's own length, so a phrase on
        # screen for four tenths of a second does not spend it arriving and
        # leaving. The first version of this only checked the stages it could
        # PARSE, so removing the clamp -- which pushes the out-fade to a
        # NEGATIVE start that the digits-only pattern then skipped -- left it
        # green. Match an optional minus, or a probe walks straight past the
        # thing it exists to catch.
        page_ms = 400
        tag = worker.ayah_fade_tag(page_ms, worker.AYAH_FADE_IN_MS, worker.AYAH_FADE_OUT_MS)
        stages = re.findall(r"\\t\((-?\d+),(-?\d+),", tag)
        self.assertTrue(stages, f"no stages at all in {tag}")
        for raw_a, raw_b in stages:
            a, b = int(raw_a), int(raw_b)
            self.assertGreaterEqual(a, 0, f"{tag} starts a stage before the page")
            self.assertLessEqual(a, b, f"{tag} has a stage running backwards")
            self.assertLessEqual(b, page_ms, f"{tag} runs past the page")

    def test_each_page_is_sized_from_its_own_length(self):
        # Real pages differ by seconds -- 12.32s against 1.98s on the verse
        # this was measured on -- so one tag sized from the AVERAGE gives a
        # short page a fade built for a long one. Driven through ayah_events,
        # because the first version called ayah_fade_tag directly with two
        # different numbers: it proved the function can tell them apart and
        # nothing at all about what the caller hands it.
        words = [(0.0, 0.12), (0.12, 0.24), (0.24, 0.36), (0.36, 0.5),
                 (0.5, 2.5), (2.5, 4.5), (4.5, 6.5), (6.5, 8.5)]
        tags = page_overrides(verse(8), words, start=0.0, end=8.5,
                              heard=[True] * 8, count=8)
        self.assertEqual(len(tags), 2, "expected two pages of four words")
        self.assertNotEqual(tags[0], tags[1],
                            "a half-second page and an eight-second one got the same fade")


class RendererWiringTests(unittest.TestCase):
    """THE RENDERER MUST ACTUALLY BE TOLD WHICH TIMES WERE HEARD.

    Every other test in this file drives ayah_page_plan or ayah_events with the
    flags handed straight in, and all 25 of them passed while the production
    path never carried them: write_ass builds its hits with an EXPLICIT key
    list, and `heard` was not in it. `hit.get("heard")` was None on every real
    render, the plan's `index < len(flags) else True` fallback counted every
    spread word as measured, and the half of v3.147.0 that draws fewer pages
    when the times are a ruler was inert from the day it shipped.

    So this drives write_ass itself. A unit test one layer down cannot see a
    key that is never copied.
    """

    def _clip(self, arabic, words, heard):
        clip = worker.Candidate(
            start=100.0, end=100.0 + 24.0, text="x",
            segments=[{"start": 100.0, "end": 124.0, "text": "x", "words": []}],
            score=70, reasons=[], quote_risk=True)
        clip.ayat = [{
            "start": 0.0, "end": 24.0,
            "ayah": {"surah": 1, "ayah": 1, "arabic": arabic, "translation": "",
                     "surahName": "Test", "confidence": 0.99},
            "words": words, "heard": heard, "wordFrom": 0, "wordCount": len(words),
        }]
        return clip

    @staticmethod
    def _with_corpus():
        """The quran path stands down without a corpus, so give it one.

        Nothing here reads the corpus for TEXT -- the hits already carry the
        verse -- but write_ass refuses the mode outright when quran.load()
        answers None, which is correct behaviour and would otherwise make every
        assertion in this class pass against an empty file.
        """
        class _Corpus:
            def match(self, *args, **kwargs):
                return None

            def match_sequence(self, *args, **kwargs):
                return []

        real = worker.quran

        class _Quran:
            @staticmethod
            def load():
                return _Corpus()

            @staticmethod
            def ornament_for(ayah):
                # The real ornament where the module is present, a plain mark
                # where it is not: this class exists to supply a corpus, not to
                # reimplement one.
                if real is not None and hasattr(real, "ornament_for"):
                    return real.ornament_for(ayah)
                return "\u06dd"

        return _Quran()

    def _pages(self, heard):
        import tempfile
        arabic = verse(14)
        words = [(i * 24.0 / 14, (i + 1) * 24.0 / 14) for i in range(14)]
        clip = self._clip(arabic, words, heard)
        template = {"captionMode": "quran", "width": 1080, "height": 1920,
                    "captionFont": "DejaVu Sans", "captionArabicFont": "Amiri",
                    "captionTranslation": False, "captionFontSize": 60}
        original, worker.quran = worker.quran, self._with_corpus()
        try:
            with tempfile.NamedTemporaryFile("r+", suffix=".ass", delete=True) as handle:
                worker.write_ass(clip, template, worker.Path(handle.name))
                body = worker.Path(handle.name).read_text(encoding="utf-8")
        finally:
            worker.quran = original
        return [line for line in body.splitlines() if ",Ayah,," in line]

    def test_a_verse_whose_times_were_all_spread_draws_fewer_pages_through_write_ass(self):
        # Fourteen words. Heard: four pages of at most AYAH_MAX_WORDS. Spread:
        # the weak ceiling, so two pages of at most AYAH_MAX_WORDS_WEAK -- a
        # correctly timed phrase instead of four confidently mistimed ones.
        measured = self._pages([True] * 14)
        ruler = self._pages([False] * 14)
        self.assertEqual(len(measured), 4, "a heard verse should page normally")
        self.assertEqual(len(ruler), 2, "a spread verse should draw fewer pages")
        self.assertLess(len(ruler), len(measured))

    def test_a_lecture_template_carries_the_flags_too(self):
        # Scripture is captioned on EVERY template (invariant 7), so the
        # non-quran branch is the COMMON path for a verse quoted inside an
        # ordinary lecture -- and it omitted word_heard entirely, so those
        # pages were divided evenly and presented as audio.
        import tempfile
        arabic = verse(14)
        words = [(i * 24.0 / 14, (i + 1) * 24.0 / 14) for i in range(14)]
        template = {"captionMode": "phrase", "width": 1080, "height": 1920,
                    "captionFont": "DejaVu Sans", "captionArabicFont": "Amiri",
                    "captionTranslation": False, "captionFontSize": 60}

        def pages(heard):
            original, worker.quran = worker.quran, self._with_corpus()
            try:
                with tempfile.NamedTemporaryFile("r+", suffix=".ass") as handle:
                    worker.write_ass(self._clip(arabic, words, heard), template,
                                     worker.Path(handle.name))
                    body = worker.Path(handle.name).read_text(encoding="utf-8")
            finally:
                worker.quran = original
            return [line for line in body.splitlines() if ",Ayah,," in line]

        self.assertEqual(len(pages([True] * 14)), 4)
        self.assertEqual(len(pages([False] * 14)), 2,
                         "a lecture template ignored the ruler flags")

    def test_the_diagnostic_says_which_pages_a_word_placed(self):
        # The row write_ass records is how a sync complaint on a shipped clip
        # is answered, so it must not report a ruler as a measurement.
        arabic = verse(14)
        words = [(i * 24.0 / 14, (i + 1) * 24.0 / 14) for i in range(14)]
        import tempfile
        template = {"captionMode": "quran", "width": 1080, "height": 1920,
                    "captionFont": "DejaVu Sans", "captionArabicFont": "Amiri",
                    "captionTranslation": False, "captionFontSize": 60}
        original, worker.quran = worker.quran, self._with_corpus()
        try:
            with tempfile.NamedTemporaryFile("r+", suffix=".ass") as handle:
                rows = worker.write_ass(self._clip(arabic, words, [False] * 14),
                                        template, worker.Path(handle.name))
        finally:
            worker.quran = original
        self.assertTrue(rows)
        self.assertEqual(rows[0].get("pagesAnchored"), 0,
                         "a verse with no heard word must not report anchored pages")
        self.assertFalse(any(page.get("anchored") for page in rows[0].get("pages") or []))


class CutVerseTests(unittest.TestCase):
    """A CUT THROUGH THE MIDDLE OF A VERSE MUST NOT PUT THE WRONG WORDS UP.

    Everything downstream reads a hit's surviving words as a CONTIGUOUS run of
    the verse beginning at `wordFrom` -- that is what ayah_page_plan's
    `have_from, have_to = word_offset, word_offset + len(timed)` means. Drop
    the words a cut removed from the middle and the run stops being
    contiguous while wordFrom still says it starts where it did, so surviving
    word k is read as verse word wordFrom + k, which it is not: the pages
    chosen and the times they are anchored to both slide, and an ayah is drawn
    against audio that is not it.

    A comment in retime_for_cuts said the two "never meet (cuts arrive only on
    a re-render, which has no lecture map)". True when written; false since
    v3.101.0 gave re-renders the walk -- which is the same release that made
    the editor's section cuts reachable on a recitation.
    """

    def _cut(self, keeps):
        # Twelve verse words, one per second, media time 100..112.
        clip = worker.Candidate(
            start=100.0, end=112.0, text="x",
            segments=[{"start": 100.0, "end": 112.0, "text": "x", "words": []}],
            score=70, reasons=[], quote_risk=True)
        clip.ayat = [{
            "start": 0.0, "end": 12.0,
            "ayah": {"surah": 1, "ayah": 1, "arabic": verse(12), "translation": "",
                     "surahName": "Test", "confidence": 0.99},
            "words": [(float(i), float(i + 1)) for i in range(12)],
            "heard": [True] * 12, "wordFrom": 0, "wordCount": 12,
        }]
        return worker.retime_for_cuts(clip, keeps).ayat

    def test_a_cut_through_the_middle_splits_the_verse_at_its_real_indices(self):
        # Keep 0-4s and 8-12s: verse words 0-3 and 8-11 survive, 4-7 do not.
        out = self._cut([(100.0, 104.0), (108.0, 112.0)])
        self.assertEqual(len(out), 2, "the two surviving stretches are separate runs")
        self.assertEqual(out[0]["wordFrom"], 0)
        self.assertEqual(len(out[0]["words"]), 4)
        # THE ASSERTION THAT MATTERS. The second run holds verse words 8-11, so
        # it must SAY 8. Before this it said 0, and those four words were drawn
        # as the opening of the verse.
        self.assertEqual(out[1]["wordFrom"], 8,
                         "the second run was read as the start of the verse")
        self.assertEqual(len(out[1]["words"]), 4)
        for run in out:
            self.assertEqual(run["wordCount"], 12, "the verse total never changes")

    def test_the_surviving_words_stay_in_step_with_their_heard_flags(self):
        clip = worker.Candidate(
            start=100.0, end=112.0, text="x",
            segments=[{"start": 100.0, "end": 112.0, "text": "x", "words": []}],
            score=70, reasons=[], quote_risk=True)
        # Only the last four were heard; the rest are a ruler.
        clip.ayat = [{
            "start": 0.0, "end": 12.0,
            "ayah": {"surah": 1, "ayah": 1, "arabic": verse(12), "translation": "",
                     "surahName": "Test", "confidence": 0.99},
            "words": [(float(i), float(i + 1)) for i in range(12)],
            "heard": [False] * 8 + [True] * 4, "wordFrom": 0, "wordCount": 12,
        }]
        out = worker.retime_for_cuts(clip, [(100.0, 104.0), (108.0, 112.0)]).ayat
        self.assertEqual(out[0]["heard"], [False] * 4)
        self.assertEqual(out[1]["heard"], [True] * 4,
                         "a flag must travel with the word it belongs to")

    def test_a_cut_that_removes_nothing_leaves_one_run(self):
        out = self._cut([(100.0, 112.0)])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["wordFrom"], 0)
        self.assertEqual(len(out[0]["words"]), 12)

    def test_a_verse_with_no_word_times_still_moves_as_one(self):
        clip = worker.Candidate(
            start=100.0, end=112.0, text="x",
            segments=[{"start": 100.0, "end": 112.0, "text": "x", "words": []}],
            score=70, reasons=[], quote_risk=True)
        clip.ayat = [{
            "start": 0.0, "end": 12.0,
            "ayah": {"surah": 1, "ayah": 1, "arabic": verse(12), "translation": "",
                     "surahName": "Test", "confidence": 0.99},
            "words": [], "heard": [], "wordFrom": 0, "wordCount": 12,
        }]
        out = worker.retime_for_cuts(clip, [(100.0, 104.0), (108.0, 112.0)]).ayat
        self.assertEqual(len(out), 1, "nothing to split on")


class TimingNudgeTests(unittest.TestCase):
    """THE SLIDER FOR "THE CAPTIONS FEEL LATE" COULD NOT MOVE SCRIPTURE.

    captionTimingOffsetMs is a shipped Templates control. It shifted
    candidate.segments -- which every spoken caption mode reads -- and the ayah
    path reads candidate.ayat, which nothing touched. So on a recitation the
    one manual remedy for the exact complaint this release is about did
    absolutely nothing, and it was invisible because the same slider plainly
    works on a lecture.
    """

    def _hit(self):
        return [{"start": 2.0, "end": 6.0,
                 "ayah": {"surah": 1, "ayah": 1, "arabic": verse(8), "translation": "",
                          "surahName": "Test", "confidence": 0.99},
                 "words": [(2.0, 4.0), (4.0, 6.0)], "heard": [True, True],
                 "wordFrom": 0, "wordCount": 2}]

    def test_the_nudge_moves_the_verse_and_its_words(self):
        moved = worker.shift_ayat(self._hit(), 0.4, 20.0)
        self.assertAlmostEqual(moved[0]["start"], 2.4, places=3)
        self.assertAlmostEqual(moved[0]["end"], 6.4, places=3)
        self.assertEqual([(round(a, 3), round(b, 3)) for a, b in moved[0]["words"]],
                         [(2.4, 4.4), (4.4, 6.4)],
                         "the anchors move with the verse or the paging fights the nudge")

    def test_a_negative_nudge_is_clamped_into_the_clip(self):
        moved = worker.shift_ayat(self._hit(), -3.0, 20.0)
        self.assertGreaterEqual(moved[0]["start"], 0.0)
        for a, b in moved[0]["words"]:
            self.assertGreaterEqual(a, 0.0)

    def test_a_verse_nudged_clean_off_the_clip_is_dropped(self):
        # Drawn at a time it was never recited would be worse than not drawn.
        self.assertEqual(worker.shift_ayat(self._hit(), -10.0, 20.0), [])

    def test_no_lecture_walked_stays_no_lecture_walked(self):
        # None and [] are different statements and both must survive a nudge.
        self.assertIsNone(worker.shift_ayat(None, 0.4, 20.0))
        self.assertEqual(worker.shift_ayat([], 0.4, 20.0), [])

    def test_the_renderer_applies_it_to_both(self):
        import tempfile
        arabic = verse(8)
        clip = worker.Candidate(
            start=100.0, end=120.0, text="x",
            segments=[{"start": 100.0, "end": 120.0, "text": "x", "words": []}],
            score=70, reasons=[], quote_risk=True)
        clip.ayat = self._hit()
        template = {"captionMode": "quran", "width": 1080, "height": 1920,
                    "captionFont": "DejaVu Sans", "captionArabicFont": "Amiri",
                    "captionTranslation": False, "captionFontSize": 60,
                    "captionTimingOffsetMs": 500}

        class _Corpus:
            def match(self, *a, **k): return None
            def match_sequence(self, *a, **k): return []

        class _Quran:
            load = staticmethod(lambda: _Corpus())
            ornament_for = staticmethod(lambda ayah: "\u06dd")

        original, worker.quran = worker.quran, _Quran()
        try:
            with tempfile.NamedTemporaryFile("r+", suffix=".ass") as handle:
                rows = worker.write_ass(clip, template, worker.Path(handle.name))
        finally:
            worker.quran = original
        self.assertTrue(rows)
        # The verse was at 2.0s; half a second of nudge puts it at 2.5s.
        self.assertAlmostEqual(rows[0]["start"], 2.5, places=2,
                               msg="the slider did nothing to the ayah")


class EditedClipWalkTests(unittest.TestCase):
    """AN EDITED CLIP WALKS WHISPER'S ORIGINAL, NOT THE EDIT.

    reflow_segments lays the customer's text back over the real segment
    boundaries and deliberately carries NO word timings -- "a wrong word timing
    is worse than none", which is right. But process_rerender then walked those
    reflowed segments for the AYAH map too, so an edited clip's scripture was
    paged on a ruler while Whisper's measured times sat on the same job object,
    unread.

    The split is by QUESTION, not by clip: the editor's words win for the
    LECTURE captions, and scripture never comes from them -- the corpus
    supplies every Arabic letter, and an edit cannot change what the audio
    said.
    """

    def test_reflowed_segments_really_do_carry_no_word_times(self):
        # The premise, asserted rather than assumed: if this ever stops being
        # true, the walk below is solving a problem that has gone away.
        out = worker.reflow_segments(
            [{"start": 0.0, "end": 4.0, "text": "one two",
              "words": [{"word": "one", "start": 0.0, "end": 2.0},
                        {"word": "two", "start": 2.0, "end": 4.0}]}],
            "ONE TWO")
        self.assertTrue(out)
        for segment in out:
            self.assertFalse(segment.get("words"),
                             "reflow drops word times, which is why the walk must not use it")

    def test_the_ayah_map_is_walked_over_the_original(self):
        # The choice itself, driven. Named rather than left inline so it can be
        # called: the earlier version of this class pinned the PREMISE (reflow
        # drops word times) and the DIFFERENCE (the two lists disagree) and
        # asserted nothing about which one the renderer picks.
        original = [{"start": 0.0, "end": 4.0, "text": "one two", "words": [
            {"word": "one", "start": 0.0, "end": 1.2}]}]
        reflowed = [{"start": 0.0, "end": 4.0, "text": "ONE TWO", "words": []}]
        self.assertIs(worker.ayah_walk_segments(original, reflowed), original)
        # And with no original -- an older job that never carried the lecture --
        # the clip's own segments are all there is.
        self.assertIs(worker.ayah_walk_segments([], reflowed), reflowed)

    def test_the_walk_prefers_the_original_transcript(self):
        """Driven through the real timeline builder rather than by reading.

        A reflowed segment yields spread times (heard False); the original
        yields measured ones. Walking the right list is the difference between
        the two, and it is visible in the flags.
        """
        original = [{"start": 0.0, "end": 4.0, "text": "one two",
                     "words": [{"word": "one", "start": 0.0, "end": 1.2},
                               {"word": "two", "start": 3.1, "end": 4.0}]}]
        reflowed = worker.reflow_segments(original, "ONE TWO")

        from_original = worker.lecture_word_timeline(original)
        from_reflow = worker.lecture_word_timeline(reflowed)
        self.assertTrue(all(row[3] for row in from_original), "the original was heard")
        self.assertFalse(any(row[3] for row in from_reflow), "the reflow is a ruler")
        # And the times themselves differ, so this is not a distinction without
        # a difference: the ruler puts the second word at 2.0s where the
        # reciter began it at 3.1s.
        self.assertAlmostEqual(from_original[1][1], 3.1, places=3)
        self.assertAlmostEqual(from_reflow[1][1], 2.0, places=3)


class RelistenTests(unittest.TestCase):
    """A RE-RENDER CAN NOW FIX A CLIP THAT IS ALREADY ON THE CHANNEL.

    A re-render captions the stored transcript and does not re-transcribe, so a
    lecture transcribed before word timings existed -- or an edited clip, whose
    reflowed segments deliberately carry none -- had nothing for the paging to
    follow however many times it was re-rendered. On the scripture path
    Whisper's TEXT is never used (the corpus supplies every letter), so a fresh
    listen for TIMES ALONE cannot change a word anybody reads.
    """

    def _candidate(self, ayat):
        candidate = worker.Candidate(
            start=10.0, end=40.0, text="x", segments=[], score=70,
            reasons=[], quote_risk=True)
        candidate.ayat = ayat
        return candidate

    def test_a_clip_with_no_scripture_is_never_re_transcribed(self):
        # [] means a lecture WAS walked and found nothing here; None means
        # nobody walked one. Neither can be improved by listening again.
        self.assertTrue(worker.clip_ayat_are_timed(self._candidate([])))
        self.assertTrue(worker.clip_ayat_are_timed(self._candidate(None)))

    def test_scripture_whose_times_were_all_spread_asks_for_another_listen(self):
        self.assertFalse(worker.clip_ayat_are_timed(self._candidate(
            [{"heard": [False, False, False]}])))

    def test_scripture_with_one_heard_word_is_left_alone(self):
        self.assertTrue(worker.clip_ayat_are_timed(self._candidate(
            [{"heard": [False, True, False]}])))

    def test_a_fresh_listen_is_converted_to_media_time_exactly_once(self):
        # The audio began at the clip's own start, so everything it reports is
        # clip-local. Adding the offset twice is the fault invariant 5 exists
        # to prevent, and it is invisible: every caption is simply late by the
        # clip's start.
        calls = {}

        def fake_transcribe(job, audio_file, duration):
            calls["duration"] = duration
            return [{"start": 0.0, "end": 5.0, "text": "a b",
                     "words": [{"word": "a", "start": 0.0, "end": 2.0},
                               {"word": "b", "start": 2.0, "end": 5.0}]}]

        def fake_run(cmd, **kwargs):
            calls["cmd"] = cmd
            return None

        original_transcribe, original_run = worker.transcribe, worker.run
        worker.transcribe, worker.run = fake_transcribe, fake_run
        try:
            out = worker.relisten_for_word_times(
                {"ffmpeg": "ffmpeg"}, worker.Path("/tmp/x.mp4"), 10.0, 40.0,
                worker.Path("/tmp"))
        finally:
            worker.transcribe, worker.run = original_transcribe, original_run

        self.assertEqual(calls["duration"], 30.0)
        self.assertEqual(out[0]["start"], 10.0)
        self.assertEqual(out[0]["end"], 15.0)
        self.assertEqual([(w["start"], w["end"]) for w in out[0]["words"]],
                         [(10.0, 12.0), (12.0, 15.0)])
        # It cut the clip's own window, not the whole lecture.
        self.assertIn("-ss", calls["cmd"])
        self.assertIn("30.000", calls["cmd"])

    def test_the_stored_transcript_is_never_what_answers_a_re_listen(self):
        """The trap that would have made this change worse than the fault.

        transcribe() short-circuits on job["transcriptSegments"] and returns
        the saved segments verbatim -- correct everywhere else, and exactly
        what a re-listen exists to escape. Left in, it hands back the stored
        MEDIA-time transcript, the clip-local shift adds the clip's start to it
        a SECOND time, the walk then looks for the verses outside the clip and
        finds none, and a recitation loses its ayah captions altogether on
        re-render. Silently.

        Stubbing transcribe() cannot see this, because the stub replaces the
        very short-circuit that causes it. So this asserts on the JOB the
        transcriber is handed.
        """
        seen = {}

        def fake_transcribe(job, audio_file, duration):
            seen["job"] = job
            return [{"start": 0.0, "end": 3.0, "text": "a",
                     "words": [{"word": "a", "start": 0.0, "end": 3.0}]}]

        original, worker.transcribe = worker.transcribe, fake_transcribe
        original_run, worker.run = worker.run, lambda *a, **k: None
        try:
            worker.relisten_for_word_times(
                {"ffmpeg": "ffmpeg",
                 "transcriptSegments": [{"start": 100.0, "end": 130.0, "text": "stored"}]},
                worker.Path("/tmp/x.mp4"), 10.0, 40.0, worker.Path("/tmp"))
        finally:
            worker.transcribe, worker.run = original, original_run

        self.assertNotIn("transcriptSegments", seen["job"],
                         "the stored transcript would have answered instead of the audio")
        self.assertEqual(seen["job"]["ffmpeg"], "ffmpeg", "the rest of the job travels")

    def test_a_listen_that_hears_no_word_boundaries_changes_nothing(self):
        original = worker.transcribe
        worker.transcribe = lambda *a, **k: [{"start": 0.0, "end": 5.0, "text": "a", "words": []}]
        original_run, worker.run = worker.run, lambda *a, **k: None
        try:
            self.assertIsNone(worker.relisten_for_word_times(
                {"ffmpeg": "ffmpeg"}, worker.Path("/tmp/x.mp4"), 10.0, 40.0,
                worker.Path("/tmp")))
        finally:
            worker.transcribe, worker.run = original, original_run

    def test_a_failed_listen_never_fails_the_render(self):
        # A clip is worth minutes on a single-slot box. Losing it because an
        # optimisation could not run would be far worse than the timing it was
        # trying to improve.
        def boom(*args, **kwargs):
            raise RuntimeError("ffmpeg fell over")

        original_run, worker.run = worker.run, boom
        try:
            self.assertIsNone(worker.relisten_for_word_times(
                {"ffmpeg": "ffmpeg"}, worker.Path("/tmp/x.mp4"), 10.0, 40.0,
                worker.Path("/tmp")))
        finally:
            worker.run = original_run


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
