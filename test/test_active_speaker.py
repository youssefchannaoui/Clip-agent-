"""Whoever is speaking is centred, and the crop never sits between two people.

Youssef, 9 Sept 2026, describing the shot exactly: "two people are sitting with
each other, then on the other side, there's another person ... with the person
who's alone, it's framing him perfectly, and then it's confused to what to do on
the other end because there's two people sitting next to each other, so then it
hits it in the middle. So it should be whenever someone's speaking, it should be
there centered in the frame."

That is one shot with three people in it, and the two halves of his sentence are
two different code paths meeting the same footage: with ONE face there is
nothing to average with, so it framed the lone man perfectly; with TWO faces
close together the exponential smoother averaged them and the average of A and B
is the gap between A and B.

These drive the decision, not the detector. The detector's job is reduced to
reporting boxes and how much each mouth moved, which needs OpenCV and a camera;
choosing who is talking and where the crop goes is arithmetic, and arithmetic
can be tested against the shot he described.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw

# The shot. A 1920-wide frame: one man alone on the left, two sitting together
# on the right, close enough that a 9:16 crop could hold either but not both
# comfortably centred.
ALONE, PAIR_A, PAIR_B = 300.0, 1250.0, 1500.0
FACE = 220.0  # face box size, so PAIR_A and PAIR_B are just over one apart
STILL, TALKING = 0.004, 0.030


def frames(spec):
    """(t, [(cx, cy, size, movement), ...]) per sample, at 2Hz."""
    return [(i * 0.5, faces) for i, faces in enumerate(spec)]


class SpeakerChoiceTests(unittest.TestCase):
    def test_THE_REPORTED_BUG_two_people_together_do_not_average(self):
        # Both in shot the whole time, A talking throughout. The crop must sit
        # on A -- not at the midpoint of A and B, which is what the shipped
        # exponential average converged to and what "it hits it in the middle"
        # means.
        spec = [[(PAIR_A, 400.0, FACE, TALKING), (PAIR_B, 400.0, FACE, STILL)]] * 12
        positions = cw.speaker_positions(frames(spec))
        final = positions[-1][1]
        self.assertAlmostEqual(final, PAIR_A, delta=12,
                               msg="the crop must be on the speaker")
        midpoint = (PAIR_A + PAIR_B) / 2
        self.assertGreater(abs(final - midpoint), 80,
                           "and nowhere near the gap between the two of them")

    def test_the_lone_person_is_still_framed_perfectly(self):
        # The half he says already works must keep working.
        spec = [[(ALONE, 400.0, FACE, TALKING)]] * 8
        positions = cw.speaker_positions(frames(spec))
        self.assertAlmostEqual(positions[-1][1], ALONE, delta=2)

    def test_the_crop_MOVES_when_the_other_one_starts_talking(self):
        # Four seconds of A, then four of B. This is what a static crop can
        # never do and why the tracker had to be wired in at all.
        spec = ([[(PAIR_A, 400.0, FACE, TALKING), (PAIR_B, 400.0, FACE, STILL)]] * 8
                + [[(PAIR_A, 400.0, FACE, STILL), (PAIR_B, 400.0, FACE, TALKING)]] * 8)
        positions = cw.speaker_positions(frames(spec))
        self.assertAlmostEqual(positions[7][1], PAIR_A, delta=12, msg="A while A talks")
        self.assertAlmostEqual(positions[-1][1], PAIR_B, delta=12, msg="B once B has")

    def test_it_travels_rather_than_cutting_or_drifting(self):
        # Between two speakers the crop moves in a straight line over
        # SPEAKER_MOVE_SECONDS. A cut is jarring; an exponential glide spends
        # its whole life in the gap, which is the fault being fixed.
        spec = ([[(PAIR_A, 400.0, FACE, TALKING), (PAIR_B, 400.0, FACE, STILL)]] * 8
                + [[(PAIR_A, 400.0, FACE, STILL), (PAIR_B, 400.0, FACE, TALKING)]] * 8)
        points = cw.speaker_positions(frames(spec))
        # The RAMP is what makes it a pan: two points a short time apart, one on
        # each speaker, which ffmpeg then interpolates once per rendered frame.
        # Asserting on the sampled positions instead would only ever measure the
        # detector's rate -- a 0.45s move inside a 0.5s gap looks like a cut in
        # the samples while rendering perfectly smoothly.
        ramp = [(a, b) for a, b in zip(points, points[1:])
                if abs(b[1] - a[1]) > 100 and b[0] > a[0]]
        self.assertEqual(len(ramp), 1, "exactly one journey between the two of them")
        span = ramp[0][1][0] - ramp[0][0][0]
        self.assertAlmostEqual(span, cw.SPEAKER_MOVE_SECONDS, delta=0.05,
                               msg="and it takes the time a camera move should take")

    def test_ONE_FRAME_OF_NOISE_DOES_NOT_SWING_THE_CAMERA(self):
        # A single sample where the other face happens to move more -- a nod, a
        # flicker of grain -- must not take the frame off the person talking.
        spec = [[(PAIR_A, 400.0, FACE, TALKING), (PAIR_B, 400.0, FACE, STILL)]] * 6
        spec[3] = [(PAIR_A, 400.0, FACE, STILL), (PAIR_B, 400.0, FACE, TALKING)]
        positions = cw.speaker_positions(frames(spec))
        # EVERY position, not just the last one. Asserting only where it ended
        # let a probe that removed the hysteresis entirely come back green: the
        # crop swung to B and back again, which is the visible fault, and the
        # final frame was on A either way.
        worst = max(abs(x - PAIR_A) for _t, x, _y in positions)
        self.assertLess(worst, 12, "the crop never left the person talking")

    def test_a_third_person_across_the_room_can_take_the_frame(self):
        # The lone man on the other side starts talking. He is far away, so the
        # crop cannot hold both -- it has to go to him.
        spec = ([[(ALONE, 400.0, FACE, STILL), (PAIR_A, 400.0, FACE, TALKING)]] * 8
                + [[(ALONE, 400.0, FACE, TALKING), (PAIR_A, 400.0, FACE, STILL)]] * 8)
        positions = cw.speaker_positions(frames(spec))
        self.assertAlmostEqual(positions[-1][1], ALONE, delta=12)

    def test_a_missed_detection_holds_rather_than_recentring(self):
        # The cascades miss constantly. A frame with no face must hold the
        # speaker, not fall back to the middle of the picture.
        spec = [[(PAIR_A, 400.0, FACE, TALKING), (PAIR_B, 400.0, FACE, STILL)]] * 4
        spec += [[]] * 2
        spec += [[(PAIR_A, 400.0, FACE, TALKING), (PAIR_B, 400.0, FACE, STILL)]] * 2
        positions = cw.speaker_positions(frames(spec))
        for _t, x, _y in positions:
            self.assertAlmostEqual(x, PAIR_A, delta=12)

    def test_THE_BIGGER_FACE_DOES_NOT_WIN_IF_THE_SMALLER_ONE_IS_TALKING(self):
        # The case that makes mouth movement the primary signal rather than a
        # bonus on top of size. One person sits nearer the camera, so their face
        # is half as big again -- and the other one is the one speaking. The
        # shipped scoring added movement to a size term and the size won.
        #
        # A probe that reordered the key to (size, movement) came back GREEN
        # against the first version of these tests, because every face in them
        # was the same size. It cannot now.
        spec = [[(PAIR_A, 400.0, FACE * 1.5, STILL), (PAIR_B, 400.0, FACE, TALKING)]] * 8
        positions = cw.speaker_positions(frames(spec))
        self.assertAlmostEqual(positions[-1][1], PAIR_B, delta=12,
                               msg="the smaller face that is talking takes the frame")

    def test_size_only_breaks_ties(self):
        # With two people sitting together the faces are nearly the same size,
        # so size cannot say who is talking -- but with nobody moving it is
        # still the best guess available.
        spec = [[(PAIR_A, 400.0, FACE * 0.6, STILL), (PAIR_B, 400.0, FACE, STILL)]] * 6
        positions = cw.speaker_positions(frames(spec))
        self.assertAlmostEqual(positions[-1][1], PAIR_B, delta=12)

    def test_the_same_person_wobbling_is_not_two_people(self):
        # A detected centre moves a few pixels between frames. Grouping has to
        # treat that as one person or every wobble reads as a speaker change.
        spec = [[(PAIR_A + (i % 3) * 15 - 15, 400.0, FACE, TALKING)] for i in range(10)]
        rows = cw.assign_subjects(frames(spec))
        self.assertEqual({face[4] for row in rows for face in row}, {0})


    def test_someone_walking_across_the_stage_is_FOLLOWED(self):
        """The property the retired dominant_subject_track tests protected.

        That function collapsed a two-person track onto whichever person
        appeared most, and it had to special-case a walking speaker so they were
        not collapsed onto their own starting position. Grouping by face size
        makes the special case unnecessary: a continuous sweep is one subject
        the whole way, because each step is far smaller than the face is wide.
        """
        spec = [[(300.0 + i * 60, 400.0, FACE, TALKING)] for i in range(16)]
        positions = cw.speaker_positions(frames(spec))
        self.assertGreater(positions[-1][1] - positions[0][1], 600,
                           "the crop travelled with them")
        rows = cw.assign_subjects(frames(spec))
        self.assertEqual({face[4] for row in rows for face in row}, {0},
                         "and never read them as a second person")


class CropExpressionTests(unittest.TestCase):
    def test_one_keyframe_is_a_plain_number(self):
        # A clip where the speaker never changes must render exactly as it did
        # before any of this existed.
        self.assertEqual(cw.crop_expression([{"t": 0.0, "x": 412}], "x"), "412")

    def test_the_expression_is_a_sum_of_gated_segments(self):
        expr = cw.crop_expression(
            [{"t": 0.0, "x": 100}, {"t": 2.0, "x": 100}, {"t": 2.5, "x": 900}], "x")
        # gte*lt, never between(): between is inclusive at BOTH ends, so two
        # adjacent segments would fire on the boundary frame and sum to double.
        self.assertNotIn("between(", expr)
        self.assertIn("gte(t", expr)
        self.assertIn("lt(t", expr)
        # Commas inside a filter argument must arrive escaped or ffmpeg reads
        # them as the end of the filter.
        self.assertNotIn("gte(t,", expr)

    def test_a_crop_that_never_moves_collapses_to_one_keyframe(self):
        keys = [{"t": i * 0.5, "x": 400 + (i % 2), "y": 10} for i in range(20)]
        self.assertEqual(len(cw.simplify_keyframes(keys)), 1)

    def test_a_real_move_survives_simplification(self):
        keys = ([{"t": i * 0.5, "x": 100, "y": 0} for i in range(6)]
                + [{"t": 3.0 + i * 0.5, "x": 900, "y": 0} for i in range(6)])
        simple = cw.simplify_keyframes(keys)
        self.assertGreater(len(simple), 1)
        self.assertEqual(simple[0]["x"], 100)
        self.assertEqual(simple[-1]["x"], 900)

    def test_speech_spans_come_out_clip_local(self):
        candidate = cw.Candidate(start=100.0, end=130.0, text="", score=0, reasons=[],
                                 quote_risk=False,
                                 segments=[{"start": 102.0, "end": 105.0}])
        self.assertEqual(cw.clip_speech_spans(candidate), [(2.0, 5.0)])

    def test_no_segments_means_assume_speech(self):
        candidate = cw.Candidate(start=0.0, end=30.0, text="", score=0, reasons=[],
                                 quote_risk=False, segments=[])
        self.assertIsNone(cw.clip_speech_spans(candidate))


if __name__ == "__main__":
    unittest.main()
