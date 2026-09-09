"""Which person the crop is built around.

Youssef, 9 Sept 2026, with a two-person clip on screen: "see if its 2 people in
one frame the framing is not doing well."

The shipped rule was "the biggest face in each sampled frame, then the median of
those centres". Measured on the box's own footage, that has two failure modes,
and the numbers in these tests are the ones the box reported rather than
invented shapes:

* a 1920x1080 lecture where the cascades found a real face 238px tall and
  SPURIOUS boxes of 64px and 66px on the background. In frames where the real
  face was missed the spurious box was the biggest, so it voted -- and the crop
  ended up keeping 22.9%..54.6% of the width with the only real face 1.1% from
  its edge.
* a single face whose detected centre wobbles a few per cent between frames,
  which scatters one person across several positions and hands the noise more
  relative weight.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw


class DominantSubjectTests(unittest.TestCase):
    def test_nothing_seen_means_no_answer(self):
        self.assertIsNone(cw.dominant_subject([]))

    def test_one_person_is_that_person(self):
        boxes = [(960.0, 400.0, 300.0)] * 5
        self.assertEqual(cw.dominant_subject(boxes), (960.0, 400.0))

    def test_A_WOBBLING_FACE_IS_ONE_PERSON(self):
        # The same person, detected a few per cent apart from frame to frame.
        # Merged, because two boxes closer together than the face is wide cannot
        # be two people -- and the merge distance is the face's own size, so it
        # scales with the shot instead of being a threshold someone picked.
        boxes = [(920.0, 400.0, 346.0), (960.0, 402.0, 345.0), (1000.0, 398.0, 344.0)]
        x, _ = cw.dominant_subject(boxes)
        self.assertAlmostEqual(x, 960.0, delta=1)

    def test_SPURIOUS_BOXES_DO_NOT_DRAG_THE_CROP(self):
        # The measured case. A real face at 24% of a 1920 frame, seen three
        # times at 238px, against two background false positives at 40% and 68%
        # seen three times each at ~65px. The shipped rule let the false
        # positives vote in the frames that missed the real face.
        real = [(460.0, 300.0, 238.0)] * 3
        noise = [(768.0, 500.0, 64.0)] * 3 + [(1306.0, 500.0, 66.0)] * 3
        x, _ = cw.dominant_subject(real + noise)
        self.assertAlmostEqual(x, 460.0, delta=2,
                               msg="the crop must be built around the real face, not the noise")

    def test_persistence_alone_is_not_enough(self):
        # A small face the cascades find reliably -- a poster, a person in the
        # background -- must not beat the speaker just by being found often.
        small = [(200.0, 400.0, 60.0)] * 10
        speaker = [(1400.0, 400.0, 340.0)] * 4
        x, _ = cw.dominant_subject(small + speaker)
        self.assertAlmostEqual(x, 1400.0, delta=2)

    def test_size_alone_is_not_enough_either(self):
        # One frame where the detector returned something huge and wrong must
        # not beat the person who is there in every frame.
        flash = [(300.0, 400.0, 700.0)]
        speaker = [(1400.0, 400.0, 300.0)] * 6
        x, _ = cw.dominant_subject(flash + speaker)
        self.assertAlmostEqual(x, 1400.0, delta=2)

    def test_two_real_people_pick_the_more_prominent_one(self):
        # The WIDE two-shot Youssef says already works: a near face at 48% and a
        # far one at 28% with a third of the height. It must keep choosing the
        # near one -- this change must not disturb the case that is right.
        near = [(920.0, 420.0, 346.0)] * 6
        far = [(538.0, 400.0, 112.0)] * 6
        x, _ = cw.dominant_subject(near + far)
        self.assertAlmostEqual(x, 920.0, delta=2)

    def test_the_vertical_position_comes_from_the_same_person(self):
        # Not the median of everybody's heights: taking y from one person and x
        # from another frames the gap between them.
        speaker = [(1400.0, 250.0, 340.0)] * 5
        other = [(300.0, 800.0, 100.0)] * 5
        x, y = cw.dominant_subject(speaker + other)
        self.assertAlmostEqual(x, 1400.0, delta=2)
        self.assertAlmostEqual(y, 250.0, delta=2)


if __name__ == "__main__":
    unittest.main()
