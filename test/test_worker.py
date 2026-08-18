import importlib.util
import pathlib
import re
import tempfile
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


class RenderProgressTests(unittest.TestCase):
    """Per-clip render progress, read from ffmpeg rather than guessed.

    The app shows a percentage for the clip being rendered. Without a real
    measurement the only options were an invented figure or none at all.
    """

    def _fractions(self, script: str, duration: float) -> list[float]:
        seen: list[float] = []
        worker.run_with_progress(
            [sys.executable, "-c", script], duration, seen.append, timeout=30,
        )
        return seen

    def test_out_time_us_becomes_a_fraction_of_the_clip(self):
        script = (
            "import sys\n"
            "for v in (0, 15_000_000, 30_000_000):\n"
            "    print(f'out_time_us={v}')\n"
        )
        self.assertEqual(self._fractions(script, 30.0), [0.0, 0.5, 1.0])

    def test_out_time_ms_is_microseconds_despite_its_name(self):
        # ffmpeg's out_time_ms is microseconds. Treating it as milliseconds
        # reports 1000x too far and every clip reads as finished instantly.
        script = "print('out_time_ms=15000000')\n"
        self.assertEqual(self._fractions(script, 30.0), [0.5])

    def test_a_fraction_never_escapes_zero_to_one(self):
        # -shortest and container padding can push the reported time past the
        # requested duration, which would render a bar wider than its track.
        script = "print('out_time_us=99000000')\n"
        self.assertEqual(self._fractions(script, 30.0), [1.0])

    def test_a_failing_command_still_raises_with_its_error(self):
        script = "import sys; sys.stderr.write('boom detail'); sys.exit(3)\n"
        with self.assertRaises(RuntimeError) as caught:
            worker.run_with_progress([sys.executable, "-c", script], 10.0, lambda f: None, timeout=30)
        self.assertIn("boom detail", str(caught.exception))
        self.assertIn("(3)", str(caught.exception))

    def test_garbage_on_the_pipe_is_ignored_rather_than_crashing(self):
        script = (
            "print('frame=12')\n"
            "print('out_time_us=notanumber')\n"
            "print('speed=1.2x')\n"
            "print('out_time_us=6000000')\n"
        )
        self.assertEqual(self._fractions(script, 12.0), [0.5])

    def test_a_zero_length_clip_reports_nothing_rather_than_dividing_by_zero(self):
        script = "print('out_time_us=1000000')\n"
        self.assertEqual(self._fractions(script, 0.0), [])

    def test_the_export_asks_ffmpeg_for_progress_only_when_someone_is_listening(self):
        # The flags are the whole mechanism; without them the pipe stays silent
        # and every clip sits at 0% forever.
        source = (ROOT / "worker" / "clip_worker.py").read_text(encoding="utf-8")
        self.assertIn('"-progress", "pipe:1"', source)
        self.assertIn("*(PROGRESS_FLAGS if on_fraction is not None else [])", source)

    def test_render_progress_is_throttled_to_a_readable_rate(self):
        # ffmpeg reports several times a second and each progress() rewrites the
        # status file the app polls.
        self.assertGreaterEqual(worker.RENDER_PROGRESS_SECONDS, 1.0)
        source = (ROOT / "worker" / "clip_worker.py").read_text(encoding="utf-8")
        self.assertIn("now - last_emit[0] < RENDER_PROGRESS_SECONDS", source)
        self.assertIn("report(0.0, force=True)", source)

    def test_the_clip_plan_names_every_clip_before_they_render(self):
        # So the app can list all four by name while only the second is running,
        # instead of naming just the one in progress.
        source = (ROOT / "worker" / "clip_worker.py").read_text(encoding="utf-8")
        self.assertIn("clip_plan = [", source)
        self.assertIn("clipPlan=clip_plan", source)
        self.assertIn("clipPercent=", source)

    def test_no_eta_is_claimed_before_a_clip_has_finished(self):
        # The estimate is measured throughput. With nothing measured yet there is
        # no honest figure, so none is sent.
        source = (ROOT / "worker" / "clip_worker.py").read_text(encoding="utf-8")
        self.assertIn("if clip_seconds:", source)
        self.assertIn("eta = None", source)


