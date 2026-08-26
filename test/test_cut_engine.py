"""Cutting a clip: keep-ranges in, one closed-up timeline out.

The render pipeline could not cut at all -- no trim, no concat -- which is
what kept Split, Trim and silence removal permanently greyed out. The design
is a pre-cut plate plus a retimed candidate, so the whole existing render
graph runs untouched; these pin the arithmetic that makes captions land on
the same words after the gaps close.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

from clip_worker import Candidate, normalise_cuts, retime_for_cuts


def make_candidate():
    return Candidate(
        start=10.0, end=40.0, text="", score=70, reasons=[], quote_risk=False,
        segments=[
            {"start": 10.0, "end": 15.0, "text": "first", "words": [
                {"start": 10.5, "end": 11.0, "word": "a"},
                {"start": 14.0, "end": 14.5, "word": "b"},
            ]},
            {"start": 15.0, "end": 25.0, "text": "middle", "words": [
                {"start": 16.0, "end": 17.0, "word": "c"},
                {"start": 21.0, "end": 22.0, "word": "d"},
            ]},
            {"start": 25.0, "end": 40.0, "text": "last", "words": [
                {"start": 30.0, "end": 31.0, "word": "e"},
            ]},
        ],
    )


class NormaliseCutsTests(unittest.TestCase):
    def test_nothing_or_everything_means_no_cutting(self):
        self.assertIsNone(normalise_cuts(None, 10, 40))
        self.assertIsNone(normalise_cuts([], 10, 40))
        self.assertIsNone(normalise_cuts([[10, 40]], 10, 40))
        self.assertIsNone(normalise_cuts([[9.99, 40.01]], 10, 40))

    def test_ranges_are_clamped_ordered_and_merged(self):
        keeps = normalise_cuts([[30, 35], [5, 12], [11.5, 14]], 10, 40)
        self.assertEqual(keeps, [(10.0, 14.0), (30.0, 35.0)])

    def test_slivers_are_dropped_not_rendered_as_a_flash(self):
        keeps = normalise_cuts([[10, 10.05], [20, 25]], 10, 40)
        self.assertEqual(keeps, [(20.0, 25.0)])


class RetimeTests(unittest.TestCase):
    def test_a_middle_cut_closes_the_gap_for_segments_and_words(self):
        # Keep 10-15 and 25-40: the middle segment vanishes, the last one
        # slides left by the ten removed seconds.
        keeps = [(10.0, 15.0), (25.0, 40.0)]
        out = retime_for_cuts(make_candidate(), keeps)
        self.assertEqual(out.start, 0.0)
        self.assertEqual(out.end, 20.0)
        self.assertEqual(len(out.segments), 2)
        first, last = out.segments
        self.assertEqual((first["start"], first["end"]), (0.0, 5.0))
        self.assertEqual((last["start"], last["end"]), (5.0, 20.0))
        # The word at media 30-31 now speaks at cut-time 10-11.
        self.assertEqual((last["words"][0]["start"], last["words"][0]["end"]), (10.0, 11.0))
        # Words from the removed middle are gone, not squashed to a boundary.
        self.assertEqual([w["word"] for w in first["words"]], ["a", "b"])

    def test_a_word_straddling_a_cut_goes_where_most_of_it_lives(self):
        candidate = make_candidate()
        # Word 14.0-14.5 has its midpoint at 14.25; keeping 10-14.2 drops it,
        # keeping 10-14.3 keeps it.
        dropped = retime_for_cuts(candidate, [(10.0, 14.2), (25.0, 40.0)])
        kept = retime_for_cuts(candidate, [(10.0, 14.3), (25.0, 40.0)])
        self.assertEqual([w["word"] for w in dropped.segments[0]["words"]], ["a"])
        self.assertEqual([w["word"] for w in kept.segments[0]["words"]], ["a", "b"])

    def test_total_duration_is_the_sum_of_what_was_kept(self):
        out = retime_for_cuts(make_candidate(), [(12.0, 14.0), (20.0, 21.5), (30.0, 33.0)])
        self.assertAlmostEqual(out.duration, 2.0 + 1.5 + 3.0)

    def test_the_retimed_candidate_carries_no_cuts_of_its_own(self):
        out = retime_for_cuts(make_candidate(), [(10.0, 15.0)])
        self.assertIsNone(out.cuts, "or the render would try to cut the already-cut plate")


if __name__ == "__main__":
    unittest.main()
