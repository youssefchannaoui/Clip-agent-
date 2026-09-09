"""The worker's metadata probe: three fields, no download, no Google (9 Sept 2026).

Google refused this app's OAuth data-access verification on 8 Sept 2026 citing
API ToS section 5a over clipping arbitrary third-party videos. The answer was
to stop asking Google: the web service no longer calls `videos.list` on a
pasted link, and `probe_source_metadata` here supplies the title, length and
thumbnail from the box's own yt-dlp instead -- the same downloader, pool and
cookies that will fetch the file.

Everything below drives the real function against a fake yt_dlp, so what is
asserted is the OPTIONS it hands the downloader and the dict it returns, not
the source that builds them.
"""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))

import import_providers  # noqa: E402


class FakeYoutubeDL:
    """Records the options it was constructed with and answers to script."""

    last_options: dict = {}
    answers: list = []
    calls: list = []

    def __init__(self, options):
        type(self).last_options = dict(options)
        self._options = options

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def extract_info(self, url, download=True):
        type(self).calls.append({"url": url, "download": download, "options": dict(self._options)})
        answer = type(self).answers.pop(0) if type(self).answers else {}
        if isinstance(answer, Exception):
            raise answer
        return answer


def install_fake(answers):
    FakeYoutubeDL.answers = list(answers)
    FakeYoutubeDL.calls = []
    module = types.ModuleType("yt_dlp")
    module.YoutubeDL = FakeYoutubeDL
    sys.modules["yt_dlp"] = module


GOOD = {
    "title": "Never lose hope in the Mercy of Allah",
    "duration": 1936.0,
    "thumbnail": "https://i.ytimg.com/vi/abc12345678/maxres.jpg",
    "extractor_key": "Youtube",
}
URL = "https://www.youtube.com/watch?v=abc12345678"


class SourceMetadataTests(unittest.TestCase):
    def setUp(self):
        self._saved = sys.modules.get("yt_dlp")
        for key in ("VIDEO_IMPORT_PROXY", "VIDEO_IMPORT_PROXIES", "VIDEO_IMPORT_COOKIES",
                    "VIDEO_IMPORT_COOKIES_FROM_BROWSER", "YTDLP_POT_PROVIDER_URL"):
            self._env = getattr(self, "_env", {})
            self._env[key] = __import__("os").environ.pop(key, None)

    def tearDown(self):
        import os
        for key, value in getattr(self, "_env", {}).items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        if self._saved is None:
            sys.modules.pop("yt_dlp", None)
        else:
            sys.modules["yt_dlp"] = self._saved

    def test_returns_the_three_fields_the_paste_box_needs(self):
        install_fake([GOOD])
        meta = import_providers.probe_source_metadata(URL)
        self.assertEqual(meta["title"], "Never lose hope in the Mercy of Allah")
        self.assertEqual(meta["durationSec"], 1936)
        self.assertEqual(meta["thumbnail"], "https://i.ytimg.com/vi/abc12345678/maxres.jpg")

    def test_it_downloads_nothing(self):
        # A metadata probe that fetched bytes would spend the proxy plan's
        # bandwidth on every paste, and would take minutes on a lecture.
        install_fake([GOOD])
        import_providers.probe_source_metadata(URL)
        self.assertEqual(len(FakeYoutubeDL.calls), 1)
        self.assertFalse(FakeYoutubeDL.calls[0]["download"], "extract_info must not download")
        self.assertTrue(FakeYoutubeDL.calls[0]["options"].get("skip_download"))

    def test_it_asks_through_the_box_own_pool_and_cookies(self):
        # The whole reason the box answers this rather than the web service.
        import os
        os.environ["VIDEO_IMPORT_PROXIES"] = "http://a:b@one.example:1080,http://c:d@two.example:1080"
        os.environ["YTDLP_POT_PROVIDER_URL"] = "http://pot:4416"
        install_fake([GOOD])
        import_providers.probe_source_metadata(URL)
        options = FakeYoutubeDL.calls[0]["options"]
        self.assertIn(options.get("proxy"), {"http://a:b@one.example:1080", "http://c:d@two.example:1080"})
        self.assertIn("youtubepot-bgutilhttp", options.get("extractor_args") or {})

    def test_a_jobs_own_network_settings_win(self):
        # The probe must ask the way the download will ask, or the length it
        # quotes is the length of a stream the download never gets.
        install_fake([GOOD])
        import_providers.probe_source_metadata(URL, {"proxy": "http://chosen.example:1080"})
        self.assertEqual(FakeYoutubeDL.calls[0]["options"]["proxy"], "http://chosen.example:1080")

    def test_a_second_client_is_tried_before_giving_up(self):
        install_fake([RuntimeError("ERROR: [youtube] abc: Sign in to confirm you are not a bot"), GOOD])
        meta = import_providers.probe_source_metadata(URL)
        self.assertEqual(meta["durationSec"], 1936)
        self.assertEqual(len(FakeYoutubeDL.calls), 2)
        self.assertIn("player_client", str(FakeYoutubeDL.calls[1]["options"].get("extractor_args")))

    def test_the_proxy_address_never_reaches_the_error(self):
        # yt-dlp QUOTES the proxy it used, userinfo and all, and this message is
        # on its way to a browser.
        install_fake([
            RuntimeError("ERROR: unable to connect to proxy http://user:hunter2@exit.example:1080"),
            RuntimeError("ERROR: unable to connect to proxy http://user:hunter2@exit.example:1080"),
        ])
        with self.assertRaises(import_providers.ImportProviderError) as caught:
            import_providers.probe_source_metadata(URL)
        self.assertNotIn("hunter2", str(caught.exception))
        self.assertIn("***@", str(caught.exception))

    def test_a_video_with_no_length_is_not_given_one(self):
        install_fake([{"title": "A live stream", "duration": None}, {"title": "A live stream", "duration": None}])
        meta = import_providers.probe_source_metadata(URL)
        self.assertIsNone(meta["durationSec"], "an invented length would be charged against the customer")

    def test_a_link_that_is_not_youtube_is_refused_before_any_lookup(self):
        install_fake([GOOD])
        with self.assertRaises(Exception):
            import_providers.probe_source_metadata("https://example.com/not-a-video")
        self.assertEqual(FakeYoutubeDL.calls, [])


if __name__ == "__main__":
    unittest.main()
