"""download_https: what arrives must be the whole file, or nothing.

A dropped connection used to return SUCCESSFULLY with a short file. read()
answers b"" at a broken socket exactly as it does at the end of one, and nothing
compared the bytes written against Content-Length. The truncated lecture was
then transcribed and filed in the source cache, so every later job for that URL
got the same short video.
"""
import io as _io
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import import_providers as ip


class FakeResponse(_io.BytesIO):
    def __init__(self, payload, declared_length=None):
        super().__init__(payload)
        length = len(payload) if declared_length is None else declared_length
        self.headers = {"Content-Length": str(length)} if length is not None else {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class DownloadIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.dest = self.dir / "video.mp4"

    def run_download(self, response_or_error, max_bytes=10 * 1024 * 1024):
        opener = mock.Mock()
        if isinstance(response_or_error, Exception):
            opener.side_effect = response_or_error
        else:
            opener.return_value = response_or_error
        with mock.patch.object(ip.urllib.request, "urlopen", opener):
            ip.download_https("https://host.test/f.mp4", self.dest, max_bytes, 30)

    def test_a_whole_file_lands(self):
        self.run_download(FakeResponse(b"D" * 5000))
        self.assertEqual(self.dest.read_bytes(), b"D" * 5000)

    def test_a_short_read_is_a_failure_not_a_success(self):
        """The bug: 5000 bytes promised, 1000 delivered, and it used to pass."""
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_download(FakeResponse(b"D" * 1000, declared_length=5000))
        self.assertIn("ended early", str(caught.exception))

    def test_a_truncated_download_leaves_no_file_behind(self):
        """Nothing partial may survive for the cache to file."""
        with self.assertRaises(ip.ImportProviderError):
            self.run_download(FakeResponse(b"D" * 1000, declared_length=5000))
        self.assertFalse(self.dest.exists(), "a partial file must not reach the destination")
        self.assertEqual(list(self.dir.iterdir()), [], "and no scratch file may be left")

    def test_an_empty_body_is_a_failure(self):
        with self.assertRaises(ip.ImportProviderError):
            self.run_download(FakeResponse(b"", declared_length=None))

    def test_a_short_read_is_marked_retryable(self):
        """It says nothing about the video, so another provider deserves a go."""
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_download(FakeResponse(b"D" * 10, declared_length=900))
        self.assertTrue(caught.exception.retryable)

    # ── network failures must stay inside the fallback chain ──

    def test_a_timeout_becomes_an_ImportProviderError(self):
        """It used to escape as itself, straight past import_with_fallback."""
        with self.assertRaises(ip.ImportProviderError) as caught:
            self.run_download(socket.timeout("timed out"))
        self.assertTrue(caught.exception.retryable)

    def test_a_url_error_becomes_an_ImportProviderError(self):
        with self.assertRaises(ip.ImportProviderError):
            self.run_download(ip.urllib.error.URLError("no route to host"))

    def test_a_dropped_connection_becomes_an_ImportProviderError(self):
        with self.assertRaises(ip.ImportProviderError):
            self.run_download(ConnectionResetError("peer reset"))

    def test_a_5xx_is_retryable_and_a_4xx_is_not(self):
        def http_error(code):
            return ip.urllib.error.HTTPError("https://host.test/f.mp4", code, "nope", {}, None)

        with self.assertRaises(ip.ImportProviderError) as server_side:
            self.run_download(http_error(503))
        self.assertTrue(server_side.exception.retryable)

        with self.assertRaises(ip.ImportProviderError) as client_side:
            self.run_download(http_error(404))
        self.assertFalse(client_side.exception.retryable)

    def test_a_file_over_the_limit_is_refused_and_leaves_nothing(self):
        with self.assertRaises(ip.ImportProviderError):
            self.run_download(FakeResponse(b"D" * 4000), max_bytes=1000)
        self.assertFalse(self.dest.exists())
        self.assertEqual(list(self.dir.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
