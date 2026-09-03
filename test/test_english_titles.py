"""Every title ships in English, whatever language the clip is spoken in.

Youssef, 3 Sept 2026: "AI titling needs SO MUCH IMPROVING AND ONLY WRITTEN IN
ENGLISH ALL TITLES."

Three things produced a title and all three could produce Arabic: the model
(the prompt never mentioned language), the fallback titler and the dedupe (both
read `clip.text`, which for an Arabic clip IS Arabic). Whisper's English
translation had been sitting on `segment["english"]` since the bilingual pass
shipped, read by the caption path and by nothing that names a clip.
"""
import importlib.util
import io
import json
import pathlib
import sys
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

ARABIC = "إن الصبر مفتاح الفرج. من صبر ظفر. والله مع الصابرين."
ENGLISH_OF_IT = "Patience is the key to relief. Whoever is patient prevails. And Allah is with the patient."


def arabic_clip(with_translation=True):
    segments = [
        {"start": 0.0, "end": 4.0, "text": "إن الصبر مفتاح الفرج.",
         **({"english": "Patience is the key to relief."} if with_translation else {})},
        {"start": 4.0, "end": 7.0, "text": "من صبر ظفر.",
         **({"english": "Whoever is patient prevails."} if with_translation else {})},
        {"start": 7.0, "end": 10.0, "text": "والله مع الصابرين.",
         **({"english": "And Allah is with the patient."} if with_translation else {})},
    ]
    return worker.Candidate(0.0, 10.0, ARABIC, segments, 80, [], False)


def english_clip():
    seg = [{"start": 0.0, "end": 10.0, "text": "So brothers, patience is the key to relief. Whoever is patient prevails."}]
    return worker.Candidate(0.0, 10.0, seg[0]["text"], seg, 80, [], False)


class ScriptTests(unittest.TestCase):
    def test_latin_script_arabic_words_are_english_titles(self):
        for title in ("Sabr: what patience really means", "Why Allah loves the patient - Omar Suleiman", "Make dua like this"):
            self.assertTrue(worker.is_english_title(title), title)

    def test_any_arabic_script_is_refused(self):
        self.assertFalse(worker.is_english_title("الصبر مفتاح الفرج"))
        self.assertFalse(worker.is_english_title("Patience is الصبر"), "one Arabic word is enough")
        self.assertFalse(worker.is_english_title(""))
        self.assertFalse(worker.is_english_title("   "))

    def test_arabic_share_reads_letters_not_punctuation(self):
        self.assertEqual(worker.arabic_share("..."), 0.0)
        self.assertGreater(worker.arabic_share(ARABIC), 0.9)
        self.assertLess(worker.arabic_share(ENGLISH_OF_IT), 0.1)


class ClipEnglishTests(unittest.TestCase):
    def test_an_english_clip_keeps_its_own_words(self):
        clip = english_clip()
        self.assertEqual(worker.clip_english(clip), clip.text)

    def test_an_arabic_clip_is_read_through_its_translation(self):
        self.assertEqual(worker.clip_english(arabic_clip()), ENGLISH_OF_IT)

    def test_an_arabic_clip_with_no_translation_keeps_its_own_words(self):
        # An older faster-whisper with no translate pass. Honest rather than
        # invented; ship_title then refuses to let it reach a channel.
        clip = arabic_clip(with_translation=False)
        self.assertEqual(worker.clip_english(clip), ARABIC)

    def test_a_translation_repeated_across_segments_is_said_once(self):
        # attach_english copies one translated line onto every segment it
        # overlaps, so a long line can land on two neighbours.
        segments = [
            {"start": 0.0, "end": 3.0, "text": "إن الصبر", "english": "Patience is the key."},
            {"start": 3.0, "end": 6.0, "text": "مفتاح الفرج", "english": "Patience is the key."},
        ]
        clip = worker.Candidate(0.0, 6.0, "إن الصبر مفتاح الفرج", segments, 80, [], False)
        self.assertEqual(worker.clip_english(clip), "Patience is the key.")