class CaptionAnimationTests(unittest.TestCase):
    """The live word's pop, and the per-event fade.

    The pop was baked in at 8% over 120ms, so it could be neither tuned nor
    switched off. The fade is new.
    """

    def _tags(self, **kw):
        return worker.caption_word_override(
            "word", active=True, primary="&H00FFFFFF", highlight="&H0078B4D9",
            highlight_font="Amiri", arabic_font="Amiri", highlight_italic=True,
            highlight_glow=0, scale_y=88, **kw,
        )

    def test_the_pop_uses_the_configured_size_and_speed(self):
        tags = self._tags(pop_scale=128, pop_ms=240)
        self.assertIn(r"\fscx128", tags)
        self.assertIn(r"\t(0,240,", tags)
        # It must settle back to the caption's own scale, not to 100 flat.
        self.assertIn(r"\fscy88)", tags)

    def test_a_scale_of_100_means_no_pop(self):
        self.assertNotIn(r"\fscx", self._tags(pop_scale=100, pop_ms=240))

    def test_a_duration_of_zero_means_no_pop(self):
        self.assertNotIn(r"\t(", self._tags(pop_scale=128, pop_ms=0))

    def test_the_default_matches_what_was_hardcoded(self):
        # Existing templates carry no value for these, so the default has to
        # reproduce exactly what every clip rendered with before.
        tags = self._tags()
        self.assertIn(r"\fscx108", tags)
        self.assertIn(r"\t(0,120,", tags)

    def test_an_inactive_word_never_pops(self):
        quiet = worker.caption_word_override(
            "word", active=False, primary="&H00FFFFFF", highlight="&H0078B4D9",
            highlight_font="Amiri", arabic_font="Amiri", highlight_italic=True,
            highlight_glow=0, scale_y=88, pop_scale=128, pop_ms=240,
        )
        self.assertNotIn(r"\fscx", quiet)

    def test_every_caption_event_carries_the_fade(self):
        # Applied per event rather than per word: per word, a stacked line would
        # flicker as the highlight moves along it.
        #
        # Counted against the Dialogue lines themselves rather than a fixed
        # number -- the Quran mode added three more and a magic 3 just started
        # failing without saying anything useful.
        source = (ROOT / "worker" / "clip_worker.py").read_text(encoding="utf-8")
        self.assertIn("fade_tag = ", source)
        caption_events = re.findall(r'f"Dialogue: 2,[^"]*Caption,,[^"]*"', source)
        ayah_events = re.findall(r'f"Dialogue: 2,[^"]*(?:Ayah|Translation),,[^"]*"', source)
        self.assertTrue(caption_events, "the caption modes emit events")
        self.assertTrue(ayah_events, "so does the Quran mode")
        for event in caption_events + ayah_events:
            self.assertIn("{fade_tag}", event, event[:90])


