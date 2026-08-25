"""The caches, with more than one job running.

capacity.py now sizes concurrency from the machine, so a bigger box runs
several jobs at once. Both caches were written for one. These pin the two races
that opened up, and both are written as real concurrent runs rather than as
assertions about the source.
"""
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw


class TranscriptCacheConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.job = {"transcriptCacheDir": self.dir, "sourceCacheKey": "src", "settings": {}}

    def test_many_writers_leave_one_readable_entry(self):
        """A direct write let two jobs' bytes interleave into unparseable JSON."""
        big = [{"start": 0.0, "end": 1.0, "text": "x" * 4000, "words": []}]
        errors = []

        def write(n):
            try:
                cw.transcript_cache_store(self.job, 0.0, 30.0, [{**big[0], "text": f"{n}" * 4000}])
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=write, args=(i,)) for i in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        loaded = cw.transcript_cache_lookup(self.job, 0.0, 30.0)
        self.assertIsNotNone(loaded, "the entry must still parse after concurrent writes")
        self.assertEqual(len(loaded), 1)

    def test_no_scratch_files_are_left_behind(self):
        cw.transcript_cache_store(self.job, 0.0, 30.0, [{"start": 0.0, "end": 1.0, "text": "hi", "words": []}])
        leftovers = [p.name for p in Path(self.dir).iterdir() if p.name.startswith(".")]
        self.assertEqual(leftovers, [], "the scratch file must be renamed, not abandoned")


class SourceCacheConcurrencyTests(unittest.TestCase):
    """The nastier of the two.

    The scratch name was derived from the cache key alone, so two jobs caching
    the same source chose it at the same instant. os.link makes that name a
    hardlink to the caller's own source file, so the second job's fallback copy
    wrote through it and truncated the first job's in-flight source.
    """

    def setUp(self):
        import importlib
        self.root = tempfile.mkdtemp()
        os.environ["WORKER_DATA_DIR"] = self.root
        self.service = importlib.reload(importlib.import_module("service"))

    def tearDown(self):
        os.environ.pop("WORKER_DATA_DIR", None)

    def test_a_second_writer_cannot_truncate_the_first_jobs_source(self):
        sources = []
        for name, payload in (("a", b"A" * 20000), ("b", b"B" * 20000)):
            f = Path(self.root) / f"{name}.mp4"
            f.write_bytes(payload)
            sources.append(f)

        threads = [
            threading.Thread(target=self.service.source_cache_store, args=("samekey", src))
            for src in sources
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Each job's own source must be exactly as it was handed over.
        self.assertEqual(sources[0].read_bytes(), b"A" * 20000, "job A's source was written through")
        self.assertEqual(sources[1].read_bytes(), b"B" * 20000, "job B's source was written through")

        cached = self.service.source_cache_lookup("samekey")
        self.assertIsNotNone(cached)
        self.assertIn(cached.read_bytes(), (b"A" * 20000, b"B" * 20000), "the cache holds one whole source")

    def test_no_scratch_files_survive(self):
        f = Path(self.root) / "one.mp4"
        f.write_bytes(b"Z" * 1000)
        self.service.source_cache_store("k", f)
        leftovers = [p.name for p in self.service.SOURCE_CACHE_DIR.iterdir() if p.name.startswith(".")]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
