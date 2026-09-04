"""A recitation is titled as a REFERENCE; a lecture is titled as a promise.

Youssef, 4 Sept 2026: "for Quran recitations ... maybe try have a search, see
how on TikTok and YouTube they do Quran recitation titles, because titles for
those are very different to just regular lectures. Two different types."

Researched rather than guessed. Short-form recitation titles are built on the
SURAH NAME and the VERSE NUMBERS, because that is what somebody types into the
search box -- "Surah Al-Mulk", "Surah Ar-Rahman" -- where a lecture clip is
found by a hook it promises. Reciter names and a quality word are the other two
conventions; the reciter is deliberately NOT used here (see below).

The whole reason this can be built at all is that NOTHING IS GENERATED. The
matcher's own map is on the candidate (`Candidate.ayat`), so the surah and the
numbers are facts. Asking qwen3:1.7b for them would be asking it to remember
scripture, which is the one thing this product must never do.
"""
import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

ZUMAR_71 = ("And those who disbelieved will be driven to Hell in groups until "
            "when they reach it its gates are opened")


def ayah(surah, number, name, translation=""):
    return {"surah": surah, "ayah": number, "surahName": name,
            "arabic": "", "translation": translation}


def clip(duration, ayat, ai_title="A model's line about hope"):
    c = worker.Candidate(start=0.0, end=duration, text="a lecture about patience",
                         segments=[], score=80, reasons=[], quote_risk=True)
    c.ayat = ayat
    c.ai_title = ai_title
    return c


class RecitationTitleTests(unittest.TestCase):
    def test_a_run_of_verses_is_a_range(self):
        c = clip(30, [
            {"start": 0, "end": 10, "ayah": ayah(39, 71, "Az-Zumar", ZUMAR_71)},
            {"start": 10, "end": 20, "ayah": ayah(39, 72, "Az-Zumar", "It will be said enter the gates")},
            {"start": 20, "end": 29, "ayah": ayah(39, 73, "Az-Zumar", "But those who feared their Lord")},
        ])
        self.assertEqual(worker.ship_title(c, 1), "Surah Az-Zumar 71-73")

    def test_A_GAP_IS_LISTED_NOT_SMOOTHED(self):
        """Claiming a range the clip does not recite is the same fault as
        inventing a speaker -- somebody arrives for 78:32 and it is not there."""
        c = clip(30, [
            {"start": 0, "end": 10, "ayah": ayah(78, 31, "An-Naba", "Indeed for the righteous is attainment")},
            {"start": 10, "end": 19, "ayah": ayah(78, 33, "An-Naba", "")},
        ])
        self.assertIn("31, 33", worker.ship_title(c, 1))
        self.assertNotIn("31-33", worker.ship_title(c, 1))

    def test_a_clip_crossing_two_surahs_names_both(self):
        c = clip(30, [
            {"start": 0, "end": 14, "ayah": ayah(78, 40, "An-Naba", "")},
            {"start": 14, "end": 28, "ayah": ayah(79, 1, "An-Naziat", "")},
        ])
        self.assertEqual(worker.ship_title(c, 1), "Surah An-Naba 40 & Surah An-Naziat 1")

    def test_the_clause_is_the_verse_s_OWN_translation(self):
        # The only hook a recitation title may carry is scripture's own
        # meaning. Every word here is in the corpus.
        c = clip(12, [{"start": 0, "end": 11, "ayah": ayah(112, 1, "Al-Ikhlas", "Say He is Allah who is One")}])
        title = worker.ship_title(c, 1)
        self.assertTrue(title.startswith("Surah Al-Ikhlas 1"))
        self.assertIn("Say He is Allah who is One", title)

    def test_the_reference_survives_when_the_clause_will_not_fit(self):
        long_gloss = "And it is He who created the heavens and the earth in truth and the day He says be and it is"
        c = clip(20, [{"start": 0, "end": 19, "ayah": ayah(6, 73, "Al-Anam", long_gloss)}])
        title = worker.ship_title(c, 1)
        self.assertLessEqual(len(title), worker.RECITATION_TITLE_MAX)
        self.assertIn("Surah Al-Anam 73", title)

    def test_A_LECTURE_QUOTING_ONE_AYAH_KEEPS_ITS_HOOK(self):
        """The signal is COVERAGE, not the template -- scripture is captioned
        on every template (invariant 7), so a khutbah quoting 2:286 in passing
        would otherwise be retitled as a recitation of it."""
        c = clip(60, [{"start": 20, "end": 31, "ayah": ayah(2, 286, "Al-Baqarah", "Allah does not charge a soul")}])
        self.assertEqual(worker.ship_title(c, 1), "A model's line about hope")

    def test_a_clip_with_no_scripture_is_untouched(self):
        self.assertEqual(worker.ship_title(clip(40, []), 1), "A model's line about hope")
        c = clip(40, None)
        self.assertEqual(worker.ship_title(c, 1), "A model's line about hope")

    def test_it_beats_the_model_rather_than_falling_back_to_it(self):
        # The model has neither the surah nor the numbers to work from, so its
        # line about a recitation is a guess at what the verses mean. The
        # reference is a fact and wins.
        c = clip(30, [
            {"start": 0, "end": 29, "ayah": ayah(67, 1, "Al-Mulk", "Blessed is He in whose hand is dominion")},
        ], ai_title="The Verse That Changes Everything")
        self.assertTrue(worker.ship_title(c, 1).startswith("Surah Al-Mulk 1"))

    def test_a_missing_surah_name_still_gives_a_usable_reference(self):
        c = clip(20, [{"start": 0, "end": 19, "ayah": ayah(55, 13, "", "")}])
        self.assertEqual(worker.ship_title(c, 1), "Quran 55:13")

    def test_every_recitation_title_is_still_english(self):
        # ship_title's own law: nothing reaches a channel in Arabic script.
        c = clip(30, [{"start": 0, "end": 29, "ayah": ayah(36, 1, "Ya-Sin", "")}])
        self.assertTrue(worker.is_english_title(worker.ship_title(c, 1)))


