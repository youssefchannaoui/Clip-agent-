"""The download says how far it is, in bytes the customer can read.

Youssef, 1 Sept 2026, watching an import sit on "0% of this step" while ffmpeg
had 741MB on disk: "can you show the mb for example xx / xx so people know and
put it next to the ETA". Everything downstream already existed -- the service's
pulse turns byte counts into bytesDone/bytesTotal, the app renders them beside
the ETA -- but the yt-dlp hook never passed its bytes on, and the section path
downloads through ffmpeg, which fires no per-byte hooks at all. These test the
two sources that now feed the pulse.
"""
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


class HookProgressTests(unittest.TestCase):
    def test_exact_totals_are_preferred_over_the_estimate(self):
        self.assertEqual(
            ip._hook_progress({"downloaded_bytes": 100, "total_bytes": 400, "total_bytes_estimate": 999}),
            (100, 400))

    def test_the_estimate_fills_in_when_no_length_was_sent(self):
        self.assertEqual(
            ip._hook_progress({"downloaded_bytes": 100, "total_bytes_estimate": 500}),
            (100, 500))

    def test_junk_values_read_as_nothing_rather_than_raising(self):
        # A hook that raises kills the download it was meant to describe.
        self.assertEqual(ip._hook_progress({"downloaded_bytes": "?", "total_bytes": None}), (0, 0))
        self.assertEqual(ip._hook_progress({}), (0, 0))


class OnDiskBytesTests(unittest.TestCase):
    def test_every_intermediate_the_downloader_writes_is_counted(self):
        # yt-dlp writes "source.mp4.part" (or per-format "source.f616.mp4.part")
        # and merges into "source.mp4"; ffmpeg writes the .part directly. All
        # share the destination's stem, and none is the only shape that occurs.
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "source.mp4.part").write_bytes(b"x" * 700)
            (work / "source.f616.mp4.part").write_bytes(b"x" * 200)
            (work / "result.json").write_bytes(b"x" * 999)  # not the download
            self.assertEqual(ip._download_bytes_on_disk(work / "source.mp4"), 900)

    def test_a_missing_directory_answers_zero_not_an_exception(self):
        self.assertEqual(ip._download_bytes_on_disk(Path("/nonexistent/dir/source.mp4")), 0)


class WatcherTests(unittest.TestCase):
    def test_the_watcher_reports_the_file_while_the_hook_is_silent(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "source.mp4.part").write_bytes(b"x" * 1234)
            seen = []
            stop = threading.Event()

            def poll(done=0, total=0):
                seen.append((done, total))
                stop.set()  # one report is the proof; end the loop
                return False

            ip._watch_download_bytes(work / "source.mp4", poll, stop, {"at": 0.0}, interval=0.01)
            self.assertEqual(seen, [(1234, 0)], "the on-disk size, with no invented total")

    def test_the_watcher_yields_to_a_hook_that_is_speaking(self):
        # Alternating the hook's per-file figure with the watcher's on-disk sum
        # would make the number the customer watches jump around.
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "source.mp4.part").write_bytes(b"x" * 1234)
            seen = []
            stop = threading.Event()
            threading.Timer(0.08, stop.set).start()
            ip._watch_download_bytes(
                work / "source.mp4",
                lambda done=0, total=0: seen.append((done, total)) or False,
                stop, {"at": time.monotonic()}, interval=0.01)
            self.assertEqual(seen, [], "the hook spoke recently, so the watcher stays quiet")


if __name__ == "__main__":
    unittest.main()
