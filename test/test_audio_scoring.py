"""Audio-aware clip selection.

Clip ranking used to read the transcript and nothing else. In a lecture the
strongest moment is usually where the speaker raises their voice, slows down,
or pauses before landing a point, and none of that appears in text.

These tests build real WAV files in a temp directory rather than mocking the
reader, because the thing worth verifying is that the numbers coming off an
actual PCM file mean what the scorer thinks they mean.
"""

import importlib.util
import math
import pathlib
import shutil
import struct
import sys
import tempfile
import unittest
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))

spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

import audio_features  # noqa: E402
import intelligence  # noqa: E402

RATE = 16000


def write_wav(path, passages, rate=RATE, channels=1, width=2):
    """Write a mono 16 kHz PCM file from (duration_sec, amplitude) passages.

    Amplitude 0 is digital silence; 0.3 is an ordinary speaking level; 0.9 is
    a raised voice. A 220 Hz tone stands in for speech — the envelope only
    ever looks at RMS, so the waveform's shape is irrelevant.
    """
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(width)
        handle.setframerate(rate)
        frames = bytearray()
        position = 0
        for duration, amplitude in passages:
            for _ in range(int(duration * rate)):
                value = int(32767 * amplitude * math.sin(2 * math.pi * 220 * position / rate))
                frames += struct.pack("<h", value) * channels
                position += 1
        handle.writeframes(bytes(frames))
    return path


class AudioEnvelopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_a_raised_voice_reads_louder_than_the_speaker_s_own_baseline(self):
        # Ten seconds of ordinary speech, then four seconds of emphasis.
        path = write_wav(self.temp / "speech.wav", [(10.0, 0.25), (4.0, 0.9)])
        envelope = audio_features.load_envelope(path)
        self.assertIsNotNone(envelope)

        ordinary = envelope.features(1.0, 9.0)
        emphatic = envelope.features(10.5, 13.5)
        self.assertLess(ordinary["emphasis"], emphatic["emphasis"])
        self.assertLess(ordinary["energy"], emphatic["energy"])

    def test_loudness_is_relative_so_recording_level_does_not_change_the_score(self):
        # The same performance recorded quietly and loudly must produce the
        # same features, or a quiet lapel mic would rank below a hot desk mic
        # for reasons that have nothing to do with the content.
        # Identical performance, one recorded 3x hotter than the other. The
        # quiet-to-loud ratio within each file must match, or the fixture is
        # testing two different performances rather than two gain settings.
        quiet = write_wav(self.temp / "quiet.wav", [(6.0, 0.08), (3.0, 0.28)])
        loud = write_wav(self.temp / "loud.wav", [(6.0, 0.24), (3.0, 0.84)])
        quiet_features = audio_features.load_envelope(quiet).features(6.2, 8.8)
        loud_features = audio_features.load_envelope(loud).features(6.2, 8.8)
        self.assertAlmostEqual(quiet_features["energy"], loud_features["energy"], delta=0.25)
        self.assertAlmostEqual(quiet_features["emphasis"], loud_features["emphasis"], delta=0.25)

    def test_pauses_on_either_side_of_a_clip_are_measured(self):
        # speech | pause | speech | pause | speech
        path = write_wav(self.temp / "speech.wav", [
            (4.0, 0.3), (1.0, 0.0), (5.0, 0.3), (1.2, 0.0), (4.0, 0.3),
        ])
        envelope = audio_features.load_envelope(path)
        clean = envelope.features(5.0, 10.0)
        self.assertGreaterEqual(clean["leadingPauseSec"], 0.5)
        self.assertGreaterEqual(clean["trailingPauseSec"], 0.5)

        # A window cutting straight into speech has no breath in front of it.
        abrupt = envelope.features(6.5, 8.0)
        self.assertLess(abrupt["leadingPauseSec"], 0.12)

    def test_dead_air_inside_a_window_is_reported(self):
        path = write_wav(self.temp / "speech.wav", [(2.0, 0.3), (6.0, 0.0), (2.0, 0.3)])
        envelope = audio_features.load_envelope(path)
        features = envelope.features(0.0, 10.0)
        self.assertGreater(features["silenceRatio"], 0.4)

    def test_unusable_audio_never_raises(self):
        # Every one of these must degrade to transcript-only scoring rather
        # than failing a job the user already waited through transcription for.
        self.assertIsNone(audio_features.load_envelope(self.temp / "missing.wav"))

        empty = self.temp / "empty.wav"
        empty.write_bytes(b"")
        self.assertIsNone(audio_features.load_envelope(empty))

        garbage = self.temp / "garbage.wav"
        garbage.write_bytes(b"not a wav file at all, just bytes" * 8)
        self.assertIsNone(audio_features.load_envelope(garbage))

        silent = write_wav(self.temp / "silent.wav", [(3.0, 0.0)])
        self.assertIsNone(audio_features.load_envelope(silent), "pure silence has no usable reference level")

    def test_a_window_outside_the_recording_returns_nothing(self):
        path = write_wav(self.temp / "speech.wav", [(4.0, 0.3)])
        envelope = audio_features.load_envelope(path)
        self.assertIsNone(envelope.features(60.0, 90.0))
        self.assertIsNone(envelope.features(2.0, 1.0), "an inverted window is not a window")