class QuranCaptionTests(unittest.TestCase):
    """The recitation template captions the ayah, not the transcript.

    Whisper's Arabic is used as a search query. Putting its approximation of
    scripture on screen would not be acceptable, so anything it cannot match
    confidently falls through to an ordinary caption.
    """

    AYAHS = [
        {"surah": 23, "ayah": 36, "surahName": "Al-Mu'minun", "surahArabic": "المؤمنون",
         "arabic": "هَيْهَاتَ هَيْهَاتَ لِمَا تُوعَدُونَ",
         "translation": "Far, very far is that which ye are promised!"},
        {"surah": 53, "ayah": 39, "surahName": "An-Najm", "surahArabic": "النجم",
         "arabic": "وَأَن لَّيْسَ لِلْإِنسَٰنِ إِلَّا مَا سَعَىٰ",
         "translation": "That man can have nothing but what he strives for."},
    ]

    def _render(self, segments, **overrides):
        import quran as quran_module
        quran_module._CORPUS = quran_module.Corpus(self.AYAHS)
        worker.quran = quran_module
        candidate = worker.Candidate(
            0, 12.0, " ".join(s["text"] for s in segments), segments, 90, [], False,
        )
        template = {
            "width": 1080, "height": 1920, "captionMode": "quran",
            "captionArabicFont": "Amiri", "captionFont": "DejaVu Serif",
            "captionFontSize": 74, "captionTranslation": True, "captionMarginV": 420,
            **overrides,
        }
        out = pathlib.Path(tempfile.mkdtemp()) / "c.ass"
        worker.write_ass(candidate, template, out)
        return out.read_text(encoding="utf-8")

    def test_the_ayah_on_screen_is_the_corpus_text_not_the_transcript(self):
        text = self._render([{"start": 0.0, "end": 4.0, "text": "هيهات هيهات لما توعدون"}])
        # The Uthmani text, with its diacritics, rather than what was heard.
        self.assertIn("هَيْهَاتَ", text)
        self.assertIn("Far, very far", text, "the translation goes under it")

    def test_the_verse_number_is_drawn_in_the_mushaf_ornament(self):
        text = self._render([{"start": 0.0, "end": 4.0, "text": "وان ليس للانسان الا ما سعى"}])
        self.assertIn("۝٣٩", text, "end-of-ayah mark with Arabic-Indic digits")

    def test_the_arabic_and_the_translation_use_their_own_styles(self):
        text = self._render([{"start": 0.0, "end": 4.0, "text": "هيهات هيهات لما توعدون"}])
        self.assertIn("Style: Ayah,Amiri,", text, "the Arabic is set in a Quranic face")
        self.assertIn("Style: Translation,DejaVu Serif,", text)
        self.assertIn(",Ayah,,", text)
        self.assertIn(",Translation,,", text)

    def test_speech_that_is_not_recitation_falls_through_to_a_plain_caption(self):
        text = self._render([{"start": 0.0, "end": 4.0, "text": "قال الشيخ ان الصبر مفتاح الفرج"}])
        self.assertNotIn(",Ayah,,", text, "no ayah is invented")
        self.assertIn(",Caption,,", text, "but the words still appear")

    def test_the_translation_can_be_turned_off(self):
        text = self._render(
            [{"start": 0.0, "end": 4.0, "text": "هيهات هيهات لما توعدون"}],
            captionTranslation=False,
        )
        self.assertIn(",Ayah,,", text)
        self.assertNotIn("Far, very far", text)

    def test_without_the_corpus_it_renders_ordinary_captions(self):
        # A worker that never downloaded the corpus must still produce clips.
        import quran as quran_module
        quran_module._CORPUS = None
        original, worker.quran = worker.quran, None
        try:
            text = self._render_without_corpus()
        finally:
            worker.quran = original
        self.assertNotIn(",Ayah,,", text)
        self.assertIn(",Caption,,", text)

    def _render_without_corpus(self):
        segments = [{"start": 0.0, "end": 4.0, "text": "هيهات هيهات لما توعدون"}]
        candidate = worker.Candidate(0, 12.0, segments[0]["text"], segments, 90, [], False)
        out = pathlib.Path(tempfile.mkdtemp()) / "c.ass"
        worker.write_ass(candidate, {"width": 1080, "height": 1920, "captionMode": "quran"}, out)
        return out.read_text(encoding="utf-8")


class CaptionFontTests(unittest.TestCase):
    """Every font the picker offers has to exist in the worker image.

    Offering one it does not have means fontconfig quietly substitutes another
    and the clip renders in a font nobody chose. The picker offered Inter for
    months; the image has never had it.
    """

    def _picker_fonts(self):
        adapter = (ROOT / "src" / "public" / "studio-adapter.js").read_text(encoding="utf-8")
        block = re.search(r"var CAPTION_FONTS = \[(.*?)\n  \];", adapter, re.S)
        assert block, "CAPTION_FONTS not found"
        return re.findall(r"name: '([^']+)'", block.group(1))

    def test_every_offered_font_is_installed_in_the_image(self):
        dockerfile = (ROOT / "worker" / "Dockerfile").read_text(encoding="utf-8")
        packages = {
            "DejaVu Sans": "fonts-dejavu-core",
            "DejaVu Serif": "fonts-dejavu-core",
            "Liberation Sans": "fonts-liberation",
            "Open Sans": "fonts-open-sans",
            "Amiri": "fonts-hosny-amiri",
            "Scheherazade New": "fonts-sil-scheherazade",
        }
        for font in self._picker_fonts():
            self.assertIn(font, packages, f"{font} is offered but no package is recorded for it")
            self.assertIn(packages[font], dockerfile, f"{font} needs {packages[font]} installed")

    def test_inter_is_not_offered_because_it_is_not_installed(self):
        self.assertNotIn("Inter", self._picker_fonts())
        self.assertNotIn("fonts-inter", (ROOT / "worker" / "Dockerfile").read_text(encoding="utf-8"))


