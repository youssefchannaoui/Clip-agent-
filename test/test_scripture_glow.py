"""The scripture caption is a soft shadow, not a hard outline.

Youssef, 10 Sept 2026, with a reference clip on screen: "Quran recitation should
be like this instead of ugly old fashion outlines of text, it should be like
this, it has a light shadow thing in the back not 100% sure what it is but it
looks SO MUCH NICER AND CLEANER."

The thing in the back is a blurred dark halo. libass draws one by BLURRING A
BORDER, so the two have to move together: a blur with no border behind it has
nothing to spread, and the 2px edge sized for a hard outline all but disappears
once it is spread. That pairing is what most of these cover.
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "worker"))

import clip_worker as cw

FOUND = {
    "surah": 25, "ayah": 68, "reference": "Al-Furqan 68",
    "arabic": "وَٱلَّذِينَ لَا يَدْعُونَ مَعَ ٱللَّهِ إِلَٰهًا ءَاخَرَ",
    "translation": "They are those who do not invoke any other god besides Allah",
}


def events(glow):
    return cw.ayah_events(
        FOUND, ornament="۝", start=0.0, end=6.0, latin_font="DejaVu Serif",
        translation_size=46, show_translation=True, ayah_size=360, mark_size=200,
        ayah_font="Amiri", glow=glow)


class ScriptureGlowTests(unittest.TestCase):
    def test_the_glow_is_emitted_as_a_blur(self):
        text = "\n".join(events(6))
        self.assertIn("\\blur6", text)

    def test_zero_glow_emits_nothing_at_all(self):
        # Every template but the Quran one keeps its hard outline, and a clip
        # rendered before this existed must come out byte-identical.
        self.assertNotIn("\\blur", "\n".join(events(0)))
        self.assertEqual(events(0), events(0.0))

    def test_THE_TRANSLATION_IS_INSIDE_THE_SAME_EVENT(self):
        # The ayah and the line under it share one Dialogue, which is why a
        # single tag covers both -- exactly as the reference frame shows them.
        # Two events would need two tags and could drift apart.
        lines = events(6)
        with_translation = [l for l in lines if "\\N" in l]
        self.assertTrue(with_translation, "the translation rides the ayah's event")
        for line in with_translation:
            self.assertIn("\\blur6", line)

    def test_the_blur_comes_before_the_text_and_after_the_fade(self):
        # \fad and \alpha drive the same channel and the fade tag is built
        # separately; the blur must not land inside it.
        line = events(6)[0]
        body = line.split(",,0,0,0,,", 1)[1]
        self.assertLess(body.index("\\blur6"), body.index("\\q0"),
                        "the blur is an opening override, not buried in the text")

    def test_A_BLUR_NEEDS_A_BORDER_TO_SPREAD(self):
        # The pairing. AYAH_OUTLINE_MIN is sized for a hard edge; blurring it
        # would leave almost nothing behind the glyph, which is the fault being
        # fixed rather than the fix.
        self.assertGreater(cw.AYAH_GLOW_BORDER, cw.AYAH_OUTLINE_MIN * 3,
                           "the halo is several times the hard edge, or it vanishes when spread")

    def test_the_style_widens_only_when_the_glow_is_on(self):
        source = (ROOT / "worker" / "clip_worker.py").read_text(encoding="utf-8")
        self.assertIn(
            "ayah_outline = max(outline_width, AYAH_GLOW_BORDER if scripture_glow > 0 else AYAH_OUTLINE_MIN)",
            source, "with no glow the border is exactly what it always was")

    def test_every_call_site_passes_it(self):
        # Four places build ayah events -- first render, re-render, the editor
        # preview and the plate. One missed would render scripture with a hard
        # outline on that path only, which nobody would think to look for.
        source = (ROOT / "worker" / "clip_worker.py").read_text(encoding="utf-8")
        self.assertEqual(source.count("ayah_events("), 5, "one definition and four callers")
        self.assertEqual(source.count("glow=scripture_glow"), 4)


class TemplateTests(unittest.TestCase):
    def test_scripture_glows_and_nothing_else_changed(self):
        # A decision about how the QUR'AN looks. The spoken captions sit on a
        # different face at a different size and keep their outline.
        folder = ROOT / "src" / "templates"
        glow = {p.stem: json.loads(p.read_text())["captionScriptureGlow"]
                for p in sorted(folder.glob("*.json"))}
        self.assertGreater(glow.pop("quran-recitation"), 0)
        self.assertEqual(set(glow.values()), {0}, f"the rest are untouched: {glow}")

    def test_the_field_is_clamped_where_every_other_one_is(self):
        ranges = (ROOT / "src" / "templates.js").read_text(encoding="utf-8")
        self.assertIn("captionScriptureGlow: [0, 30]", ranges)
        # Same ceiling as the highlight's glow, which is what clip_worker
        # accepts -- two blur limits that could disagree would be one too many.
        self.assertIn("captionHighlightGlow: [0, 30]", ranges)


if __name__ == "__main__":
    unittest.main()