if __name__ == "__main__":
    unittest.main()


class ClipStyleTests(unittest.TestCase):
    """The named shapes a customer can press in the clip preview.

    Youssef, 4 Sept 2026: "integrate DeenAI to everything ... do AI changes and
    etcetera, like with the titling and all that and the description as well."
    Researched against what the other clippers offer -- OpusClip regenerates a
    title "in various styles including interesting, catchy, serious, and
    question formats" -- but the shapes here are the ones clip_worker's OWN
    prompt already names, so a chip in the studio and a title written during a
    render mean the same thing rather than two vocabularies drifting apart.
    """

    def setUp(self):
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "worker"))
        import service
        self.service = service

    def test_the_shapes_are_the_automatic_titler_s_own(self):
        # If clip_worker stops naming a shape, the chip offering it is selling
        # something the model is no longer told how to write.
        worker = (pathlib.Path(__file__).resolve().parent.parent
                  / "worker" / "clip_worker.py").read_text(encoding="utf-8")
        self.assertIn("The plain promise", worker)
        self.assertIn("The question the clip answers", worker)
        self.assertIn("Subject, colon, payoff", worker)
        for key in ("promise", "question", "subject"):
            self.assertIn(key, self.service.CLIP_STYLES)

    def test_the_counted_list_is_deliberately_not_offered(self):
        # It is only right when the clip genuinely enumerates. A chip that
        # quietly does something else on most clips is worse than no chip.
        self.assertNotIn("counted", self.service.CLIP_STYLES)

    def test_a_shape_never_overrides_the_recitation_reference(self):
        """THE LOAD-BEARING ONE.

        A verse reference is the right title for a recitation whatever shape is
        asked for, and pushing scripture through a 1.7B model to make it punchy
        is the one thing this product must never do. So a style must NOT count
        as "the customer asked for something specific" -- only typed text does.
        """
        rows = [{"surah": 112, "surahName": "Al-Ikhlas", "ayah": 1,
                 "arabic": "قُلْ هُوَ ٱللَّهُ أَحَدٌ", "translation": "Say, He is Allah, who is One"}]
        # No OLLAMA_URL is set here, so reaching the model raises. Coming back
        # with a reference proves it never tried.
        out = self.service.retitle_clip({"kind": "title", "ayahs": rows, "style": "question",
                                         "text": "قل هو الله أحد"})
        self.assertEqual(out["source"], "reference")
        self.assertIn("Al-Ikhlas", out["title"])

    def test_typed_text_still_overrides_it(self):
        # "make the title Arabic" is the customer choosing, and that is the one
        # thing that may take a recitation to the model.
        rows = [{"surah": 112, "surahName": "Al-Ikhlas", "ayah": 1,
                 "arabic": "قُلْ هُوَ ٱللَّهُ أَحَدٌ", "translation": "Say, He is Allah, who is One"}]
        with self.assertRaises(RuntimeError):
            self.service.retitle_clip({"kind": "title", "ayahs": rows,
                                       "instruction": "make it Arabic", "text": "قل هو الله أحد"})

    def test_hashtags_are_for_descriptions_and_say_where_they_come_from(self):
        rule = self.service.CLIP_STYLES["hashtags"]
        self.assertIn("what this clip", rule)
        # The register this content must not borrow -- the same rule the titler
        # already carries.
        self.assertIn("viral", rule)