class OpenCVVersionGuardTests(unittest.TestCase):
    """OpenCV 5 removed cv2.CascadeClassifier, which speaker framing needs.

    requirements.txt had no upper bound, so pip resolved 5.0.0.93 and framing
    reported "no face detector available" on every job. The guard did catch it,
    but told the operator to reinstall or clear the build cache -- advice that
    cost two full --no-cache rebuilds and could never have worked, because the
    cache was not the problem.
    """

    class FakeCV2:
        def __init__(self, version, attributes):
            self.__version__ = version
            for name in attributes:
                setattr(self, name, lambda *a, **k: None)

    def _problem(self, version, attributes):
        original = worker.cv2
        worker.cv2 = self.FakeCV2(version, attributes)
        try:
            return worker.cv2_problem()
        finally:
            worker.cv2 = original

    def test_opencv_5_is_named_as_a_version_problem(self):
        problem = self._problem("5.0.0", ("VideoCapture", "cvtColor"))
        self.assertIn("5.0.0", problem)
        self.assertIn("<5.0.0", problem, "the operator is told the actual fix")
        self.assertNotIn("build cache", problem, "the advice that wasted two rebuilds")

    def test_a_genuinely_broken_install_still_says_reinstall(self):
        problem = self._problem("4.10.0", ("CascadeClassifier", "cvtColor"))
        self.assertIn("VideoCapture", problem)
        self.assertIn("4.10.0", problem, "the version is reported either way")
        self.assertIn("Reinstall", problem)

    def test_requirements_cap_opencv_below_5(self):
        text = (ROOT / "worker" / "requirements.txt").read_text(encoding="utf-8")
        line = next(l for l in text.splitlines() if l.startswith("opencv-python-headless"))
        self.assertIn("<5.0.0", line, "an unbounded pin silently reintroduces this")

    def test_major_parses_junk_without_raising(self):
        self.assertEqual(worker._major("5.0.0.93"), 5)
        self.assertEqual(worker._major("4.10.0.84"), 4)
        self.assertEqual(worker._major("unknown"), 0)
        self.assertEqual(worker._major(""), 0)


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


class VideoFilterTests(unittest.TestCase):
    """The grain, warmth and zoom controls were drawn in the editor long before
    anything held their values. These cover the filters that now back them."""

    def _graph(self, template, crop_plan=None):
        return worker.build_video_filter(template, pathlib.Path("/tmp/x.ass"), crop_plan)

    def test_defaults_add_no_colour_or_grain_stage(self):
        graph = self._graph({"fitMode": "contain"})
        self.assertNotIn("colorbalance", graph)
        self.assertNotIn("noise=", graph)

    def test_warmth_pushes_red_up_and_blue_down(self):
        graph = self._graph({"fitMode": "contain", "warm": 100})
        self.assertIn("colorbalance=rs=0.300", graph)
        self.assertIn("bs=-0.300", graph)

    def test_cool_warmth_reverses_the_balance(self):
        graph = self._graph({"fitMode": "contain", "warm": -100})
        self.assertIn("rs=-0.300", graph)
        self.assertIn("bs=0.300", graph)

    def test_grain_adds_a_temporal_noise_stage(self):
        graph = self._graph({"fitMode": "contain", "grain": 50})
        self.assertIn("noise=alls=20:allf=t+u", graph)

    def test_grain_is_applied_after_sharpening(self):
        graph = self._graph({"fitMode": "contain", "grain": 50, "sharpen": 1})
        self.assertLess(graph.index("unsharp"), graph.index("noise="))

    def test_zoom_of_one_leaves_the_crop_untouched(self):
        plain = self._graph({"fitMode": "crop"})
        zoomed = self._graph({"fitMode": "crop", "smartFramingZoom": 1})
        self.assertEqual(plain, zoomed)

    def test_zoom_enlarges_the_scale_before_cropping(self):
        graph = self._graph({"fitMode": "crop", "smartFramingZoom": 2, "width": 1080, "height": 1920})
        self.assertIn("scale=2160:3840", graph)
        self.assertIn("crop=1080:1920", graph)

    def test_zoom_tightens_a_tracked_crop_around_its_centre(self):
        plan = {"w": 800, "h": 800, "x": 100, "y": 100}
        graph = self._graph({"fitMode": "crop", "smartFramingZoom": 2}, plan)
        # Half the box, recentred: 800 -> 400, origin moves in by 200.
        self.assertIn("crop=400:400:300:300", graph)

    def test_out_of_range_zoom_cannot_produce_a_degenerate_crop(self):
        plan = {"w": 20, "h": 20, "x": 0, "y": 0}
        graph = self._graph({"fitMode": "crop", "smartFramingZoom": 99}, plan)
        self.assertIn("crop=16:16", graph)


