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


if __name__ == "__main__":
    unittest.main()
