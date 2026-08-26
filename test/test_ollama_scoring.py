"""The scoring model's answer is read for content, not for wrapper shape.

A real production call (26 Aug 2026) answered with valid JSON that was not
{"clips": [...]}, and the entire batch fell back to built-in scoring. The
model was right about the clips and wrong about the envelope; only the
envelope was checked.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

from clip_worker import ollama_clip_rows


ROW = {"index": 0, "score": 90, "title": "T", "description": "D", "reason": "R"}


class OllamaClipRowsTests(unittest.TestCase):
    def test_the_asked_for_shape(self):
        self.assertEqual(ollama_clip_rows({"clips": [ROW]}), [ROW])

    def test_a_top_level_list_is_the_same_answer_without_the_wrapper(self):
        self.assertEqual(ollama_clip_rows([ROW, ROW]), [ROW, ROW])

    def test_a_single_row_under_clips_is_a_list_of_one(self):
        self.assertEqual(ollama_clip_rows({"clips": ROW}), [ROW])

    def test_a_bare_row_is_a_list_of_one(self):
        self.assertEqual(ollama_clip_rows(ROW), [ROW])

    def test_answers_that_are_not_rows_stay_refused(self):
        # The per-row guards downstream tolerate junk inside a list, but an
        # answer with no rows at all must still fall back loudly.
        self.assertIsNone(ollama_clip_rows({"ok": True}))
        self.assertIsNone(ollama_clip_rows({}))
        self.assertIsNone(ollama_clip_rows("clips"))
        self.assertIsNone(ollama_clip_rows(None))
        self.assertIsNone(ollama_clip_rows(42))


if __name__ == "__main__":
    unittest.main()
