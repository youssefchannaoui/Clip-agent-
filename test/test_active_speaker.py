"""Whoever is speaking holds the frame, the frame does not move, and it CUTS.

Youssef, 9 Sept 2026, on a two-person podcast: "it doesn't even know who's
speaking. So it was ... going to the opposite guy who wasn't even speaking ...
Second off, it's not stable. It moves while they speak. It shouldn't be doing
that. And it's, like, smoothly moving right and left. It should be cutting to
the person who's speaking."

Three complaints, three mechanisms, and each is tested on its own here:

* WHO      -- the lip aperture, divided by the face's own height so a face
              twice as big scores the same, correlated against the audio.
* STILL    -- a shot's crop is the median of where that person was, and it
              does not move until the shot ends.
* CUT      -- a change of framing is a step; the expression has no arithmetic
              in it at all.

These drive the DECISION, not the detector. Measuring lip aperture needs
MediaPipe, a decoder and a real face and can only run on the box; who is
talking and where the crop goes is arithmetic, and arithmetic is tested here
against the shot he described. v3.179.0 established that split after a rebuild
that could not be tested at all.
"""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import speaker as sp
import clip_worker as cw

HZ = 12.5
STEP = 1.0 / HZ
CROP = 608.0  # a 9:16 window on a 1920-wide source, which is the real shot

# The shot. One man alone on the left; two sitting together on the right, close
# enough that a 9:16 crop holds either but not both centred.
ALONE, PAIR_A, PAIR_B = 300.0, 1250.0, 1500.0
FACE = 220.0

# A talking mouth opens and closes; a listening one is still but never
# perfectly still, because a real detection wobbles.
TALK = (0.02, 0.07)
STILL = (0.010, 0.011)


def mouth(shape, index):
    return shape[index % 2]


def face(x, shape, index, size=FACE, y=400.0):
    return (x, y, size, mouth(shape, index))


def envelope(count, live=True):
    """Loud on the odd samples, so a mouth opening on the odd samples matches."""
    return [(1.0 if index % 2 else 0.0) if live else 0.0 for index in range(count)]


def decide(spec, env=None, spans=None, duration=None, crop=CROP):
    """The whole decision chain, from measured faces to shots."""
    samples = [(index * STEP, faces) for index, faces in enumerate(spec)]
    times = [t for t, _faces in samples]
    rows = sp.assign_subjects(samples)
    levels = envelope(len(spec)) if env is None else env
    window = max(3, int(round(sp.WINDOW_SECONDS * HZ)))
    scores = sp.speech_scores(rows, levels, window)
    chosen = sp.speaking_subject(scores, sp.speech_flags(times, spans))
    return sp.shots(times, chosen, sp.last_seen(rows),
                    duration if duration is not None else len(spec) * STEP, crop)


def framed(shots, at):
    for shot in shots:
        if shot["start"] <= at < shot["end"]:
            return shot["x"]
    return shots[-1]["x"] if shots else None


