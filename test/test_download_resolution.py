"""The production downloader fetches 1080p, not whatever YouTube offers.

Every template this product ships renders 1080x1920 and every clip is scaled to
it, so a 4K source is downscaled and thrown away. Uncapped, the selector took
the best mp4 available: several times the bytes off a 250GB-a-month proxy plan,
several times the disk, and several times the work in every ffmpeg pass after
it -- to make a file identical to the one 1080p would have produced.

The cap must never cost an import, which is the other half of this and the
reason for the bare fallback: a video published ONLY above 1080p with no lower
rendition would otherwise fail to download at all. Saving bandwidth is worth
less than the lecture.
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

SOURCE = (Path(__file__).resolve().parent.parent / "worker" / "import_providers.py").read_text(encoding="utf-8")


def production_format() -> str:
    """The format selector YtDlpImportProvider actually hands yt-dlp.

    Read out of the class rather than the module: clip_worker.py carries a
    SECOND copy of a downloader for the self-hosted engine, and this file's own
    record says the two have already drifted apart once. Asserting on the wrong
    one would pass while production stayed uncapped.
    """
    start = SOURCE.index("class YtDlpImportProvider")
    body = SOURCE[start:]
    opts = body.index("ydl_opts = {")
    chunk = body[opts:opts + 1200]
    # The selector is written across several lines, so join the string pieces.
    match = re.search(r'"format":\s*\(([^)]*)\)|"format":\s*("(?:[^"\\]|\\.)*")', chunk)
    assert match, "the production format selector moved"
    raw = match.group(1) or match.group(2)
    return "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', raw))


class DownloadResolutionTests(unittest.TestCase):
    def test_the_production_selector_caps_at_1080(self):
        fmt = production_format()
        self.assertIn("height<=1080", fmt)

    def test_every_preference_before_the_last_is_capped(self):
        """A single capped clause with uncapped ones ahead of it caps nothing.

        yt-dlp takes the FIRST preference that matches, so an uncapped
        `bv*[ext=mp4]+ba[ext=m4a]` sitting in front would win on every ordinary
        video and the cap would never once apply.
        """
        prefs = production_format().split("/")
        self.assertGreater(len(prefs), 1, "a selector with no fallback cannot be safe")
        for pref in prefs[:-1]:
            self.assertIn("height<=1080", pref, f"uncapped preference ahead of the fallback: {pref}")

    def test_the_last_preference_is_uncapped_so_an_import_never_fails_for_this(self):
        """The bare fallback is deliberate, not an oversight.

        A lecture published only above 1080p has nothing for a capped selector
        to match. Refusing that import to save bandwidth would trade a
        customer's lecture for a few gigabytes.
        """
        self.assertNotIn("height", production_format().split("/")[-1])


if __name__ == "__main__":
    unittest.main()
