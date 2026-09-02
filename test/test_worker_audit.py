"""The worker audit of 2 Sept 2026, pinned.

Youssef asked for every area of the worker to be a ten. These are the code
changes that moved the scores, each proven here against the failure it fixes.
"""
import importlib
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw


# ── The AI request ──────────────────────────────────────────────────────────

class FakeResponse:
    def __init__(self, payload):
        self._payload = json.dumps({"response": json.dumps(payload)}).encode()

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def cand(i, text="He spoke about patience for a long while and then stopped.", score=60):
    return cw.Candidate(start=i * 30.0, end=i * 30.0 + 40.0, text=text, segments=[],
                        score=score, reasons=[], quote_risk=False)


class OllamaRequestTests(unittest.TestCase):
    def setUp(self):
        cw._SCHEMA_FORMAT_OK = None

    def requests_for(self, cands, responder=None):
        sent = []

        def fake_urlopen(request, timeout=None):
            body = json.loads(request.data.decode("utf-8"))
            sent.append(body)
            if responder:
                return responder(body)
            n = len(body["prompt"].split('"index": ')) - 1
            return FakeResponse({"clips": [{"index": k, "score": 80, "title": f"T{k} words words words words",
                                             "description": "d", "reason": "r"} for k in range(n)]})

        with mock.patch.object(cw.urllib.request, "urlopen", fake_urlopen), mock.patch.object(cw, "emit"):
            cw.refine_with_ollama(cands, {"ollamaUrl": "http://x", "ollamaModel": "m"}, "A lecture")
        return sent

    def test_the_context_window_is_declared(self):
        # It never was. The DeenAI path set 4096 and had a test for it; this
        # one ran on the server default, and Ollama truncates from the FRONT
        # -- the rules were the part that got dropped.
        body = self.requests_for([cand(0)])[0]
        self.assertEqual(body["options"]["num_ctx"], cw.AI_NUM_CTX)
        self.assertGreaterEqual(cw.AI_NUM_CTX, 4096)

    def test_a_batch_fits_inside_the_window_with_its_answer(self):
        cands = [cand(i, text="word " * 400) for i in range(cw.AI_BATCH)]
        body = self.requests_for(cands)[0]
        self.assertTrue(cw.prompt_fits(body["prompt"]),
                        "instructions + data + the answer's num_predict must fit the declared window")
        self.assertLessEqual(len(json.loads(body["prompt"].split("BEGIN TRANSCRIPT DATA\n")[1]
                                            .split("\nEND TRANSCRIPT DATA")[0])[0]["text"]), cw.AI_ITEM_CHARS)

    def test_the_answer_is_pinned_to_the_batch_size_by_schema(self):
        # The early close: asked for four rows, the model returned one. A
        # schema with minItems == maxItems == batch makes that undecodable.
        cands = [cand(i) for i in range(3)]
        body = self.requests_for(cands)[0]
        schema = body["format"]
        self.assertIsInstance(schema, dict)
        self.assertEqual(schema["properties"]["clips"]["minItems"], 3)
        self.assertEqual(schema["properties"]["clips"]["maxItems"], 3)
        self.assertIn("index", schema["properties"]["clips"]["items"]["required"])

    def test_a_server_that_rejects_schemas_gets_plain_json_once_and_is_remembered(self):
        import urllib.error
        seen = []

        def responder(body):
            seen.append(body["format"])
            if isinstance(body["format"], dict):
                raise urllib.error.HTTPError("http://x", 400, "invalid format", {}, None)
            return FakeResponse({"clips": [{"index": 0, "score": 80, "title": "T", "description": "d", "reason": "r"}]})

        self.requests_for([cand(0)], responder)
        self.assertEqual(seen[0].__class__, dict, "the schema is tried first")
        self.assertEqual(seen[1], "json", "then plain JSON mode")
        self.assertIs(cw._SCHEMA_FORMAT_OK, False)
        seen.clear()
        self.requests_for([cand(1)], responder)
        self.assertEqual(seen, ["json"], "the 400 is paid once a run, not once a batch")

    def test_an_oversized_batch_is_asked_in_halves_so_the_rules_always_arrive(self):
        # An Arabic passage tokenises at ~1.5 chars a token; four of them
        # would overrun the window, and the server would drop the rules.
        arabic = "التوبة " * 200
        cands = [cand(i, text=arabic) for i in range(4)]
        sent = self.requests_for(cands)
        self.assertGreater(len(sent), 1, "split rather than truncated")
        for body in sent:
            self.assertTrue(cw.prompt_fits(body["prompt"]))

    def test_the_token_estimate_is_pessimistic_for_arabic(self):
        self.assertGreater(cw.estimate_tokens("ب" * 100), cw.estimate_tokens("b" * 100))


