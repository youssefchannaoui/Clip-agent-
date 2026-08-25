"""The import chain's fallback rule.

Two real jobs failed at the first provider with the local downloader untried:

    socialkit: Download failed: ERROR: [youtube] 8sB6qcPXAcE: This video is unavailable
    socialkit: SocialKit download timed out.

Neither string was in _BLOCK_SIGNS, so the chain stopped. These pin the rule
that lets the local downloader answer for itself.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


class StubProvider:
    def __init__(self, name, error=None):
        self.name = name
        self.error = error
        self.calls = 0

    def import_video(self, source, destination, cancelled):
        self.calls += 1
        if self.error:
            raise ip.ImportProviderError(self.error)
        return ip.ImportedSource(file=destination)


class ImportFallbackTests(unittest.TestCase):
    def run_chain(self, providers, source=None):
        source = source or {"type": "youtube", "url": "https://youtu.be/x"}
        original = ip.provider_chain
        ip.provider_chain = lambda *a, **k: providers
        try:
            return ip.import_with_fallback(source, Path("/tmp/out.mp4"), lambda: False, None)
        finally:
            ip.provider_chain = original

    def test_unavailable_from_a_managed_provider_still_tries_the_local_one(self):
        """The exact string that killed a real job."""
        managed = StubProvider("socialkit", "Download failed: ERROR: [youtube] 8sB6qcPXAcE: This video is unavailable")
        local = StubProvider("ytdlp")
        result = self.run_chain([managed, local])
        self.assertEqual(local.calls, 1, "the local downloader must get its turn")
        self.assertEqual(result.provider, "ytdlp")

    def test_a_timeout_still_tries_the_local_one(self):
        """The other real job. A timeout says nothing about the video."""
        managed = StubProvider("socialkit", "SocialKit download timed out.")
        local = StubProvider("ytdlp")
        self.run_chain([managed, local])
        self.assertEqual(local.calls, 1)

    def test_a_timeout_carries_on_even_with_no_local_provider_left(self):
        first = StubProvider("cobalt", "Download timed out.")
        second = StubProvider("socialkit")
        self.run_chain([first, second])
        self.assertEqual(second.calls, 1)

    def test_the_local_downloader_is_believed_when_it_is_last(self):
        """It ran on our own IP with PO tokens, so its verdict stands."""
        local = StubProvider("ytdlp", "This video is unavailable")
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_chain([local])
        self.assertIn("ytdlp", str(caught.exception))

    def test_every_provider_that_failed_is_named(self):
        managed = StubProvider("socialkit", "SocialKit download timed out.")
        local = StubProvider("ytdlp", "This video is unavailable")
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_chain([managed, local])
        trail = str(caught.exception)
        self.assertIn("socialkit", trail)
        self.assertIn("ytdlp", trail)
        self.assertIn("uploading the video file", trail, "a link import keeps its way through")

    def test_private_is_a_verdict_but_unavailable_is_not(self):
        """The distinction the whole rule turns on.

        "private" is an answer about the video and reads the same from any
        address. "unavailable" is what YouTube says to a blocked datacenter
        range, so from a managed provider it describes their IP, not the file.
        """
        local_after_private = StubProvider("ytdlp")
        with self.assertRaises(ip.ImportProviderError):
            self.run_chain([StubProvider("socialkit", "This video is private."), local_after_private])
        self.assertEqual(local_after_private.calls, 0, "no point asking again")

        local_after_unavailable = StubProvider("ytdlp")
        self.run_chain([StubProvider("socialkit", "This video is unavailable"), local_after_unavailable])
        self.assertEqual(local_after_unavailable.calls, 1, "our own IP may still get it")

    def test_cancellation_is_never_retried_as_a_failure(self):
        first = StubProvider("socialkit", "Job cancelled.")
        local = StubProvider("ytdlp")
        with self.assertRaises(ip.ImportProviderError):
            self.run_chain([first, local])
        self.assertEqual(local.calls, 0, "a cancelled job must not start another download")


if __name__ == "__main__":
    unittest.main()