class PhaseClassificationTests(unittest.TestCase):
    """The UI keys its pipeline rail off `phase`. service.py used to rewrite the
    worker's prose in transit, which collapsed analysing into importing and
    verifying into rendering, so three of five steps never lit."""

    ORDER = ["import", "transcribe", "score", "render", "verify", "done"]

    def test_every_real_progress_line_classifies_correctly(self):
        cases = {
            "Downloading source video": "import",
            "Loading saved lecture and transcript": "import",
            "Preparing selected source range": "import",
            "Preparing transcription": "transcribe",
            "Extracting speech audio": "transcribe",
            "Analysing transcript": "score",
            "Finding and scoring clips": "score",
            "Scoring unused moments": "score",
            "Removing moments already used": "score",
            "Re-rendering clip with the saved template": "render",
            "Verifying rendered clips": "verify",
            "Verifying new clips": "verify",
            "Verifying template, captions, video and music": "verify",
            "Complete": "done",
            "More clips are ready": "done",
        }
        for text, expected in cases.items():
            self.assertEqual(worker.phase_for(text), expected, text)

    def test_transcript_in_a_loading_line_does_not_read_as_transcribing(self):
        # "Loading saved lecture and transcript" contains "transcri".
        self.assertEqual(worker.phase_for("Loading saved lecture and transcript"), "import")

    def test_verifying_outranks_the_render_keyword_it_contains(self):
        self.assertEqual(worker.phase_for("Verifying rendered clips"), "verify")

    def test_the_pipeline_never_runs_backwards(self):
        sequence = [
            "Downloading source video", "Preparing transcription", "Extracting speech audio",
            "Analysing transcript", "Finding and scoring clips",
            "Re-rendering clip with the saved template", "Verifying rendered clips", "Complete",
        ]
        seen = [self.ORDER.index(worker.phase_for(s)) for s in sequence]
        self.assertEqual(seen, sorted(seen))

    def test_an_unknown_line_starts_the_rail_rather_than_guessing(self):
        self.assertEqual(worker.phase_for("something nobody anticipated"), "import")

    def test_progress_emits_the_phase_alongside_the_prose(self):
        # Consumers read `phase`; the prose stays as the human-facing detail.
        worker.progress("Verifying rendered clips", 90)
        with worker._progress_lock:
            state = dict(worker._progress_state)
        self.assertEqual(state.get("phase"), "verify")
        self.assertEqual(state.get("stage"), "Verifying rendered clips")


