"""A retry adds to the clips a stopped run already made (v3.132.1).

Youssef cancelled a khutbah at 69% with four clips already rendered and two
approved. A retry re-runs the whole job under a new worker id, and the main
path never read `existingRanges` -- only the more-clips path did -- so the
re-run would have picked the same four moments again under new ids and the
queue would have shown them twice. The main path now removes the moments the
lecture already holds before scoring, and says so honestly when that leaves
nothing.
"""
from __future__ import annotations

import inspect
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
import clip_worker as cw  # noqa: E402


class RetryAddsTests(unittest.TestCase):
    def test_main_path_removes_existing_moments_before_scoring(self):
        # Order inside process() (the main path): candidates are built, the moments already
        # cut come OFF, then Ollama scores what is left -- asking the model to
        # rank moments that will be thrown away is a wasted generation on a
        # single-slot box.
        src = inspect.getsource(cw.process)
        built = src.index("filter_length_bands(build_candidates(")
        removed = src.index('remove_existing_moments(candidates, existing)')
        scored = src.index("refine_with_ollama(candidates, settings")
        self.assertTrue(built < removed < scored, (built, removed, scored))
        self.assertIn('job.get("existingRanges")', src[built:scored], "read off the job, like the more-clips path")

    def test_a_retry_with_nothing_left_says_so(self):
        # The sentence names the count, and names the two honest next steps
        # rather than blaming the duration range the old message blamed.
        reason = cw.nothing_new_reason([{"id": "a", "startSec": 0, "endSec": 45}, {"id": "b", "startSec": 60, "endSec": 100}])
        self.assertIn("2 clips", reason)
        self.assertIn("already in your library", reason)
        self.assertIn("cut more clips", reason)
        self.assertNotIn("duration range", reason)
        self.assertIn("1 clip)", cw.nothing_new_reason([{"id": "a", "startSec": 0, "endSec": 45}]))

    def test_remove_existing_moments_is_a_no_op_on_a_first_run(self):
        cands = [cw.Candidate(start=0.0, end=45.0, text="a", segments=[], score=0, reasons=[], quote_risk=False), cw.Candidate(start=60.0, end=100.0, text="b", segments=[], score=0, reasons=[], quote_risk=False)]
        self.assertEqual(cw.remove_existing_moments(cands, []), cands)
        kept = cw.remove_existing_moments(cands, [{"id": "k", "startSec": 0, "endSec": 45}])
        self.assertEqual([c.start for c in kept], [60.0], "the moment already cut is gone, the other stays")


if __name__ == "__main__":
    unittest.main()
