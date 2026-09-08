"""The BOX wins over the job payload for hardware settings (8 Sept 2026).

The bug this file exists for: the worker box was configured for `medium` and
every real job transcribed with `small`, silently, for a fortnight -- a green
suite and a green deploy log throughout. clip_worker read `settings["model"]`
first and never read WHISPER_MODEL at all, so service.py's own CAPACITY choice,
which it had already put into this child's environment, was overruled by a
figure the web app guessed on hardware it has never seen.

Everything here is EXECUTED: the model the transcriber was actually constructed
with, the filename the cache key actually produced, the JSON body actually
posted to Ollama. A test that only called whisper_settings would go on passing
the day one of its two callers stopped calling it -- and a transcript filed
under the wrong model is the EXPENSIVE half of this bug, because a `medium`
transcript filed under `small` is then served back to a later `small` job.
"""
from __future__ import annotations

import io
import json
import os
import sys
import types
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
import clip_worker as cw  # noqa: E402

# Every variable the box puts into this child's environment. A test that left
# one set would decide the answer for every test after it.
ENV_KEYS = ("WHISPER_MODEL", "WHISPER_DEVICE", "WHISPER_COMPUTE_TYPE",
            "WHISPER_CPU_THREADS", "OLLAMA_MODEL")


class _Seg:
    def __init__(self, start, end, text="words"):
        self.start, self.end, self.text, self.words = start, end, text, []
        self.no_speech_prob, self.avg_logprob = 0.1, -0.3


class _Info:
    language = "en"
    language_probability = 0.99


class RecordingWhisper:
    """Records how the transcriber was CONSTRUCTED, which is the whole point.

    The old bug is invisible in the transcript: `small` and `medium` both come
    back with segments. It is only visible in the arguments.
    """

    built: list[dict] = []

    def __init__(self, model_name, device=None, compute_type=None, **kwargs):
        RecordingWhisper.built.append(
            {"model": model_name, "device": device, "computeType": compute_type, **kwargs}
        )

    def transcribe(self, path, **options):
        # Reaches the end of the file, so second_listen never runs and cannot
        # add a second construction to the record.
        return iter([_Seg(0.0, 95.0)]), _Info()


