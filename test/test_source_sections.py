"""Fetching only the stretch of lecture someone actually selected.

A 90-minute lecture is about 1.5GB through the proxy pool. Someone who picked
three minutes of it was paying for the whole file -- in bandwidth off a 250GB
monthly plan, in disk on the box, and in the minutes before their job could
start. The downloader now asks for the selected range instead.

The bandwidth is the easy half. The hazard is that a file which starts at
10:00 looks exactly like a file which starts at 0:00, and cutting it a second
time with the same window renders the wrong moment with the right captions --
the failure apply_source_window() was written for in the first place. So the
rules under test are: never claim a section the downloader did not confirm,
never trim a file that is already the window, and never let the source cache
hand one job's section to a job that asked for a different part.
"""
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip  # noqa: E402


class FakeDownloadError(Exception):
    pass


class FakeYoutubeDL:
    """Stands in for yt_dlp.YoutubeDL, recording what it was asked for."""

    calls: list = []
    ranges_seen: list = []
    # One entry per attempt: either an exception to raise or an info dict.
    script: list = []

    def __init__(self, options):
        self.options = options
        FakeYoutubeDL.calls.append(options)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def extract_info(self, url, download=True):
        step = FakeYoutubeDL.script.pop(0) if FakeYoutubeDL.script else {}
        # yt-dlp calls the range callback during the download, with the info it
        # extracted BEFORE any section was chosen -- which is the only moment
        # the whole video's duration is still on the record. Calling it here is
        # what makes this stub worth having.
        callback = self.options.get("download_ranges")
        if callback:
            FakeYoutubeDL.ranges_seen.append(callback({"duration": LECTURE_SECONDS}, self))
        if isinstance(step, Exception):
            raise step
        return step

    def prepare_filename(self, info):
        target = Path(self.options["outtmpl"].replace(".%(ext)s", ".mp4"))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"video-bytes")
        return str(target)


def install_fake_yt_dlp():
    module = types.ModuleType("yt_dlp")
    module.YoutubeDL = FakeYoutubeDL
    utils = types.ModuleType("yt_dlp.utils")
    utils.DownloadError = FakeDownloadError
    module.utils = utils
    sys.modules["yt_dlp"] = module
    sys.modules["yt_dlp.utils"] = utils


URL = "https://www.youtube.com/watch?v=abcdefghijk"
LECTURE_SECONDS = 5400.0  # 90 minutes


class SectionDownloadTests(unittest.TestCase):
    def setUp(self):
        self.saved = sys.modules.get("yt_dlp")
        install_fake_yt_dlp()
        FakeYoutubeDL.calls = []
        FakeYoutubeDL.ranges_seen = []
        FakeYoutubeDL.script = []
        self.tmp = Path(__file__).resolve().parent / "__sections__"
        self.tmp.mkdir(exist_ok=True)
        self.destination = self.tmp / "source.mp4"

    def tearDown(self):
        if self.saved is None:
            sys.modules.pop("yt_dlp", None)
        else:
            sys.modules["yt_dlp"] = self.saved
        sys.modules.pop("yt_dlp.utils", None)
        for leftover in self.tmp.glob("*"):
            leftover.unlink()
        self.tmp.rmdir()

    def run_import(self, source):
        return ip.YtDlpImportProvider().import_video(source, self.destination, lambda: False)

    def sections_asked_for(self):
        """The ranges the downloader was actually handed, or None if never asked."""
        return FakeYoutubeDL.ranges_seen[0] if FakeYoutubeDL.ranges_seen else None

    def test_only_the_selected_stretch_is_requested(self):
        FakeYoutubeDL.script = [{"title": "Lecture", "section_start": 600.0, "section_end": 900.0}]
        imported = self.run_import(
            {"url": URL, "windowStartSec": 600, "windowEndSec": 900}
        )
        self.assertEqual(self.sections_asked_for(), [{"start_time": 600.0, "end_time": 900.0}])
        self.assertTrue(imported.windowed, "the file IS the window, and whoever gets it must know")
        self.assertEqual(imported.source_duration_sec, LECTURE_SECONDS,
                         "the whole lecture's length is only knowable here -- yt-dlp "
                         "overwrites it with the section's once a range is chosen")

    def test_a_window_running_to_the_end_uses_the_videos_own_length(self):
        # "From 20 minutes in, to wherever it finishes" carries no end second.
        FakeYoutubeDL.script = [{"title": "Lecture", "section_start": 1200.0, "section_end": LECTURE_SECONDS}]
        self.run_import({"url": URL, "windowStartSec": 1200, "windowEndSec": None})
        self.assertEqual(self.sections_asked_for(), [{"start_time": 1200.0, "end_time": LECTURE_SECONDS}])

    def test_the_whole_video_is_still_fetched_whole(self):
        FakeYoutubeDL.script = [{"title": "Lecture"}]
        imported = self.run_import({"url": URL})
        self.assertIsNone(self.sections_asked_for(),
                          "asking for a 'section' that is the whole video adds only a way to fail")
        self.assertFalse(imported.windowed)

    def test_a_section_is_never_claimed_unless_the_downloader_confirms_it(self):
        # An extractor that ignores ranges hands back the whole lecture. Calling
        # that the window is how the wrong ten minutes gets rendered.
        FakeYoutubeDL.script = [{"title": "Lecture"}]  # no section_start/section_end
        imported = self.run_import({"url": URL, "windowStartSec": 600, "windowEndSec": 900})
        self.assertIsNotNone(self.sections_asked_for(), "it was asked for")
        self.assertFalse(imported.windowed, "but it was not delivered, so it must not be claimed")

    def test_a_refused_section_falls_back_to_the_whole_video(self):
        # Saving bandwidth is an optimisation. An optimisation that costs
        # someone their import is not one.
        blocked = [FakeDownloadError("HTTP Error 403: Forbidden") for _ in ip.YOUTUBE_CLIENTS]
        FakeYoutubeDL.script = [*blocked, {"title": "Lecture"}]
        imported = self.run_import({"url": URL, "windowStartSec": 600, "windowEndSec": 900})
        self.assertFalse(imported.windowed, "the fallback is the whole video, so it still needs trimming")
        self.assertTrue(self.destination.exists(), "the import must still succeed")
        self.assertTrue(
            any("download_ranges" not in options for options in FakeYoutubeDL.calls),
            "the retry has to drop the range, not repeat it",
        )

    def test_a_leftover_file_can_never_be_mistaken_for_a_finished_download(self):
        # yt-dlp skips a download whose output file already exists. A section
        # attempt that dies after writing one would make the full retry
        # "succeed" by handing back the broken piece.
        FakeYoutubeDL.script = [{"title": "Lecture", "section_start": 1.0, "section_end": 2.0}]
        self.run_import({"url": URL, "windowStartSec": 1, "windowEndSec": 2})
        self.assertTrue(all(options.get("overwrites") for options in FakeYoutubeDL.calls))


