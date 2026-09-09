"""A YouTube refusal that clears on a retry must not cost a customer the import.

Youssef, 9 Sept 2026, on a lecture that failed and then imported on his own
retry: "I NEED TO RETRY THEN THE LECTURE WORKS." That is the whole argument.
The same URL, the same box, minutes apart, and the second attempt succeeds --
so the refusal is TRANSIENT, and the pipeline was asking a person to be its
retry loop at two in the morning.

The ten client/plan attempts all run inside a few seconds, so every one of
them asks YouTube the same question at the same instant. Whatever relaxes in
between needs TIME, and there was none anywhere in this path.
"""
import sys
import time
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


class FakeDownloadError(Exception):
    pass


class FakeYoutubeDL:
    """Fails a set number of ATTEMPTS, then writes a file and succeeds."""

    script: list = []        # one message per attempt; None means succeed
    attempts: list = []      # what each attempt was handed
    out: Path = Path()

    def __init__(self, options):
        self.options = options

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=True):
        index = len(FakeYoutubeDL.attempts)
        FakeYoutubeDL.attempts.append(self.options)
        message = FakeYoutubeDL.script[index] if index < len(FakeYoutubeDL.script) else None
        if message is not None:
            raise FakeDownloadError(message)
        FakeYoutubeDL.out.write_bytes(b"video")
        return {"title": "A lecture", "duration": 1920}

    def prepare_filename(self, info):
        return str(FakeYoutubeDL.out)


def fake_yt_dlp():
    module = types.ModuleType("yt_dlp")
    module.YoutubeDL = FakeYoutubeDL
    module.utils = types.SimpleNamespace(DownloadError=FakeDownloadError)
    module.version = types.SimpleNamespace(__version__="2026.09.09")
    return module


# The real refusal, verbatim off the box on 9 Sept 2026.
BLOCKED = "ERROR: unable to download video data: HTTP Error 403: Forbidden"
# A video that is genuinely gone answers the same way on every client, for ever.
GONE = "ERROR: [youtube] abc: Private video. Sign in if you've been granted access"
# What a client whose format set does not carry the selector answers. Verbatim
# from the box, run 34299748962, where it killed a fetchable import outright.
FORMAT = "ERROR: [youtube] abc: Requested format is not available. Use --list-formats for a list of available formats"
# The SECOND transient the box produced once the first was excused by name --
# which is what turned the rule from a list of exceptions into an inversion.
RELOAD = "ERROR: [youtube] abc: The page needs to be reloaded."


