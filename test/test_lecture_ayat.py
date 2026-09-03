"""The renderer captions from the LECTURE's walk, not from the clip alone.

Youssef, 2 Sept 2026, on a recitation of Az-Zumar and An-Naba: "it didnt be
able to catch the quran only on like 2 out of 5 clips". v3.77.1 rebuilt the
matcher and took that from 6 captioned ayat (two of them the wrong verse) to
13 correct and none wrong -- and left ONE clip still captioning nothing, with
the reason written down in CLAUDE.md and the fix named as not done:

    "The fix for it is to caption from the LECTURE-wide ayah map rather than
     re-matching per clip at render time: the lecture walk does find verses
     across that clip's window."

That is what these tests pin. The walk existed and was used only to move a
clip's EDGES onto a verse; `write_ass` then threw it away and re-derived the
caption from the clip's own segments in isolation -- which is precisely the
isolation the walk exists to escape.
"""
import importlib.util
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

import quran as quran_module  # noqa: E402


# Az-Zumar 69-71: the stretch the failing clip sat in. Consecutive, so the
# walk has a recitation to follow rather than a bag of verses to search.
AYAHS = [
    {"surah": 39, "ayah": 69, "surahName": "Az-Zumar", "surahArabic": "الزمر",
     "arabic": "وَأَشْرَقَتِ الْأَرْضُ بِنُورِ رَبِّهَا وَوُضِعَ الْكِتَابُ وَجِيءَ بِالنَّبِيِّينَ وَالشُّهَدَاءِ",
     "translation": "And the Earth will shine with the Glory of its Lord"},
    {"surah": 39, "ayah": 70, "surahName": "Az-Zumar", "surahArabic": "الزمر",
     "arabic": "وَوُفِّيَتْ كُلُّ نَفْسٍ مَّا عَمِلَتْ وَهُوَ أَعْلَمُ بِمَا يَفْعَلُونَ",
     "translation": "And to every soul will be paid in full the fruit of its deeds"},
    {"surah": 39, "ayah": 71, "surahName": "Az-Zumar", "surahArabic": "الزمر",
     "arabic": "وَسِيقَ الَّذِينَ كَفَرُوا إِلَىٰ جَهَنَّمَ زُمَرًا حَتَّىٰ إِذَا جَاءُوهَا فُتِحَتْ أَبْوَابُهَا",
     "translation": "The Unbelievers will be led to Hell in crowds"},
]

# How Whisper actually wrote 39:71 on the clip that captioned nothing: letters
# dropped, words run together. Not invented -- the shape is the one CLAUDE.md
# records ("بجها لمذمرا" for "إلى جهنم زمرا"), damaged to the level that
# reproduces the failure.
DAMAGED = "وسيك الذي كفرو بجها لمذمرا حت جا اتحت بوبها"

LECTURE = [
    {"start": 0.0, "end": 6.0, "text": AYAHS[0]["arabic"]},
    {"start": 6.0, "end": 11.0, "text": AYAHS[1]["arabic"]},
    {"start": 11.0, "end": 18.0, "text": DAMAGED},
]
# The clip the scorer chose: it opens on the damaged verse, with the two clean
# ones behind it in the lecture and outside the clip.
CLIP_SEGMENTS = [LECTURE[2]]


def corpus():
    return quran_module.Corpus(AYAHS)


class ThePremiseTests(unittest.TestCase):
    """Prove the failure before pinning the fix, or the fix proves nothing."""

    def test_the_clips_own_words_reach_no_verse_at_all(self):
        found = corpus().match_sequence(DAMAGED)
        self.assertEqual(found, [], "matched in isolation, this clip captions nothing")

    def test_the_same_words_behind_the_lecture_reach_the_verse(self):
        passage = AYAHS[1]["arabic"] + " " + DAMAGED
        numbers = [hit["ayah"]["ayah"] for hit in corpus().match_sequence(passage)]
        self.assertIn(71, numbers,
                      "the verse before it turns a search into a named hypothesis")


