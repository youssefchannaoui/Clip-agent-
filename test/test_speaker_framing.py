"""One subject in the crop, not the midpoint between two.

Measured on a real render, 30 Aug 2026: a lecture with a seated listener at the
left of frame produced a clip whose opening had the SPEAKER's face cut off at
the right edge, on blank wall. The crop had settled halfway between the two
people, framing neither.

The cause is not the scoring, which weights face size, mouth movement and
continuity sensibly. It is that the exponential smoothing averages every sample
it is handed, so a track that alternates between two faces smooths to the gap
between them -- and on the FIRST sample there is no previous centre and no
previous frame, so neither continuity nor mouth movement exists to break the
tie. Whoever has the biggest face wins the start.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

from clip_worker import dominant_subject_track  # noqa: E402

WIDTH = 1920


def track(xs):
    """A raw track at one-second samples, all at the same height."""
    return [(float(i), float(x), 540.0) for i, x in enumerate(xs)]


class DominantSubjectTests(unittest.TestCase):
    def test_two_people_collapse_onto_the_one_present_most(self):
        # Speaker at 1300, listener at 300, detection flapping between them.
        xs = [1300, 300, 1300, 1300, 300, 1300, 1300, 1300, 300, 1300]
        out = dominant_subject_track(track(xs), WIDTH)
        self.assertTrue(all(x > 1000 for _, x, _ in out),
                        f"every sample should sit on the speaker, got {[round(x) for _, x, _ in out]}")

    def test_the_minority_is_held_not_dropped(self):
        # Replacing rather than removing keeps the timeline intact, so the crop
        # holds still instead of lurching away and back.
        xs = [1300, 300, 1300, 1300, 300, 1300, 1300, 1300, 300, 1300]
        out = dominant_subject_track(track(xs), WIDTH)
        self.assertEqual(len(out), len(xs))
        self.assertEqual([t for t, _, _ in out], [float(i) for i in range(len(xs))])

    def test_a_speaker_walking_across_is_left_alone(self):
        # A continuous sweep is one person moving, and the crop must follow.
        xs = list(range(300, 1500, 120))
        out = dominant_subject_track(track(xs), WIDTH)
        self.assertEqual([x for _, x, _ in out], [float(x) for x in xs],
                         "a moving speaker must not be clamped to where they started")

    def test_one_person_wobbling_is_left_alone(self):
        xs = [900, 915, 890, 905, 898, 902, 910, 895]
        out = dominant_subject_track(track(xs), WIDTH)
        self.assertEqual([x for _, x, _ in out], [float(x) for x in xs])

    def test_a_few_stray_detections_are_not_a_second_subject(self):
        # One bad frame is the scoring doing its job; collapsing on it would
        # make the fix more twitchy than the bug.
        xs = [1300, 1310, 1290, 1300, 1305, 1295, 1300, 1302, 1298, 300]
        out = dominant_subject_track(track(xs), WIDTH)
        self.assertEqual(len(out), len(xs))
        self.assertEqual(out[-1][1], 300.0, "a lone outlier is left for the smoothing to absorb")

    def test_too_short_to_judge_is_left_alone(self):
        xs = [1300, 300]
        self.assertEqual(dominant_subject_track(track(xs), WIDTH), track(xs))

    def test_an_empty_track_is_safe(self):
        self.assertEqual(dominant_subject_track([], WIDTH), [])


if __name__ == "__main__":
    unittest.main()
