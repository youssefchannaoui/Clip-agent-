"""Framing composition, right-to-left captions, render caching and AI reachability.

These cover the parts of P2/P3/P5/P6 that are decidable without looking at a
rendered frame: geometry, generated subtitle text, cache invalidation and
endpoint probing. The composition *judgement* — does this actually look good —
still needs eyes on real output, and nothing here claims otherwise.
"""

import importlib.util
import json
import pathlib
import sys
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)


class CaptionZoneTests(unittest.TestCase):
    def test_the_default_template_puts_captions_right_of_centre(self):
        # This is the collision the framing fix exists for: the shipped
        # default places text at 78% across while framing pinned the subject
        # at 50%. If this default ever moves, the framing tests below are
        # asserting something that no longer matches the product.
        zone = worker.caption_zone({"captionPositionX": 78, "captionPositionY": 58})
        self.assertGreater(zone["cx"], 0.5)
        self.assertAlmostEqual(zone["cx"], 0.78, places=3)

    def test_a_missing_or_broken_template_yields_no_zone(self):
        self.assertIsNone(worker.caption_zone(None))
        self.assertIsNone(worker.caption_zone({}))
        self.assertIsNone(worker.caption_zone({"captionPositionX": "not a number"}))

    def test_positions_are_clamped_to_the_frame(self):
        self.assertEqual(worker.caption_zone({"captionPositionX": 300, "captionPositionY": -80})["cx"], 1.0)
        self.assertEqual(worker.caption_zone({"captionPositionX": 300, "captionPositionY": -80})["cy"], 0.0)