class SourceCacheKeyTests(unittest.TestCase):
    """The cache holds bytes, and a section is different bytes than the lecture."""

    def setUp(self):
        import importlib
        import os
        import tempfile
        self.root = tempfile.mkdtemp()
        os.environ["WORKER_DATA_DIR"] = self.root
        self.service = importlib.reload(importlib.import_module("service"))

    def tearDown(self):
        import os
        import shutil
        os.environ.pop("WORKER_DATA_DIR", None)
        shutil.rmtree(self.root, ignore_errors=True)

    def test_two_windows_of_one_lecture_are_not_the_same_cache_entry(self):
        first = self.service.source_cache_key({"url": URL}, (600.0, 900.0))
        second = self.service.source_cache_key({"url": URL}, (2400.0, 2700.0))
        self.assertNotEqual(first, second,
                            "handing minute 40 to the job that asked for minute 10 renders "
                            "the wrong moment with the right captions")

    def test_a_section_is_not_filed_under_the_whole_lecture(self):
        whole = self.service.source_cache_key({"url": URL})
        section = self.service.source_cache_key({"url": URL}, (600.0, 900.0))
        self.assertNotEqual(whole, section)

    def test_the_same_window_is_the_same_entry(self):
        self.assertEqual(
            self.service.source_cache_key({"url": URL}, (600.0, 900.0)),
            self.service.source_cache_key({"url": URL}, (600.0, 900.0)),
        )

    def test_an_open_ended_window_still_keys_stably(self):
        first = self.service.source_cache_key({"url": URL}, (600.0, None))
        self.assertEqual(first, self.service.source_cache_key({"url": URL}, (600.0, None)))
        self.assertNotEqual(first, self.service.source_cache_key({"url": URL}, (600.0, 900.0)))

    def test_uploads_are_unaffected(self):
        self.assertEqual(
            self.service.source_cache_key({"objectKey": "sources/x.mp4"}),
            self.service.source_cache_key({"objectKey": "sources/x.mp4"}),
        )

    def test_a_job_that_selected_nothing_has_no_window(self):
        self.assertIsNone(self.service.window_of({}))
        self.assertIsNone(self.service.window_of({"sourceStartSec": 0, "sourceEndSec": None}))

    def test_a_job_that_selected_something_has_one(self):
        self.assertEqual(self.service.window_of({"sourceStartSec": 600, "sourceEndSec": 900}), (600.0, 900.0))
        self.assertEqual(self.service.window_of({"sourceStartSec": 600}), (600.0, None))
        self.assertEqual(self.service.window_of({"sourceStartSec": 0, "sourceEndSec": 900}), (0.0, 900.0))


class NoSecondTrimTests(unittest.TestCase):
    """The cut happens once, wherever it happened."""

    def setUp(self):
        import clip_worker
        self.clip_worker = clip_worker

    def test_a_file_that_is_already_the_window_is_left_alone(self):
        job = {
            "sourceStartSec": 600, "sourceEndSec": 900,
            "sourceAlreadyWindowed": True,
            # A real ffmpeg would be needed to trim; naming one that cannot
            # exist means the test fails loudly if anything tries.
            "ffmpeg": "/nonexistent/ffmpeg", "ffprobe": "/nonexistent/ffprobe",
        }
        source = Path("/tmp/already-a-window.mp4")
        self.assertEqual(self.clip_worker.apply_source_window(job, source), source)

    def test_a_whole_video_still_gets_its_window_cut(self):
        # The flag is the only thing that may suppress the trim, so its absence
        # must leave the old behaviour exactly as it was.
        job = {"sourceStartSec": 600, "sourceEndSec": 900, "ffmpeg": "ffmpeg", "ffprobe": "ffprobe"}
        calls = []
        original = self.clip_worker.media_duration
        self.clip_worker.media_duration = lambda *a, **k: LECTURE_SECONDS
        trim = self.clip_worker.trim_source_window
        self.clip_worker.trim_source_window = lambda *args: calls.append(args)
        try:
            self.clip_worker.apply_source_window(job, Path("/tmp/whole.mp4"))
        finally:
            self.clip_worker.media_duration = original
            self.clip_worker.trim_source_window = trim
        self.assertEqual(len(calls), 1, "a full download still has to be cut down to the window")
        self.assertEqual(calls[0][3], 600.0)
        self.assertEqual(calls[0][4], 300.0)


if __name__ == "__main__":
    unittest.main()