class WhoIsSpeakingTests(unittest.TestCase):
    def test_THE_REPORTED_BUG_the_frame_is_on_the_talker_not_the_gap(self):
        # Both in shot throughout, A talking. The crop must sit on A -- not at
        # the midpoint, which is what the shipped exponential average settled
        # on and what "it hits it in the middle" meant.
        spec = [[face(PAIR_A, TALK, i), face(PAIR_B, STILL, i)] for i in range(50)]
        shots = decide(spec)
        self.assertAlmostEqual(framed(shots, 2.0), PAIR_A, delta=12)
        self.assertGreater(abs(framed(shots, 2.0) - (PAIR_A + PAIR_B) / 2), 80,
                           "and nowhere near the gap between the two of them")

    def test_THE_BIGGER_FACE_DOES_NOT_WIN_IF_THE_SMALLER_ONE_IS_TALKING(self):
        # This is fault one. The shipped signal was a raw pixel difference over
        # the lower half of a Haar box, and box jitter scales with the box --
        # so the nearest face won whether or not its mouth was open. The
        # aperture is divided by the face's own height, so size cannot vote.
        spec = [[face(PAIR_A, TALK, i, size=140.0), face(PAIR_B, STILL, i, size=320.0)]
                for i in range(50)]
        self.assertAlmostEqual(framed(decide(spec), 2.0), PAIR_A, delta=12)

    def test_SIZE_PLAYS_NO_PART_AT_ALL(self):
        # Stronger than "size only breaks ties", which is what the Haar tracker
        # claimed: swapping the two faces' sizes must not change the answer.
        big = [[face(PAIR_A, TALK, i, size=140.0), face(PAIR_B, STILL, i, size=320.0)]
               for i in range(50)]
        swapped = [[face(PAIR_A, TALK, i, size=320.0), face(PAIR_B, STILL, i, size=140.0)]
                   for i in range(50)]
        self.assertEqual(framed(decide(big), 2.0), framed(decide(swapped), 2.0))

    def test_A_MOUTH_IN_TIME_WITH_THE_AUDIO_BEATS_ONE_THAT_IS_NOT(self):
        # Both mouths move by exactly the same amount; only one of them moves
        # when the sound is there. That is the whole of the audio half, and
        # nothing else in this file can distinguish these two people.
        with_sound = TALK
        against = (TALK[1], TALK[0])  # the same swing, in antiphase
        spec = [[face(PAIR_A, against, i), face(PAIR_B, with_sound, i)] for i in range(50)]
        self.assertAlmostEqual(framed(decide(spec), 2.0), PAIR_B, delta=12)

    def test_the_lone_person_is_still_framed_perfectly(self):
        spec = [[face(ALONE, TALK, i)] for i in range(40)]
        shots = decide(spec)
        self.assertEqual(len(shots), 1)
        self.assertAlmostEqual(shots[0]["x"], ALONE, delta=2)

    def test_the_frame_moves_when_the_other_one_starts_talking(self):
        spec = ([[face(PAIR_A, TALK, i), face(PAIR_B, STILL, i)] for i in range(40)]
                + [[face(PAIR_A, STILL, i), face(PAIR_B, TALK, i)] for i in range(40, 90)])
        shots = decide(spec)
        self.assertAlmostEqual(framed(shots, 1.5), PAIR_A, delta=12)
        self.assertAlmostEqual(framed(shots, 6.0), PAIR_B, delta=12)

    def test_a_third_person_across_the_room_can_take_the_frame(self):
        spec = ([[face(ALONE, STILL, i), face(PAIR_A, TALK, i), face(PAIR_B, STILL, i)]
                 for i in range(40)]
                + [[face(ALONE, TALK, i), face(PAIR_A, STILL, i), face(PAIR_B, STILL, i)]
                   for i in range(40, 90)])
        self.assertAlmostEqual(framed(decide(spec), 6.0), ALONE, delta=12)

    def test_NOBODY_SPEAKS_IN_SILENCE_so_the_frame_holds(self):
        # Whisper says there is no speech after 2s. B's mouth then moves and A's
        # does not -- a listener shifting in their seat. The frame must not
        # follow that: a pause is not a reason to move the camera.
        spec = ([[face(PAIR_A, TALK, i), face(PAIR_B, STILL, i)] for i in range(30)]
                + [[face(PAIR_A, STILL, i), face(PAIR_B, TALK, i)] for i in range(30, 95)])
        shots = decide(spec, spans=[(0.0, 1.4)])
        self.assertEqual(len(shots), 1, "silence must not cut")
        self.assertAlmostEqual(shots[0]["x"], PAIR_A, delta=12)

    def test_a_missed_detection_holds_rather_than_recentring(self):
        spec = [[face(PAIR_A, TALK, i), face(PAIR_B, STILL, i)] for i in range(30)]
        spec[10] = []
        spec[11] = []
        shots = decide(spec)
        self.assertEqual(len(shots), 1)
        self.assertAlmostEqual(shots[0]["x"], PAIR_A, delta=12)

    def test_the_same_person_wobbling_is_not_two_people(self):
        spec = [[face(ALONE + (14 if i % 2 else -14), TALK, i)] for i in range(40)]
        shots = decide(spec)
        self.assertEqual(len(shots), 1, "one person, one shot")


