"""How far through a download is, from whatever the downloader will say.

Youssef, 9 Sept 2026, watching an import: "it could stay on fifteen minutes for
longer than fifteen minutes ... it says it's on zero percent, but you can
clearly see the MB has went up ... nothing really adds up."

Every symptom in that sentence came from ONE fact: yt-dlp had reported no byte
TOTAL for that download, and the whole import progress model was gated on
having one. No total meant no fraction, so "0% of this step" for the length of
the import; no fraction meant the service wrote no `progress` and no `etaSec`,
so the app fell back to a constant and the ETA could not move. The megabytes
climbed because they were the only figure not behind that gate.

These drive the two halves of the fix: DownloadProgress, which finds a
denominator in whatever the downloader does say, and the service's pulse, which
now reports a percentage, a speed and an ETA without needing one.
"""
import pathlib
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


def hook(**fields):
    base = {"status": "downloading"}
    base.update(fields)
    return base


class DenominatorTests(unittest.TestCase):
    def test_an_exact_total_is_used_as_it_is(self):
        progress = ip.DownloadProgress()
        self.assertEqual(progress.note_hook(hook(downloaded_bytes=40, total_bytes=100)), (40, 100))

    def test_a_fragmented_download_gets_a_total_from_its_fragments(self):
        # THE REPORTED CASE. A DASH format reports no total at all -- the
        # rescue download on the box came back as 348 fragments -- so before
        # this the app had a climbing byte count and no denominator, and drew
        # 0%. The fragments know the fraction, and a fraction with a byte count
        # beside it IS a denominator.
        progress = ip.DownloadProgress()
        done, total = progress.note_hook(hook(downloaded_bytes=250_000_000, fragment_index=88, fragment_count=352))
        self.assertEqual(done, 250_000_000)
        # 87 of 352 fragments finished, so about a quarter of roughly a gigabyte.
        self.assertGreater(total, 900_000_000)
        self.assertLess(total, 1_100_000_000)

    def test_a_merge_never_makes_the_count_fall_backwards(self):
        # `bv*+ba` fetches video and audio as separate files and
        # `downloaded_bytes` RESTARTS at zero for the second, so the customer
        # watched the megabytes climb to 400 and then drop to 30.
        progress = ip.DownloadProgress()
        progress.note_hook(hook(downloaded_bytes=400_000_000, total_bytes=400_000_000))
        progress.note_hook(hook(status="finished", downloaded_bytes=400_000_000, total_bytes=400_000_000))
        done, total = progress.note_hook(hook(downloaded_bytes=30_000_000, total_bytes=40_000_000))
        self.assertEqual(done, 430_000_000, "the finished file is banked, not forgotten")
        self.assertEqual(total, 440_000_000, "and so is its share of the denominator")

    def test_a_retry_does_not_carry_the_failed_attempt_forward(self):
        # `overwrites` means every attempt starts from an empty file. Without
        # the reset the counters reported 900 MB of a 400 MB video.
        progress = ip.DownloadProgress()
        progress.note_hook(hook(downloaded_bytes=400_000_000, total_bytes=900_000_000))
        progress.reset()
        self.assertEqual(progress.note_hook(hook(downloaded_bytes=10, total_bytes=900_000_000))[0], 10)

    def test_the_denominator_is_never_smaller_than_what_has_landed(self):
        # An estimate the real bytes overtake would otherwise pin the bar at
        # more than 100% -- or, once clamped, at 100% while the file arrives.
        progress = ip.DownloadProgress()
        progress.expect(100)
        done, total = progress.note_hook(hook(downloaded_bytes=500))
        self.assertEqual((done, total), (500, 500))

    def test_a_section_download_gets_its_denominator_from_the_metadata(self):
        # The path production takes for every ranged import. It downloads
        # through ffmpeg, which fires no hooks whatsoever, so the extractor's
        # own metadata is the ONLY place a denominator can come from.
        progress = ip.DownloadProgress()
        progress.expect(ip._info_expected_bytes({"duration": 1800.0, "filesize_approx": 900_000_000}, 180.0))
        done, total = progress.note_disk(9_000_000)
        self.assertEqual(done, 9_000_000)
        # A tenth of the video's length, so about a tenth of its size.
        self.assertEqual(total, 90_000_000)

    def test_a_bitrate_will_do_when_no_size_is_offered(self):
        # 1000 kbit/s over 120 seconds is 15 MB.
        self.assertEqual(ip._info_expected_bytes({"tbr": 1000.0}, 120.0), 15_000_000)

    def test_metadata_that_says_nothing_estimates_nothing(self):
        # An estimate invented from no evidence is worse than no estimate: it
        # would draw a confident percentage against a number nobody measured.
        self.assertEqual(ip._info_expected_bytes({}, 120.0), 0)
        self.assertEqual(ip._info_expected_bytes({"tbr": "?"}, 120.0), 0)
        self.assertEqual(ip._info_expected_bytes(None, 120.0), 0)

    def test_the_watcher_reports_through_the_tracker_so_a_section_has_a_total(self):
        # Proven end to end rather than by reading: the watcher used to hand the
        # pulse a bare zero for the total, which is where "0% of this step" on
        # every section download came from.
        import threading
        seen = []
        work = Path(ip.tempfile.mkdtemp()) if hasattr(ip, "tempfile") else None
        if work is None:
            import tempfile
            work = Path(tempfile.mkdtemp())
        (work / "source.mp4.part").write_bytes(b"x" * 4096)
        progress = ip.DownloadProgress()
        progress.expect(40_960)
        stop = threading.Event()

        def poll(done, total):
            seen.append((done, total))
            stop.set()
            return False

        ip._watch_download_bytes(work / "source.mp4", poll, stop, {"at": 0.0}, interval=0.01, progress=progress)
        self.assertEqual(seen, [(4096, 40_960)])


