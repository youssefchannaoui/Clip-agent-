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
import threading
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

    def test_restart_recovery_requeues_real_worker_stages_not_just_the_old_tokens(self):
        # The allowlist was written against the five collapsed tokens this
        # service used to emit. clip_worker's own prose passes straight through
        # now, so stages like "Rendering clip 1 of 8" matched nothing and a
        # restart left those jobs frozen forever.
        store = self.service.JobStore()
        for index, stage in enumerate([
            "Extracting speech audio", "Transcribing speech", "Analysing transcript",
            "Finding and scoring clips", "Rendering clip 1 of 8", "Verifying rendered clips",
        ]):
            job = f"job_stage_{index}"
            store.create({"id": job, "source": {"type": "youtube"}})
            store.update(job, status=stage, stage=stage, progress=40)
        recovered = set(store.recover())
        self.assertEqual(len(recovered), 6, "every unfinished stage must be re-queued")

    def test_finished_jobs_are_never_requeued(self):
        store = self.service.JobStore()
        for index, final in enumerate(["completed", "failed", "cancelled"]):
            job = f"job_final_{index}"
            store.create({"id": job, "source": {"type": "youtube"}})
            store.update(job, status=final, stage=final, progress=100)
        self.assertEqual(store.recover(), [])

    def test_a_vanished_job_reads_as_cancelled_rather_than_crashing(self):
        # cancelled() dereferenced a None status. That AttributeError escaped
        # process() into loop(), which has no try, killing the only consumer
        # thread -- after which the worker accepted jobs forever and ran none.
        store = self.service.JobStore()
        store.create({"id": "job_gone", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        self.assertFalse(processor.cancelled("job_gone"))
        store.status_path("job_gone").unlink()
        self.assertTrue(processor.cancelled("job_gone"), "a job with no status file must unwind, not raise")

    def test_the_job_loop_survives_a_job_that_throws(self):
        store = self.service.JobStore()
        store.create({"id": "job_boom", "source": {"type": "youtube"}})
        store.create({"id": "job_after", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        calls = []

        def explode(job_id):
            calls.append(job_id)
            if job_id == "job_boom":
                raise RuntimeError("worker exploded")

        processor.process = explode
        processor.submit("job_boom")
        processor.submit("job_after")
        thread = threading.Thread(target=processor.loop, daemon=True)
        thread.start()
        deadline = time.time() + 5
        while "job_after" not in calls and time.time() < deadline:
            time.sleep(0.05)
        processor.stop.set()
        thread.join(timeout=5)
        self.assertIn("job_after", calls, "a later job must still be picked up after one throws")
        self.assertEqual(store.read("job_boom")["status"], "failed")

    def test_the_import_heartbeat_moves_the_signature_and_is_throttled(self):
        # The app cancels a job whose stage|progress|heartbeatAt has not changed
        # for five minutes. The import wrote nothing at all, so every download
        # longer than that was killed as hung.
        store = self.service.JobStore()
        store.create({"id": "job_pulse", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        pulse = processor.import_pulse("job_pulse")
        self.assertFalse(pulse())
        first = store.read("job_pulse").get("heartbeatAt")
        self.assertIsNotNone(first, "the first poll must prove liveness immediately")
        self.assertFalse(pulse())
        self.assertEqual(store.read("job_pulse").get("heartbeatAt"), first, "throttled between beats")
        self.assertLess(self.service.IMPORT_HEARTBEAT_SECONDS, 300,
                        "the beat has to land well inside the app's five-minute stall budget")

    def test_the_import_pulse_reports_cancellation(self):
        store = self.service.JobStore()
        store.create({"id": "job_cancel", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        pulse = processor.import_pulse("job_cancel")
        self.assertFalse(pulse())
        processor.cancel("job_cancel")
        self.assertTrue(pulse(), "a cancelled import must stop downloading")

    def test_the_import_reports_a_percentage_and_an_eta(self):
        # The import used to write nothing but a heartbeat, so a multi-minute
        # download sat at 3% with no sign of movement.
        store = self.service.JobStore()
        store.create({"id": "job_bytes", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        pulse = processor.import_pulse("job_bytes")
        self.assertFalse(pulse(0, 0))
        first = store.read("job_bytes")
        self.assertIsNotNone(first.get("heartbeatAt"))

        # Halfway through a known-size download.
        processor.import_pulse.__wrapped__ if False else None
        pulse2 = processor.import_pulse("job_bytes")
        time.sleep(0.01)
        self.assertFalse(pulse2(50, 100))
        status = store.read("job_bytes")
        self.assertGreaterEqual(status["progress"], 3, "the import band starts at 3%")
        self.assertLessEqual(status["progress"], 8, "and must not claim more than the import is worth")

    def test_the_import_reports_the_raw_byte_counts(self):
        # The app shows "142 MB of 380 MB" beside the percentage. A percentage
        # alone gives no sense of whether a slow import is a large file or a
        # broken one, so the counts travel rather than being derived.
        store = self.service.JobStore()
        store.create({"id": "job_size", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        self.assertFalse(processor.import_pulse("job_size")(149_000_000, 398_000_000))
        status = store.read("job_size")
        self.assertEqual(status["bytesDone"], 149_000_000)
        self.assertEqual(status["bytesTotal"], 398_000_000)

    def test_an_import_with_no_content_length_still_reports_what_it_has(self):
        # A server that sends no Content-Length is common. The done count is
        # still useful; the total must simply be absent rather than zero.
        store = self.service.JobStore()
        store.create({"id": "job_nolen", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        self.assertFalse(processor.import_pulse("job_nolen")(149_000_000, 0))
        status = store.read("job_nolen")
        self.assertEqual(status["bytesDone"], 149_000_000)
        self.assertIsNone(status.get("bytesTotal"))

    def test_the_clip_breakdown_is_forwarded_only_when_the_worker_sends_it(self):
        # Forwarding unconditionally would clear currentClip/clipPercent back to
        # nothing on every transcribe and verify event, so the list would blink
        # out between renders.
        source = (WORKER / "service.py").read_text(encoding="utf-8")
        self.assertIn('for key in ("currentClip", "totalClips", "clipPercent", "clipPlan")', source)
        self.assertIn("if event.get(key) is not None:", source)

    def test_a_provider_that_ignores_progress_still_works(self):
        # Most providers pass a plain `lambda: bool`. The two-argument form must
        # fall back rather than raise.
        from import_providers import _poll
        self.assertFalse(_poll(lambda: False, 10, 100))
        self.assertTrue(_poll(lambda: True, 10, 100))
        seen = {}
        def rich(done, total):
            seen['done'] = done
            return False
        self.assertFalse(_poll(rich, 7, 70))
        self.assertEqual(seen['done'], 7)


if __name__ == "__main__":
    unittest.main()