class Point:
    def __init__(self, x, y):
        self.x, self.y = x, y


def landmarks(cx, cy, half_w, half_h, gap):
    """A face mesh: a bounding box, and an open mouth of `gap` (normalised)."""
    points = [Point(cx, cy) for _ in range(478)]
    points[0] = Point(cx - half_w, cy - half_h)
    points[1] = Point(cx + half_w, cy + half_h)
    points[sp.UPPER_LIP] = Point(cx, cy - gap / 2)
    points[sp.LOWER_LIP] = Point(cx, cy + gap / 2)
    return points


class ApertureTests(unittest.TestCase):
    """The one line the whole fix rests on, and the one the decision tests
    cannot see: dividing the lip gap by the face's own height."""

    def test_THE_SAME_FACE_TWICE_THE_SIZE_SCORES_THE_SAME(self):
        near = sp._face_from_landmarks(landmarks(0.5, 0.5, 0.10, 0.20, 0.04), 1920, 1080)
        far = sp._face_from_landmarks(landmarks(0.5, 0.5, 0.05, 0.10, 0.02), 1920, 1080)
        self.assertAlmostEqual(near[3], far[3], places=6,
                               msg="a face nearer the camera must not score higher")
        self.assertGreater(near[2], far[2] * 1.5, "and it really is the bigger face")

    def test_a_wider_mouth_scores_higher_at_the_same_size(self):
        shut = sp._face_from_landmarks(landmarks(0.5, 0.5, 0.10, 0.20, 0.004), 1920, 1080)
        open_ = sp._face_from_landmarks(landmarks(0.5, 0.5, 0.10, 0.20, 0.06), 1920, 1080)
        self.assertGreater(open_[3], shut[3] * 5)

    def test_positions_come_back_in_SOURCE_pixels(self):
        found = sp._face_from_landmarks(landmarks(0.25, 0.5, 0.05, 0.10, 0.02), 1920, 1080)
        self.assertAlmostEqual(found[0], 0.25 * 1920, places=3)
        self.assertAlmostEqual(found[1], 0.5 * 1080, places=3)

    def test_a_face_with_no_height_is_refused_rather_than_dividing_by_zero(self):
        self.assertIsNone(sp._face_from_landmarks(landmarks(0.5, 0.5, 0.0, 0.0, 0.0), 1920, 1080))

    def test_a_mesh_too_short_to_hold_the_lip_points_is_refused(self):
        self.assertIsNone(sp._face_from_landmarks([Point(0.5, 0.5)] * 5, 1920, 1080))


