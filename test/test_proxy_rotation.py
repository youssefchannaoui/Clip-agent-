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
        self.saved = {k: os.environ.get(k) for k in ("VIDEO_IMPORT_PROXIES", "VIDEO_IMPORT_PROXY")}

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

    def test_no_proxy_configured_means_no_proxy_option(self):
        os.environ.pop("VIDEO_IMPORT_PROXIES", None)
        os.environ.pop("VIDEO_IMPORT_PROXY", None)
        self.assertNotIn("proxy", ip.youtube_network_options())


if __name__ == "__main__":
    unittest.main()