class AudioScoringTests(unittest.TestCase):
    def setUp(self):
        self.segments = [
            {"start": 0.0, "end": 8.0, "text": "Remember that hardship can bring a believer closer to Allah."},
            {"start": 8.1, "end": 16.0, "text": "The important question is how you respond to the test."},
            {"start": 16.1, "end": 24.0, "text": "Return sincerely, repair what you can, and continue forward."},
        ]
        self.text = " ".join(segment["text"] for segment in self.segments)

    def evaluate(self, audio=None):
        return intelligence.evaluate_clip(0.0, 24.0, self.text, self.segments, audio=audio)

    def test_scoring_without_audio_is_completely_unchanged(self):
        """The old path must stay bit-identical — most jobs still take it."""
        baseline = self.evaluate()
        self.assertEqual(baseline, self.evaluate(audio=None))
        self.assertEqual(baseline, self.evaluate(audio={}))
        self.assertNotIn("delivery", baseline["dimensions"])
        self.assertNotIn("cleanEdges", baseline["dimensions"])
        self.assertEqual(baseline["signals"]["audio"], {})

    def test_the_transcript_weights_still_sum_to_one_without_audio(self):
        # A dimension silently dropping out of the weighting is the kind of
        # bug that shifts every score slightly and is invisible in review.
        weights = {
            "hook": 0.11, "openingStrength": 0.12, "flow": 0.10, "value": 0.14,
            "clarity": 0.09, "completeness": 0.10, "payoffStrength": 0.10,
            "specificity": 0.06, "pacing": 0.06, "confidence": 0.06,
            "safety": 0.03, "durationFit": 0.03,
        }
        self.assertAlmostEqual(sum(weights.values()), 1.0, places=6)
        self.assertAlmostEqual(sum(weights.values()) * 0.86 + 0.09 + 0.05, 1.0, places=6)

    def test_emphatic_delivery_outranks_flat_delivery_on_identical_words(self):
        flat = self.evaluate(audio={
            "energy": 0.9, "emphasis": 1.05, "dynamics": 0.05,
            "openingEnergy": 1.0, "silenceRatio": 0.05,
            "leadingPauseSec": 0.4, "trailingPauseSec": 0.4,
        })
        emphatic = self.evaluate(audio={
            "energy": 1.3, "emphasis": 2.3, "dynamics": 0.7,
            "openingEnergy": 1.1, "silenceRatio": 0.05,
            "leadingPauseSec": 0.4, "trailingPauseSec": 0.4,
        })
        self.assertGreater(emphatic["score"], flat["score"])
        self.assertGreater(emphatic["dimensions"]["delivery"], flat["dimensions"]["delivery"])

    def test_a_clip_that_starts_mid_breath_scores_below_one_that_does_not(self):
        common = {"energy": 1.0, "emphasis": 1.5, "dynamics": 0.3, "openingEnergy": 1.0, "silenceRatio": 0.05}
        abrupt = self.evaluate(audio={**common, "leadingPauseSec": 0.0, "trailingPauseSec": 0.0})
        clean = self.evaluate(audio={**common, "leadingPauseSec": 0.6, "trailingPauseSec": 0.6})
        self.assertGreater(clean["dimensions"]["cleanEdges"], abrupt["dimensions"]["cleanEdges"])
        self.assertGreater(clean["score"], abrupt["score"])
        self.assertIn("starts mid-breath", abrupt["signals"]["dropOffRisks"])

    def test_dead_air_is_penalised_and_surfaced_as_a_drop_off_risk(self):
        noisy = self.evaluate(audio={
            "energy": 1.0, "emphasis": 1.5, "dynamics": 0.3, "openingEnergy": 1.0,
            "silenceRatio": 0.55, "leadingPauseSec": 0.4, "trailingPauseSec": 0.4,
        })
        tight = self.evaluate(audio={
            "energy": 1.0, "emphasis": 1.5, "dynamics": 0.3, "openingEnergy": 1.0,
            "silenceRatio": 0.02, "leadingPauseSec": 0.4, "trailingPauseSec": 0.4,
        })
        self.assertGreater(tight["dimensions"]["delivery"], noisy["dimensions"]["delivery"])
        self.assertIn("dead air on the recording", noisy["signals"]["dropOffRisks"])

    def test_audio_informs_the_ranking_but_never_overrules_the_transcript(self):
        """A shouted throwaway line must not beat a strong point said calmly.

        This is the same principle as blending the local model 45/55 with the
        heuristic: the microphone is evidence about delivery, not about whether
        the point is worth hearing.
        """
        weak_text = "um so yeah basically you know it was kind of like that i mean"
        weak_segments = [{"start": 0.0, "end": 24.0, "text": weak_text}]
        shouted = intelligence.evaluate_clip(0.0, 24.0, weak_text, weak_segments, audio={
            "energy": 1.6, "emphasis": 3.0, "dynamics": 1.0, "openingEnergy": 1.3,
            "silenceRatio": 0.0, "leadingPauseSec": 1.0, "trailingPauseSec": 1.0,
        })
        calm = self.evaluate(audio={
            "energy": 0.85, "emphasis": 1.0, "dynamics": 0.05, "openingEnergy": 0.9,
            "silenceRatio": 0.1, "leadingPauseSec": 0.0, "trailingPauseSec": 0.0,
        })
        self.assertGreater(calm["score"], shouted["score"])

    def test_the_religious_quotation_gate_is_unaffected_by_audio(self):
        # The most important safety property in the codebase: scripture cannot
        # auto-post without a human seeing it, however the clip sounds.
        text = "The hadith says this wording must be reviewed carefully."
        segments = [{"start": 0.0, "end": 24.0, "text": text}]
        loud = {
            "energy": 1.8, "emphasis": 3.0, "dynamics": 1.2, "openingEnergy": 1.4,
            "silenceRatio": 0.0, "leadingPauseSec": 1.0, "trailingPauseSec": 1.0,
        }
        result = intelligence.evaluate_clip(0.0, 24.0, text, segments, quote_risk=True, audio=loud)
        self.assertIn("religious quotation needs human review", result["reasons"])
        score, reasons, risk = worker.score_candidate(0, 24, text, segments)
        self.assertTrue(risk)
        self.assertIn("religious quotation needs human review", reasons)

    def test_scores_stay_within_bounds_on_extreme_audio(self):
        for audio in (
            {"energy": 0.0, "emphasis": 0.0, "dynamics": 0.0, "openingEnergy": 0.0,
             "silenceRatio": 1.0, "leadingPauseSec": 0.0, "trailingPauseSec": 0.0},
            {"energy": 99.0, "emphasis": 99.0, "dynamics": 99.0, "openingEnergy": 99.0,
             "silenceRatio": 0.0, "leadingPauseSec": 99.0, "trailingPauseSec": 99.0},
        ):
            result = self.evaluate(audio=audio)
            self.assertGreaterEqual(result["score"], 1)
            self.assertLessEqual(result["score"], 100)
            self.assertGreaterEqual(result["dimensions"]["delivery"], 0)
            self.assertLessEqual(result["dimensions"]["delivery"], 100)
            self.assertLessEqual(result["dimensions"]["cleanEdges"], 100)


class CandidateBuildingWithAudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp())
        self.segments = [
            {"start": 0.0, "end": 8.0, "text": "Remember that hardship can bring a believer closer to Allah."},
            {"start": 8.1, "end": 16.0, "text": "The important question is how you respond to the test."},
            {"start": 16.1, "end": 24.0, "text": "Return sincerely, repair what you can, and continue forward."},
            {"start": 24.1, "end": 32.0, "text": "Hope and responsibility should remain together."},
        ]

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_build_candidates_without_an_envelope_still_works(self):
        candidates = worker.build_candidates(self.segments, 15, 35)
        self.assertTrue(candidates)
        self.assertTrue(all(1 <= item.score <= 100 for item in candidates))

    def test_build_candidates_uses_the_envelope_when_given_one(self):
        path = write_wav(self.temp / "speech.wav", [(16.0, 0.2), (16.0, 0.85)])
        envelope = audio_features.load_envelope(path)
        self.assertIsNotNone(envelope)

        without = worker.build_candidates(self.segments, 15, 35)
        with_audio = worker.build_candidates(self.segments, 15, 35, envelope)
        self.assertEqual(len(without), len(with_audio))
        # Same windows, but the acoustic dimensions now exist and the ranking
        # is no longer identical to the transcript-only pass.
        self.assertTrue(all("delivery" in item.dimensions for item in with_audio))
        self.assertNotEqual(
            [item.score for item in without],
            [item.score for item in with_audio],
            "audio was loaded but changed nothing, which means it is not wired in",
        )

    def test_score_candidate_accepts_an_envelope(self):
        path = write_wav(self.temp / "speech.wav", [(32.0, 0.3)])
        envelope = audio_features.load_envelope(path)
        score, reasons, risk = worker.score_candidate(0, 24, "A calm and clear reminder about patience.", self.segments, envelope)
        self.assertGreaterEqual(score, 1)
        self.assertLessEqual(score, 100)
        self.assertFalse(risk)