class TheFrameDoesNotMoveTests(unittest.TestCase):
    def test_A_WOBBLING_DETECTION_DOES_NOT_DRAG_THE_FRAME(self):
        # Fault two. The shipped tracker eased toward the newest detection on
        # every sample, so this shot wandered for its whole length. A median
        # cannot be dragged, and there is only ever one value per shot.
        spec = [[face(ALONE + (i % 7) * 6 - 18, TALK, i)] for i in range(60)]
        shots = decide(spec)
        self.assertEqual(len(shots), 1, "a wobble is not a change of shot")

    def test_ONE_SAMPLE_OF_NOISE_DOES_NOT_SWING_THE_CAMERA(self):
        spec = [[face(PAIR_A, TALK, i), face(PAIR_B, STILL, i)] for i in range(60)]
        spec[30] = [face(PAIR_A, STILL, 30), face(PAIR_B, (0.02, 0.30), 30)]
        shots = decide(spec)
        self.assertEqual(len(shots), 1)
        self.assertAlmostEqual(shots[0]["x"], PAIR_A, delta=12)

    def test_A_NEAR_TIE_HOLDS_THE_FRAME_WHERE_IT_IS(self):
        # B's mouth works a little harder than A's -- 16% -- which is inside the
        # margin. Two people this close cannot be told apart by any of this, and
        # the answer to "we cannot tell" is not to move the camera.
        louder = (TALK[0], TALK[0] + (TALK[1] - TALK[0]) * 1.16)
        spec = ([[face(PAIR_A, TALK, i), face(PAIR_B, STILL, i)] for i in range(30)]
                + [[face(PAIR_A, TALK, i), face(PAIR_B, louder, i)] for i in range(30, 90)])
        shots = decide(spec)
        self.assertEqual(len(shots), 1, "a near tie is not a cut")
        self.assertAlmostEqual(shots[0]["x"], PAIR_A, delta=12)

    def test_NO_SHOT_IS_SHORTER_THAN_THE_MINIMUM(self):
        # A sentence traded back and forth must not cut every half second: that
        # is worse to watch than the fault being fixed.
        spec = []
        for block in range(12):
            talker, quiet = (PAIR_A, PAIR_B) if block % 2 == 0 else (PAIR_B, PAIR_A)
            for i in range(9):  # 0.72s each
                index = block * 9 + i
                spec.append([face(talker, TALK, index), face(quiet, STILL, index)])
        shots = decide(spec)
        for shot in shots:
            self.assertGreaterEqual(shot["end"] - shot["start"], sp.MIN_SHOT_SECONDS - 1e-6,
                                    f"a {shot['end'] - shot['start']:.2f}s shot is a flicker")

    def test_THE_FRAMING_IS_THE_MEDIAN_so_leaning_out_does_not_move_it(self):
        # A speaker who leans forward for half a second, or a mesh that catches
        # a shoulder for a few frames. The mean is dragged by it and the median
        # is not, and the camera must not move for either.
        lean = [[face(ALONE if i < 36 else ALONE + 100.0, TALK, i)] for i in range(42)]
        shots = decide(lean)
        self.assertEqual(len(shots), 1)
        self.assertAlmostEqual(shots[0]["x"], ALONE, delta=2.0)

    def test_ANOTHER_PERSONS_POSITIONS_NEVER_BUILD_THIS_SHOTS_FRAMING(self):
        # Heavy crosstalk: B keeps winning briefly and keeps being absorbed
        # back into A's shot. Their positions must not come with them -- under
        # enough crosstalk they outnumber A's inside one shot, and the median
        # then lands on the wrong person, or in the gap. That is the averaged
        # crop this module exists to remove, arriving through the merge.
        chosen = [0] * 10
        for _ in range(8):
            chosen += [1] * 4 + [0]
        chosen += [0] * 5
        times = [round(i * 0.1, 3) for i in range(len(chosen))]
        seen = [{0: (PAIR_A, 400.0), 1: (PAIR_B, 400.0)} for _ in times]
        # B's absorbed samples outnumber A's 32 to 23, so a polluted median
        # lands on B -- the wrong person, in a shot that is A's.
        shots = sp.shots(times, chosen, seen, times[-1] + 0.1, CROP, min_shot=0.6)
        self.assertEqual(len(shots), 1, "the brief runs must all be absorbed")
        self.assertAlmostEqual(shots[0]["x"], PAIR_A, delta=2.0)

    def test_two_subject_ids_framed_at_the_same_place_are_ONE_shot(self):
        # Identity is carried by position, so a detection that comes back small
        # for a frame can split one person into two ids. What a viewer sees is
        # the framing, so the framing is what decides -- otherwise the render
        # cuts from a man to the same man.
        times = [0.0, 1.0, 2.0, 3.0]
        chosen = [0, 0, 1, 1]
        seen = [{0: (900.0, 400.0)}, {0: (900.0, 400.0)},
                {0: (900.0, 400.0), 1: (901.0, 400.0)},
                {0: (900.0, 400.0), 1: (901.0, 400.0)}]
        self.assertEqual(len(sp.shots(times, chosen, seen, 4.0, CROP, min_shot=0.5)), 1)

    def test_someone_walking_across_the_stage_is_FOLLOWED(self):
        # The one thing that ends a shot without the speaker changing. The
        # alternative to cutting is letting them walk out of the picture.
        spec = [[face(300.0 + i * 18.0, TALK, i)] for i in range(70)]
        shots = decide(spec)
        self.assertGreater(len(shots), 1, "a walker must be re-framed, not lost")
        for shot in shots:
            middle = 300.0 + ((shot["start"] + shot["end"]) / 2) * HZ * 18.0
            self.assertLess(abs(shot["x"] - middle), CROP * 0.5,
                            "the walker must stay inside the crop")

    def test_a_reframe_may_be_shorter_than_a_change_of_speaker(self):
        # The minimum shot exists to stop the frame ping-ponging between
        # people. It must not stop the frame following one person who is
        # genuinely moving, or a fast walker leaves the picture.
        spec = [[face(300.0 + i * 40.0, TALK, i)] for i in range(40)]
        shots = decide(spec)
        self.assertTrue(any(shot["end"] - shot["start"] < sp.MIN_SHOT_SECONDS
                            for shot in shots))


