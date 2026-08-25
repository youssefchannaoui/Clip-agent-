"""The first Whisper pass must transcribe, never translate.

`translate` returns English whatever was spoken. On an Arabic lecture that
loses the Arabic line that belongs on screen, leaves the ayah matcher searching
the Quran in English -- which matches nothing, taking the medallion and the
verse translation with it -- and stops the second, genuinely translating pass
from ever running, because it only fires when the first pass was `transcribe`.

Both places that read the default said `translate`. The web app happens to send
`transcribe` on every job, so it never fired. These stop it waiting.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw


class WhisperDefaultTests(unittest.TestCase):
    def test_the_first_pass_defaults_to_transcribe(self):
        self.assertEqual(cw.DEFAULT_WHISPER_TASK, "transcribe")

    def test_the_cache_key_records_the_task_that_actually_ran(self):
        """A cache filed under a task the run did not perform serves the wrong
        transcript back -- English for an Arabic clip, or the reverse."""
        job = {
            "transcriptCacheDir": "/tmp/tcache",
            "sourceCacheKey": "abc123",
            "settings": {},
        }
        path = cw.transcript_cache_path(job, 0.0, 30.0)
        self.assertIsNotNone(path)
        self.assertIn("transcribe", path.name)
        self.assertNotIn("translate", path.name)

    def test_an_explicit_task_still_reaches_the_cache_key(self):
        job = {
            "transcriptCacheDir": "/tmp/tcache",
            "sourceCacheKey": "abc123",
            "settings": {"task": "translate"},
        }
        self.assertIn("translate", cw.transcript_cache_path(job, 0.0, 30.0).name)

    def test_two_tasks_never_share_a_cache_entry(self):
        base = {"transcriptCacheDir": "/tmp/tcache", "sourceCacheKey": "abc123"}
        transcribed = cw.transcript_cache_path({**base, "settings": {"task": "transcribe"}}, 0.0, 30.0)
        translated = cw.transcript_cache_path({**base, "settings": {"task": "translate"}}, 0.0, 30.0)
        self.assertNotEqual(transcribed, translated)

    def test_two_models_never_share_a_cache_entry(self):
        base = {"transcriptCacheDir": "/tmp/tcache", "sourceCacheKey": "abc123"}
        small = cw.transcript_cache_path({**base, "settings": {"model": "small"}}, 0.0, 30.0)
        large = cw.transcript_cache_path({**base, "settings": {"model": "large-v3"}}, 0.0, 30.0)
        self.assertNotEqual(small, large, "a bigger box must not read the small model's cache")

    def test_the_default_model_matches_between_the_two_readers(self):
        """The cache key and the transcriber must agree on what "unset" means."""
        base = {"transcriptCacheDir": "/tmp/tcache", "sourceCacheKey": "abc123"}
        implicit = cw.transcript_cache_path({**base, "settings": {}}, 0.0, 30.0)
        explicit = cw.transcript_cache_path(
            {**base, "settings": {"model": cw.DEFAULT_WHISPER_MODEL, "task": cw.DEFAULT_WHISPER_TASK}}, 0.0, 30.0
        )
        self.assertEqual(implicit, explicit)


if __name__ == "__main__":
    unittest.main()
