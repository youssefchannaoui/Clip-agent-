"""A first listen that stops early is listened to again (5 Sept 2026).

Youssef's 568-second recitation came back as two segments covering 28.4
seconds, and the run failed blaming the clip length. These drive the real
transcriber with a fake faster-whisper whose answers depend on the options it
is given, so what is asserted is the transcript the pipeline would have used,
the warning it emitted, and the sentence a zero-clip run now reports.
"""
from __future__ import annotations

import io
import json
import sys
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
import clip_worker as cw  # noqa: E402


class _Seg:
    def __init__(self, start, end, text):
        self.start, self.end, self.text, self.words = start, end, text, []
        self.no_speech_prob, self.avg_logprob = 0.1, -0.3


class _Info:
    language = "ar"
    language_probability = 0.99


def _rows(count, step=12.0, length=9.0):
    return [_Seg(i * step, i * step + length, "كلمات") for i in range(count)]


class FakeWhisper:
    """Answers like the box did: with the VAD on, two segments and silence."""

    calls: list[dict] = []
    behaviour = "vad"  # which guard silences the recording

    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, path, **options):
        FakeWhisper.calls.append(dict(options))
        vad = bool(options.get("vad_filter", True))
        gate = options.get("no_speech_threshold", 0.6) is not None
        silenced = {"vad": vad, "gate": gate}.get(FakeWhisper.behaviour, False)
        rows = _rows(2, step=17.0, length=16.0) if silenced else _rows(46)
        return iter(rows), _Info()


def _install_fake():
    module = types.ModuleType("faster_whisper")
    module.WhisperModel = FakeWhisper
    sys.modules["faster_whisper"] = module


def _job(language="ar"):
    return {"settings": {"language": language, "model": "small", "device": "cpu", "computeType": "int8",
                         "translateCaptions": False}}