class FramingCompositionTests(unittest.TestCase):
    def setUp(self):
        self.src_w, self.src_h = 1920, 1080
        # A zoomed crop, so there is vertical freedom to compose within. At
        # zoom 1.0 a 16:9 source cropped to 9:16 uses the full source height
        # and vertical placement has nothing to decide.
        self.crop_w, self.crop_h = 450, 800

    def origin(self, center_x, center_y=None, **kwargs):
        return worker.crop_origin_from_center(
            center_x, center_y, self.src_w, self.src_h, self.crop_w, self.crop_h, **kwargs
        )

    def subject_position_in_crop(self, center_x, **kwargs):
        """Where the subject lands inside the crop, 0 = left edge, 1 = right edge."""
        x, _ = self.origin(center_x, self.src_h * 0.3, **kwargs)
        return (center_x - x) / self.crop_w

    def test_a_centred_speaker_is_no_longer_pinned_dead_centre(self):
        # Bug 1: anywhere in the middle third produced exactly 0.5, which is
        # the framing that reads as amateur. Tested with caption geometry
        # present because that is what the pipeline always passes — both the
        # renderer and the preview endpoint supply it.
        captions = {"cx": 0.78, "cy": 0.58}
        for fraction in (0.44, 0.47, 0.50, 0.53, 0.56):
            placement = self.subject_position_in_crop(self.src_w * fraction, captions=captions)
            self.assertGreater(
                abs(placement - 0.5), 0.08,
                f"a subject at {fraction:.2f} of the frame was left within a hair of dead centre",
            )

    def test_without_caption_geometry_placement_stays_continuous(self):
        # The fallback for callers that supply no template. Direction has to
        # flip at the centre line here, so the nudge fades out there rather
        # than making a drifting subject jump sides. That trade is deliberate:
        # the shipping pipeline always supplies captions.
        samples = [self.subject_position_in_crop(self.src_w * fraction) for fraction in
                   (0.42, 0.46, 0.50, 0.54, 0.58)]
        steps = [abs(b - a) for a, b in zip(samples, samples[1:])]
        self.assertLess(max(steps), 0.10)

    def test_captions_on_the_right_push_the_subject_left(self):
        right = self.subject_position_in_crop(self.src_w / 2, captions={"cx": 0.78, "cy": 0.58})
        left = self.subject_position_in_crop(self.src_w / 2, captions={"cx": 0.22, "cy": 0.58})
        self.assertLess(right, 0.5, "captions on the right should leave the subject left of centre")
        self.assertGreater(left, 0.5, "captions on the left should leave the subject right of centre")
        self.assertGreater(left - right, 0.15, "the two caption layouts should frame visibly differently")

    def test_placement_is_continuous_rather_than_a_step_function(self):
        # The old rule jumped at 0.42 and 0.58 of the source width. The
        # tracker calls this once per keyframe, so a cliff is visible camera
        # motion as the speaker drifts, not a rounding detail.
        captions = {"cx": 0.78, "cy": 0.58}
        samples = [self.subject_position_in_crop(self.src_w * fraction, captions=captions)
                   for fraction in (0.36, 0.40, 0.44, 0.48, 0.52, 0.56, 0.60, 0.64)]
        steps = [abs(b - a) for a, b in zip(samples, samples[1:])]
        self.assertLess(max(steps), 0.10, "placement jumps sharply between neighbouring positions")

    def test_a_subject_near_an_edge_still_stays_inside_the_source(self):
        for center_x in (10, 60, self.src_w - 60, self.src_w - 10):
            x, y = self.origin(center_x, self.src_h * 0.3)
            self.assertGreaterEqual(x, 0)
            self.assertLessEqual(x + self.crop_w, self.src_w)
            self.assertGreaterEqual(y, 0)
            self.assertLessEqual(y + self.crop_h, self.src_h)

    def test_headroom_adapts_to_shot_size_when_the_face_height_is_known(self):
        # Bug 3: one fixed ratio was applied to a wide shot and a close-up
        # alike. With a face height, the eyeline drives the framing instead.
        face_y = self.src_h * 0.30
        _, wide_y = self.origin(self.src_w / 2, face_y, face_h=90)
        _, close_y = self.origin(self.src_w / 2, face_y, face_h=420)
        self.assertNotEqual(wide_y, close_y, "headroom should differ between a wide shot and a close-up")

    def test_the_face_is_never_cropped_out_of_frame(self):
        for face_y in (self.src_h * 0.2, self.src_h * 0.3, self.src_h * 0.5, self.src_h * 0.75):
            for face_h in (60, 180, 400):
                top, bottom = face_y - face_h / 2, face_y + face_h / 2
                # Only faces that genuinely fit inside both the source and the
                # crop can be framed intact; anything else is the caller
                # feeding in a detection that was already impossible.
                if top < 0 or bottom > self.src_h or face_h >= self.crop_h * 0.85:
                    continue
                _, y = self.origin(self.src_w / 2, face_y, face_h=face_h)
                self.assertLessEqual(y, top, f"crop top {y} cuts into a face starting at {top}")
                self.assertGreaterEqual(y + self.crop_h, bottom, "the chin fell out of the bottom of the crop")

    def test_low_captions_buy_the_subject_more_headroom(self):
        face_y = self.src_h * 0.32
        _, normal = self.origin(self.src_w / 2, face_y, face_h=220, captions={"cx": 0.5, "cy": 0.4})
        _, low = self.origin(self.src_w / 2, face_y, face_h=220, captions={"cx": 0.5, "cy": 0.8})
        self.assertNotEqual(normal, low)

    def test_without_a_face_height_the_previous_behaviour_is_kept(self):
        # Callers that cannot supply a height must not silently change.
        face_y = self.src_h * 0.3
        _, y = self.origin(self.src_w / 2, face_y)
        self.assertEqual(y, max(0, min(self.src_h - self.crop_h, int(round(face_y - self.crop_h * 0.38)))))

    def test_no_vertical_detection_still_falls_back_to_the_fixed_guess(self):
        _, y = self.origin(self.src_w / 2, None)
        self.assertEqual(y, int(round((self.src_h - self.crop_h) * 0.36)))

    def test_dimensions_are_always_usable_integers(self):
        x, y = self.origin(self.src_w * 0.5, self.src_h * 0.3, face_h=200, captions={"cx": 0.78, "cy": 0.58})
        self.assertIsInstance(x, int)
        self.assertIsInstance(y, int)