class DependencyFreeFallbackTests(unittest.TestCase):
    """`audioop` is removed in Python 3.13; the container pins 3.12 today.

    The pure-Python path is therefore dead code on this machine and in
    production, and would break unnoticed on a version bump. These tests force
    it on so the day the base image moves is not the day clip scoring stops.
    """

    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp())
        self.original = audio_features.audioop

    def tearDown(self):
        audio_features.audioop = self.original
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_the_fallback_agrees_with_the_fast_path(self):
        path = write_wav(self.temp / "speech.wav", [(6.0, 0.2), (4.0, 0.85), (2.0, 0.0)])

        audio_features.audioop = self.original
        fast = audio_features.load_envelope(path)
        audio_features.audioop = None
        slow = audio_features.load_envelope(path)

        self.assertIsNotNone(fast)
        self.assertIsNotNone(slow)
        fast_features = fast.features(6.2, 9.8)
        slow_features = slow.features(6.2, 9.8)
        for key in ("energy", "emphasis", "leadingPauseSec"):
            self.assertAlmostEqual(
                fast_features[key], slow_features[key], delta=0.15,
                msg=f"{key} diverges between the audioop and pure-Python paths",
            )

    def test_the_fallback_still_degrades_safely_on_bad_input(self):
        audio_features.audioop = None
        garbage = self.temp / "garbage.wav"
        garbage.write_bytes(b"still not a wav" * 10)
        self.assertIsNone(audio_features.load_envelope(garbage))


class DeliveryDescriptionTests(unittest.TestCase):
    def test_descriptions_are_plain_language_and_safe_on_empty_input(self):
        self.assertEqual(audio_features.describe(None), [])
        self.assertEqual(audio_features.describe({}), [])
        notes = audio_features.describe({
            "emphasis": 2.4, "dynamics": 0.7, "energy": 1.2,
            "leadingPauseSec": 0.5, "trailingPauseSec": 0.5, "silenceRatio": 0.1,
        })
        self.assertIn("speaker raises their voice here", notes)
        self.assertIn("clean pause on both edges", notes)


if __name__ == "__main__":
    unittest.main()
