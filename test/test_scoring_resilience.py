"""AI scoring, when the model answers badly.

The blend is score*0.45 + ai*0.55, so a half-applied batch ranks some clips on
one scale and the rest on another. That decides which clips a customer is shown,
and it used to happen silently whenever the model hiccuped once.
"""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw


class FakeResponse:
    def __init__(self, payload):
        self._payload = json.dumps({"response": json.dumps(payload)}).encode()

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def candidate(index, score):
    return cw.Candidate(
        start=index * 10.0, end=index * 10.0 + 30.0, text=f"clip {index}",
        segments=[], score=score, reasons=[], quote_risk=False,
    )


class ScoringResilienceTests(unittest.TestCase):
    def score(self, rows, candidates):
        with mock.patch.object(cw.urllib.request, "urlopen", return_value=FakeResponse({"clips": rows})), \
             mock.patch.object(cw, "emit"):
            return cw.refine_with_ollama(candidates, {"ollamaUrl": "http://ollama:11434"})

    def test_a_good_batch_blends_every_candidate(self):
        cands = [candidate(0, 50), candidate(1, 50)]
        self.score([{"index": 0, "score": 100}, {"index": 1, "score": 0}], cands)
        self.assertEqual(cands[0].score, 78)   # 50*0.45 + 100*0.55
        self.assertEqual(cands[1].score, 22)   # 50*0.45 +   0*0.55

    def test_one_unparseable_row_does_not_discard_the_others(self):
        """It used to raise out of the whole function on the bad row."""
        cands = [candidate(0, 50), candidate(1, 50)]
        self.score([{"index": 0, "score": 100}, {"index": "?", "score": 90}], cands)
        self.assertEqual(cands[0].score, 78, "the good row still applied")

    def test_a_non_numeric_score_is_skipped_not_fatal(self):
        cands = [candidate(0, 50), candidate(1, 50)]
        self.score([{"index": 0, "score": "high"}, {"index": 1, "score": 100}], cands)
        self.assertEqual(cands[0].score, 50, "left on its built-in score")
        self.assertEqual(cands[1].score, 78)

    def test_a_repeated_index_is_applied_once(self):
        """The blend is not idempotent; repeating dragged the score further."""
        cands = [candidate(0, 50)]
        self.score([{"index": 0, "score": 100}, {"index": 0, "score": 100}], cands)
        self.assertEqual(cands[0].score, 78, "not 90-something from a second blend")

    def test_an_out_of_range_index_is_ignored(self):
        cands = [candidate(0, 50)]
        self.score([{"index": 99, "score": 100}], cands)
        self.assertEqual(cands[0].score, 50)

    def test_rubbish_instead_of_rows_leaves_every_score_alone(self):
        cands = [candidate(0, 50), candidate(1, 60)]
        self.score(["not-a-dict", 42, None], cands)
        self.assertEqual([c.score for c in cands], [50, 60])

    def test_a_partial_batch_is_announced(self):
        cands = [candidate(0, 50), candidate(1, 50)]
        with mock.patch.object(cw.urllib.request, "urlopen",
                               return_value=FakeResponse({"clips": [{"index": 0, "score": 100}]})), \
             mock.patch.object(cw, "emit") as emitted:
            cw.refine_with_ollama(cands, {"ollamaUrl": "http://ollama:11434"})
        codes = [c.kwargs.get("code") for c in emitted.call_args_list]
        self.assertIn("ollama_partial_scoring", codes)

    def test_a_completely_unusable_answer_is_announced(self):
        cands = [candidate(0, 50)]
        with mock.patch.object(cw.urllib.request, "urlopen",
                               return_value=FakeResponse({"clips": [{"index": 99}]})), \
             mock.patch.object(cw, "emit") as emitted:
            cw.refine_with_ollama(cands, {"ollamaUrl": "http://ollama:11434"})
        codes = [c.kwargs.get("code") for c in emitted.call_args_list]
        self.assertIn("ollama_no_usable_rows", codes)


if __name__ == "__main__":
    unittest.main()