class CaptionDirectionTests(unittest.TestCase):
    ARABIC = "السلام عليكم ورحمة الله"
    ENGLISH = "Peace be upon you and mercy"

    def test_direction_is_detected_from_the_first_strong_character(self):
        self.assertTrue(worker.first_strong_is_rtl(self.ARABIC))
        self.assertFalse(worker.first_strong_is_rtl(self.ENGLISH))
        # Neutral leading characters must be skipped, not treated as English.
        self.assertTrue(worker.first_strong_is_rtl('"«— ' + self.ARABIC))
        self.assertTrue(worker.first_strong_is_rtl("123 " + self.ARABIC))
        self.assertFalse(worker.first_strong_is_rtl(""))

    def test_mixed_lines_take_the_direction_of_what_they_start_with(self):
        self.assertEqual(worker.caption_direction(f"{self.ARABIC} and then English", {}), "rtl")
        self.assertEqual(worker.caption_direction(f"He said {self.ARABIC}", {}), "ltr")

    def test_an_explicit_template_setting_overrides_detection(self):
        self.assertEqual(worker.caption_direction(self.ENGLISH, {"captionDirection": "rtl"}), "rtl")
        self.assertEqual(worker.caption_direction(self.ARABIC, {"captionDirection": "ltr"}), "ltr")
        self.assertEqual(worker.caption_direction(self.ARABIC, {"captionDirection": "auto"}), "rtl")

    def test_caption_text_carries_no_bidi_control_characters(self):
        """Injecting RLE/PDF broke Arabic captions outright in the real render.

        Debian's libass links FriBidi and HarfBuzz and was already shaping and
        ordering whole-line Arabic correctly. Adding explicit controls to a
        working path — without any way to see the output — stopped Arabic
        captions appearing at all. This pins the text as clean.
        """
        self.assertFalse(hasattr(worker, "with_direction"),
                         "the bidi injection helper must not come back without a verified render")


class ArabicSubtitleRenderTests(unittest.TestCase):
    """Assert the actual .ass file contents, not that the source mentions RTL."""

    ARABIC_WORDS = ["السلام", "عليكم", "ورحمة", "الله"]

    def build(self, mode, words, tmp_path, template_extra=None):
        segments = [{
            "start": 0.0, "end": 4.0, "text": " ".join(words),
            "words": [
                {"word": word, "start": index * 0.9, "end": index * 0.9 + 0.7}
                for index, word in enumerate(words)
            ],
        }]
        candidate = worker.Candidate(0.0, 4.0, " ".join(words), segments, 80, ["test"], False)
        template = {
            "id": "t", "name": "t", "width": 1080, "height": 1920,
            "captionMode": mode, "captionArabicFont": "Amiri",
            **(template_extra or {}),
        }
        out = tmp_path / f"{mode}.ass"
        worker.write_ass(candidate, template, out)
        return out.read_text(encoding="utf-8")

    def setUp(self):
        import tempfile
        self.temp = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        import shutil
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_every_caption_mode_emits_arabic_without_control_characters(self):
        for mode in ("phrase", "word", "dynamic-stack"):
            content = self.build(mode, self.ARABIC_WORDS, self.temp)
            dialogue = [line for line in content.splitlines() if ",Caption," in line]
            self.assertTrue(dialogue, f"{mode} produced no dialogue lines")
            for control in ("\u202a", "\u202b", "\u202c"):
                self.assertNotIn(control, content, f"{mode} injected a bidi control character")
            self.assertIn(self.ARABIC_WORDS[0], content, f"{mode} dropped the Arabic text")

    def test_english_captions_are_emitted_unchanged(self):
        for mode in ("phrase", "word", "dynamic-stack"):
            content = self.build(mode, ["Peace", "be", "upon", "you"], self.temp)
            dialogue = [line for line in content.splitlines() if ",Caption," in line]
            self.assertTrue(dialogue)
            self.assertIn("Peace", content)

    def test_the_arabic_font_is_still_selected_per_line(self):
        # Existing behaviour that must not regress: Amiri for Arabic text.
        content = self.build("word", self.ARABIC_WORDS, self.temp)
        self.assertIn("\\fnAmiri", content)

    def test_arabic_words_are_emitted_in_logical_order(self):
        # The bidi algorithm reorders for display; the file itself must stay in
        # logical (spoken) order or the reordering happens twice.
        content = self.build("word", self.ARABIC_WORDS, self.temp)
        positions = [content.find(word) for word in self.ARABIC_WORDS]
        self.assertTrue(all(position >= 0 for position in positions))
        self.assertEqual(positions, sorted(positions), "words were written out of spoken order")

    def test_a_forced_direction_does_not_inject_controls(self):
        # `captionDirection` is kept as a field for a future alignment-based
        # implementation. It must not reintroduce control characters.
        content = self.build("phrase", ["Peace", "be", "upon", "you"], self.temp, {"captionDirection": "rtl"})
        for control in ("\u202a", "\u202b", "\u202c"):
            self.assertNotIn(control, content)


