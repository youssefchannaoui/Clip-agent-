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
        os.environ["WORKER_CALLBACK_SECRET"] = "callback-test-secret-at-least-thirty-two-characters"
        os.environ["WORKER_MAX_CONCURRENT_JOBS"] = "2"
        os.environ["WORKER_MAX_HEAVY_JOBS"] = "1"
        os.environ["WORKER_CALLBACK_ATTEMPTS"] = "2"
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

    def test_queue_positions_follow_the_actual_pending_order(self):
        store = self.service.JobStore()
        store.create({"id": "job_1", "source": {"type": "youtube"}})
        store.create({"id": "job_2", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        processor.submit("job_1")
        processor.submit("job_2")
        self.assertEqual(store.read("job_1")["queuePosition"], 1)
        self.assertEqual(store.read("job_2")["queuePosition"], 2)
        self.assertEqual(processor.queue.get_nowait(), "job_1")
        processor.refresh_queue_positions()
        self.assertEqual(store.read("job_2")["queuePosition"], 1)

    def test_one_account_batch_does_not_block_another_account(self):
        """Twenty jobs from one customer must not put another customer twenty-first."""
        fair = self.service.FairQueue()
        for index in range(20):
            fair.put(f"a_{index}", "user_a")
        fair.put("b_0", "user_b")
        self.assertEqual(fair.get_nowait(), "a_0")
        self.assertEqual(fair.get_nowait(), "b_0")
        self.assertEqual(fair.get_nowait(), "a_1")
        self.assertEqual(fair.qsize(), 18)

    def test_accounts_are_served_in_turn_and_keep_their_own_order(self):
        fair = self.service.FairQueue()
        for index in range(3):
            fair.put(f"a_{index}", "user_a")
            fair.put(f"b_{index}", "user_b")
        drained = [fair.get_nowait() for _ in range(6)]
        self.assertEqual(drained, ["a_0", "b_0", "a_1", "b_1", "a_2", "b_2"])
        with self.assertRaises(self.service.queue.Empty):
            fair.get_nowait()

    def test_untagged_jobs_keep_plain_arrival_order(self):
        """A web service that has not been redeployed yet sends no tenant."""
        fair = self.service.FairQueue()
        for index in range(4):
            fair.put(f"job_{index}")
        self.assertEqual([fair.get_nowait() for _ in range(4)], ["job_0", "job_1", "job_2", "job_3"])

    def test_queue_positions_reflect_the_fair_order_not_arrival_order(self):
        store = self.service.JobStore()
        for job_id, tenant in (("a_1", "user_a"), ("a_2", "user_a"), ("b_1", "user_b")):
            store.create({"id": job_id, "tenant": tenant, "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        for job_id, tenant in (("a_1", "user_a"), ("a_2", "user_a"), ("b_1", "user_b")):
            processor.submit(job_id, tenant)
        # b_1 arrived last but runs second, and the position the customer sees
        # has to say so or the wait estimate lies.
        self.assertEqual(store.read("a_1")["queuePosition"], 1)
        self.assertEqual(store.read("b_1")["queuePosition"], 2)
        self.assertEqual(store.read("a_2")["queuePosition"], 3)

    def test_restart_recovery_rebuilds_the_rotation_from_stored_tenants(self):
        store = self.service.JobStore()
        for job_id, tenant in (("a_1", "user_a"), ("a_2", "user_a"), ("b_1", "user_b")):
            store.create({"id": job_id, "tenant": tenant, "source": {"type": "youtube"}})
        self.assertEqual(store.read("a_1")["tenant"], "user_a")
        processor = self.service.Processor(store)
        for job_id in sorted(store.recover()):
            processor.queue.put(job_id, self.service.tenant_of(store.read(job_id)))
        self.assertEqual(processor.queue.snapshot(), ["a_1", "b_1", "a_2"])

    def test_abandoned_temporary_directories_are_removed(self):
        abandoned = self.service.TEMP_DIR / "abandoned"
        abandoned.mkdir(parents=True)
        old = time.time() - self.service.JOB_TTL_SECONDS - 5
        os.utime(abandoned, (old, old))
        self.service.Processor(self.service.JobStore()).cleanup_abandoned()
        self.assertFalse(abandoned.exists())

    def test_two_jobs_can_prepare_but_only_one_can_use_heavy_compute(self):
        processor = self.service.Processor(self.service.JobStore())
        self.assertEqual(len(processor.threads), 2)
        self.assertTrue(processor.heavy_slots.acquire(blocking=False))
        self.assertFalse(processor.heavy_slots.acquire(blocking=False))
        processor.heavy_slots.release()

    def test_callback_retries_a_temporary_failure(self):
        processor = self.service.Processor(self.service.JobStore())
        response = FakeResponse(b"ok")
        with mock.patch.object(self.service.urllib.request, "urlopen", side_effect=[OSError("temporary"), response]) as urlopen, \
             mock.patch.object(self.service.time, "sleep"):
            processor.callback(
                {"callbackUrl": "https://deenclipped.online/api/worker-callbacks/project_1"},
                {"id": "project_1", "status": "completed"},
            )
        self.assertEqual(urlopen.call_count, 2)

    def test_terminating_a_worker_stops_the_process_group(self):
        child = mock.Mock(pid=1234)
        child.poll.return_value = None
        child.wait.return_value = 0
        with mock.patch.object(self.service.os, "killpg") as killpg:
            self.service.terminate_process_tree(child)
        killpg.assert_called_once_with(1234, self.service.signal.SIGTERM)

    def test_framing_analysis_downloads_the_stored_source_and_cleans_up(self):
        class FakeStorage:
            configured = True

            def download(self, key, destination):
                self.key = key
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"video")

        completed = mock.Mock(
            returncode=0,
            stdout=json.dumps({"plan": {"available": True, "method": "active-speaker", "keyframes": []}}),
            stderr="",
        )
        with mock.patch.object(self.service, "ObjectStorage", return_value=FakeStorage()), \
             mock.patch.object(self.service.shutil, "disk_usage", return_value=mock.Mock(free=self.service.MIN_FREE_BYTES + 1)), \
             mock.patch.object(self.service.subprocess, "run", return_value=completed) as subprocess_run:
            plan = self.service.analyse_framing({
                "sourceKey": "projects/project_1/source.mp4", "duration": 30,
                "speechSpans": [[0.2, 1.0]],
            })
        self.assertEqual(plan["method"], "active-speaker")
        self.assertTrue(subprocess_run.called)
        self.assertFalse(any(item.name != "framing-cache" for item in self.service.TEMP_DIR.glob("framing-*")))

    def test_framing_analysis_rejects_unsafe_storage_keys(self):
        with self.assertRaisesRegex(ValueError, "valid stored source key"):
            self.service.analyse_framing({"sourceKey": "projects/../secret", "duration": 30})


if __name__ == "__main__":
    unittest.main()