# ── Scoring speaks Arabic ───────────────────────────────────────────────────

class ArabicScoringTests(unittest.TestCase):
    def segs(self, text, dur=40):
        return [{"start": 0.0, "end": dur, "text": text, "words": []}]

    def test_an_arabic_lecture_is_no_longer_scored_blind(self):
        arabic = ("هل تعلم ماذا يحدث في القبر؟ الموت قادم وكل واحد منا سيقف للحساب. " * 4
                  + "تذكر أن رحمة الله واسعة والتوبة بابها مفتوح، فادع الله.")
        score, reasons, _ = cw.score_candidate(0, 40, arabic, self.segs(arabic))
        self.assertIn("question opening", reasons, "the Arabic question mark is a question mark")
        self.assertGreater(score, 45, "a strong Arabic reminder must not score like an empty window")
        # The stakes vocabulary is what lifts it: the same passage with the
        # power words replaced by neutral ones scores lower. (The reasons list
        # is capped at four labels, so the score is the honest witness here.)
        flat = arabic.replace("القبر", "المكان").replace("الموت", "الوقت").replace("للحساب", "للقاء") \
                     .replace("رحمة", "كلمة").replace("التوبة", "الطريق")
        weaker, _, _ = cw.score_candidate(0, 40, flat, self.segs(flat))
        self.assertGreater(score, weaker)
        self.assertTrue({"قبر", "موت", "رحمة", "توبة"} <= set(cw.score_words(arabic)))

    def test_arabic_words_are_counted_as_words(self):
        words = cw.score_words("الجنة والنار والقبر")
        self.assertIn("جنة", words, "the definite article is stripped so الجنة and جنة are one word")
        self.assertIn("قبر", words)

    def test_the_review_gate_fires_on_arabic_scripture_too(self):
        # Invariant 1 had an Arabic blind spot.
        for text in ("قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات",
                     "وفي الحديث أن الصبر ضياء", "قال تعالى في سورة البقرة"):
            _, _, risk = cw.score_candidate(0, 40, text, self.segs(text))
            self.assertTrue(risk, text)
        _, _, risk = cw.score_candidate(0, 40, "The hadith says this must be reviewed.", self.segs("x"))
        self.assertTrue(risk, "and the English still fires")

    def test_filler_is_counted_by_whole_word(self):
        # "likely", "unlike" and "Allah likes" are not filler.
        clean = ("It is likely that Allah likes the one who is unlike the arrogant, and he dislikes pride, "
                 "so be humble before your Lord and remember the grave.")
        filler = clean.replace("Allah likes", "like, um, Allah likes").replace("so be", "like, you know, so be")
        s_clean, _, _ = cw.score_candidate(0, 40, clean, self.segs(clean))
        s_filler, _, _ = cw.score_candidate(0, 40, filler, self.segs(filler))
        self.assertEqual(len(cw._FILLER_RE.findall(clean.lower())), 0, "likely / likes / unlike / dislikes are not filler")
        self.assertEqual(len(cw._FILLER_RE.findall(filler.lower())), 4)
        self.assertGreater(s_clean, s_filler)

    def test_intro_words_match_whole_words(self):
        self.assertEqual(cw._INTRO_RE.findall("the channels of mercy"), [])
        self.assertEqual(cw._INTRO_RE.findall("subscribe to the channel"), ["subscribe", "channel"])


# ── Transcription ───────────────────────────────────────────────────────────

class FakeSegment:
    def __init__(self, start, end, text):
        self.start, self.end, self.text, self.words = start, end, text, []


class FakeInfo:
    def __init__(self, language):
        self.language = language


