"""The editor's live-preview plate (v3.140.0).

The clip editor plays a PLATE -- the clip window cut untouched, no captions,
no mark, no grade, no music -- and draws every layer over it live from the
same object the sliders write. The worker cuts it on the quick lane and it
must never pass through the nasheed or template checks, because a plate has
neither by definition.
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "worker"))
import clip_worker as worker  # noqa: E402

FFMPEG = shutil.which("ffmpeg")


def ffmpeg_works() -> bool:
    if not FFMPEG:
        return False
    try:
        return subprocess.run([FFMPEG, "-version"], capture_output=True, timeout=20).returncode == 0
    except Exception:
        return False


class PlateBranchTests(unittest.TestCase):
    def test_a_plate_job_cuts_the_window_and_touches_nothing_else(self):
        calls = []

        def fake_render_plate(ffmpeg, source, start, end, clip_file, thumb_file, threads):
            calls.append((start, end, clip_file.name, thumb_file.name))
            return {"clipFile": str(clip_file), "thumbFile": str(thumb_file), "startSec": start, "endSec": end,
                    "durationMs": int((end - start) * 1000), "musicEnabled": False, "musicVerified": False,
                    "renderVerified": True, "plate": True, "createdAt": 1}

        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / "source.mp4"
            src.write_bytes(b"not really a video")
            result = pathlib.Path(tmp) / "result.json"
            # No music tracks and no musicEnabled: false -- the ordinary
            # re-render refuses this job outright. The plate must not.
            job = {"id": "job1", "projectId": "p1", "resultPath": str(result), "outputDir": tmp, "sourceFile": str(src),
                   "ffmpeg": "ffmpeg", "settings": {}, "template": {"id": "clean-line"},
                   "clip": {"plate": True, "startSec": 5.0, "endSec": 24.55, "title": "The door"}, "musicTracks": []}
            with mock.patch.object(worker, "render_plate", fake_render_plate), \
                 mock.patch.object(worker, "render_clip", side_effect=AssertionError("a plate never renders a clip")), \
                 mock.patch.object(worker, "apply_source_window", lambda job, path: path), \
                 mock.patch.object(worker, "emit", lambda *a, **k: None), \
                 mock.patch.object(worker, "progress", lambda *a, **k: None):
                worker.process_rerender(job, pathlib.Path(tmp) / "job.json")
            self.assertEqual(calls, [(5.0, 24.55, "job1-plate.mp4", "job1-plate.jpg")])
            landed = json.loads(result.read_text())
        plate = landed["clips"][0]
        self.assertEqual(plate["id"], "job1-plate")
        self.assertEqual(plate["projectId"], "p1")
        self.assertTrue(plate["plate"])
        self.assertTrue(plate["renderVerified"], "the app's landing refuses an unverified result")
        self.assertIs(plate["musicEnabled"], False, "store.musicSatisfied reads this as satisfied")

    def test_an_ordinary_rerender_still_refuses_without_a_nasheed(self):
        # The guard the plate skips must still hold for everything else.
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / "source.mp4"
            src.write_bytes(b"x")
            job = {"id": "job2", "resultPath": str(pathlib.Path(tmp) / "r.json"), "outputDir": tmp, "sourceFile": str(src),
                   "settings": {}, "template": {"id": "clean-line"}, "clip": {"startSec": 0, "endSec": 5}, "musicTracks": []}
            with mock.patch.object(worker, "render_plate", side_effect=AssertionError("not a plate")), \
                 mock.patch.object(worker, "apply_source_window", lambda job, path: path), \
                 mock.patch.object(worker, "emit", lambda *a, **k: None), \
                 mock.patch.object(worker, "progress", lambda *a, **k: None):
                with self.assertRaises(Exception):
                    worker.process_rerender(job, pathlib.Path(tmp) / "job.json")


class RenderPlateTests(unittest.TestCase):
    """Cuts a real window with ffmpeg where one exists; skipped per test where
    it does not, so the skip is COUNTED rather than the class vanishing."""

    def test_the_plate_is_the_window_bounded_to_the_long_edge(self):
        if not ffmpeg_works():
            self.skipTest("ffmpeg is not available here")
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / "src.mp4"
            subprocess.run([FFMPEG, "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=25:duration=6",
                            "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "mpeg4", "-q:v", "5",
                            "-c:a", "aac", "-shortest", str(src)], check=True, capture_output=True, timeout=120)
            out = worker.render_plate(FFMPEG, src, 1.0, 4.0, pathlib.Path(tmp) / "p.mp4", pathlib.Path(tmp) / "p.jpg", "2")
            self.assertTrue(pathlib.Path(out["clipFile"]).exists())
            self.assertTrue(pathlib.Path(out["thumbFile"]).exists())
            self.assertEqual((out["startSec"], out["endSec"], out["durationMs"]), (1.0, 4.0, 3000))
            probe = subprocess.run([FFMPEG.replace("ffmpeg", "ffprobe"), "-v", "error", "-select_streams", "v:0",
                                    "-show_entries", "stream=width,height:format=duration", "-of", "json", out["clipFile"]],
                                   capture_output=True, text=True, timeout=60)
            info = json.loads(probe.stdout)
            width, height = info["streams"][0]["width"], info["streams"][0]["height"]
            self.assertEqual(width, worker.PLATE_MAX_EDGE, "the long edge is bounded")
            self.assertEqual(height, 720)
            self.assertAlmostEqual(float(info["format"]["duration"]), 3.0, delta=0.25)

    def test_an_empty_window_is_refused(self):
        with self.assertRaises(RuntimeError):
            worker.render_plate("ffmpeg", pathlib.Path("x.mp4"), 4.0, 4.0, pathlib.Path("a.mp4"), pathlib.Path("a.jpg"), "1")


if __name__ == "__main__":
    unittest.main()
