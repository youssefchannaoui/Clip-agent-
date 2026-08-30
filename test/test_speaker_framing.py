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

from clip_worker import crop_origin_from_center, dominant_subject_track  # noqa: E402

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


class SubjectStaysInsideTheCropTests(unittest.TestCase):
    """A biased template must nudge the subject, never slice them.

    Measured on a real render, 30 Aug 2026. Bold Stack carries
    framingSubjectBias 16, which exists so captions down one edge have room.
    For a speaker already right of centre in the source the placement scored
    0.762 on its own; the bias took it to 0.92; the clamp settled it at 0.85 --
    and the rendered frame had his face cut off at the right edge, on blank
    wall. 0.85 of a 1214px crop leaves ~180px, and a face is wider than that.
    """

    SRC_W, SRC_H = 3840, 2160
    CROP_W, CROP_H = 1214, 1920

    def ratio(self, centre_x, bias):
        """Where the subject's centre lands inside the crop, 0..1."""
        x, _ = crop_origin_from_center(centre_x, 1080.0, self.SRC_W, self.SRC_H,
                                       self.CROP_W, self.CROP_H, 0.18, subject_bias=bias)
        return (centre_x - x) / float(self.CROP_W)

    def test_a_biased_template_keeps_the_face_inside_the_frame(self):
        # The exact failing case: speaker right of centre, Bold Stack's bias.
        r = self.ratio(2259.0, 0.16)
        self.assertLessEqual(r, 0.76,
            f"subject sits {r:.2f} across the crop; past ~0.75 the face is cut at the edge")
        margin = (1.0 - r) * self.CROP_W
        self.assertGreater(margin, 250,
            f"only {margin:.0f}px beyond the subject's centre — narrower than a face")

    def test_the_bias_still_does_its_job(self):
        # A centred speaker must still be pushed across to clear the captions,
        # or the fix has simply removed the feature.
        centred = self.ratio(1920.0, 0.0)
        biased = self.ratio(1920.0, 0.16)
        self.assertGreater(biased, centred + 0.10,
            "a bias that no longer moves a centred subject is not a bias")

    def test_no_bias_is_untouched(self):
        before = self.ratio(2259.0, 0.0)
        self.assertLess(before, 0.80)
        self.assertGreater(before, 0.60, "unbiased placement should be unchanged by this fix")

    def test_the_other_edge_is_protected_too(self):
        r = self.ratio(600.0, -0.16)
        self.assertGreaterEqual(r, 0.24,
            f"subject sits {r:.2f} across; too near the left edge to survive the crop")
