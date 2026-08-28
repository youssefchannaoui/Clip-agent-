"""Auto-detect means both languages, switching as it hears them.

Youssef, 28 Aug 2026: "auto detect should do BOTH ARABIC AND ENLISH AND SHOULD
SWITCH WHEN DETECT ... UNLESS SELECTED A SPEFICI LANAGUAGE NOT AUTO DETECT".

Whisper's own default detects ONE language from the opening seconds and applies
it to the whole lecture. An English talk with recitation in the middle came back
with the Arabic transcribed as Latin nonsense -- and once that happened nothing
downstream could tell it was Arabic, because by then it was not: no Arabic face,
no ayah match, no translation line.
"""
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw


class FakeSegment:
    def __init__(self, start, end, text):
        self.start, self.end, self.text, self.words = start, end, text, []


class FakeInfo:
    def __init__(self, language):
        self.language = language


class FakeModel:
    """Records what it was asked for, and answers with a mixed lecture."""

    calls: list[dict] = []

    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, _audio, **kwargs):
        FakeModel.calls.append(kwargs)
        if kwargs.get("task") == "translate":
            return ([FakeSegment(4.0, 8.0, "It is We Who created you")], FakeInfo("ar"))
        return ([
            FakeSegment(0.0, 4.0, "Listen to what Allah says about this"),
            FakeSegment(4.0, 8.0, "نحن خلقناكم"),
        ], FakeInfo("en"))


def run(settings):
    FakeModel.calls = []
    sys.modules["faster_whisper"] = types.SimpleNamespace(WhisperModel=FakeModel)
    job = {"settings": settings}
    return cw.FasterWhisperBackend().transcribe(job, Path("/tmp/does-not-matter.wav"), 8.0)


class BilingualAutoTests(unittest.TestCase):
    def test_auto_asks_for_per_segment_detection(self):
        run({})
        first = FakeModel.calls[0]
        self.assertTrue(first.get("multilingual"), "auto must detect per segment, not once per file")
        self.assertNotIn("language", first, "and must not pin one language for the lecture")

    def test_choosing_a_language_pins_it(self):
        run({"language": "ar"})
        first = FakeModel.calls[0]
        self.assertEqual(first.get("language"), "ar")
        self.assertFalse(first.get("multilingual"), "a chosen language is a decision, not a hint")

    def test_arabic_inside_an_english_lecture_still_gets_its_english_line(self):
        segments = run({})
        tasks = [call.get("task") for call in FakeModel.calls]
        self.assertIn("translate", tasks,
                      "the file was detected English; the recitation in it still needs translating")
        recited = [item for item in segments if cw.contains_arabic(item["text"])]
        self.assertTrue(recited, "the Arabic survived as Arabic")
        self.assertTrue(str(recited[0].get("english") or "").strip(),
                        "and carries the English that goes under it")

    def test_an_all_english_lecture_is_not_translated_for_nothing(self):
        class EnglishOnly(FakeModel):
            def transcribe(self, _audio, **kwargs):
                FakeModel.calls.append(kwargs)
                return ([FakeSegment(0.0, 4.0, "Every word of this is English")], FakeInfo("en"))

        FakeModel.calls = []
        sys.modules["faster_whisper"] = types.SimpleNamespace(WhisperModel=EnglishOnly)
        cw.FasterWhisperBackend().transcribe({"settings": {}}, Path("/tmp/x.wav"), 4.0)
        self.assertEqual([call.get("task") for call in FakeModel.calls].count("translate"), 0)

    def test_an_older_whisper_without_per_segment_detection_still_runs(self):
        class OldWhisper(FakeModel):
            def transcribe(self, _audio, **kwargs):
                if kwargs.get("multilingual"):
                    raise TypeError("transcribe() got an unexpected keyword argument 'multilingual'")
                FakeModel.calls.append(kwargs)
                return ([FakeSegment(0.0, 4.0, "Plain English")], FakeInfo("en"))

        FakeModel.calls = []
        sys.modules["faster_whisper"] = types.SimpleNamespace(WhisperModel=OldWhisper)
        segments = cw.FasterWhisperBackend().transcribe({"settings": {}}, Path("/tmp/x.wav"), 4.0)
        self.assertEqual(len(segments), 1, "one language for the file is worse, not a failed job")


if __name__ == "__main__":
    unittest.main()
