"""The queue-time warm-up for the hosted import.

The import service takes 30+ minutes on a long lecture's first fetch and caches
the result, so the fetch clock should start when a job is queued, not when a
worker slot opens. These pin the warm-up's manners: one submit per URL, nothing
for uploads or junk, and silence on failure -- the real import reports errors.
"""
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


class PrewarmTests(unittest.TestCase):
    def setUp(self):
        ip._PREWARMED.clear()
        self.calls = []
        self.done = threading.Event()

        calls, done = self.calls, self.done

        def record(self_provider, url, method="GET"):
            calls.append((url, method))
            done.set()
            return {"data": {"jobId": "warm-1", "status": "queued"}}

        self.orig_call = ip.SocialKitImportProvider._call
        ip.SocialKitImportProvider._call = record
        self.orig_key = ip.os.environ.get("VIDEO_IMPORT_API_KEY")
        ip.os.environ["VIDEO_IMPORT_API_KEY"] = "warm-test-key"

    def tearDown(self):
        ip.SocialKitImportProvider._call = self.orig_call
        if self.orig_key is None:
            ip.os.environ.pop("VIDEO_IMPORT_API_KEY", None)
        else:
            ip.os.environ["VIDEO_IMPORT_API_KEY"] = self.orig_key
        ip._PREWARMED.clear()

    def test_a_youtube_job_fires_one_download_submit(self):
        ip.prewarm_hosted_import({"type": "youtube", "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa"})
        self.assertTrue(self.done.wait(5), "the submit thread never ran")
        self.assertEqual(len(self.calls), 1)
        url, method = self.calls[0]
        self.assertEqual(method, "POST")
        self.assertIn("/v2/youtube/download", url)

    def test_the_same_url_is_warmed_once_not_per_glance(self):
        source = {"type": "youtube", "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa"}
        ip.prewarm_hosted_import(source)
        self.assertTrue(self.done.wait(5))
        ip.prewarm_hosted_import(source)
        ip.prewarm_hosted_import(source)
        time.sleep(0.3)
        self.assertEqual(len(self.calls), 1, "a queued job is warmed once")

    def test_uploads_and_junk_are_left_alone(self):
        ip.prewarm_hosted_import({"type": "object_storage", "key": "u/lecture.mp4"})
        ip.prewarm_hosted_import({"type": "youtube", "url": "not a url"})
        ip.prewarm_hosted_import({})
        ip.prewarm_hosted_import(None)
        time.sleep(0.3)
        self.assertEqual(self.calls, [], "nothing to fetch, nothing submitted")

    def test_a_failing_submit_is_silent(self):
        def explode(self_provider, url, method="GET"):
            self.done.set()
            raise ip.ImportProviderError("service down")

        ip.SocialKitImportProvider._call = explode
        # Must not raise -- the warm-up is opportunistic.
        ip.prewarm_hosted_import({"type": "youtube", "url": "https://www.youtube.com/watch?v=bbbbbbbbbbb"})
        self.assertTrue(self.done.wait(5))


if __name__ == "__main__":
    unittest.main()