class TranslationSpanTests(unittest.TestCase):
    def run_model(self, segments, duration, settings=None, reject_clips=False):
        calls = []

        class Model:
            def __init__(self, *a, **k):
                pass

            def transcribe(self, _audio, **kwargs):
                if reject_clips and "clip_timestamps" in kwargs:
                    raise TypeError("transcribe() got an unexpected keyword argument 'clip_timestamps'")
                calls.append(kwargs)
                if kwargs.get("task") == "translate":
                    return ([FakeSegment(300.0, 306.0, "Indeed We created you")], FakeInfo("ar"))
                return (segments, FakeInfo("en"))

        sys.modules["faster_whisper"] = types.SimpleNamespace(WhisperModel=Model)
        out = cw.FasterWhisperBackend().transcribe({"settings": settings or {}}, Path("/tmp/x.wav"), duration)
        return calls, out

    def english_with_recitation(self):
        segs = [FakeSegment(i * 10.0, i * 10.0 + 9.0, "English teaching here") for i in range(60)]
        segs[30] = FakeSegment(300.0, 306.0, "إنا خلقناكم")
        return segs

    def test_only_the_arabic_is_translated(self):
        # An English hour with six seconds of recitation used to pay a second
        # full transcription for those six seconds.
        calls, _ = self.run_model(self.english_with_recitation(), 600.0)
        translate = [c for c in calls if c.get("task") == "translate"][0]
        self.assertEqual(translate["clip_timestamps"], [299.4, 306.6], "the Arabic segment, padded")
        self.assertNotIn("vad_filter", translate, "the library ignores VAD with clips; it is not sent")

    def test_the_english_still_lands_on_the_arabic_segment(self):
        _, out = self.run_model(self.english_with_recitation(), 600.0)
        arabic = [s for s in out if cw.contains_arabic(s["text"])][0]
        self.assertEqual(arabic["english"], "Indeed We created you")

    def test_a_mostly_arabic_file_is_translated_whole(self):
        segs = [FakeSegment(i * 10.0, i * 10.0 + 9.0, "إنا خلقناكم") for i in range(6)]
        calls, _ = self.run_model(segs, 60.0)
        translate = [c for c in calls if c.get("task") == "translate"][0]
        self.assertNotIn("clip_timestamps", translate, "clipping most of a file buys nothing")

    def test_a_pinned_arabic_language_is_translated_whole(self):
        calls, _ = self.run_model(self.english_with_recitation(), 600.0, settings={"language": "ar"})
        translate = [c for c in calls if c.get("task") == "translate"][0]
        self.assertNotIn("clip_timestamps", translate)

    def test_an_older_whisper_without_clips_still_translates(self):
        calls, out = self.run_model(self.english_with_recitation(), 600.0, reject_clips=True)
        translate = [c for c in calls if c.get("task") == "translate"]
        self.assertTrue(translate, "fell back to the whole file rather than failing the job")
        self.assertNotIn("clip_timestamps", translate[0])
        self.assertTrue(translate[0].get("vad_filter"), "and VAD comes back for the whole-file pass")

    def test_the_first_pass_does_not_condition_on_previous_text(self):
        # The repeat-loop setting: a small model on an hour of audio.
        calls, _ = self.run_model(self.english_with_recitation(), 600.0)
        self.assertIs(calls[0]["condition_on_previous_text"], False)

    def test_spans_merge_and_pad(self):
        segs = [{"start": 10.0, "end": 12.0, "text": "أ"}, {"start": 12.5, "end": 14.0, "text": "ب"},
                {"start": 50.0, "end": 51.0, "text": "ج"}]
        self.assertEqual(cw.arabic_spans(segs, 100.0), [(9.4, 14.6), (49.4, 51.6)])
        self.assertIsNone(cw.arabic_spans([{"start": 0, "end": 5, "text": "x"}], 10.0))


# ── Template fields cannot break the file formats they land in ──────────────

class TemplateHardeningTests(unittest.TestCase):
    def test_a_font_name_cannot_start_a_new_style_field_or_event(self):
        self.assertEqual(cw.safe_font("Outfit", "DejaVu Sans"), "Outfit")
        self.assertEqual(cw.safe_font("KFGQPC HAFS Uthmanic Script", "x"), "KFGQPC HAFS Uthmanic Script")
        self.assertEqual(cw.safe_font("Outfit,99,&HFF0000&", "DejaVu Sans"), "DejaVu Sans")
        self.assertEqual(cw.safe_font("Outfit\nDialogue: 0,0:00:00.00,0:00:05.00,Caption,,0,0,0,,x", "DejaVu Sans"), "DejaVu Sans")
        self.assertEqual(cw.safe_font("", "DejaVu Sans"), "DejaVu Sans")

    def test_a_colour_cannot_carry_a_filter(self):
        self.assertEqual(cw.safe_hex("#d9b478", "#000000"), "#D9B478")
        self.assertEqual(cw.safe_hex("000000,drawtext=text=pwned", "#000000"), "#000000")
        self.assertEqual(cw.ass_color("#,,,,,,"), "&H00FFFFFF")
        self.assertEqual(cw.ass_color("#2A2C39"), "&H00392C2A")

    def test_the_style_line_is_built_from_the_safe_values(self):
        template = {"id": "t", "name": "t", "captionFont": "Outfit,99,&HFF0000&",
                    "frameBackground": "black,drawtext=x", "brandLineEnabled": True,
                    "brandLineColor": "0x00,drawbox=x", "captionMode": "phrase"}
        candidate = cand(0)
        with tempfile.TemporaryDirectory() as work:
            ass = Path(work) / "x.ass"
            cw.write_ass(candidate, template, ass)
            header = ass.read_text(encoding="utf-8")
        self.assertIn("Style: Caption,DejaVu Sans,", header)
        self.assertNotIn("&HFF0000&", header)
        graph = cw.build_video_filter(template, Path("/tmp/x.ass"))
        self.assertNotIn("drawtext", graph)
        self.assertIn("color=0x000000", graph)
        self.assertIn("color=0xD9B478", graph)

    def test_a_carriage_return_cannot_start_a_new_event(self):
        self.assertEqual(cw.ass_escape("a\r\nDialogue: 0"), "a\\NDialogue: 0")


