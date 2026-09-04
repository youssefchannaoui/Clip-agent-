"""Weather over the picture, and the twelve graded looks.

Youssef, 4 Sept 2026: "add more configuration ... things like on looks of the
upload like black and white or idk just more so they can easily just config
beofre posring on the selector ... also add another thing so they can add
sencery or layover, so layour can be dark with rain drops but still the video
of couese."

Two features and one law between them: a template that asks for NEITHER must
render exactly as it did before. Everything else here is about the graph the
renderer actually builds, read out of `build_video_filter` rather than grepped
out of the file -- the shape of the graph is the behaviour.

The one test that renders is gated on ffmpeg, the same way SpeakerTrackingTests
is: the Python suite has to keep running on a clean checkout anywhere, which is
what makes a phone session viable.
"""

import os
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest

os.environ.setdefault("WORKER_DATA_DIR", tempfile.mkdtemp(prefix="deenclipped-atmos-"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as worker  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent


def ass_file() -> pathlib.Path:
    path = pathlib.Path(tempfile.mkdtemp(prefix="atmos-ass-")) / "c.ass"
    path.write_text("[Events]\n", encoding="utf-8")
    return path


BASE = {"width": 1080, "height": 1920, "fitMode": "crop",
        "filterPreset": "natural", "sharpen": 0.45}


class LooksTests(unittest.TestCase):
    """Twelve graded looks, and the promise that the old five did not move."""

    def test_every_look_the_app_offers_is_a_look_the_renderer_knows(self):
        # THE CROSS-LANGUAGE LAW. A preset the picker offers and LOOKS does not
        # hold falls through to the "custom" branch, which renders the template's
        # raw brightness/contrast sliders -- so choosing "Sepia" would silently
        # give you Natural. Nothing anywhere would report it.
        #
        # Deliberately compares two DATA tables across the two languages, which
        # is the one case where reading the source is the right thing: there is
        # no way to call one from the other.
        source = (ROOT / "src" / "templates.js").read_text(encoding="utf-8")
        block = re.search(r"filterPreset: \[(.*?)\],", source, re.S).group(1)
        offered = [m.group(1) for m in re.finditer(r"'([a-z]+)'", block)]
        self.assertIn("monochrome", offered, "the list was not parsed")
        self.assertGreaterEqual(len(offered), 13, "twelve looks plus 'custom'")
        for name in offered:
            if name == "custom":
                continue
            self.assertIn(name, worker.LOOKS,
                          f"the app offers the {name} look and the renderer has never heard of it")

    def test_the_looks_that_shipped_before_still_grade_identically(self):
        # The five that existed before the table grew must be untouched, or a
        # customer's saved template renders differently after a deploy.
        self.assertEqual(worker.filter_values({"filterPreset": "natural"}), (0.0, 1.0, 1.0, 1.0))
        self.assertEqual(worker.filter_values({"filterPreset": "crisp"}), (0.015, 1.09, 1.08, 1.0))
        self.assertEqual(worker.filter_values({"filterPreset": "cinematic"}), (-0.015, 1.13, 0.88, 0.96))
        self.assertEqual(worker.filter_values({"filterPreset": "monochrome"}), (0.0, 1.08, 0.0, 1.0))
        # warm gained a colour balance; its eq is unchanged.
        self.assertEqual(worker.filter_values({"filterPreset": "warm"}), (0.025, 1.04, 1.12, 0.98))
        for name in ("natural", "crisp", "cinematic", "monochrome"):
            self.assertEqual(worker.look_extras({"filterPreset": name}), [],
                             f"{name} used to be an eq and nothing else")

    def test_custom_still_reads_the_sliders_and_adds_nothing(self):
        template = {"filterPreset": "custom", "brightness": 0.2, "contrast": 1.4,
                    "saturation": 0.6, "gamma": 1.1}
        self.assertEqual(worker.filter_values(template), (0.2, 1.4, 0.6, 1.1))
        self.assertEqual(worker.look_extras(template), [])

    def test_the_three_black_and_white_looks_are_genuinely_different(self):
        # Youssef asked for "black and white". Three entries earn their place
        # only if they are three different pictures: flat, hard and soft.
        flat = worker.filter_values({"filterPreset": "monochrome"})
        hard = worker.filter_values({"filterPreset": "noir"})
        soft = worker.filter_values({"filterPreset": "silver"})
        self.assertEqual((flat[2], hard[2], soft[2]), (0.0, 0.0, 0.0), "all three are grey")
        self.assertGreater(hard[1], flat[1], "noir is harder than monochrome")
        self.assertLess(soft[1], flat[1], "silver is softer")
        self.assertGreater(soft[0], hard[0], "and lifted rather than crushed")

    def test_a_colour_matrix_lands_straight_after_the_eq(self):
        # Order matters: a sepia matrix applied after the sharpen or the grain
        # tints the texture as well as the picture.
        graph = worker.build_video_filter(dict(BASE, filterPreset="sepia"), ass_file())
        eq = graph.index("eq=brightness")
        matrix = graph.index("colorchannelmixer")
        sharpen = graph.index("unsharp")
        self.assertLess(eq, matrix)
        self.assertLess(matrix, sharpen)


class AtmosphereTests(unittest.TestCase):
    """Rain, snow, dust and bokeh -- generated, never shipped as artwork."""

    def test_a_template_that_asks_for_neither_renders_exactly_as_before(self):
        graph = worker.build_video_filter(dict(BASE), ass_file())
        self.assertNotIn("atmlayer", graph, "no generator")
        self.assertNotIn("drawbox", graph, "no scrim")
        self.assertNotIn("[graded]", graph, "not even a relabelling hop")
        self.assertEqual(graph.count("[vout]"), 1)

    def test_none_and_zero_intensity_both_produce_nothing(self):
        self.assertIsNone(worker.atmosphere_chain(dict(BASE), 1080, 1920, "a", "b"))
        self.assertIsNone(worker.atmosphere_chain(
            dict(BASE, overlayEffect="none"), 1080, 1920, "a", "b"))
        self.assertIsNone(worker.atmosphere_chain(
            dict(BASE, overlayEffect="rain", overlayIntensity=0), 1080, 1920, "a", "b"))
        # An effect nobody has heard of must be nothing, not a crash.
        self.assertIsNone(worker.atmosphere_chain(
            dict(BASE, overlayEffect="locusts"), 1080, 1920, "a", "b"))

    def test_the_scrim_and_the_weather_go_on_before_the_captions(self):
        # Dimming a bright frame so the words read must not dim the words, and
        # rain in front of a caption is rain on a caption nobody can read.
        graph = worker.build_video_filter(
            dict(BASE, overlayEffect="rain", overlayIntensity=70, overlayDarken=40), ass_file())
        scrim = graph.index("drawbox")
        weather = graph.index("[atmlayer]overlay")
        captions = graph.index("ass=")
        self.assertLess(scrim, weather, "the scrim is under the weather")
        self.assertLess(weather, captions, "and both are under the captions")
        self.assertEqual(graph.count("[vout]"), 1, "exactly one thing is mapped")

    def test_the_field_is_three_periods_tall_and_the_window_sits_in_the_middle(self):
        # THE SEAM. Only the middle band has real neighbours above and below it
        # for the vertical blur, and only the middle band is periodic -- a
        # window anywhere else truncates streaks at the wrap, which reads as
        # the rain stopping dead several times a clip.
        chain = worker.atmosphere_chain(
            dict(BASE, overlayEffect="rain", overlayIntensity=60), 1080, 1920, "a", "b")
        period = worker.ATMOSPHERES["rain"]["gh"]
        self.assertIn(f"s={worker.ATMOSPHERES['rain']['gw']}x{period * 3}", chain,
                      "the field is three periods tall")
        self.assertIn(f"crop={worker.ATMOSPHERES['rain']['gw']}:{period}:0:'{period}+", chain,
                      "and the window starts one period down")

    def test_the_shaping_is_paid_for_once_not_once_a_frame(self):
        # Everything before `loop` runs on the single generated frame. If the
        # loop ever moved above the blur and the gain, an hour-long lecture
        # would pay for a Gaussian on every frame of every clip.
        chain = worker.atmosphere_chain(
            dict(BASE, overlayEffect="bokeh", overlayIntensity=60), 1080, 1920, "a", "b")
        loop = chain.index("loop=loop=-1")
        for expensive in ("geq=lum=", "gblur=sigma=", "avgblur=", "lutyuv=y='min(255"):
            self.assertLess(chain.index(expensive), loop,
                            f"{expensive} must be generated once, not per frame")

    def test_an_upward_effect_never_takes_a_negative_modulo(self):
        # ffmpeg's mod() of a negative gives a negative, crop clamps it to zero
        # and the effect silently stops moving. Dust drifts UP, so it is the
        # one that would have.
        chain = worker.atmosphere_chain(
            dict(BASE, overlayEffect="dust", overlayIntensity=60), 1080, 1920, "a", "b")
        self.assertGreater(worker.ATMOSPHERES["dust"]["speed"], 0,
                           "the table states a positive speed and a direction flag")
        self.assertTrue(worker.ATMOSPHERES["dust"]["up"])
        self.assertNotIn("t*-", chain, "no negative rate reaches the expression")
        self.assertIn("-mod(t*", chain, "the direction is a subtraction, not a sign")

    def test_intensity_is_the_alpha_and_is_clamped(self):
        for value, expected in ((100, "0.900"), (50, "0.500"), (999, "1.000")):
            chain = worker.atmosphere_chain(
                dict(BASE, overlayEffect="snow", overlayIntensity=value), 1080, 1920, "a", "b")
            if value == 100:
                expected = "1.000"
            self.assertIn(f"lutyuv=y='val*{expected}'", chain, f"intensity {value}")

    def test_the_particle_colour_is_a_constant_with_the_field_as_its_alpha(self):
        # The version that tinted the field BY ITS OWN VALUE made faint
        # particles dark grey, and compositing dark grey over a white masjid
        # wall DARKENS it -- "rain" rendered as dirt on the lens.
        chain = worker.atmosphere_chain(
            dict(BASE, overlayEffect="rain", overlayIntensity=60), 1080, 1920, "a", "b")
        red, green, blue = worker.ATMOSPHERES["rain"]["rgb"]
        self.assertIn(f"lutrgb=r={red}:g={green}:b={blue}", chain,
                      "a constant colour, not one scaled by the field")
        self.assertIn("alphamerge", chain, "and the field carries the alpha")
        self.assertNotIn("blend=", chain,
                         "blend=screen turns the chroma planes magenta; this composites with alpha")

    def test_darken_stands_alone_and_stops_short_of_hiding_the_video(self):
        self.assertEqual(worker.darken_filter(dict(BASE)), "")
        self.assertEqual(worker.darken_filter(dict(BASE, overlayDarken=0)), "")
        self.assertIn("black@0.400", worker.darken_filter(dict(BASE, overlayDarken=40)))
        # "but still the video of course" -- a scrim that reaches 1.0 is a
        # black rectangle with captions on it.
        self.assertIn("black@0.800", worker.darken_filter(dict(BASE, overlayDarken=250)))
        # And it works with no weather at all, which is its own reason to exist:
        # dimming a bright frame is how a caption reads.
        graph = worker.build_video_filter(dict(BASE, overlayDarken=30), ass_file())
        self.assertIn("drawbox", graph)
        self.assertNotIn("atmlayer", graph)

    def test_captions_behind_the_speaker_still_get_the_weather(self):
        graph = worker.build_video_filter(
            dict(BASE, overlayEffect="rain", overlayDarken=30, captionBehindSubject=True),
            ass_file(), matte_src="1:v", source_size=(1920, 1080))
        self.assertEqual(graph.count("[vout]"), 1)
        self.assertIn("[gradedraw]", graph, "the weather goes on before the matte split")
        self.assertIn("[graded]split=2[capbase][subject]", graph, "and the split still reads [graded]")


class AtmosphereFrameTests(unittest.TestCase):
    """The one test that renders. A filter graph is not a picture.

    Gated on ffmpeg with the filters this needs, per TEST rather than in
    setUpClass -- a SkipTest there counts as one skip while the tests
    disappear from the total, which the handover guard rightly reports as
    tests having vanished.
    """

    _why_not = ""

    @classmethod
    def setUpClass(cls):
        # The gate has to fail in the SAME conditions SpeakerTrackingTests does,
        # or the suite's skip count is not what the handover guard is told to
        # expect. So it probes the same way: list the filters this needs, then
        # actually encode something with the native mpeg4 encoder -- listing
        # filters succeeds on a build that cannot encode at all.
        try:
            filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"],
                                     capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
        except (OSError, subprocess.SubprocessError) as error:
            cls._why_not = f"ffmpeg is not available ({error})"
            return
        for needed in ("geq", "gblur", "avgblur", "alphamerge", "overlay", "loop"):
            if not re.search(rf"\s{needed}\s", filters):
                cls._why_not = f"this ffmpeg build has no {needed} filter"
                return
        try:
            with tempfile.TemporaryDirectory() as work:
                subprocess.run(
                    ["ffmpeg", "-v", "error", "-f", "lavfi",
                     "-i", "color=c=black:s=64x64:d=0.2", "-c:v", "mpeg4", "-q:v", "5",
                     "-pix_fmt", "yuv420p", "-y", str(pathlib.Path(work) / "probe.mp4")],
                    check=True, capture_output=True, timeout=60)
        except (OSError, subprocess.SubprocessError) as error:
            detail = getattr(error, "stderr", b"") or b""
            detail = detail.decode("utf-8", "replace").strip() if isinstance(detail, bytes) else str(detail)
            cls._why_not = f"ffmpeg cannot encode here: {detail or error}"

    def setUp(self):
        if self._why_not:
            self.skipTest(self._why_not)

    def test_the_weather_is_drawn_and_it_moves(self):
        # Over a FLAT MID-GREY, so every lit pixel is the effect and nothing
        # else. Two things are asserted and the second is the one that matters:
        # a static field that never scrolls looks perfectly correct in a single
        # frame and is not rain.
        chain = worker.atmosphere_chain(
            dict(BASE, overlayEffect="rain", overlayIntensity=90), 1080, 1920, "bg", "out")
        with tempfile.TemporaryDirectory() as work:
            out = pathlib.Path(work) / "rain.mp4"
            graph = ("color=c=0x606060:s=1080x1920:d=3,format=yuv420p[bg];" + chain
                     + ";[out]format=yuv420p[v]")
            result = subprocess.run(
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-filter_complex", graph,
                 "-map", "[v]", "-t", "3", "-r", "30", "-c:v", "mpeg4", "-q:v", "3", str(out)],
                capture_output=True, timeout=300)
            self.assertEqual(result.returncode, 0,
                             result.stderr.decode("utf-8", "replace")[-800:])

            def frame(at: float) -> bytes:
                got = subprocess.run(
                    ["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", str(out),
                     "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                    capture_output=True, timeout=120)
                self.assertTrue(got.stdout, "no frame came back")
                return got.stdout

            first = frame(1.0)
            # The ground is 0x60; anything meaningfully brighter is a raindrop.
            lit = sum(1 for value in first if value > 0x78)
            self.assertGreater(lit, 2000, "the rain drew almost nothing on the frame")
            self.assertLess(lit, len(first) // 4, "the rain covered the picture")

            later = frame(1.5)
            moved = sum(1 for a, b in zip(first, later) if abs(a - b) > 8)
            self.assertGreater(moved, lit // 2, "the field is not falling, it is a still")


if __name__ == "__main__":
    unittest.main()