class EnvSettingsBase(unittest.TestCase):
    def setUp(self):
        self._saved = {key: os.environ.pop(key, None) for key in ENV_KEYS}
        RecordingWhisper.built = []
        module = types.ModuleType("faster_whisper")
        module.WhisperModel = RecordingWhisper
        sys.modules["faster_whisper"] = module

    def tearDown(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def job(self, **settings):
        return {"settings": {"task": "transcribe", **settings},
                "transcriptCacheDir": "/tmp/tcache", "sourceCacheKey": "abc123"}

    def transcribe(self, job, duration=100.0):
        """Drive the real transcriber; return the model it was built with."""
        with redirect_stdout(io.StringIO()):
            cw._transcribe_with_faster_whisper(job, Path("/tmp/nothing.wav"), duration)
        self.assertEqual(len(RecordingWhisper.built), 1, "one construction per run")
        return RecordingWhisper.built[-1]


class WhisperResolutionTests(EnvSettingsBase):
    def test_the_box_wins_over_the_payload(self):
        os.environ.update({"WHISPER_MODEL": "medium", "WHISPER_DEVICE": "cuda",
                           "WHISPER_COMPUTE_TYPE": "float16"})
        settings = {"model": "small", "device": "cpu", "computeType": "int8"}
        self.assertEqual(cw.whisper_settings(settings), ("medium", "cuda", "float16"))

    def test_the_payload_is_the_fallback_for_the_self_hosted_engine(self):
        """It spawns clip_worker directly and sets no such environment."""
        settings = {"model": "large-v3", "device": "cpu", "computeType": "int8"}
        self.assertEqual(cw.whisper_settings(settings), ("large-v3", "cpu", "int8"))

    def test_neither_set_resolves_exactly_as_it_did_before(self):
        self.assertEqual(cw.whisper_settings({}),
                         (cw.DEFAULT_WHISPER_MODEL, "auto", "int8"))

    def test_a_blank_variable_is_not_an_answer(self):
        """A variable set to "" is an operator who never answered.

        Read literally it would transcribe with a model called "", which fails
        at load time on a box that looks correctly configured.
        """
        os.environ["WHISPER_MODEL"] = "   "
        self.assertEqual(cw.whisper_settings({"model": "small"})[0], "small")

    # ── the bug, driven end to end ──

    def test_the_transcriber_uses_the_boxs_model_not_the_payloads(self):
        """This is the production failure, reproduced.

        The payload says small (config.aiModel's default, which nothing on
        Render overrides) and the box says medium. Every job took the payload.
        """
        os.environ["WHISPER_MODEL"] = "medium"
        built = self.transcribe(self.job(model="small", device="cpu", computeType="int8"))
        self.assertEqual(built["model"], "medium")

    def test_the_cache_key_is_filed_under_the_model_that_actually_RAN(self):
        """Drive BOTH readers and compare them, never one function's name.

        Two readers of "which model is this", disagreeing, is worse than the
        bug they came from: the transcriber does `medium` work and the key
        says `small`, so the next `small` job on the same source is served a
        medium transcript and nothing anywhere says so.
        """
        os.environ["WHISPER_MODEL"] = "medium"
        job = self.job(model="small")
        built = self.transcribe(job)
        cache = cw.transcript_cache_path(job, 0.0, 30.0)
        self.assertIsNotNone(cache)
        self.assertIn(built["model"], cache.name,
                      "the cache entry names the model the transcriber was built with")
        self.assertNotIn("small", cache.name, "the payload's model must not name the entry")

    def test_two_boxes_never_share_a_cache_entry(self):
        job = self.job(model="small")
        os.environ["WHISPER_MODEL"] = "medium"
        on_medium = cw.transcript_cache_path(job, 0.0, 30.0)
        os.environ["WHISPER_MODEL"] = "small"
        on_small = cw.transcript_cache_path(job, 0.0, 30.0)
        self.assertNotEqual(on_medium, on_small)

    def test_the_same_resolved_model_is_the_same_entry_whichever_side_said_it(self):
        """One source of truth, so a cache hit follows the WORK, not the road.

        A box forcing medium and a self-hosted engine asking for medium did
        identical work; filing them apart would transcribe twice for nothing.
        """
        os.environ["WHISPER_MODEL"] = "medium"
        from_box = cw.transcript_cache_path(self.job(model="small"), 0.0, 30.0)
        os.environ.pop("WHISPER_MODEL")
        from_payload = cw.transcript_cache_path(self.job(model="medium"), 0.0, 30.0)
        self.assertEqual(from_box, from_payload)


class WhisperCpuThreadTests(EnvSettingsBase):
    """Told nothing, ctranslate2 sizes its pool from every core it can see.

    Free while the box ran one job at a time; threefold oversubscription
    against ffmpeg's own capped threads now that CAPACITY allows three.
    """

    def test_the_boxs_share_reaches_the_transcriber(self):
        os.environ["WHISPER_CPU_THREADS"] = "3"
        self.assertEqual(self.transcribe(self.job())["cpu_threads"], 3)

    def test_unset_leaves_the_library_deciding_exactly_as_before(self):
        built = self.transcribe(self.job())
        self.assertNotIn("cpu_threads", built,
                         "the self-hosted engine sets no such variable and must not be capped at a guess")

    def test_rubbish_is_ignored_rather_than_capping_the_box_at_nothing(self):
        for value in ("", "   ", "0", "-4", "two"):
            with self.subTest(value=value):
                os.environ["WHISPER_CPU_THREADS"] = value
                RecordingWhisper.built = []
                self.assertNotIn("cpu_threads", self.transcribe(self.job()))


class OllamaModelTests(EnvSettingsBase):
    """The same rule for the scoring model, and the same reason.

    A model too big for the container is an OOM kill mid-job, not a slow
    answer: llama-server was killed 42 times on the old box at 2.4-3.0G under a
    2G cap. The box knows its own RAM; the web service does not.
    """

    def posted_model(self, settings):
        """The `model` field in the body actually POSTED to /api/generate."""
        bodies: list[dict] = []

        def stub(request, timeout=None):
            bodies.append(json.loads(request.data.decode("utf-8")))
            raise urllib.error.URLError("stubbed: the body is what is under test")

        candidate = cw.Candidate(start=0.0, end=40.0, text="a reminder about mercy",
                                 segments=[], score=70, reasons=[], quote_risk=False)
        with mock.patch.object(urllib.request, "urlopen", stub), redirect_stdout(io.StringIO()):
            cw.refine_with_ollama([candidate], {"ollamaUrl": "http://ollama.test", **settings}, "A lecture")
        self.assertEqual(len(bodies), 1, "one batch, one request")
        return bodies[0]["model"]

    def test_the_box_wins_over_the_payload(self):
        os.environ["OLLAMA_MODEL"] = "qwen3:4b"
        self.assertEqual(self.posted_model({"ollamaModel": "qwen3:1.7b"}), "qwen3:4b")

    def test_the_payload_is_the_fallback(self):
        self.assertEqual(self.posted_model({"ollamaModel": "qwen3:1.7b"}), "qwen3:1.7b")

    def test_a_blank_variable_falls_through_rather_than_asking_for_nothing(self):
        os.environ["OLLAMA_MODEL"] = "  "
        self.assertEqual(self.posted_model({"ollamaModel": "qwen3:1.7b"}), "qwen3:1.7b")


if __name__ == "__main__":
    unittest.main()