class FallbackTitleTests(unittest.TestCase):
    """With no OLLAMA_URL there is no AI titling, so this is the only titler and
    its output is what the customer sees on every clip."""

    def test_filler_openers_are_dropped(self):
        title = worker.title_from_text("Alright guys, 2013 Mercedes Benz C250, really beautiful car.", 1)
        self.assertFalse(title.lower().startswith("alright"))
        self.assertTrue(title.startswith("2013 Mercedes"))

    def test_stacked_openers_are_all_dropped(self):
        title = worker.title_from_text("So, um, whoever wakes up safe in his home is given the world.", 1)
        self.assertTrue(title.startswith("Whoever wakes"), title)

    def test_a_trailing_comma_is_never_kept(self):
        # It was only stripped when the sentence was long enough to truncate.
        title = worker.title_from_text("Really beautiful car, and it drives well,", 1)
        self.assertFalse(title.endswith(","), title)

    def test_a_long_sentence_is_truncated_with_an_ellipsis(self):
        title = worker.title_from_text(
            "The Prophet peace be upon him said that patience is a light for the believer in every trial.", 1)
        self.assertTrue(title.endswith("…"), title)
        self.assertLessEqual(len(title.split()), 12)

    def test_the_title_is_capitalised(self):
        self.assertTrue(worker.title_from_text("whoever wakes up safe in his home today.", 1)[0].isupper())

    def test_an_unusable_transcript_falls_back_to_a_numbered_title(self):
        self.assertEqual(worker.title_from_text("Short.", 4), "Important reminder 4")

    def test_an_all_filler_opening_sentence_is_skipped_for_the_next_one(self):
        title = worker.title_from_text("So anyway. Patience is a light for the believer in trial.", 1)
        self.assertTrue(title.startswith("Patience"), title)


class OllamaFallbackTests(unittest.TestCase):
    def test_an_unconfigured_ollama_warns_instead_of_failing_silently(self):
        emitted = []
        original = worker.emit
        worker.emit = lambda kind, **payload: emitted.append((kind, payload))
        try:
            candidate = worker.Candidate(0.0, 40.0, "text " * 40, [], 70, [], False)
            out = worker.refine_with_ollama([candidate], {"ollamaUrl": ""})
        finally:
            worker.emit = original
        self.assertEqual(out, [candidate], "candidates pass through unchanged")
        self.assertTrue(any(k == "warning" and p.get("code") == "ollama_not_configured" for k, p in emitted),
                        "the user is told their clips were scored without the AI")


class CaptionBlockTests(unittest.TestCase):
    """The renderer knew every word's timing but wrote none of it back, so the
    editor received a flat transcript and showed the whole clip as one block."""

    def _candidate(self, words, text):
        seg = {"start": 0.0, "end": 10.0, "words": words}
        return worker.Candidate(0.0, 10.0, text, [seg], 70, [], False)

    def test_blocks_split_on_sentence_ends(self):
        words = [
            {"start": 0.0, "end": 0.4, "word": "Whoever"}, {"start": 0.4, "end": 0.9, "word": "wakes"},
            {"start": 0.9, "end": 1.4, "word": "safe."},
            {"start": 1.5, "end": 1.9, "word": "He"}, {"start": 1.9, "end": 2.6, "word": "wins."},
        ]
        blocks = worker.caption_blocks(self._candidate(words, "Whoever wakes safe. He wins."))
        self.assertEqual([b["text"] for b in blocks], ["Whoever wakes safe.", "He wins."])

    def test_a_long_pause_breaks_a_block_without_punctuation(self):
        words = [
            {"start": 0.0, "end": 0.4, "word": "one"}, {"start": 0.4, "end": 0.8, "word": "two"},
            {"start": 3.0, "end": 3.4, "word": "three"},
        ]
        blocks = worker.caption_blocks(self._candidate(words, "one two three"))
        self.assertEqual(len(blocks), 2)

    def test_timings_are_relative_to_the_clip_and_ordered(self):
        words = [{"start": 0.0, "end": 0.5, "word": "hello."}, {"start": 1.0, "end": 1.5, "word": "there."}]
        blocks = worker.caption_blocks(self._candidate(words, "hello. there."))
        self.assertEqual(blocks[0]["start"], 0.0)
        self.assertLess(blocks[0]["end"], blocks[1]["start"])

    def test_a_very_long_run_is_split_so_a_block_stays_editable(self):
        words = [{"start": i * 0.3, "end": i * 0.3 + 0.25, "word": f"w{i}"} for i in range(30)]
        blocks = worker.caption_blocks(self._candidate(words, " ".join(f"w{i}" for i in range(30))))
        self.assertGreater(len(blocks), 1)
        for block in blocks:
            self.assertLessEqual(len(block["text"].split()), 14)

    def test_no_words_yields_no_blocks_rather_than_an_empty_one(self):
        self.assertEqual(worker.caption_blocks(self._candidate([], "")), [])
