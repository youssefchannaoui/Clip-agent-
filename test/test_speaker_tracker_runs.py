"""speaker_crop_plan actually runs, end to end, on a real video.

THIS FILE EXISTS BECAUSE OF A BUG THE BOX FOUND AND THE SUITE COULD NOT.

Rewiring the tracker once introduced `samples` as the list of collected
measurements, next to an existing `samples` holding the sample COUNT -- so
`range(samples + 1)` added an int to a list and the function raised TypeError on
its first real frame. Every unit test still passed: they drive the pure
decision functions underneath, which is deliberate and lets them run on a
machine with no MediaPipe -- but it means nothing between the video and those
functions was ever executed.

The render wraps the call in try/except and falls back to the static crop, so
the fault did not fail a single job. It made the feature silently not happen,
which is worse: a green suite, working renders, and no speaker tracking.

These need ffmpeg and skip without it. They assert almost nothing about the
ANSWER -- a generated video has no faces in it, so "no face was found" is the
correct outcome. What they assert is that the function REACHES an answer
instead of raising, and that the graph it produces is one ffmpeg accepts and
renders as a CUT rather than a pan.
"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw

FFMPEG = shutil.which("ffmpeg")

# ffmpeg alone. The tracker's detector is MediaPipe now, and none of these
# tests needs one: a chosen bias is arithmetic on ffprobe's dimensions, and the
# auto branch is asked to REACH an answer rather than to find a face in
# synthetic footage.
@unittest.skipUnless(FFMPEG, "needs ffmpeg")
class TrackerRunsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = Path(tempfile.mkdtemp())
        cls.video = cls.temp / "shot.mp4"
        # Two bright blocks where two people would sit. The cascades will not
        # call them faces, which is the point: the function must come back with
        # an answer rather than an exception.
        subprocess.run([
            FFMPEG, "-y", "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=4:r=10",
            "-vf", ("drawbox=x=300:y=250:w=90:h=90:color=white:t=fill,"
                    "drawbox=x=800:y=250:w=90:h=90:color=gray:t=fill"),
            "-c:v", "mpeg4", "-pix_fmt", "yuv420p", str(cls.video),
        ], capture_output=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.temp, ignore_errors=True)

    def test_it_returns_an_answer_rather_than_raising(self):
        # The bug. It raised TypeError on the first sampled frame.
        plan = cw.speaker_crop_plan(
            self.video, "ffmpeg", "ffprobe", 0.0, 3.0, 1080, 1920)
        self.assertIn("available", plan)
        if not plan["available"]:
            self.assertTrue(plan.get("reason"), "and says why when it cannot")

    def test_a_chosen_bias_needs_no_detector_at_all(self):
        # Pure arithmetic on the dimensions. CLAUDE.md records OpenCV 5 removing
        # the cascade API and taking `smartFramingBias: left` down with it,
        # though nothing in that branch needs a detector.
        plan = cw.speaker_crop_plan(
            self.video, "ffmpeg", "ffprobe", 0.0, 3.0, 1080, 1920, "left")
        self.assertTrue(plan["available"])
        self.assertEqual(plan["method"], "bias-left")
        # Near the left edge, not pinned to it: crop_origin_from_center adds a
        # deliberate look-room nudge toward the middle so a subject is never
        # jammed against the frame edge.
        x = plan["keyframes"][0]["x"]
        self.assertLess(x, plan["srcW"] * 0.15, "hard over to the left")
        self.assertGreaterEqual(x, 0)

    def test_a_portrait_source_needs_no_crop_and_says_so(self):
        tall = self.temp / "tall.mp4"
        subprocess.run([
            FFMPEG, "-y", "-f", "lavfi", "-i", "color=c=black:s=720x1280:d=2:r=10",
            "-c:v", "mpeg4", "-pix_fmt", "yuv420p", str(tall),
        ], capture_output=True, timeout=120)
        plan = cw.speaker_crop_plan(tall, "ffmpeg", "ffprobe", 0.0, 1.0, 1080, 1920)
        self.assertFalse(plan["available"])
        self.assertIn("narrower", plan["reason"])

    def test_A_CUT_LANDS_ON_ONE_FRAME_AND_THE_SUBJECT_IS_CENTRED(self):
        """The oldest rule in CLAUDE.md: only a rendered frame settles this.

        Two people told apart by BRIGHTNESS rather than position, because both
        are framed dead centre when chosen and a probe that only reads where
        the ink is cannot say which of them is on screen.
        """
        source = self.temp / "two.mp4"
        subprocess.run([
            FFMPEG, "-y", "-v", "error", "-f", "lavfi",
            "-i", "color=c=black:s=1920x1080:d=4:r=30",
            "-vf", ("drawbox=x=550:y=340:w=60:h=400:color=0xF0F0F0:t=fill,"
                    "drawbox=x=1310:y=340:w=60:h=400:color=0x707070:t=fill"),
            "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", str(source),
        ], check=True, capture_output=True, timeout=180)

        keys = [{"t": 0.0, "x": 276, "y": 0}, {"t": 2.0, "x": 1036, "y": 0}]
        graph = cw.build_video_filter(
            {"width": 1080, "height": 1920, "fitMode": "crop", "smartFramingEnabled": True},
            self.temp / "none.ass",
            crop_plan={"x": 276, "y": 0, "w": 608, "h": 1080, "srcW": 1920, "srcH": 1080,
                       "motion": "cut", "keyframes": keys})
        part = graph[graph.index("crop="):]
        part = part[:part.index("setsar=1") + 8]
        self.assertNotIn("/", part, "a division is a ramp, and a ramp is not a cut")

        # RENDER THE WHOLE CLIP and read frames out of the OUTPUT. `-ss` before
        # `-i` restarts the output timestamps at zero, so extracting a frame at
        # t=2 with a seek asks the crop expression about t=0 -- and the first
        # reading of this reported a cut that never happened, on a cut that
        # happens exactly on time.
        rendered = self.temp / "cut.mp4"
        done = subprocess.run(
            [FFMPEG, "-y", "-v", "error", "-i", str(source), "-vf", part,
             "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", str(rendered)],
            capture_output=True, timeout=300)
        self.assertEqual(done.returncode, 0, msg=done.stderr.decode("utf-8", "replace")[-600:])

        frames = self.temp / "walk"
        frames.mkdir(exist_ok=True)
        subprocess.run(
            [FFMPEG, "-y", "-v", "error", "-i", str(rendered),
             "-vf", r"select='gte(n\,57)*lte(n\,62)'", "-vsync", "0",
             str(frames / "f-%02d.png")], capture_output=True, timeout=180)
        seen = []
        for index, frame in enumerate(sorted(frames.glob("f-*.png"))):
            raw = subprocess.run(
                [FFMPEG, "-v", "error", "-i", str(frame), "-f", "rawvideo",
                 "-pix_fmt", "gray", "-"], capture_output=True, timeout=60).stdout
            width, height = 1080, 1920
            if len(raw) < width * height:
                continue
            line = raw[(height // 2) * width:(height // 2 + 1) * width]
            lit = [x for x in range(width) if line[x] > 60]
            self.assertTrue(lit, "the subject must be somewhere in the frame")
            centre = (min(lit) + max(lit)) / 2
            self.assertLess(abs(centre - width / 2), 12,
                            "whoever is framed must be centred, in EVERY frame -- a"
                            " pan spends its life with them off to one side")
            seen.append("A" if max(line[x] for x in lit) > 170 else "B")
        self.assertEqual(len(seen), 6, "six frames either side of the cut")
        self.assertEqual(seen, ["A", "A", "A", "B", "B", "B"],
                         "one frame on the old subject, the next on the new one")

    def test_the_whole_render_graph_builds_from_a_real_plan(self):
        # The filter string is what ffmpeg has to accept. Built from a moving
        # plan, it must carry an expression rather than four integers.
        plan = {"x": 100, "y": 0, "w": 404, "h": 720, "srcW": 1280, "srcH": 720,
                "keyframes": [{"t": 0.0, "x": 100, "y": 0}, {"t": 1.0, "x": 100, "y": 0},
                              {"t": 1.45, "x": 800, "y": 0}, {"t": 3.0, "x": 800, "y": 0}]}
        graph = cw.build_video_filter(
            {"width": 1080, "height": 1920, "fitMode": "crop", "smartFramingEnabled": True},
            self.temp / "none.ass", crop_plan=plan)
        self.assertIn("crop=404:720:", graph)
        self.assertIn("gte(t", graph)
        # And ffmpeg must actually accept it. A graph that parses in Python and
        # is rejected by ffmpeg is the whole failure mode this file is for.
        part = graph[graph.index("crop="):]
        part = part[:part.index("setsar=1") + 8]
        done = subprocess.run(
            [FFMPEG, "-y", "-i", str(self.video), "-vf", part, "-frames:v", "3",
             "-f", "null", "-"], capture_output=True, timeout=120)
        self.assertEqual(done.returncode, 0,
                         msg=done.stderr.decode("utf-8", "replace")[-600:])


if __name__ == "__main__":
    unittest.main()