class ShipTitleTests(unittest.TestCase):
    def test_an_english_ai_title_ships_as_is(self):
        clip = arabic_clip()
        clip.ai_title = "Patience is the key to relief - Omar Suleiman"
        self.assertEqual(worker.ship_title(clip, 1), clip.ai_title)

    def test_the_fallback_reads_the_translation_not_the_arabic(self):
        title = worker.ship_title(arabic_clip(), 1)
        self.assertTrue(worker.is_english_title(title), title)
        self.assertIn("Patience", title)

    def test_no_translation_means_the_numbered_english_fallback(self):
        title = worker.ship_title(arabic_clip(with_translation=False), 3)
        self.assertEqual(title, "Important reminder 3")

    def test_an_arabic_ai_title_never_ships(self):
        # ai_title is normally scrubbed in apply_clip_rows; this is the last
        # gate, for a stored title from before the rule.
        clip = arabic_clip()
        clip.ai_title = "الصبر مفتاح الفرج"
        self.assertTrue(worker.is_english_title(worker.ship_title(clip, 1)))


class ModelRowTests(unittest.TestCase):
    """The prompt says English twice; a 1.7B model treats that as a suggestion."""

    def test_an_arabic_row_title_is_refused_and_the_translation_titles_it(self):
        clip = arabic_clip()
        applied: set[int] = set()
        worker.apply_clip_rows(
            [{"index": 0, "score": 80, "title": "الصبر مفتاح الفرج", "description": "x", "reason": "y"}],
            [clip], 0, applied, "",
        )
        self.assertEqual(clip.ai_title, "", "the Arabic title was not accepted")
        shipped = worker.ship_title(clip, 1)
        self.assertTrue(worker.is_english_title(shipped), shipped)
        self.assertIn("Patience", shipped, "and the fallback read the translation")

    def test_an_english_row_title_is_kept(self):
        clip = arabic_clip()
        worker.apply_clip_rows(
            [{"index": 0, "score": 80, "title": "Why patience unlocks relief", "description": "x", "reason": "y"}],
            [clip], 0, set(), "",
        )
        self.assertEqual(clip.ai_title, "Why patience unlocks relief")

    def test_a_copy_of_the_translation_is_caught_as_copied(self):
        # looks_copied used to compare against the ARABIC text, so a model that
        # read the English and handed its first sentence back sailed through.
        clip = arabic_clip()
        worker.apply_clip_rows(
            [{"index": 0, "score": 80, "title": "Patience is the key to relief. Whoever is", "description": "x", "reason": "y"}],
            [clip], 0, set(), "",
        )
        self.assertEqual(clip.ai_title, "", "a sentence copied out of the translation is not a title")


class PromptTests(unittest.TestCase):
    """The bytes that go to Ollama, not the source that builds them."""

    def _prompt_sent(self, clip):
        sent = {}

        def fake_urlopen(request, timeout=None):
            sent["body"] = json.loads(request.data.decode("utf-8"))
            reply = json.dumps({"response": json.dumps({"clips": [
                {"index": 0, "score": 70, "title": "Patience unlocks relief", "description": "d", "reason": "r"}]})}).encode()
            return io.BytesIO(reply)

        with mock.patch.object(worker.urllib.request, "urlopen", fake_urlopen):
            worker.refine_with_ollama([clip], {"ollamaUrl": "http://x", "ollamaModel": "m"}, "")
        return str(sent["body"].get("prompt") or "")

    def test_the_rule_is_stated_and_restated_before_the_data(self):
        prompt = self._prompt_sent(english_clip())
        self.assertIn("LANGUAGE. Every title and every description is written in ENGLISH", prompt)
        # The restatement sits after the rules and BEFORE the transcript data,
        # which on this model is the only place a rule reliably lands.
        restated = prompt.rindex("IN ENGLISH")
        self.assertGreater(restated, prompt.index("LANGUAGE."))
        self.assertLess(restated, prompt.index("TRANSCRIPT DATA"))

    def test_an_arabic_clip_is_shown_to_the_model_in_english(self):
        prompt = self._prompt_sent(arabic_clip())
        self.assertIn("Patience is the key to relief", prompt, "the model reads the translation")
        self.assertNotIn("الصبر مفتاح", prompt, "not the Arabic it cannot title in English")


class DedupeTests(unittest.TestCase):
    def test_two_arabic_clips_on_one_moment_resolve_in_english(self):
        a, b = arabic_clip(), arabic_clip()
        worker.dedupe_clip_titles([a, b])
        self.assertTrue(worker.is_english_title(a.ai_title), a.ai_title)
        self.assertTrue(worker.is_english_title(b.ai_title), b.ai_title)
        self.assertNotEqual(worker.normalise_title(a.ai_title), worker.normalise_title(b.ai_title),
                            "resolved from the clip's own later sentences, in English")


if __name__ == "__main__":
    unittest.main()
