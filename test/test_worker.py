import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

class WorkerScoringTests(unittest.TestCase):
    def setUp(self):
        self.segments = [
            {"start": 0.0, "end": 8.0, "text": "Remember that hardship can bring a believer closer to Allah."},
            {"start": 8.1, "end": 16.0, "text": "The important question is how you respond to the test."},
            {"start": 16.1, "end": 24.0, "text": "Return sincerely, repair what you can, and continue forward."},
            {"start": 24.1, "end": 32.0, "text": "Hope and responsibility should remain together."},
        ]

    def test_builds_complete_candidates(self):
        candidates = worker.build_candidates(self.segments, 15, 35)
        self.assertTrue(candidates)
        selected = worker.select_candidates(candidates, 2)
        self.assertLessEqual(len(selected), 2)
        self.assertTrue(all(15 <= item.duration <= 35 for item in selected))
        self.assertTrue(all(1 <= item.score <= 100 for item in selected))

    def test_religious_quote_is_flagged_for_review(self):
        score, reasons, risk = worker.score_candidate(0, 35, "The hadith says this wording must be reviewed.", self.segments)
        self.assertTrue(risk)
        self.assertIn("religious quotation needs human review", reasons)
        self.assertGreater(score, 0)

    def test_quality_report_contains_retention_metrics(self):
        candidate = worker.Candidate(0, 32, "Remember that hardship can bring a believer closer to Allah.", self.segments, 84, ["stands alone"], False)
        report = worker.quality_report(candidate, {"captionFontSize": 62, "captionMaxWords": 6})
        self.assertGreaterEqual(report["overall"], 1)
        self.assertLessEqual(report["overall"], 100)
        self.assertIn("hook", report)
        self.assertIn("readability", report)

class CropFramingTests(unittest.TestCase):
    """Covers the actual reported bug: a subject's head getting cut off
    because the vertical crop position ignored where the face detector
    actually found the face, always using a fixed 36%-from-top guess
    instead. These test the pure geometry function directly — no OpenCV
    or real video needed — so the fix itself is verified, independent of
    whether face detection succeeds on any particular piece of footage.
    """

    def setUp(self):
        # A source frame much taller than the 9:16 target, so there's real
        # vertical room to crop from — the exact situation that exposed
        # the bug (plenty of headroom above the fixed 36% guess).
        self.src_w, self.src_h = 1920, 1920
        self.crop_w, self.crop_h = 608, 1080

    def test_face_near_top_keeps_the_head_in_frame(self):
        # A face detected near the top of a tall source used to still get
        # cropped at the fixed 36% mark, cutting the head off. It must not
        # do that anymore.
        x, y = worker.crop_origin_from_center(
            self.src_w / 2, 120, self.src_w, self.src_h, self.crop_w, self.crop_h,
        )
        old_buggy_y = int(round((self.src_h - self.crop_h) * 0.36))
        self.assertLess(y, old_buggy_y, "a face near the top must produce a crop near the top, not the old fixed guess")
        self.assertGreaterEqual(y, 0)

    def test_face_near_bottom_follows_the_face_down(self):
        x, y = worker.crop_origin_from_center(
            self.src_w / 2, self.src_h - 150, self.src_w, self.src_h, self.crop_w, self.crop_h,
        )
        old_buggy_y = int(round((self.src_h - self.crop_h) * 0.36))
        self.assertGreater(y, old_buggy_y, "a face near the bottom must produce a crop lower down, not the old fixed guess")
        self.assertLessEqual(y, self.src_h - self.crop_h)

    def test_no_vertical_detection_falls_back_to_the_original_guess(self):
        # The edge-detection fallback only ever finds a horizontal position
        # — there's genuinely no vertical data in that case. Falling back
        # to the old fixed assumption there is a reasonable default, not
        # the bug; the bug was applying it even when real detection existed.
        x, y = worker.crop_origin_from_center(
            self.src_w / 2, None, self.src_w, self.src_h, self.crop_w, self.crop_h,
        )
        self.assertEqual(y, int(round((self.src_h - self.crop_h) * 0.36)))

    def test_y_never_goes_out_of_bounds(self):
        for extreme_y in [-500, 0, self.src_h * 5]:
            x, y = worker.crop_origin_from_center(
                self.src_w / 2, extreme_y, self.src_w, self.src_h, self.crop_w, self.crop_h,
            )
            self.assertGreaterEqual(y, 0)
            self.assertLessEqual(y, self.src_h - self.crop_h)

    def test_horizontal_placement_is_unaffected_by_the_vertical_fix(self):
        # Regression check — the horizontal logic was already correct and
        # must behave exactly as before.
        _, _ = worker.crop_origin_from_center(50, 900, self.src_w, self.src_h, self.crop_w, self.crop_h)
        x_left, _ = worker.crop_origin_from_center(50, 900, self.src_w, self.src_h, self.crop_w, self.crop_h)
        x_right, _ = worker.crop_origin_from_center(self.src_w - 50, 900, self.src_w, self.src_h, self.crop_w, self.crop_h)
        x_center, _ = worker.crop_origin_from_center(self.src_w / 2, 900, self.src_w, self.src_h, self.crop_w, self.crop_h)
        self.assertLess(x_left, x_center, "a subject near the left edge should pull the crop left")
        self.assertGreater(x_right, x_center, "a subject near the right edge should pull the crop right")

    def test_a_typical_talking_head_shot_gets_reasonable_headroom(self):
        # A common real-world case: face roughly in the upper third of a
        # standard interview/lecture shot. The crop should keep a small
        # margin above the face, not crop right at the hairline and not
        # leave excessive empty space either.
        face_y = self.src_h * 0.22
        x, y = worker.crop_origin_from_center(
            self.src_w / 2, face_y, self.src_w, self.src_h, self.crop_w, self.crop_h,
        )
        headroom = face_y - y
        self.assertGreater(headroom, 0, "the face must not be right at or above the crop's top edge")
        self.assertLess(headroom, self.crop_h * 0.5, "headroom should not be excessive")


if __name__ == "__main__":
    unittest.main()