class ItCutsTests(unittest.TestCase):
    def test_THE_EXPRESSION_HAS_NO_ARITHMETIC_IN_IT(self):
        # Fault three, and the reason the crop is safe again: what ffmpeg
        # refused on a real lecture on 9 Sept 2026 was a chain of ramps.
        keys = [{"t": 0.0, "x": 530}, {"t": 3.0, "x": 604}, {"t": 7.0, "x": 530}]
        expression = cw.crop_expression(keys, "x", hold=True)
        self.assertNotIn("/", expression, "a division is a ramp, not a cut")
        self.assertNotIn("+(", expression)
        self.assertIn("530", expression)
        self.assertIn("604", expression)

    def test_the_interpolating_form_is_still_available_and_still_ramps(self):
        keys = [{"t": 0.0, "x": 530}, {"t": 3.0, "x": 604}]
        self.assertIn("/", cw.crop_expression(keys, "x"))

    def test_one_keyframe_is_a_plain_number(self):
        self.assertEqual(cw.crop_expression([{"t": 0.0, "x": 512}], "x", hold=True), "512")

    def test_the_expression_is_a_sum_of_gated_segments(self):
        keys = [{"t": 0.0, "x": 100}, {"t": 2.0, "x": 400}]
        expression = cw.crop_expression(keys, "x", hold=True)
        self.assertIn(r"lt(t\,0.000)", expression)
        self.assertIn(r"gte(t\,2.000)", expression)
        self.assertNotIn("between", expression,
                         "between is inclusive at both ends and would double on a boundary")

    def test_a_framing_that_never_changes_collapses_to_one_keyframe(self):
        plan = [{"start": 0.0, "end": 3.0, "x": 500.0, "y": 0.0},
                {"start": 3.0, "end": 6.0, "x": 501.0, "y": 0.0}]
        self.assertEqual(len(sp.shot_keyframes(plan)), 1)

    def test_a_real_cut_survives(self):
        plan = [{"start": 0.0, "end": 3.0, "x": 500.0, "y": 0.0},
                {"start": 3.0, "end": 6.0, "x": 900.0, "y": 0.0}]
        self.assertEqual(len(sp.shot_keyframes(plan)), 2)


class CorrelationTests(unittest.TestCase):
    def test_a_flat_series_correlates_with_nothing_rather_than_dividing_by_zero(self):
        self.assertEqual(sp.correlate([0.5] * 8, [0.0, 1.0] * 4), 0.0)

    def test_in_phase_is_one_and_antiphase_is_minus_one(self):
        a = [0.0, 1.0] * 5
        self.assertAlmostEqual(sp.correlate(a, a), 1.0, places=6)
        self.assertAlmostEqual(sp.correlate(a, [1.0, 0.0] * 5), -1.0, places=6)

    def test_too_short_to_mean_anything_is_zero(self):
        self.assertEqual(sp.correlate([0.0, 1.0], [0.0, 1.0]), 0.0)


