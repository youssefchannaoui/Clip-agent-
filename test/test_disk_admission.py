"""Free disk, checked against what is already running.

Free space was compared against a flat floor once per job. At one job at a time
that was enough. capacity.py now sizes concurrency from the machine, so four
jobs can each look at the same 12G, each admit itself, and then want 4G of
source between them -- and the check that was supposed to prevent exactly that
would have passed all four.
"""
import importlib
import os
import sys
import tempfile
import unittest
from collections import namedtuple
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

Usage = namedtuple("Usage", "total used free")
GB = 1024 ** 3


class DiskAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        os.environ["WORKER_DATA_DIR"] = self.root
        os.environ["WORKER_MIN_FREE_GB"] = "10"
        os.environ["WORKER_MAX_DOWNLOAD_MB"] = "4096"   # 4G per job
        self.service = importlib.reload(importlib.import_module("service"))
        self.processor = self.service.Processor.__new__(self.service.Processor)
        self.processor.lock = __import__("threading").RLock()
        self.processor.in_flight = set()

    def tearDown(self):
        for key in ("WORKER_DATA_DIR", "WORKER_MIN_FREE_GB", "WORKER_MAX_DOWNLOAD_MB"):
            os.environ.pop(key, None)

    def shortfall(self, free_gb):
        with mock.patch.object(self.service.shutil, "disk_usage",
                               return_value=Usage(100 * GB, 0, int(free_gb * GB))):
            return self.processor.disk_shortfall()

    def test_an_idle_worker_only_needs_the_floor(self):
        self.assertEqual(self.shortfall(free_gb=11), 0)
        self.assertGreater(self.shortfall(free_gb=9), 0)

    def test_each_running_job_reserves_its_whole_allowance(self):
        """One job running: the floor plus that job's 4G."""
        self.processor.in_flight.add("job-a")
        self.assertGreater(self.shortfall(free_gb=13), 0, "10G floor + 4G in flight needs 14G")
        self.assertEqual(self.shortfall(free_gb=15), 0)

    def test_four_jobs_cannot_all_admit_themselves_on_the_same_free_space(self):
        """The bug, stated directly.

        26G free: the old flat 10G floor admitted every one of the four.
        """
        for n in range(3):
            self.processor.in_flight.add(f"job-{n}")
        self.assertGreater(self.shortfall(free_gb=20), 0, "10G + three jobs at 4G needs 22G")

    def test_a_finished_job_stops_being_counted(self):
        self.processor.in_flight.add("job-a")
        self.assertGreater(self.shortfall(free_gb=13), 0)
        self.processor.in_flight.discard("job-a")
        self.assertEqual(self.shortfall(free_gb=13), 0)

    def test_the_shortfall_is_reported_in_bytes_not_a_bare_boolean(self):
        """The operator needs to know how far short, not merely that it failed."""
        self.assertEqual(self.shortfall(free_gb=8), 2 * GB)


if __name__ == "__main__":
    unittest.main()
