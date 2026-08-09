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


class CaptionTimingTests(unittest.TestCase):
    def test_edited_words_keep_original_speech_gaps(self):
        source = [
            {"start": 0.1, "end": 0.4, "word": "old"},
            {"start": 0.5, "end": 0.8, "word": "caption"},
            {"start": 2.0, "end": 2.3, "word": "word"},
        ]
        mapped = worker.remap_edited_words("new corrected caption", source)
        self.assertEqual([word["word"] for word in mapped], ["new", "corrected", "caption"])
        self.assertEqual([word["start"] for word in mapped], [0.1, 0.5, 2.0])

    def test_phrase_frames_end_before_a_real_silent_gap(self):
        words = [
            {"start": 0.0, "end": 0.3, "word": "First"},
            {"start": 0.34, "end": 0.7, "word": "phrase."},
            {"start": 1.8, "end": 2.1, "word": "Second"},
        ]
        frames = worker.phrase_caption_frames(words, 8, 0.42, 0.04)
        self.assertEqual(len(frames), 2)
        self.assertLessEqual(frames[0]["end"], 0.74)
        self.assertEqual(frames[1]["start"], 1.8)

    def test_dynamic_frames_do_not_hold_through_silence(self):
        segments = [{"start": 0.0, "end": 2.1, "text": "First second", "words": [
            {"start": 0.0, "end": 0.3, "word": "First"},
            {"start": 1.8, "end": 2.1, "word": "second"},
        ]}]
        candidate = worker.Candidate(0, 2.5, "First second", segments, 80, [], False)
        frames = worker.dynamic_caption_frames(candidate, {"captionClearPause": 0.42, "captionHoldSeconds": 0.04})
        self.assertLessEqual(frames[0]["end"], 0.34)
        self.assertEqual(frames[1]["start"], 1.8)

class FillModeAspectTests(unittest.TestCase):
    """Covers the reported Fill-mode bug: video coming out stretched.

    The crop box used to size width and height independently, each clamped
    to the source separately. At any zoom below 1.0 the height clamped but
    the width did not, so the box stopped matching the output ratio and the
    final plain `scale=W:H` distorted the picture by up to 33%.
    """

    TARGET = 1080 / 1920  # portrait 9:16

    def _assert_ratio_exact(self, crop_w, crop_h, msg=""):
        actual = crop_w / crop_h
        drift = abs(actual - self.TARGET) / self.TARGET
        # Only sub-pixel rounding should ever move the ratio.
        self.assertLess(drift, 0.01, f"{msg} ratio {actual:.4f} vs target {self.TARGET:.4f}")

    def test_landscape_source_never_stretches_at_any_zoom(self):
        for zoom in [0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.2, 1.35]:
            crop_w, crop_h = worker.fitted_crop_size(1920, 1080, self.TARGET, zoom)
            self._assert_ratio_exact(crop_w, crop_h, f"zoom={zoom}")

    def test_zoom_below_one_was_the_broken_case(self):
        # The specific regression: at 0.75 zoom the old code produced a
        # 0.75 ratio instead of 0.5625 — a 33% distortion.
        crop_w, crop_h = worker.fitted_crop_size(1920, 1080, self.TARGET, 0.75)
        self._assert_ratio_exact(crop_w, crop_h, "zoom=0.75")
        self.assertNotAlmostEqual(crop_w / crop_h, 0.75, places=2)

    def test_crop_never_exceeds_the_source(self):
        for src in [(1920, 1080), (1280, 720), (3840, 2160), (1080, 1080)]:
            for zoom in [0.75, 1.0, 1.35]:
                crop_w, crop_h = worker.fitted_crop_size(src[0], src[1], self.TARGET, zoom)
                self.assertLessEqual(crop_w, src[0], f"width overflow for {src} @ {zoom}")
                self.assertLessEqual(crop_h, src[1], f"height overflow for {src} @ {zoom}")

    def test_dimensions_are_even_for_the_encoder(self):
        for src in [(1921, 1081), (1920, 1080), (1279, 721)]:
            for zoom in [0.75, 1.0, 1.33]:
                crop_w, crop_h = worker.fitted_crop_size(src[0], src[1], self.TARGET, zoom)
                self.assertEqual(crop_w % 2, 0, f"odd width {crop_w}")
                self.assertEqual(crop_h % 2, 0, f"odd height {crop_h}")

    def test_square_source_to_portrait_still_matches_ratio(self):
        crop_w, crop_h = worker.fitted_crop_size(1080, 1080, self.TARGET, 1.0)
        self._assert_ratio_exact(crop_w, crop_h, "square source")

    def test_zooming_in_selects_a_tighter_box(self):
        wide, _ = worker.fitted_crop_size(1920, 1080, self.TARGET, 1.0)
        tight, _ = worker.fitted_crop_size(1920, 1080, self.TARGET, 1.35)
        self.assertLess(tight, wide, "a higher zoom should crop a smaller region")