class PulseTests(unittest.TestCase):
    """The service turning those numbers into what the app renders."""

    def setUp(self):
        import importlib, os, shutil, tempfile
        self.temp = pathlib.Path(tempfile.mkdtemp())
        os.environ["WORKER_DATA_DIR"] = str(self.temp / "data")
        os.environ["WORKER_TEMP_DIR"] = str(self.temp / "tmp")
        os.environ["WORKER_SHARED_SECRET"] = "worker-test-secret-at-least-thirty-two-characters"
        sys.modules.pop("service", None)
        self.service = importlib.import_module("service")
        self._shutil = shutil

    def tearDown(self):
        self._shutil.rmtree(self.temp, ignore_errors=True)

    def _processor(self, job_id):
        store = self.service.JobStore()
        store.create({"id": job_id, "source": {"type": "youtube"}})
        return store, self.service.Processor(store)

    def test_a_download_with_no_total_still_reports_a_speed(self):
        # THE HEART OF THE REPORTED BUG. Every one of these fields used to be
        # gated on knowing the total, so a download without one reported bytes
        # climbing beside a percentage and an ETA that both sat still. The
        # speed is the one figure that is always available, and on a download
        # with no denominator it is the whole of the proof it is alive.
        store, processor = self._processor("job_nototal")
        pulse = processor.import_pulse("job_nototal")
        pulse(0, 0)
        # Past the write throttle as well as the rate-sampling gap: the first
        # call writes, so the second is only recorded once IMPORT_PROGRESS_SECONDS
        # has passed.
        time.sleep(self.service.IMPORT_PROGRESS_SECONDS + 0.1)
        pulse(5_000_000, 0)
        status = store.read("job_nototal")
        self.assertEqual(status["bytesDone"], 5_000_000)
        self.assertIsNone(status.get("bytesTotal"), "no total may be invented")
        self.assertGreater(status.get("bytesPerSec") or 0, 0, "but the speed is measured")

    def test_the_fraction_travels_exactly_rather_than_through_the_band(self):
        # The import owns five points of the global bar, so a fraction read
        # back off it can only ever be 0, 20, 40, 60, 80 or 100 per cent -- a
        # quarter-hour download would appear to advance five times.
        store, processor = self._processor("job_fraction")
        processor.import_pulse("job_fraction")(37, 100)
        self.assertAlmostEqual(store.read("job_fraction")["stageFraction"], 0.37, places=3)

    def test_the_eta_follows_the_current_speed_not_the_whole_run_average(self):
        # A whole-run average cannot notice the proxy pool handing over to a
        # faster exit, so it quotes the first slow minute for the whole import.
        store, processor = self._processor("job_eta")
        pulse = processor.import_pulse("job_eta")
        pulse(0, 10_000_000)
        time.sleep(1.05)
        pulse(1_000_000, 10_000_000)
        time.sleep(1.05)
        pulse(2_000_000, 10_000_000)
        time.sleep(1.05)
        pulse(3_000_000, 10_000_000)
        eta = store.read("job_eta").get("etaSec")
        self.assertIsNotNone(eta, "an ETA is reported once a rate is known")
        # ~1 MB/s with 7 MB left. Wide, because the sleeps are not exact and
        # what is being pinned is that it is derived from the rate at all.
        self.assertGreater(eta, 3)
        self.assertLess(eta, 25)

    def test_a_stale_eta_is_cleared_when_the_total_goes_away(self):
        # The app now believes the worker's own ETA for whatever phase reports
        # one, so an ETA left behind by a phase that could measure itself would
        # be counted down to a moment that had already passed.
        store, processor = self._processor("job_stale")
        pulse = processor.import_pulse("job_stale")
        pulse(0, 0)
        time.sleep(1.05)
        pulse(5_000_000, 10_000_000)
        time.sleep(1.05)
        pulse(6_000_000, 0)
        self.assertIsNone(store.read("job_stale").get("etaSec"))

    def test_progress_is_written_often_enough_to_read_as_moving(self):
        # At the old 15s the app polls the worker every 5s and the browser
        # repaints every 2s, so the megabyte count moved once per three or four
        # polls and everything on screen sat still in between.
        self.assertLessEqual(self.service.IMPORT_PROGRESS_SECONDS, 5,
                             "a progress bar is a different job from a liveness beat")
        self.assertGreaterEqual(self.service.IMPORT_PROGRESS_SECONDS, 1,
                                "and not so often that it thrashes the status file")


if __name__ == "__main__":
    unittest.main()