class SecondListenTests(unittest.TestCase):
    def setUp(self):
        _install_fake()
        FakeWhisper.calls = []
        FakeWhisper.behaviour = "vad"

    def transcribe(self, duration=568.0, language="ar"):
        out = io.StringIO()
        with redirect_stdout(out):
            rows = cw._transcribe_with_faster_whisper(_job(language), Path("/tmp/nothing.wav"), duration)
        events = [json.loads(line) for line in out.getvalue().splitlines() if line.startswith("{")]
        return rows, events

    def test_a_transcript_that_stops_early_is_listened_to_again_with_the_vad_off(self):
        rows, events = self.transcribe()
        self.assertEqual(len(rows), 46, "the fuller pass is the transcript the pipeline gets")
        self.assertGreater(cw.transcript_reach(rows, 568.0), 0.9)
        self.assertEqual(len(FakeWhisper.calls), 2, "one retry was enough")
        self.assertIs(FakeWhisper.calls[1].get("vad_filter"), False)
        self.assertNotIn("vad_parameters", FakeWhisper.calls[1], "the VAD's own tuning goes with it")
        self.assertEqual(FakeWhisper.calls[1].get("language"), "ar", "the pinned language is kept")
        warnings = [e for e in events if e.get("type") == "warning"]
        self.assertEqual([w["code"] for w in warnings], ["transcription_second_pass"])
        self.assertIn("stopped at 6%", warnings[0]["warning"])
        self.assertIn("voice detection off", warnings[0]["warning"])

    def test_the_no_speech_gate_is_the_second_thing_tried_and_the_vad_stays_on_for_it(self):
        FakeWhisper.behaviour = "gate"
        rows, events = self.transcribe()
        self.assertEqual(len(rows), 46)
        self.assertEqual(len(FakeWhisper.calls), 3)
        self.assertIsNone(FakeWhisper.calls[2].get("no_speech_threshold", 0.6))
        self.assertIs(FakeWhisper.calls[2].get("vad_filter"), True, "each retry keeps the other guard")
        self.assertIn("no-speech gate off", [e for e in events if e.get("type") == "warning"][0]["warning"])

    def test_a_first_pass_that_covers_the_file_is_never_retried(self):
        FakeWhisper.behaviour = "none"
        rows, events = self.transcribe()
        self.assertEqual(len(rows), 46)
        self.assertEqual(len(FakeWhisper.calls), 1, "no second pass on a transcript that reaches the end")
        self.assertEqual([e for e in events if e.get("type") == "warning"], [])

    def test_a_short_recording_is_never_retried(self):
        # 28 seconds transcribed of a 50-second file is ambiguous; a whole
        # second pass is only earned by a recording that plainly stopped.
        rows, events = self.transcribe(duration=50.0)
        self.assertEqual(len(FakeWhisper.calls), 1)

    def test_when_nothing_reaches_further_the_first_pass_stands_and_says_so(self):
        FakeWhisper.behaviour = "both"  # every pass silenced

        def always_short(self_, path, **options):
            FakeWhisper.calls.append(dict(options))
            return iter(_rows(2, step=17.0, length=16.0)), _Info()
        FakeWhisper.transcribe = always_short
        try:
            rows, events = self.transcribe()
        finally:
            del FakeWhisper.transcribe
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(FakeWhisper.calls), 3, "both retries were tried")
        codes = [e["code"] for e in events if e.get("type") == "warning"]
        self.assertEqual(codes, ["transcription_stopped_early"])

    def test_a_recitation_never_pays_for_the_voice_filter(self):
        # Measured on the box: the filter kept 26s of the first 120s of the
        # recitation, and switching it off recovered 119s. A Quran-template job
        # starts without it, so the first pass is the full one.
        job = _job()
        job["template"] = {"id": "quran-recitation", "captionMode": "quran"}
        out = io.StringIO()
        with redirect_stdout(out):
            rows = cw._transcribe_with_faster_whisper(job, Path("/tmp/nothing.wav"), 568.0)
        self.assertEqual(len(FakeWhisper.calls), 1, "one pass, no retry needed")
        self.assertIs(FakeWhisper.calls[0].get("vad_filter"), False)
        self.assertNotIn("vad_parameters", FakeWhisper.calls[0])
        self.assertIsNotNone(FakeWhisper.calls[0].get("no_speech_threshold", 0.6), "the no-speech gate stays")
        self.assertEqual(len(rows), 46)

    def test_a_cached_transcript_that_stopped_early_is_not_reused(self):
        # The failed run CACHED its 28-second transcript, so a Retry would
        # have reused it and failed again without ever listening twice.
        src = Path(cw.__file__).read_text(encoding="utf-8")
        at = src.index("cached_transcript = transcript_cache_lookup(job, selected_start, selected_end)")
        block = src[at:at + 900]
        self.assertIn("stopped_early(cached_transcript, duration)", block)
        self.assertLess(block.index("stopped_early(cached_transcript, duration)"),
                        block.index('progress("Reusing the stored transcript"'),
                        "the early-stop check runs before the cache is honoured")
        short = [{"start": 0.0, "end": 16.4, "text": "x"}, {"start": 17.2, "end": 28.4, "text": "y"}]
        self.assertTrue(cw.stopped_early(short, 568.0))
        self.assertFalse(cw.stopped_early(short, 50.0), "a short recording is never second-guessed")

    def test_a_zero_clip_run_names_the_transcript_when_that_is_why(self):
        short = [{"start": 0.0, "end": 16.4, "text": "x"}, {"start": 17.2, "end": 28.4, "text": "y"}]
        settings = {"clipMinSeconds": 45, "clipMaxSeconds": 60}
        reason = cw.no_clip_reason(short, 568.0, settings)
        self.assertIn("Only 28s of the 568s source could be transcribed", reason)
        self.assertIn("45-60 second clip", reason)
        full = [{"start": i * 12.0, "end": i * 12.0 + 9.0, "text": "x"} for i in range(46)]
        self.assertEqual(cw.no_clip_reason(full, 568.0, settings),
                         "No complete clip candidates fit the selected duration range (45-60s).")
        self.assertIn("duration range", cw.no_clip_reason(short, 50.0, settings),
                      "a short recording is a range problem, not a recogniser one")