class SpeakerTrackingTests(unittest.TestCase):
    """Covers the active-speaker keyframe tracker.

    The AI-focus endpoint previously did not exist at all, so the editor
    got a 404 and reported "Not found". These check the tracker's
    deterministic paths — the ones that do not depend on real faces being
    present in test footage.
    """

    VIDEO = pathlib.Path("/tmp/track_test.mp4")

    def setUp(self):
        if not self.VIDEO.exists():
            self.skipTest("test video not available in this environment")

    def test_manual_bias_produces_a_usable_plan(self):
        for bias in ["left", "center", "right"]:
            plan = worker.track_speaker_keyframes(
                self.VIDEO, "ffprobe", 0, 6, 1080, 1920, bias=bias,
            )
            self.assertTrue(plan["available"], f"{bias} should always be available")
            self.assertEqual(plan["method"], f"bias-{bias}")
            self.assertTrue(plan["keyframes"], "a plan needs at least one keyframe")

    def test_bias_positions_are_ordered_left_to_right(self):
        xs = {}
        for bias in ["left", "center", "right"]:
            plan = worker.track_speaker_keyframes(
                self.VIDEO, "ffprobe", 0, 6, 1080, 1920, bias=bias,
            )
            xs[bias] = plan["keyframes"][0]["x"]
        self.assertLess(xs["left"], xs["center"], "left must sit left of centre")
        self.assertLess(xs["center"], xs["right"], "centre must sit left of right")

    def test_keyframes_keep_the_output_aspect_ratio(self):
        target = 1080 / 1920
        plan = worker.track_speaker_keyframes(
            self.VIDEO, "ffprobe", 0, 6, 1080, 1920, bias="center",
        )
        for frame in plan["keyframes"]:
            ratio = frame["w"] / frame["h"]
            self.assertLess(abs(ratio - target) / target, 0.01, "crop must not distort")

    def test_keyframes_stay_inside_the_source(self):
        plan = worker.track_speaker_keyframes(
            self.VIDEO, "ffprobe", 0, 6, 1080, 1920, bias="right",
        )
        for frame in plan["keyframes"]:
            self.assertGreaterEqual(frame["x"], 0)
            self.assertGreaterEqual(frame["y"], 0)
            self.assertLessEqual(frame["x"] + frame["w"], plan["srcW"])
            self.assertLessEqual(frame["y"] + frame["h"], plan["srcH"])

    def test_failure_is_reported_cleanly_rather_than_crashing(self):
        # Synthetic footage has no real faces, so auto detection must fail
        # with a readable reason instead of raising.
        plan = worker.track_speaker_keyframes(
            self.VIDEO, "ffprobe", 0, 6, 1080, 1920, bias="auto",
        )
        self.assertIn("available", plan)
        if not plan["available"]:
            self.assertTrue(plan.get("reason"), "a failure must explain itself")

    def test_a_missing_file_does_not_raise(self):
        plan = worker.track_speaker_keyframes(
            pathlib.Path("/tmp/definitely-not-here.mp4"), "ffprobe", 0, 5, 1080, 1920,
        )
        self.assertFalse(plan["available"])
        self.assertTrue(plan.get("reason"))

    def test_portrait_source_needs_no_crop(self):
        # A source already narrower than the target should decline rather
        # than invent a crop.
        plan = worker.track_speaker_keyframes(
            self.VIDEO, "ffprobe", 0, 6, 1920, 1080, bias="auto",
        )
        self.assertFalse(plan["available"])


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
