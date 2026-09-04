"""A recitation clip opens on an ayah, and its edges do not race.

Youssef, 3 Sept 2026, on the shipped Quran sync: "quran recitation sync is
GREAT but the start and end, it's like it's finding the aya, so what happens is
it goes through QUICKLY to find where the reciter is speaking" -- then, in the
same sitting: "best way of fixing ALWAYS find ayas when the clipper finds only
for quran recitation ALWAYS FIND THE START of a AYA."

Two faults, and they compound. MEASURED before either was designed, on a real
twenty-second verse of twelve words paged four at a time:

    clip opens AT the verse start   ->  6.67s / 6.66s / 6.67s
    clip opens with 3s of it left   ->  1.33s / 0.67s / 1.00s
    clip opens with 1s of it left   ->  0.33s / 0.34s / 0.33s
    clip ENDS 1s into the verse     ->  0.33s / 0.34s / 0.33s

A third of a second a page, each with a fade in and a fade out. That is the
"goes through QUICKLY", exactly.

1. `ayah_events` was handed the WHOLE verse and only the transcript words that
   survived the cut, so it spread twelve words across whatever time was left.
   It now knows WHICH words survived (`wordFrom`/`wordCount`, recorded by
   attach_lecture_ayat) and draws only the pages actually recited here.
2. `snap_clips_to_ayat` treated the alignment as an improvement to be
   abandoned whenever it did not fit, so the clips that raced were exactly the
   ones it gave up on. The start is now non-negotiable and the END gives way.
"""
import importlib.util
import pathlib
import re
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)


# Az-Zumar 71, the verse from the recitation that prompted all of this, padded
# to twelve words so it pages three ways at AYAH_MAX_WORDS.
AYAH = {
    "surah": 39, "ayah": 71, "surahName": "Az-Zumar",
    "arabic": ("وَسِيقَ الَّذِينَ كَفَرُوا إِلَىٰ جَهَنَّمَ زُمَرًا "
               "حَتَّىٰ إِذَا جَاءُوهَا فُتِحَتْ أَبْوَابُهَا وَقَالَ"),
    "translation": "The Unbelievers will be led to Hell in crowds until when they arrive there",
}
VERSE_START, VERSE_END = 100.0, 120.0
WORDS = AYAH["arabic"].split()
STEP = (VERSE_END - VERSE_START) / len(WORDS)
# One walk's answer for this verse: where it was recited, and when Whisper
# heard each of its words.
LECTURE = [{
    "start": VERSE_START, "end": VERSE_END, "ayah": AYAH,
    "words": [(VERSE_START + STEP * i, VERSE_START + STEP * (i + 1)) for i in range(len(WORDS))],
}]
ORNAMENT = "۝٧١"


def seconds(stamp: str) -> float:
    hours, minutes, rest = stamp.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(rest)


def pages(clip_start: float, duration: float) -> list[tuple[float, float, str]]:
    """Drive the REAL chain -- the clip-local conversion and then the pager --
    and read the Dialogue lines that come out. Executed output, not source."""
    candidate = worker.Candidate(start=clip_start, end=clip_start + duration, text="",
                                 segments=[], score=80, reasons=[], quote_risk=True)
    worker.attach_lecture_ayat([candidate], LECTURE)
    if not candidate.ayat:
        return []
    hit = candidate.ayat[0]
    events = worker.ayah_events(
        AYAH, ornament=ORNAMENT, start=hit["start"], end=hit["end"],
        latin_font="Outfit", translation_size=40, show_translation=True,
        ayah_size=120, mark_size=90, ayah_font="Amiri",
        word_times=hit.get("words"),
        word_offset=hit.get("wordFrom", 0), word_count=hit.get("wordCount", 0),
    )
    out = []
    for line in events:
        stamps = re.match(r"Dialogue: 2,([\d:.]+),([\d:.]+),", line)
        out.append((seconds(stamps.group(1)), seconds(stamps.group(2)),
                    line.split(",,0,0,0,,", 1)[1]))
    return out