class SpeechFlagTests(unittest.TestCase):
    def test_no_timings_at_all_means_assume_speech(self):
        self.assertEqual(sp.speech_flags([0.0, 1.0, 2.0], None), [True, True, True])

    def test_speech_spans_come_out_clip_local(self):
        # Unchanged from the tracker this replaces: Whisper's own boundaries are
        # in media time and the tracker works in clip time.
        candidate = cw.Candidate(start=10.0, end=20.0, text="x", score=0.0, reasons=[],
                                 quote_risk=False,
                                 segments=[{"start": 12.0, "end": 14.0, "text": "x"}])
        self.assertEqual(cw.clip_speech_spans(candidate), [(2.0, 4.0)])

    def test_no_segments_means_assume_speech(self):
        candidate = cw.Candidate(start=0.0, end=10.0, text="x", score=0.0, reasons=[],
                                 quote_risk=False, segments=[])
        self.assertIsNone(cw.clip_speech_spans(candidate))


class AudioEnvelopeTests(unittest.TestCase):
    """The one half of the measurement that needs no MediaPipe, so it is
    measured here with real ffmpeg rather than described."""

    @classmethod
    def setUpClass(cls):
        cls._why_not = ""
        cls._dir = tempfile.TemporaryDirectory()
        cls.AUDIO = Path(cls._dir.name) / "half.wav"
        try:
            subprocess.run(
                ["ffmpeg", "-v", "error",
                 "-f", "lavfi", "-i", "sine=frequency=800:duration=2",
                 "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2",
                 "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
                 "-y", str(cls.AUDIO)],
                check=True, capture_output=True, timeout=60,
            )
        except OSError as error:
            cls._why_not = f"ffmpeg is not available ({error})"
        except subprocess.SubprocessError as error:
            detail = getattr(error, "stderr", b"") or b""
            detail = detail.decode("utf-8", "replace").strip() if isinstance(detail, bytes) else str(detail)
            cls._why_not = f"ffmpeg could not build the test audio: {detail or error}"

    @classmethod
    def tearDownClass(cls):
        cls._dir.cleanup()

    def setUp(self):
        # Per TEST, never in setUpClass: a SkipTest raised there counts as one
        # skip and the rest of the class VANISHES from the total, which the
        # handover guard rightly reports as tests having disappeared.
        if self._why_not:
            self.skipTest(self._why_not)

    def test_the_envelope_follows_the_sound(self):
        levels = sp.audio_envelope(ffmpeg="ffmpeg", source=self.AUDIO, start=0.0,
                                   duration=4.0, count=50, sample_hz=HZ)
        self.assertEqual(len(levels), 50)
        loud = sum(levels[3:22]) / 19
        quiet = sum(levels[28:47]) / 19
        self.assertGreater(loud, 0.8, "a tone must read as speech")
        self.assertLess(quiet, 0.05, "silence must read as silence")

    def test_it_is_relative_to_the_clip_so_a_quiet_recording_still_reads(self):
        levels = sp.audio_envelope(ffmpeg="ffmpeg", source=self.AUDIO, start=0.0,
                                   duration=2.0, count=25, sample_hz=HZ)
        self.assertGreater(max(levels), 0.9,
                           "the clip's own loudest moment is the top of the scale")

    def test_a_source_with_no_audio_answers_empty_rather_than_raising(self):
        self.assertEqual(sp.audio_envelope(ffmpeg="ffmpeg", source=Path("/tmp/nope.wav"),
                                           start=0.0, duration=2.0, count=10), [])


if __name__ == "__main__":
    unittest.main()
