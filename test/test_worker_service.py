import importlib
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time
import socket
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKER = ROOT / "worker"
sys.path.insert(0, str(WORKER))


class FakeResponse(io.BytesIO):
    def __init__(self, payload, headers=None):
        super().__init__(payload)
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class ManagedImportProviderTests(unittest.TestCase):
    def setUp(self):
        os.environ["VIDEO_IMPORT_API_URL"] = "https://ffmpegapi.net"
        os.environ["VIDEO_IMPORT_API_KEY"] = "provider-key"
        os.environ["VIDEO_IMPORT_ALLOWED_DOWNLOAD_HOSTS"] = "ffmpegapi.net"
        self.module = importlib.reload(importlib.import_module("import_providers"))
        self.temp = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_official_ffmpegapi_success_response_is_downloaded(self):
        responses = [
            FakeResponse(json.dumps({"success": True, "download_url": "https://ffmpegapi.net/download/video.mp4", "filename": "video.mp4", "title": "Lecture"}).encode()),
            FakeResponse(b"video-bytes", {"Content-Length": "11"}),
        ]
        with mock.patch("urllib.request.urlopen", side_effect=responses), mock.patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))]):
            result = self.module.FfmpegApiImportProvider().import_video(
                {"url": "https://youtu.be/Abc_123-xyZ"}, self.temp / "video.mp4", lambda: False
            )
        self.assertEqual(result.title, "Lecture")
        self.assertEqual(result.file.read_bytes(), b"video-bytes")

    def test_provider_failure_is_actionable(self):
        response = FakeResponse(json.dumps({"success": False, "error": "Video is unavailable"}).encode())
        with mock.patch("urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(self.module.ImportProviderError, "unavailable"):
                self.module.FfmpegApiImportProvider().import_video(
                    {"url": "https://youtube.com/watch?v=Abc_123-xyZ"}, self.temp / "video.mp4", lambda: False
                )

    def test_invalid_provider_response_is_rejected(self):
        with mock.patch("urllib.request.urlopen", return_value=FakeResponse(b"not-json")):
            with self.assertRaisesRegex(self.module.ImportProviderError, "invalid JSON"):
                self.module.FfmpegApiImportProvider().import_video(
                    {"url": "https://youtube.com/watch?v=Abc_123-xyZ"}, self.temp / "video.mp4", lambda: False
                )

    def test_provider_timeout_recommends_upload_fallback(self):
        with mock.patch("urllib.request.urlopen", side_effect=socket.timeout("timed out")):
            with self.assertRaisesRegex(self.module.ImportProviderError, "Upload the original MP4"):
                self.module.FfmpegApiImportProvider().import_video(
                    {"url": "https://youtube.com/watch?v=Abc_123-xyZ"}, self.temp / "video.mp4", lambda: False
                )


class WorkerPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp())
        os.environ["WORKER_DATA_DIR"] = str(self.temp / "data")
        os.environ["WORKER_TEMP_DIR"] = str(self.temp / "tmp")
        os.environ["WORKER_SHARED_SECRET"] = "worker-test-secret-at-least-thirty-two-characters"
        sys.modules.pop("service", None)
        self.service = importlib.import_module("service")

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_authentication_rejects_stale_and_accepts_signed_requests(self):
        timestamp = str(self.service.now_ms())
        body = b'{"id":"job_1"}'
        import hashlib, hmac
        sig = hmac.new(os.environ["WORKER_SHARED_SECRET"].encode(), f"{timestamp}\nPOST\n/jobs\n{body.decode()}".encode(), hashlib.sha256).hexdigest()
        self.assertTrue(self.service.authenticated(timestamp, "POST", "/jobs", body, sig))
        self.assertFalse(self.service.authenticated("0", "POST", "/jobs", body, sig))

    def test_job_creation_is_persistent_and_restart_recovery_requeues(self):
        store = self.service.JobStore()
        status, created = store.create({"id": "job_1", "source": {"type": "youtube"}})
        self.assertTrue(created)
        self.assertEqual(status["status"], "queued")
        store.update("job_1", status="transcribing", stage="transcribing", progress=45)
        self.assertEqual(store.recover(), ["job_1"])
        recovered = store.read("job_1")
        self.assertEqual(recovered["status"], "queued")
        self.assertLessEqual(recovered["progress"], 5)

    def test_abandoned_temporary_directories_are_removed(self):
        abandoned = self.service.TEMP_DIR / "abandoned"
        abandoned.mkdir(parents=True)
        old = time.time() - self.service.JOB_TTL_SECONDS - 5
        os.utime(abandoned, (old, old))
        self.service.Processor(self.service.JobStore()).cleanup_abandoned()
        self.assertFalse(abandoned.exists())


if __name__ == "__main__":
    unittest.main()