class LectureMapTests(unittest.TestCase):
    def test_the_walk_places_the_verse_inside_the_clips_window(self):
        verses = worker.lecture_ayat(LECTURE, corpus())
        numbers = [hit["ayah"]["ayah"] for hit in verses]
        self.assertEqual(numbers, [69, 70, 71], "the whole recitation, in order")
        last = verses[-1]
        self.assertGreaterEqual(last["start"], 11.0 - 0.01,
                                "39:71 is timed where the clip actually starts")
        self.assertLessEqual(last["end"], 18.0 + 0.01)

    def test_the_snapper_reads_the_same_map_the_renderer_does(self):
        """One walk, so a clip's edges and its captions cannot disagree."""
        verses = worker.lecture_ayat(LECTURE, corpus())
        self.assertEqual(
            worker.ayah_spans(LECTURE, corpus()),
            [(hit["start"], hit["end"]) for hit in verses],
        )

    def test_no_corpus_is_an_empty_map_rather_than_a_failure(self):
        self.assertEqual(worker.lecture_ayat(LECTURE, None), [])


class AttachTests(unittest.TestCase):
    def _clip(self):
        return worker.Candidate(11.0, 18.0, DAMAGED, CLIP_SEGMENTS, 90, [], False)

    def test_the_verse_arrives_in_clip_local_time(self):
        """Invariant 5: media time and clip-local time are not the same number."""
        clip = self._clip()
        worker.attach_lecture_ayat([clip], worker.lecture_ayat(LECTURE, corpus()))
        self.assertEqual([hit["ayah"]["ayah"] for hit in clip.ayat], [71],
                         "only the verse inside this clip's window")
        self.assertLess(clip.ayat[0]["start"], 1.0,
                        "and it starts near the top of the clip, not at 11s")
        self.assertLessEqual(clip.ayat[0]["end"], clip.duration + 0.01)

    def test_a_clip_with_no_scripture_gets_an_empty_map_not_none(self):
        """Empty and absent are different statements.

        Empty means a lecture WAS walked and this clip holds no scripture.
        None means nobody walked one -- which is every re-render, and is what
        keeps the renderer's own per-segment match alive for that case.
        """
        clip = worker.Candidate(0.0, 6.0, "x", [LECTURE[0]], 90, [], False)
        worker.attach_lecture_ayat([clip], [])
        self.assertEqual(clip.ayat, [])
        self.assertIsNotNone(clip.ayat)