class RetryTests(unittest.TestCase):
    def setUp(self):
        self.saved_module = sys.modules.get("yt_dlp")
        sys.modules["yt_dlp"] = fake_yt_dlp()
        # Real waiting, tiny durations: the cancellable sleep is exercised
        # rather than stubbed, and the suite still runs in milliseconds.
        self.saved_backoff = ip.IMPORT_BACKOFF_SEC
        self.saved_rounds = ip.IMPORT_ROUNDS
        ip.IMPORT_BACKOFF_SEC = (0.01, 0.01)
        ip.IMPORT_ROUNDS = 3
        FakeYoutubeDL.attempts = []
        FakeYoutubeDL.script = []
        self.dir = TemporaryDirectory()
        FakeYoutubeDL.out = Path(self.dir.name) / "source.mp4"

    def tearDown(self):
        if self.saved_module is None:
            sys.modules.pop("yt_dlp", None)
        else:
            sys.modules["yt_dlp"] = self.saved_module
        ip.IMPORT_BACKOFF_SEC = self.saved_backoff
        ip.IMPORT_ROUNDS = self.saved_rounds
        self.dir.cleanup()

    def run_import(self, script, cancelled=None):
        FakeYoutubeDL.script = script
        provider = ip.YtDlpImportProvider()
        return provider.import_video(
            {"type": "youtube", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
            FakeYoutubeDL.out,
            cancelled or (lambda: False),
        )

    def test_a_refusal_that_clears_on_a_later_round_still_imports(self):
        """YOUSSEF'S CASE. One whole rotation refused; the next one works."""
        clients = len(ip.YOUTUBE_CLIENTS)
        result = self.run_import([BLOCKED] * clients + [None])
        self.assertTrue(result.file.is_file())
        self.assertGreater(len(FakeYoutubeDL.attempts), clients,
                           "it must try again after the first rotation is spent")

    def test_only_a_FINAL_failure_ends_the_rotation_early(self):
        """The rule, stated as the rule rather than as a list of exceptions.

        Naming transients one at a time lost twice in one evening -- a format
        fault, then "The page needs to be reloaded" -- so anything yt-dlp says
        that _looks_final does not recognise gets the rest of the rotation. An
        unknown message must never be read as a verdict on the video.
        """
        result = self.run_import(["ERROR: something nobody has seen before", None])
        self.assertTrue(result.file.is_file(),
                        "an unrecognised failure is not a verdict")

    def test_a_client_that_cannot_serve_the_format_does_not_kill_the_import(self):
        """FOUND ON THE BOX, 9 Sept 2026, by the injected-refusal probe.

        A rotation reached a client whose format set does not carry the
        selector, yt-dlp said "Requested format is not available", and the
        provider RAISED -- abandoning two whole rounds on a video the probe's
        own control had downloaded thirty seconds earlier. It is not a fact
        about the video, so the next client must get its turn.
        """
        result = self.run_import([BLOCKED, FORMAT, RELOAD, FORMAT, None])
        self.assertTrue(result.file.is_file())
        self.assertGreaterEqual(len(FakeYoutubeDL.attempts), 4,
                                "the rotation carries on past a format fault")

    def test_a_format_fault_is_never_dressed_as_a_verdict_on_the_video(self):
        """The wording matters as much as the control flow.

        "YouTube would not release this video" is what the app reads as
        permanent -- transientImport does not match it -- so a format fault
        wearing that sentence stops the five-minute auto-retry as well as the
        rounds. Every client failing this way must still read as a refusal
        that was tried and tried again.
        """
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_import([FORMAT, RELOAD] * 100)
        self.assertNotIn("would not release this video", str(caught.exception))
        self.assertGreater(len(FakeYoutubeDL.attempts), len(ip.YOUTUBE_CLIENTS),
                           "it spends its rounds rather than failing at once")

    def test_it_gives_up_eventually_rather_than_retrying_for_ever(self):
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_import([BLOCKED] * 200)
        # Bounded by the rounds, not by the customer's patience.
        self.assertLessEqual(len(FakeYoutubeDL.attempts),
                             ip.IMPORT_ROUNDS * len(ip.YOUTUBE_CLIENTS) * 2)
        self.assertIn("Attempts:", str(caught.exception))

    def test_a_video_that_is_GONE_refuses_at_once_and_never_waits(self):
        """The failure that will never change must not cost three rounds.

        A private, deleted or members-only video answers identically on every
        client in every round. Waiting through the backoff to arrive at the
        answer already in hand is the retry loop being worse than no retry.
        """
        with self.assertRaises(ip.ImportProviderError):
            self.run_import([GONE] * 200)
        self.assertEqual(len(FakeYoutubeDL.attempts), 1,
                         "one attempt is all a gone video is worth")

    def test_cancelling_is_noticed_during_the_wait_rather_than_after_it(self):
        """The app gives the worker slot back the moment it cancels, so a box
        asleep in a backoff holds it for a job nobody wants.

        MEASURED ON THE CLOCK, and the first version of this test could not
        fail. It asserted only that the error said "cancelled" -- which stays
        true with the in-loop check deleted, because the wait still reports the
        cancellation once it has finished sleeping. The whole value of that
        check is that the sleep ENDS EARLY, and only a stopwatch can see it.
        """
        ip.IMPORT_BACKOFF_SEC = (30.0, 30.0)   # never actually slept through
        # ONE plan here, not two: plans is [{}] unless a section was asked for,
        # so a round is len(YOUTUBE_CLIENTS) attempts. The first version of
        # this doubled it, never reached the threshold before the first wait,
        # and sat through the whole 30 seconds -- which is what exposed it.
        spent = len(ip.YOUTUBE_CLIENTS)

        started = time.monotonic()
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_import([BLOCKED] * 200,
                            cancelled=lambda: len(FakeYoutubeDL.attempts) >= spent)
        elapsed = time.monotonic() - started

        self.assertIn("cancel", str(caught.exception).lower())
        self.assertLess(elapsed, 5.0,
                        f"the 30s backoff was slept through ({elapsed:.1f}s) -- "
                        "a cancel during the wait is not being noticed")

    def test_every_attempt_asks_for_its_own_proxy(self):
        """Ten attempts down one burned exit is one attempt repeated.

        job_network_options is called per attempt so the pool is re-picked; a
        version that hoisted it out of the loop would send every retry through
        the address that had just been refused.
        """
        ip.os.environ["VIDEO_IMPORT_PROXIES"] = ",".join(
            f"http://user:pw@10.0.0.{n}:8080" for n in range(1, 21))
        try:
            with self.assertRaises(ip.ImportProviderError):
                self.run_import([BLOCKED] * 200)
        finally:
            ip.os.environ.pop("VIDEO_IMPORT_PROXIES", None)
        seen = {opts.get("proxy") for opts in FakeYoutubeDL.attempts}
        self.assertGreater(len(seen), 1, "the pool must actually rotate between attempts")

    def test_the_refusal_names_the_yt_dlp_version(self):
        """A stale extractor fails in exactly this shape, so the message says
        which one refused -- measured 9 Sept 2026 at three weeks old on a box
        rebuilt that morning."""
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_import([BLOCKED] * 200)
        self.assertIn("2026.09.09", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