class FramingCacheTests(unittest.TestCase):
    def setUp(self):
        self.candidate = worker.Candidate(10.0, 40.0, "text", [], 80, [], False)
        self.template = {
            "width": 1080, "height": 1920, "fitMode": "crop", "smartFramingEnabled": True,
            "smartFramingBias": "auto", "smartFramingPadding": 0.18, "smartFramingZoom": 1.0,
            "smartFramingSmoothing": 0.68, "smartFramingDwellSeconds": 1.2,
            "captionPositionX": 78, "captionPositionY": 58,
        }

    def signature(self, **changes):
        return worker.framing_signature({**self.template, **changes}, self.candidate)

    def test_the_signature_is_stable_for_identical_inputs(self):
        self.assertEqual(self.signature(), self.signature())

    def test_caption_styling_alone_does_not_invalidate_the_plan(self):
        # The whole point: recolouring captions should not re-run OpenCV.
        unchanged = worker.framing_signature(
            {**self.template, "captionPrimary": "#FF0000", "captionFontSize": 120, "captionMode": "word"},
            self.candidate,
        )
        self.assertEqual(unchanged, self.signature())

    def test_anything_that_moves_the_crop_does_invalidate_the_plan(self):
        for key, value in (
            ("smartFramingZoom", 1.2), ("smartFramingBias", "left"), ("smartFramingPadding", 0.3),
            ("smartFramingSmoothing", 0.4), ("smartFramingDwellSeconds", 3.0),
            ("width", 720), ("height", 1280), ("fitMode", "contain"), ("smartFramingEnabled", False),
        ):
            self.assertNotEqual(self.signature(**{key: value}), self.signature(), f"{key} should invalidate the cache")

    def test_moving_the_captions_invalidates_the_plan(self):
        # Framing now biases away from the caption box, so caption position is
        # a framing input. Missing this would be a wrong-cache bug, not just a
        # lost optimisation.
        self.assertNotEqual(self.signature(captionPositionX=22), self.signature())
        self.assertNotEqual(self.signature(captionPositionY=80), self.signature())

    def test_a_different_clip_window_invalidates_the_plan(self):
        other = worker.Candidate(50.0, 80.0, "text", [], 80, [], False)
        self.assertNotEqual(worker.framing_signature(self.template, other), self.signature())

    def test_a_plan_is_only_reused_when_the_signature_matches(self):
        plan = {"w": 608, "h": 1080, "x": 100, "y": 0, "method": "active-speaker"}
        good = {"cropPlan": {"signature": self.signature(), "plan": plan}}
        self.assertEqual(worker.reusable_crop_plan(good, self.template, self.candidate), plan)

        stale = {"cropPlan": {"signature": "something-else", "plan": plan}}
        self.assertIsNone(worker.reusable_crop_plan(stale, self.template, self.candidate))

    def test_malformed_cached_plans_are_ignored_rather_than_trusted(self):
        for cached in (
            None, {}, "not a dict", {"plan": {"w": 608, "h": 1080}},
            {"signature": "x"}, {"signature": "x", "plan": "nope"},
            {"signature": None, "plan": {"w": 608, "h": 1080}},
        ):
            self.assertIsNone(worker.reusable_crop_plan({"cropPlan": cached}, self.template, self.candidate))
        # A plan with no usable dimensions is not a plan.
        empty = {"cropPlan": {"signature": self.signature(), "plan": {"method": "active-speaker"}}}
        self.assertIsNone(worker.reusable_crop_plan(empty, self.template, self.candidate))