class RenderTests(unittest.TestCase):
    """The whole point: the ASS file has to carry the verse."""

    def _write(self, clip, mode="quran"):
        """Returns (the ASS text, the verses write_ass says it captioned).

        Both, because they answer different questions: the text is what libass
        will draw, and the returned rows are what the EDITOR draws its caption
        blocks from (invariant 4). A verse is one row and several events -- a
        long ayah is paged across the time it is recited -- so counting
        ",Ayah,," counts pages, not scripture.
        """
        quran_module._CORPUS = corpus()
        worker.quran = quran_module
        template = {
            "width": 1080, "height": 1920, "captionMode": mode,
            "captionArabicFont": "Amiri", "captionFont": "DejaVu Serif",
            "captionFontSize": 74, "captionTranslation": True, "captionMarginV": 420,
        }
        out = pathlib.Path(tempfile.mkdtemp()) / "c.ass"
        matched = worker.write_ass(clip, template, out)
        return out.read_text(encoding="utf-8"), matched

    def _render(self, clip, mode="quran"):
        return self._write(clip, mode)[0]

    def _clip_with_map(self):
        clip = worker.Candidate(11.0, 18.0, DAMAGED, CLIP_SEGMENTS, 90, [], False)
        worker.attach_lecture_ayat([clip], worker.lecture_ayat(LECTURE, corpus()))
        return clip

    def test_the_clip_that_captioned_nothing_now_carries_its_ayah(self):
        text = self._render(self._clip_with_map())
        self.assertIn(",Ayah,,", text)
        self.assertIn("وَسِيقَ", text, "the Uthmani text, not Whisper's damage")
        self.assertNotIn("وسيك", text, "and never the transcript's own spelling")

    def test_without_the_lecture_map_the_same_clip_captions_nothing(self):
        """The measurement that makes the one above mean something.

        This is the behaviour that shipped: the clip re-matched in isolation,
        finding nothing. If this ever starts passing an ayah through, the test
        above has stopped proving the fix.
        """
        bare = worker.Candidate(11.0, 18.0, DAMAGED, CLIP_SEGMENTS, 90, [], False)
        self.assertIsNone(bare.ayat, "a candidate nobody walked a lecture for")
        self.assertNotIn(",Ayah,,", self._render(bare))

    def test_a_lecture_template_gets_the_verse_too(self):
        """Choosing a font must not decide whether scripture is quoted right."""
        text = self._render(self._clip_with_map(), mode="phrase")
        self.assertIn(",Ayah,,", text)
        self.assertIn("وَسِيقَ", text)

    def test_the_verse_is_captioned_once_not_twice(self):
        """The map and the per-segment match must not both draw the stretch."""
        clean = [{"start": 11.0, "end": 18.0, "text": AYAHS[2]["arabic"]}]
        clip = worker.Candidate(11.0, 18.0, AYAHS[2]["arabic"], clean, 90, [], False)
        worker.attach_lecture_ayat(
            [clip], worker.lecture_ayat(LECTURE[:2] + clean, corpus()))
        text, matched = self._write(clip)
        self.assertEqual([(row["surah"], row["ayah"]) for row in matched], [(39, 71)],
                         "one verse, from whichever path knows it best -- not both")
        # And its pages run in sequence rather than on top of each other.
        spans = [
            (line.split(",")[1], line.split(",")[2])
            for line in text.splitlines() if ",Ayah,," in line
        ]
        self.assertEqual(spans, sorted(spans), "the verse is paged in order")

    def test_a_re_render_still_works_off_its_stored_transcript(self):
        """process_rerender rebuilds ONE segment and there is no lecture.

        CLAUDE.md: "Any future caption feature must be tested on a re-render,
        not only on a first render -- they take different paths through
        write_ass."
        """
        passage = " ".join(a["arabic"] for a in AYAHS)
        stored = [{"start": 0.0, "end": 18.0, "text": passage}]
        clip = worker.Candidate(0.0, 18.0, passage, stored, 90, [], False)
        self.assertIsNone(clip.ayat)
        text = self._render(clip)
        self.assertIn("وَأَشْرَقَتِ", text)
        self.assertIn("وَسِيقَ", text, "every verse of the passage, as before")


class CutTests(unittest.TestCase):
    """A cut moves the verses with everything else, or it moves nothing."""

    def test_the_map_is_retimed_through_a_cut(self):
        clip = worker.Candidate(
            10.0, 30.0, "x", [{"start": 10.0, "end": 30.0, "text": "x"}], 90, [], False,
            ayat=[
                {"start": 1.0, "end": 3.0, "ayah": AYAHS[0]},   # media 11-13, kept
                {"start": 6.0, "end": 8.0, "ayah": AYAHS[1]},   # media 16-18, CUT OUT
                {"start": 12.0, "end": 14.0, "ayah": AYAHS[2]},  # media 22-24, kept
            ],
        )
        # Keep 10-15 and 20-30 in media time: the middle five seconds go.
        moved = worker.retime_for_cuts(clip, [(10.0, 15.0), (20.0, 30.0)])
        numbers = [hit["ayah"]["ayah"] for hit in moved.ayat]
        self.assertEqual(numbers, [69, 71], "the verse inside the removed stretch is dropped")
        self.assertAlmostEqual(moved.ayat[0]["start"], 1.0, places=3, msg="before the cut, unmoved")
        self.assertAlmostEqual(moved.ayat[1]["start"], 7.0, places=3,
                               msg="after the cut, pulled left by the removed five seconds")

    def test_a_clip_with_no_map_keeps_none_through_a_cut(self):
        clip = worker.Candidate(0.0, 10.0, "x", [{"start": 0.0, "end": 10.0, "text": "x"}],
                                90, [], False)
        self.assertIsNone(worker.retime_for_cuts(clip, [(0.0, 5.0)]).ayat)


if __name__ == "__main__":
    unittest.main()