class SecondListenGuardTests(unittest.TestCase):
    """Which passes are worth running, decided against the BASE options.

    Each pass used to be applied blind. A Qur'an job already starts with the
    voice filter off (v3.132.0, measured on the box), so on a recitation the
    "voice detection off" pass changed NOTHING -- a whole wasted transcription
    of the file, minutes on a single-slot box -- and the "no-speech gate off"
    pass then ran with the filter AND the gate off together, which is the one
    combination SECOND_LISTEN_PASSES exists to avoid: with neither silencer in
    the way the model hallucinates captions onto silence, which is worse than
    the fault being fixed.

    Driven against the real second_listen with a fake run_pass that records the
    options it was handed, because the fault is entirely in the ARGUMENTS -- a
    wasted pass and a dangerous pass both return perfectly ordinary segments.
    """

    STOPS_EARLY = [{"start": 0.0, "end": 16.4, "text": "x"}, {"start": 17.2, "end": 28.4, "text": "y"}]
    DURATION = 568.0

    # What a lecture and a recitation actually arrive with, from
    # _transcribe_with_faster_whisper's own kwargs.
    LECTURE = {"beam_size": 1, "vad_filter": True, "vad_parameters": {"min_silence_duration_ms": 450},
               "word_timestamps": True, "condition_on_previous_text": False, "task": "transcribe"}
    RECITATION = {"beam_size": 1, "vad_filter": False, "word_timestamps": True,
                  "condition_on_previous_text": False, "task": "transcribe"}

    def listen(self, options, answer=None):
        """Run the real second_listen; return (segments, label, options seen, events)."""
        seen: list[dict] = []

        def run_pass(passed):
            seen.append(dict(passed))
            return (answer or self.STOPS_EARLY)

        out = io.StringIO()
        with redirect_stdout(out):
            best, winner = cw.second_listen(run_pass, self.STOPS_EARLY, self.DURATION, dict(options))
        events = [json.loads(line) for line in out.getvalue().splitlines() if line.startswith("{")]
        return best, winner, seen, events

    def guards_off(self, options):
        return cw.relaxed_guards(options)

    # -- the absent/None distinction the whole rule rests on --

    def test_an_absent_no_speech_threshold_is_the_librarys_gate_and_it_is_ON(self):
        # A plain .get() comparison cannot tell "off" from "not mentioned", and
        # reading absent as off would make every base look like the gate was
        # already relaxed -- skipping the one pass that recovers a gated file.
        self.assertNotIn("no_speech_threshold", self.guards_off({"vad_filter": True}))
        self.assertIn("no_speech_threshold", self.guards_off({"vad_filter": True, "no_speech_threshold": None}))
        self.assertNotIn("no_speech_threshold", self.guards_off({"vad_filter": True, "no_speech_threshold": 0.6}))

    def test_an_absent_vad_filter_is_faster_whispers_own_default_which_is_off(self):
        self.assertIn("vad_filter", self.guards_off({}))
        self.assertIn("vad_filter", self.guards_off({"vad_filter": False}))
        self.assertNotIn("vad_filter", self.guards_off({"vad_filter": True}))

    # -- a recitation --

    def test_a_recitation_runs_no_pass_that_can_only_waste_a_transcription(self):
        best, winner, seen, _ = self.listen(self.RECITATION)
        self.assertEqual(seen, [], "the voice filter is already off; that pass changes nothing")
        self.assertIsNone(winner)
        self.assertIs(best, self.STOPS_EARLY, "the first pass stands")

    def test_a_recitation_never_relaxes_the_gate_on_top_of_the_filter(self):
        _, _, seen, _ = self.listen(self.RECITATION)
        for options in seen:
            self.assertLessEqual(len(self.guards_off(options)), 1,
                                 "neither silencer left in the way hallucinates captions onto silence")

    def test_a_recitation_that_stays_short_says_which_silence_it_was(self):
        # "listening again did not reach further" would describe a pass that
        # never ran. Same warning CODE, so the app's guidance is unchanged.
        _, _, _, events = self.listen(self.RECITATION)
        warnings = [event for event in events if event.get("type") == "warning"]
        self.assertEqual([w["code"] for w in warnings], ["transcription_stopped_early"])
        self.assertIn("no safer way to listen again", warnings[0]["warning"])
        self.assertNotIn("did not reach further", warnings[0]["warning"])

    # -- an ordinary lecture is untouched --

    def test_a_lecture_still_gets_both_passes_one_guard_at_a_time(self):
        _, _, seen, _ = self.listen(self.LECTURE)
        self.assertEqual(len(seen), 2)
        self.assertIs(seen[0].get("vad_filter"), False)
        self.assertNotIn("vad_parameters", seen[0], "the VAD's own tuning goes with it")
        self.assertIsNotNone(seen[0].get("no_speech_threshold", 0.6), "the gate still refuses real silence")
        self.assertIsNone(seen[1].get("no_speech_threshold", 0.6))
        self.assertIs(seen[1].get("vad_filter"), True, "the filter still removes it")
        for options in seen:
            self.assertEqual(len(self.guards_off(options)), 1)

    def test_a_lecture_that_stayed_short_says_it_listened_again(self):
        _, _, _, events = self.listen(self.LECTURE)
        warnings = [event for event in events if event.get("type") == "warning"]
        self.assertEqual([w["code"] for w in warnings], ["transcription_stopped_early"])
        self.assertIn("did not reach further", warnings[0]["warning"])

    def test_a_pass_that_reaches_further_still_wins_and_is_named(self):
        full = [{"start": i * 12.0, "end": i * 12.0 + 9.0, "text": "x"} for i in range(46)]
        best, winner, seen, events = self.listen(self.LECTURE, answer=full)
        self.assertEqual(best, full)
        self.assertEqual(winner, "voice detection off")
        self.assertEqual(len(seen), 1, "the first retry reached the end; the second is not paid for")
        self.assertEqual([e["code"] for e in events if e.get("type") == "warning"],
                         ["transcription_second_pass"])

    # -- the rule is about the base, not about the template --

    def test_a_base_with_the_gate_already_off_skips_the_gate_pass_too(self):
        # Symmetry, so nothing here has to know what kind of job this is: the
        # no-op pass and the both-off pass are both refused whichever guard the
        # base happens to have relaxed.
        base = {**self.LECTURE, "no_speech_threshold": None}
        _, _, seen, _ = self.listen(base)
        self.assertEqual(seen, [])


if __name__ == "__main__":
    unittest.main()
