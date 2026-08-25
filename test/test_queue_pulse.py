"""A queued job must look alive, because it is.

The app cancels a job whose stage|progress|heartbeatAt has not moved inside its
stall budget. Nothing beat while a job sat in the worker's queue, so a job that
waited longer than the budget was cancelled as "the worker stopped responding"
-- while the worker was healthy and working steadily through the queue ahead of
it. The fault only appears once there IS a queue, which is to say once more
than one person is using the product.
"""
import importlib
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))


class QueuePulseTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        os.environ["WORKER_DATA_DIR"] = self.root
        self.service = importlib.reload(importlib.import_module("service"))
        self.processor = self.service.Processor(self.service.JobStore())

    def tearDown(self):
        self.processor.stop.set()
        os.environ.pop("WORKER_DATA_DIR", None)

    def write_job(self, job_id, status, created_at):
        folder = self.service.JOBS_DIR / job_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "status.json").write_text(json.dumps({
            "id": job_id, "status": status, "stage": status,
            "progress": 0, "createdAt": created_at, "heartbeatAt": 0,
        }))

    def beat_once(self):
        """Run exactly one pass of the pulse loop."""
        thread = threading.Thread(target=self.processor.queue_pulse, daemon=True)
        thread.start()
        deadline = time.time() + 5
        while time.time() < deadline:
            status = self.processor.store.read("a")
            if status and status.get("heartbeatAt"):
                break
            time.sleep(0.05)
        self.processor.stop.set()
        thread.join(timeout=5)

    def test_a_waiting_job_gets_a_heartbeat(self):
        self.write_job("a", "queued", 1000)
        self.beat_once()
        self.assertGreater(self.processor.store.read("a").get("heartbeatAt", 0), 0)

    def test_the_place_in_the_line_is_recorded(self):
        self.write_job("a", "queued", 1000)
        self.write_job("b", "queued", 2000)
        self.beat_once()
        first = self.processor.store.read("a")
        second = self.processor.store.read("b")
        self.assertEqual(first["queuePosition"], 1, "oldest waits at the front")
        self.assertEqual(second["queuePosition"], 2)
        self.assertEqual(first["queueLength"], 2)

    def test_a_job_that_is_not_queued_is_left_alone(self):
        """A running job has its own heartbeat; a finished one must not be revived."""
        self.write_job("a", "queued", 1000)
        self.write_job("done", "completed", 500)
        self.beat_once()
        self.assertEqual(self.processor.store.read("done").get("heartbeatAt"), 0)

    def test_unreadable_status_files_do_not_stop_the_beat(self):
        folder = self.service.JOBS_DIR / "broken"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "status.json").write_text("{not json")
        self.write_job("a", "queued", 1000)
        self.beat_once()
        self.assertGreater(self.processor.store.read("a").get("heartbeatAt", 0), 0)


if __name__ == "__main__":
    unittest.main()
