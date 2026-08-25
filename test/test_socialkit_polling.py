"""SocialKit's poll loop.

SocialKit downloads on its own infrastructure, which is why it works from an IP
YouTube blocks -- and it is currently the only working YouTube path, so its
reliability is the product's reliability. A thirty-minute wait is roughly 360
polls, and one failure used to discard the lot.
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


class PollingTests(unittest.TestCase):
    def make(self):
        with mock.patch.dict("os.environ", {"SOCIALKIT_API_KEY": "k", "SOCIALKIT_POLL_SECONDS": "2"}):
            provider = ip.SocialKitImportProvider()
        provider.poll_seconds = 0  # the tests are about the sequence, not the wait
        return provider

    def drive(self, provider, answers, destination=None):
        """Run import_video with _call returning/raising the given answers."""
        calls = {"n": 0}

        def fake_call(url, method="GET"):
            index = calls["n"]
            calls["n"] += 1
            answer = answers[min(index, len(answers) - 1)]
            if isinstance(answer, Exception):
                raise answer
            return answer

        provider._call = fake_call
        with mock.patch.object(ip, "assert_public_https_url", side_effect=lambda u, h: u), \
             mock.patch.object(ip, "download_https", return_value=None):
            result = provider.import_video(
                {"type": "youtube", "url": "https://www.youtube.com/watch?v=abcdefghijk"},
                destination or Path("/tmp/out.mp4"),
                lambda: False,
            )
        return result, calls["n"]

    SUBMIT = {"data": {"jobId": "j1"}}
    READY = {"data": {"status": "ready", "downloadUrl": "https://x.socialkit.dev/f.mp4", "title": "Lecture"}}

    def test_a_ready_job_is_not_made_to_wait_first(self):
        """It used to sleep the poll interval before asking even once, so every
        import paid the interval whether or not it was already done."""
        provider = self.make()
        provider.poll_seconds = 5
        slept = []
        with mock.patch.object(ip.time, "sleep", side_effect=slept.append):
            result, calls = self.drive(provider, [self.SUBMIT, self.READY])
        self.assertEqual(result.title, "Lecture")
        self.assertEqual(calls, 2, "submit, then one poll")
        self.assertEqual(slept, [], "nothing should have been slept before the first poll")

    def test_a_job_that_is_not_ready_yet_does_wait_between_polls(self):
        """The other half: it must not spin the API as fast as it can."""
        provider = self.make()
        provider.poll_seconds = 5
        working = {"data": {"status": "processing"}}
        slept = []
        with mock.patch.object(ip.time, "sleep", side_effect=slept.append):
            self.drive(provider, [self.SUBMIT, working, working, self.READY])
        self.assertEqual(slept, [5, 5], "one wait between each pair of polls")

    def test_a_transient_poll_failure_does_not_discard_the_download(self):
        blip = ip.ImportProviderError("SocialKit request timed out.", retryable=True)
        result, _ = self.drive(self.make(), [self.SUBMIT, blip, blip, self.READY])
        self.assertEqual(result.title, "Lecture")

    def test_a_five_hundred_is_treated_as_transient(self):
        blip = ip.ImportProviderError("HTTP 503", retryable=True)
        result, _ = self.drive(self.make(), [self.SUBMIT, blip, self.READY])
        self.assertEqual(result.title, "Lecture")

    def test_a_four_hundred_stops_at_once(self):
        """A bad key is an answer. Asking again only makes someone wait."""
        refused = ip.ImportProviderError("SocialKit request failed with HTTP 401: bad key", retryable=False)
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.drive(self.make(), [self.SUBMIT, refused])
        self.assertIn("401", str(caught.exception))

    def test_endless_blips_still_give_up(self):
        blip = ip.ImportProviderError("SocialKit request timed out.", retryable=True)
        with self.assertRaises(ip.ImportProviderError):
            self.drive(self.make(), [self.SUBMIT, blip])

    def test_a_failed_job_is_reported_not_retried(self):
        failed = {"data": {"status": "failed", "error": "source removed"}}
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.drive(self.make(), [self.SUBMIT, failed])
        self.assertIn("source removed", str(caught.exception))

    def test_the_api_key_never_reaches_the_error_text(self):
        """The trail is shown to operators and, after the rewrite, customers."""
        refused = ip.ImportProviderError("SocialKit request failed with HTTP 401: nope", retryable=False)
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.drive(self.make(), [self.SUBMIT, refused])
        self.assertNotIn("access_key", str(caught.exception))


class RetryableFlagTests(unittest.TestCase):
    def test_the_default_is_not_retryable(self):
        """Anything that forgets to say must be treated as an answer."""
        self.assertFalse(ip.ImportProviderError("plain").retryable)


if __name__ == "__main__":
    unittest.main()