# ── The result says where the time went ─────────────────────────────────────

class StageClockTests(unittest.TestCase):
    def test_laps_accumulate_and_the_total_is_wall_clock(self):
        times = iter([100.0, 102.0, 104.5, 104.5, 110.0])
        with mock.patch.object(cw.time, "time", lambda: next(times)):
            clock = cw.StageClock()
            clock.lap("import")
            clock.lap("transcribe")
            clock.lap("import")
            report = clock.report()
        self.assertEqual(report, {"import": 2.0, "transcribe": 2.5, "total": 10.0})


class LocalSourceTests(unittest.TestCase):
    def test_a_local_source_is_linked_not_copied(self):
        with tempfile.TemporaryDirectory() as work:
            src = Path(work) / "cached.mp4"
            src.write_bytes(b"x" * 1024)
            dest = Path(work) / "sources" / "job.mp4"
            cw.place_local(src, dest)
            self.assertEqual(dest.read_bytes(), src.read_bytes())
            self.assertEqual(src.stat().st_ino, dest.stat().st_ino, "same inode: one copy on disk")


# ── The service ─────────────────────────────────────────────────────────────

class ServiceGuardTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="deenclipped-audit-")
        os.environ["WORKER_DATA_DIR"] = self.root
        os.environ["WORKER_SHARED_SECRET"] = "s" * 40
        self.service = importlib.reload(importlib.import_module("service"))

    def tearDown(self):
        for key in ("WORKER_DATA_DIR", "WORKER_JOB_BUDGET_MIN", "VIDEO_IMPORT_PROXIES", "VIDEO_IMPORT_PROXY"):
            os.environ.pop(key, None)
        shutil.rmtree(self.root, ignore_errors=True)

    def test_proxy_credentials_never_reach_a_job_record(self):
        os.environ["VIDEO_IMPORT_PROXIES"] = "http://alice:hunter2secret@1.2.3.4:8080,http://bob:pw@5.6.7.8:1"
        os.environ["VIDEO_IMPORT_PROXY"] = "http://carol:topsecret@9.9.9.9:3"
        text = self.service.clean_error(RuntimeError(
            "yt-dlp: Unable to connect via http://alice:hunter2secret@1.2.3.4:8080 (proxy) and hunter2secret was refused; also topsecret"))
        self.assertNotIn("hunter2secret", text)
        self.assertNotIn("topsecret", text)
        self.assertIn("[proxy]", text)

    def test_a_hung_job_is_stopped_at_its_budget(self):
        # A child that prints heartbeats for ever: the stall detector stays
        # green, and before this the only slot was held until someone noticed.
        fake_root = Path(self.root) / "fake"
        (fake_root / "worker").mkdir(parents=True)
        (fake_root / "worker" / "clip_worker.py").write_text(
            "import time,json,sys\n"
            "while True:\n"
            "    print(json.dumps({'type':'heartbeat'}), flush=True); time.sleep(0.2)\n")
        store = self.service.JobStore()
        store.create({"id": "hung", "settings": {"maxSourceMinutes": 180}})
        processor = self.service.Processor(store)
        job_file = Path(self.root) / "job.json"
        job_file.write_text("{}")
        with mock.patch.object(self.service, "ROOT", fake_root), \
             mock.patch.object(self.service.Processor, "job_budget_seconds", return_value=2):
            with self.assertRaises(RuntimeError) as caught:
                processor.run_clip_worker("hung", job_file, Path(self.root) / "result.json")
        self.assertIn("time budget", str(caught.exception))
        self.assertNotIn("hung", processor.running, "the slot is released")

    def test_the_budget_scales_with_the_selected_stretch(self):
        store = self.service.JobStore()
        store.create({"id": "short", "sourceStartSec": 600, "sourceEndSec": 900, "settings": {}})
        store.create({"id": "whole", "settings": {"maxSourceMinutes": 180}})
        processor = self.service.Processor(store)
        self.assertEqual(processor.job_budget_seconds("short"), 90 * 60, "five minutes selected: the 90-minute floor")
        self.assertEqual(processor.job_budget_seconds("whole"), 180 * 4 * 60, "unknown length: four times the limit")
        os.environ["WORKER_JOB_BUDGET_MIN"] = "45"
        self.assertEqual(processor.job_budget_seconds("whole"), 45 * 60, "the operator's override wins")


if __name__ == "__main__":
    unittest.main()
