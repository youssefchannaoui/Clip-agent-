"""The proxy pool: every download attempt gets a fresh exit address.

One residential exit that moves a full lecture at line speed gets flagged by
YouTube within the hour -- measured on 26 Aug 2026: the first IP served 1.5GB
at 216 Mbit/s and was bot-walled before the next customer job arrived. The
client-rotation loop calls the network options once per attempt, so a random
pick per call means a retry lands on a different exit than the one refused.
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


class ProxyRotationTests(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.get(k) for k in ("VIDEO_IMPORT_PROXIES", "VIDEO_IMPORT_PROXY", "VIDEO_IMPORT_PROXY_FILE")}

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_a_pool_spreads_attempts_across_addresses(self):
        os.environ["VIDEO_IMPORT_PROXIES"] = ",".join(
            f"http://u:p@10.0.0.{n}:8080" for n in range(1, 21)
        )
        os.environ.pop("VIDEO_IMPORT_PROXY", None)
        chosen = {ip.youtube_network_options()["proxy"] for _ in range(200)}
        self.assertGreater(len(chosen), 5, "200 attempts through a 20-address pool must not all use one exit")
        for proxy in chosen:
            self.assertTrue(proxy.startswith("http://u:p@10.0.0."))

    def test_a_single_proxy_still_works_without_a_pool(self):
        os.environ.pop("VIDEO_IMPORT_PROXIES", None)
        os.environ["VIDEO_IMPORT_PROXY"] = "http://u:p@single.example:1"
        self.assertEqual(ip.youtube_network_options()["proxy"], "http://u:p@single.example:1")

    def test_the_pool_wins_over_the_single_setting(self):
        # Both set is a transition state; the pool is the newer intent.
        os.environ["VIDEO_IMPORT_PROXIES"] = "http://u:p@pool.example:1"
        os.environ["VIDEO_IMPORT_PROXY"] = "http://u:p@old.example:1"
        self.assertEqual(ip.youtube_network_options()["proxy"], "http://u:p@pool.example:1")


    def test_a_pool_file_outranks_the_env_and_needs_no_restart(self):
        import tempfile, os as _os
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
            handle.write("http://u:p@10.9.9.1:1\n\nhttp://u:p@10.9.9.2:2\n")
            path = handle.name
        try:
            _os.environ["VIDEO_IMPORT_PROXY_FILE"] = path
            _os.environ["VIDEO_IMPORT_PROXIES"] = "http://u:p@stale.example:1"
            chosen = {ip.youtube_network_options()["proxy"] for _ in range(40)}
            self.assertTrue(all(c.startswith("http://u:p@10.9.9.") for c in chosen),
                            "the file is the live pool; the env is last night's")
            # A vanished file falls back to the env rather than to no proxy.
            _os.remove(path)
            self.assertEqual(ip.youtube_network_options()["proxy"], "http://u:p@stale.example:1")
        finally:
            _os.environ.pop("VIDEO_IMPORT_PROXY_FILE", None)

    def test_no_proxy_configured_means_no_proxy_option(self):
        os.environ.pop("VIDEO_IMPORT_PROXIES", None)
        os.environ.pop("VIDEO_IMPORT_PROXY", None)
        self.assertNotIn("proxy", ip.youtube_network_options())


if __name__ == "__main__":
    unittest.main()


class ProxyReportingTests(unittest.TestCase):
    """The health readout must answer from the same place the downloader picks.

    The box ran a 16-address Webshare pool and reported `"importProxy": false`,
    because the capability check read the singular VIDEO_IMPORT_PROXY while the
    downloader chose from VIDEO_IMPORT_PROXY_FILE / VIDEO_IMPORT_PROXIES. The
    one moment that readout matters is when imports start failing and someone
    has to decide whether the exits are burned or were never configured --
    which is exactly when it was lying.
    """

    def setUp(self):
        self.saved = {k: os.environ.get(k) for k in
                      ("VIDEO_IMPORT_PROXIES", "VIDEO_IMPORT_PROXY", "VIDEO_IMPORT_PROXY_FILE")}
        for key in self.saved:
            os.environ.pop(key, None)

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_an_env_pool_counts_as_having_a_proxy(self):
        os.environ["VIDEO_IMPORT_PROXIES"] = "http://u:p@10.0.0.1:1,http://u:p@10.0.0.2:2"
        self.assertEqual(len(ip.proxy_pool()), 2)

    def test_a_pool_file_outranks_the_env_pool(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
            handle.write("http://u:p@10.9.9.1:1\n\nhttp://u:p@10.9.9.2:2\nhttp://u:p@10.9.9.3:3\n")
            path = handle.name
        try:
            os.environ["VIDEO_IMPORT_PROXY_FILE"] = path
            os.environ["VIDEO_IMPORT_PROXIES"] = "http://u:p@stale.example:1"
            self.assertEqual(len(ip.proxy_pool()), 3, "the maintenance job's file is the fresher truth")
        finally:
            os.unlink(path)

    def test_no_pool_is_an_empty_list_rather_than_a_crash(self):
        self.assertEqual(ip.proxy_pool(), [])

    def test_the_capability_readout_sees_the_pool(self):
        import importlib
        import sys as _sys
        from pathlib import Path as _Path
        _sys.path.insert(0, str(_Path(__file__).resolve().parent.parent / "worker"))
        clip_worker = importlib.import_module("clip_worker")

        # capabilities() is memoised for the life of the process, which is right
        # in production and means the cache has to be cleared between the two
        # halves of this test rather than the second answer trusted.
        def asked_fresh():
            clip_worker._CAPABILITIES = None
            return clip_worker.capabilities()["importProxy"]

        os.environ["VIDEO_IMPORT_PROXIES"] = "http://u:p@10.0.0.1:1,http://u:p@10.0.0.2:2"
        self.assertTrue(asked_fresh(), "a live pool must not be reported as no proxy at all")
        os.environ.pop("VIDEO_IMPORT_PROXIES", None)
        self.assertFalse(asked_fresh())
        clip_worker._CAPABILITIES = None