class PagingAtTheEdgesTests(unittest.TestCase):
    """A page nobody recited inside this clip is not a page."""

    def test_a_whole_verse_is_paged_exactly_as_it_always_was(self):
        # The safety property. Everything below only changes what happens at a
        # clip's edges; the ordinary case must not move by a millisecond.
        drawn = pages(VERSE_START, 30.0)
        self.assertEqual(len(drawn), 3)
        lengths = [round(b - a, 2) for a, b, _ in drawn]
        self.assertEqual(lengths, [6.67, 6.66, 6.67])

    def test_A_VERSE_THE_CLIP_OPENS_ONE_SECOND_BEFORE_THE_END_OF_DOES_NOT_RACE(self):
        # The measurement that started this: three pages in 1.0s, 0.33s each.
        drawn = pages(119.0, 30.0)
        self.assertEqual(len(drawn), 1,
                         "only the page whose words were recited inside the clip")
        start, end, _ = drawn[0]
        self.assertAlmostEqual(end - start, 1.0, places=2,
                               msg="and it keeps the whole second it has")

    def test_the_same_at_the_other_edge(self):
        # A clip that ENDS one second into a verse. Identical shape, mirrored.
        drawn = pages(96.0, 5.0)
        self.assertEqual(len(drawn), 1)
        start, end, _ = drawn[0]
        self.assertAlmostEqual(end - start, 1.0, places=2)

    def test_the_page_drawn_is_the_one_being_recited(self):
        """Which page survives is the whole point, and it needs the OFFSET.

        A clip opening one second before the verse ends is hearing its LAST
        four words. Knowing only that one transcript word survived -- without
        knowing it was word twelve of twelve -- draws the wrong page.
        """
        opening = pages(119.0, 30.0)[0][2]
        closing = pages(96.0, 5.0)[0][2]
        self.assertIn(worker.ass_escape(WORDS[-1]), opening, "the verse's last word")
        self.assertIn(worker.ass_escape(WORDS[0]), closing, "and its first")
        self.assertNotIn(worker.ass_escape(WORDS[0]), opening)

    def test_the_verse_mark_closes_a_verse_that_actually_finished(self):
        """A clip ending part way through a verse has not reached the end of
        it, so nothing is closed and no ornament is drawn.

        The clip here ends after the verse's TENTH word of twelve, so its last
        page is drawn -- the words are being recited -- and simply carries no
        mark. Ending it earlier would prove nothing: the last page would not
        be drawn at all and the ornament would be absent for a different
        reason. A probe that removed the guard came back GREEN against the
        first version of this test, which is how that was found.
        """
        self.assertIn(ORNAMENT, pages(119.0, 30.0)[-1][2],
                      "the verse does finish inside this clip")
        unfinished = pages(96.0, 20.0)
        self.assertEqual(len(unfinished), 3, "its last page IS drawn")
        self.assertNotIn(ORNAMENT, unfinished[-1][2], "and closes nothing")

    def test_a_transcript_with_no_word_times_takes_the_path_it_always_did(self):
        # An older transcript, or a re-render: every page is drawn and the
        # ruler shares the verse's time out, exactly as before.
        events = worker.ayah_events(
            AYAH, ornament=ORNAMENT, start=0.0, end=12.0,
            latin_font="Outfit", translation_size=40, show_translation=True,
            ayah_size=120, mark_size=90, ayah_font="Amiri", word_times=None)
        self.assertEqual(len(events), 3)
        self.assertIn(ORNAMENT, events[-1])


class AttachRecordsWhatSurvivedTests(unittest.TestCase):
    def test_it_records_which_words_are_here_not_only_how_many(self):
        candidate = worker.Candidate(start=119.0, end=149.0, text="", segments=[],
                                     score=80, reasons=[], quote_risk=True)
        worker.attach_lecture_ayat([candidate], LECTURE)
        hit = candidate.ayat[0]
        self.assertEqual(hit["wordCount"], len(WORDS), "the verse's own length")
        self.assertEqual(hit["wordFrom"], len(WORDS) - 1,
                         "and that this clip holds only its last word")

    def test_a_clip_holding_the_whole_verse_starts_at_word_zero(self):
        candidate = worker.Candidate(start=VERSE_START, end=VERSE_START + 30.0, text="",
                                     segments=[], score=80, reasons=[], quote_risk=True)
        worker.attach_lecture_ayat([candidate], LECTURE)
        hit = candidate.ayat[0]
        self.assertEqual(hit["wordFrom"], 0)
        self.assertEqual(len(hit["words"]), len(WORDS))