class RenderQualityTests(unittest.TestCase):
    def test_export_quality_is_unchanged_by_default(self):
        preset, crf = worker.render_quality_settings({"videoPreset": "medium", "videoCrf": 18})
        self.assertEqual((preset, crf), ("medium", 18))

    def test_preview_quality_is_faster_and_only_applies_when_asked(self):
        preset, crf = worker.render_quality_settings({"videoPreset": "medium", "videoCrf": 18, "previewQuality": True})
        self.assertEqual(preset, "veryfast")
        self.assertGreaterEqual(crf, 18)
        # Never worse than the pipeline's own worst allowed setting.
        self.assertLessEqual(crf, 23)

    def test_crf_stays_inside_the_allowed_range(self):
        self.assertEqual(worker.render_quality_settings({"videoCrf": 2})[1], 16)
        self.assertEqual(worker.render_quality_settings({"videoCrf": 99})[1], 23)

    def test_an_unknown_preset_falls_back_rather_than_reaching_the_encoder(self):
        self.assertEqual(worker.render_quality_settings({"videoPreset": "; rm -rf /"})[0], "medium")


class OllamaReachabilityTests(unittest.TestCase):
    def test_an_unconfigured_endpoint_reports_itself_clearly(self):
        health = worker.ollama_health({})
        self.assertFalse(health["configured"])
        self.assertFalse(health["reachable"])

    def test_an_unreachable_endpoint_is_reported_rather_than_waited_out(self):
        with mock.patch.object(worker.urllib.request, "urlopen", side_effect=OSError("connection refused")):
            health = worker.ollama_health({"ollamaUrl": "http://ollama.invalid:11434"})
        self.assertTrue(health["configured"])
        self.assertFalse(health["reachable"])
        self.assertIn("connection refused", health["reason"])

    def test_a_reachable_endpoint_reports_whether_the_model_is_installed(self):
        class FakeResponse:
            def __init__(self, payload):
                self.payload = payload
            def read(self):
                return json.dumps(self.payload).encode()
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False

        present = FakeResponse({"models": [{"name": "qwen3:4b"}, {"name": "llama3:8b"}]})
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=present):
            health = worker.ollama_health({"ollamaUrl": "http://host:11434", "ollamaModel": "qwen3:4b"})
        self.assertTrue(health["reachable"])
        self.assertTrue(health["modelPresent"])

        missing = FakeResponse({"models": [{"name": "llama3:8b"}]})
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=missing):
            health = worker.ollama_health({"ollamaUrl": "http://host:11434", "ollamaModel": "qwen3:4b"})
        self.assertTrue(health["reachable"])
        self.assertFalse(health["modelPresent"])

    def test_refinement_skips_the_long_call_when_the_endpoint_is_down(self):
        candidates = [worker.Candidate(0, 30, "text", [], 70, [], False)]
        with mock.patch.object(worker, "ollama_health", return_value={"configured": True, "reachable": False, "reason": "refused"}), \
             mock.patch.object(worker.urllib.request, "urlopen") as urlopen, \
             mock.patch.object(worker, "emit") as emit:
            result = worker.refine_with_ollama(candidates, {"ollamaUrl": "http://host:11434"})
        urlopen.assert_not_called()
        self.assertEqual(result, candidates)
        kinds = [call.args[0] for call in emit.call_args_list]
        self.assertIn("ai_scoring", kinds)
        self.assertEqual(emit.call_args.kwargs["status"], "unreachable")

    def test_a_missing_model_is_reported_distinctly_from_an_unreachable_host(self):
        candidates = [worker.Candidate(0, 30, "text", [], 70, [], False)]
        health = {"configured": True, "reachable": True, "modelPresent": False, "model": "qwen3:4b", "models": ["llama3:8b"]}
        with mock.patch.object(worker, "ollama_health", return_value=health), \
             mock.patch.object(worker.urllib.request, "urlopen") as urlopen, \
             mock.patch.object(worker, "emit") as emit:
            worker.refine_with_ollama(candidates, {"ollamaUrl": "http://host:11434"})
        urlopen.assert_not_called()
        self.assertEqual(emit.call_args.kwargs["status"], "model_missing")

    def test_scoring_without_a_configured_endpoint_stays_silent(self):
        candidates = [worker.Candidate(0, 30, "text", [], 70, [], False)]
        with mock.patch.object(worker, "emit") as emit:
            result = worker.refine_with_ollama(candidates, {})
        self.assertEqual(result, candidates)
        emit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
