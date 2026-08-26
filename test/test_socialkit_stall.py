"""A hosted provider that accepts a job and never starts delivering it.

On 26 Aug 2026 every YouTube import failed this way. SocialKit returned a jobId
instantly, reported "processing" forever, and the chain waited the full 30-minute
VIDEO_IMPORT_TIMEOUT_MS before trying anything else -- so a customer watched a
motionless 3% for half an hour, with no field in the job saying what the wait was
for, and only then learned it had failed.

Two properties are pinned here: the wait is bounded well short of the download
budget, and it is retryable, because a provider stuck before it ever starts is
exactly the case the local downloader exists to answer.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


class SocialKitStallTests(unittest.TestCase):
    def setUp(self):
        self.provider = ip.SocialKitImportProvider()
        self.provider.api_key = "test-key"
        self.provider.base = "https://api.example.test"
        self.provider.poll_seconds = 2
        self.provider.timeout = 1800

        self.clock = [0.0]
        self.real_monotonic = ip.time.monotonic
        self.real_sleep = ip.time.sleep
        ip.time.monotonic = lambda: self.clock[0]
        ip.time.sleep = lambda seconds: self.clock.__setitem__(0, self.clock[0] + seconds)

    def tearDown(self):
        ip.time.monotonic = self.real_monotonic
        ip.time.sleep = self.real_sleep

    def _stub(self, status):
        def call(url, method="GET"):
            if method == "POST":
                return {"data": {"jobId": "job-1", "status": "queued"}}
            return {"data": {"jobId": "job-1", "status": status}}
        return call

    def test_a_provider_that_never_starts_gives_up_well_before_the_download_budget(self):
        self.provider._call = self._stub("processing")
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.provider.import_video(
                {"url": "https://www.youtube.com/watch?v=aaaaaaaaaaa"},
                Path("/tmp/unused.mp4"),
                lambda **_: False,
            )
        # Bounded by the stall window, and it does end rather than running to
        # the hard import timeout.
        self.assertLess(self.clock[0], self.provider.timeout)
        self.assertLessEqual(self.clock[0], ip._SOCIALKIT_STALL_SECONDS + self.provider.poll_seconds)
        # Retryable: the local downloader must still get its turn.
        self.assertTrue(getattr(caught.exception, "retryable", False))
        self.assertIn("never started delivering", str(caught.exception))

    def test_the_wait_is_reported_so_it_is_not_a_motionless_three_percent(self):
        notes = []

        def cancelled(note=""):
            notes.append(note)
            return False

        self.provider._call = self._stub("processing")
        with self.assertRaises(ip.ImportProviderError):
            self.provider.import_video(
                {"url": "https://www.youtube.com/watch?v=aaaaaaaaaaa"},
                Path("/tmp/unused.mp4"),
                cancelled,
            )
        # The bare cancellation checks carry no note; only the phase reports do.
        spoken = [n for n in notes if n]
        self.assertTrue(spoken, "the customer was told nothing while waiting")
        self.assertIn("processing", spoken[0])
        # The elapsed time travels too, so a long wait reads as a wait.
        self.assertRegex(spoken[-1], r"\d+m \d\ds|\d+s")

    def test_a_callback_that_takes_no_arguments_still_works(self):
        # Every existing provider and test passes a bare lambda; offering the
        # note must never become a requirement.
        self.provider._call = self._stub("processing")
        with self.assertRaises(ip.ImportProviderError):
            self.provider.import_video(
                {"url": "https://www.youtube.com/watch?v=aaaaaaaaaaa"},
                Path("/tmp/unused.mp4"),
                lambda: False,
            )


    def test_the_stall_window_leaves_room_for_a_slow_first_fetch(self):
        """The bound is a stuck-detector, not an impatience timer.

        Measured on 26 Aug 2026: SocialKit needs well over half an hour to fetch
        a 53-minute lecture the first time -- the customer's own job ran 1805s
        without finishing. An earlier version of this file set the window to
        480s, which would have turned every slow first import of a long lecture
        into a failure. That is worse than the bug it was written for, so the
        floor is pinned here rather than left to whoever next edits the default.
        """
        self.assertGreaterEqual(
            ip._SOCIALKIT_STALL_SECONDS, 1200,
            "a long lecture's first fetch must not be mistaken for a stuck vendor",
        )
        # Still short of the hard import timeout, or it would never fire.
        budget = max(60, int(__import__("os").getenv("VIDEO_IMPORT_TIMEOUT_MS", "1800000")) // 1000)
        self.assertLess(ip._SOCIALKIT_STALL_SECONDS, budget)

if __name__ == "__main__":
    unittest.main()