# Four verses back to back, the shape a recitation actually has. The last is
# deliberately FORTY-FIVE seconds long: a verse more than twice the old
# AYAH_SNAP_TOLERANCE has a middle from which neither its own start nor the
# next verse is within that tolerance, and that is the only place the
# opening-verse reach is the difference between snapping and giving up. A
# probe that removed the reach came back GREEN against a fixture of ordinary
# twenty-second verses, which is how this was found.
SPANS = [(100.0, 120.0), (120.0, 140.0), (140.0, 155.0), (155.0, 200.0)]
AYAT = [{"start": a, "end": b, "ayah": AYAH} for a, b in SPANS]
SEGMENTS = [{"start": a, "end": b, "text": "x"} for a, b in SPANS]


def snapped(start: float, end: float, minimum: float = 20, maximum: float = 90):
    candidate = worker.Candidate(start=start, end=end, text="", segments=list(SEGMENTS),
                                 score=80, reasons=[], quote_risk=True)
    worker.snap_clips_to_ayat([candidate], SEGMENTS, {"captionMode": "quran"},
                              {"clipMinSeconds": minimum, "clipMaxSeconds": maximum},
                              ayat=AYAT)
    return candidate


class AlwaysStartOnAnAyahTests(unittest.TestCase):
    """"ALWAYS FIND THE START of a AYA." Driven, at every cut."""

    def test_every_cut_inside_the_recitation_opens_on_a_verse(self):
        begins = {a for a, _ in SPANS}
        for cut in (100.0, 103.0, 110.0, 117.0, 119.0, 121.0, 130.0, 139.0):
            with self.subTest(cut=cut):
                clip = snapped(cut, cut + 30.0)
                self.assertTrue(any(abs(clip.start - begin) < 0.01 for begin in begins),
                                f"cut at {cut} opened at {clip.start}")

    def test_the_old_twelve_second_tolerance_could_not_reach_the_verse(self):
        # 117.0 is seventeen seconds into a twenty-second verse -- beyond
        # AYAH_SNAP_TOLERANCE from its start, which is why the clip that raced
        # was left where it was. The reach is now the verse, not a number.
        self.assertGreater(117.0 - SPANS[0][0], worker.AYAH_SNAP_TOLERANCE)
        self.assertAlmostEqual(snapped(117.0, 147.0).start, 120.0, places=2)

    def test_A_CUT_DEEP_INSIDE_A_LONG_VERSE_STILL_OPENS_ON_IT(self):
        """The case the old tolerance could not serve at all, and the one that
        raced: a cut in the middle of a long verse is more than twelve seconds
        from that verse's start AND from the next verse's, so the old code left
        it exactly where it was -- opening mid-verse, which is what made
        ayah_events page a verse it had only the tail of."""
        begin, finish = SPANS[-1]
        middle = begin + 22.0
        self.assertGreater(middle - begin, worker.AYAH_SNAP_TOLERANCE)
        self.assertGreater(finish - middle, worker.AYAH_SNAP_TOLERANCE)
        self.assertAlmostEqual(snapped(middle, middle + 30.0).start, begin, places=2)

    def test_the_nearest_verse_start_wins_forward_or_back(self):
        """A clip opening one second before a verse ends belongs at the NEXT
        verse, a second away -- not nineteen seconds back at the start of the
        one it is leaving, which would throw away most of the moment."""
        self.assertAlmostEqual(snapped(139.0, 169.0).start, 140.0, places=2)
        self.assertAlmostEqual(snapped(121.0, 151.0).start, 120.0, places=2)

    def test_the_end_gives_way_so_the_start_can_hold(self):
        # A 25s maximum cannot hold verse 1 from its start, so the end moves in
        # and the clip still opens on a verse. Under the old rule the whole
        # snap was abandoned here, start included.
        clip = snapped(117.0, 147.0, minimum=20, maximum=25)
        self.assertAlmostEqual(clip.start, 120.0, places=2)
        self.assertLessEqual(clip.duration, 25.0 + 0.01)
        self.assertGreaterEqual(clip.duration, 20.0 - 0.01)

    def test_a_cut_nowhere_near_the_recitation_is_left_alone(self):
        clip = snapped(40.0, 70.0)
        self.assertAlmostEqual(clip.start, 40.0, places=2)
        self.assertAlmostEqual(clip.end, 70.0, places=2)


if __name__ == "__main__":
    unittest.main()
