import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("quran", ROOT / "worker" / "quran.py")
quran = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = quran
spec.loader.exec_module(quran)


# A handful of real ayahs, enough to exercise matching without a 3MB download in
# CI. The two from the reference clips are here deliberately.
FIXTURE = [
    {"surah": 23, "ayah": 36, "surahName": "Al-Mu'minun", "surahArabic": "المؤمنون",
     "arabic": "هَيْهَاتَ هَيْهَاتَ لِمَا تُوعَدُونَ",
     "translation": "Far, very far is that which ye are promised!"},
    {"surah": 53, "ayah": 39, "surahName": "An-Najm", "surahArabic": "النجم",
     "arabic": "وَأَن لَّيْسَ لِلْإِنسَٰنِ إِلَّا مَا سَعَىٰ",
     "translation": "That man can have nothing but what he strives for."},
    {"surah": 1, "ayah": 2, "surahName": "Al-Fatiha", "surahArabic": "الفاتحة",
     "arabic": "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ",
     "translation": "Praise be to Allah, the Cherisher and Sustainer of the worlds."},
    {"surah": 112, "ayah": 1, "surahName": "Al-Ikhlas", "surahArabic": "الإخلاص",
     "arabic": "قُلْ هُوَ ٱللَّهُ أَحَدٌ",
     "translation": "Say: He is Allah, the One and Only."},
]


class NormalisationTests(unittest.TestCase):
    """Whisper emits none of the marks the Uthmani script carries.

    Both sides are folded to the same form, or nothing ever matches.
    """

    def test_diacritics_are_stripped(self):
        self.assertEqual(
            quran.normalise("هَيْهَاتَ هَيْهَاتَ لِمَا تُوعَدُونَ"),
            quran.normalise("هيهات هيهات لما توعدون"),
        )

    def test_alef_forms_fold_together(self):
        for variant in ["أن", "إن", "آن", "ٱن"]:
            self.assertEqual(quran.normalise(variant), "ان", variant)

    def test_taa_marbuta_and_alef_maksura_fold(self):
        self.assertEqual(quran.normalise("سعى"), quran.normalise("سعي"))
        self.assertEqual(quran.normalise("صلاة"), quran.normalise("صلاه"))

    def test_latin_and_punctuation_are_dropped(self):
        self.assertEqual(quran.normalise("قل ,, hello هو"), "قل هو")


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.corpus = quran.Corpus(FIXTURE)

    def test_the_ayah_from_the_reference_clip_is_found(self):
        found = self.corpus.match("هيهات هيهات لما توعدون")
        self.assertIsNotNone(found)
        self.assertEqual((found["surah"], found["ayah"]), (23, 36))

    def test_a_loose_transcription_still_matches(self):
        # How Whisper actually renders it: no diacritics, plain alef.
        found = self.corpus.match("وان ليس للانسان الا ما سعى")
        self.assertEqual((found["surah"], found["ayah"]), (53, 39))

    def test_the_caption_uses_the_corpus_text_not_the_transcript(self):
        # The whole point: what goes on screen is the Quran's own words, with
        # its diacritics, not Whisper's approximation of them.
        found = self.corpus.match("قل هو الله احد")
        self.assertEqual(found["arabic"], "قُلْ هُوَ ٱللَّهُ أَحَدٌ")
        self.assertIn("He is Allah", found["translation"])

    def test_speech_about_the_quran_is_not_captioned_as_the_quran(self):
        # A confident wrong ayah on screen is far worse than no ayah: this is
        # scripture, and a lecture shares plenty of vocabulary with it.
        self.assertIsNone(self.corpus.match("قال الشيخ ان الصبر مفتاح الفرج"))
        self.assertIsNone(self.corpus.match("today we talk about patience"))
        self.assertIsNone(self.corpus.match(""))

    def test_a_single_common_word_is_not_enough(self):
        self.assertIsNone(self.corpus.match("الله"))

    def test_confidence_is_reported_so_a_caller_can_be_stricter(self):
        found = self.corpus.match("هيهات هيهات لما توعدون")
        self.assertGreater(found["confidence"], 0.9)


class AutoDetectionTests(unittest.TestCase):
    """Recited scripture is matched whatever template the clip is using.

    Ayah matching used to depend on the operator having picked the Quran
    template: the same recitation clipped with any other style put Whisper's
    approximation of the ayah on screen. Choosing a font must not decide
    whether scripture is quoted correctly.
    """

    def setUp(self):
        self.corpus = quran.Corpus(FIXTURE)

    def test_the_stricter_threshold_still_finds_a_real_recitation(self):
        # Auto-detection runs unasked, so it uses 0.72 rather than the Quran
        # mode's 0.55. A genuine recitation has to clear it comfortably.
        found = self.corpus.match("هيهات هيهات لما توعدون", minimum=0.72)
        self.assertIsNotNone(found)
        self.assertEqual((found["surah"], found["ayah"]), (23, 36))

    def test_ordinary_arabic_speech_is_left_as_spoken(self):
        # A false positive here would replace a lecture's own words with an
        # ayah nobody recited -- worse than leaving the transcript alone.
        for line in ["قال الشيخ ان الصبر مفتاح الفرج",
                     "اليوم نتكلم عن اهمية الصلاة في حياة المسلم",
                     "السلام عليكم ورحمة الله وبركاته"]:
            self.assertIsNone(self.corpus.match(line, minimum=0.72), line)

    def test_a_loose_transcription_of_a_real_ayah_still_matches(self):
        # Whisper drops diacritics and flattens alef forms; the stricter floor
        # must not throw away real recitations along with the false ones.
        found = self.corpus.match("وان ليس للانسان الا ما سعى", minimum=0.72)
        self.assertIsNotNone(found)
        self.assertEqual((found["surah"], found["ayah"]), (53, 39))


class OrnamentTests(unittest.TestCase):
    """The verse number sits inside U+06DD, the way a mushaf prints it."""

    def test_digits_are_arabic_indic(self):
        self.assertEqual(quran.arabic_number(39), "٣٩")
        self.assertEqual(quran.arabic_number(255), "٢٥٥")
        self.assertEqual(quran.arabic_number(1), "١")

    def test_the_ornament_follows_the_ayah(self):
        marked = quran.ayah_with_ornament("قُلْ هُوَ ٱللَّهُ أَحَدٌ", 1)
        self.assertTrue(marked.startswith("قُلْ"))
        self.assertIn("۝", marked, "end-of-ayah mark")
        self.assertTrue(marked.endswith("١"))


class CacheTests(unittest.TestCase):
    def test_a_truncated_corpus_is_refused_rather_than_half_loaded(self):
        # A short download must not leave the matcher quietly missing most of
        # the book and confidently matching the wrong ayah from what is left.
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "quran.json"
            path.write_text(json.dumps({"ayahs": FIXTURE}), encoding="utf-8")
            quran._CORPUS = None
            self.assertIsNone(quran.load(path))

    def test_a_missing_corpus_is_absent_not_fatal(self):
        # A worker without the download still has to render ordinary clips.
        quran._CORPUS = None
        self.assertIsNone(quran.load(pathlib.Path("/nonexistent/quran.json")))


if __name__ == "__main__":
    unittest.main()
