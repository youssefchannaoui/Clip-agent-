"""Hardware detection.

The point of this module is that buying a bigger machine makes the product
faster without anyone editing anything. These pin both halves: that it grows
when the machine grows, and that it does not quietly change what the current
box already does.
"""
import importlib
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import capacity as cap

ENV_KEYS = (
    "WHISPER_DEVICE", "WHISPER_COMPUTE_TYPE", "WHISPER_MODEL",
    "WORKER_MAX_CONCURRENT_JOBS", "FFMPEG_THREADS",
)


class CapacityTests(unittest.TestCase):
    def setUp(self):
        self._saved = {k: os.environ.pop(k, None) for k in ENV_KEYS}
        importlib.reload(cap)

    def tearDown(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def plan(self, cores=2, ram=2.0, reserved=0.5, gpus=0):
        cap.cpu_cores = lambda: cores
        cap.memory_budget = lambda: (ram, reserved)
        cap.gpu_count = lambda: gpus
        return cap.plan()

    # ── it grows with the machine ──

    def test_a_bigger_box_runs_more_jobs(self):
        self.assertEqual(self.plan(cores=2, ram=2.0)["maxConcurrentJobs"], 1)
        self.assertEqual(self.plan(cores=8, ram=12.0)["maxConcurrentJobs"], 4)
        self.assertEqual(self.plan(cores=16, ram=32.0)["maxConcurrentJobs"], 8)

    def test_a_gpu_switches_device_compute_type_and_model_together(self):
        plan = self.plan(cores=8, ram=16.0, gpus=1)
        self.assertEqual(plan["device"], "cuda")
        # int8 on a GPU throws away most of what the GPU is for.
        self.assertEqual(plan["computeType"], "float16")
        self.assertEqual(plan["model"], "large-v3")

    def test_more_ram_earns_a_better_model(self):
        self.assertEqual(self.plan(ram=3.0)["model"], "base")
        self.assertEqual(self.plan(ram=8.0)["model"], "small")
        self.assertEqual(self.plan(cores=8, ram=16.0)["model"], "medium")

    # ── it does not overcommit ──

    def test_ram_can_hold_concurrency_below_what_the_cores_allow(self):
        """Sixteen cores and 4G of RAM is still not four jobs."""
        self.assertEqual(self.plan(cores=16, ram=4.0, reserved=0.5)["maxConcurrentJobs"], 2)

    def test_concurrency_is_never_zero(self):
        self.assertEqual(self.plan(cores=1, ram=0.5)["maxConcurrentJobs"], 1)

    def test_threads_are_split_between_the_jobs_that_will_run(self):
        """Four threads on two cores was ffmpeg contending with itself."""
        plan = self.plan(cores=8, ram=12.0)
        self.assertEqual(plan["maxConcurrentJobs"], 4)
        self.assertEqual(plan["ffmpegThreads"], 2, "8 cores across 4 jobs")

    def test_a_gpu_does_not_invite_unlimited_parallelism(self):
        """One GPU's memory serialises the work whatever the CPU says."""
        self.assertLessEqual(self.plan(cores=32, ram=64.0, gpus=1)["maxConcurrentJobs"], 2)

    # ── the operator always wins ──

    def test_every_value_can_be_overridden(self):
        os.environ.update({
            "WHISPER_DEVICE": "cuda", "WHISPER_COMPUTE_TYPE": "int8_float16",
            "WHISPER_MODEL": "tiny", "WORKER_MAX_CONCURRENT_JOBS": "7",
            "FFMPEG_THREADS": "3",
        })
        plan = self.plan(cores=2, ram=2.0)
        self.assertEqual(plan["device"], "cuda")
        self.assertEqual(plan["computeType"], "int8_float16")
        self.assertEqual(plan["model"], "tiny")
        self.assertEqual(plan["maxConcurrentJobs"], 7)
        self.assertEqual(plan["ffmpegThreads"], 3)

    # ── the current box keeps behaving as it does today ──

    def test_todays_worker_box_is_unchanged(self):
        """2 cores, a 2G container limit: one job, two threads, small on CPU."""
        plan = self.plan(cores=2, ram=2.0, reserved=0.5)
        self.assertEqual(plan["maxConcurrentJobs"], 1)
        self.assertEqual(plan["ffmpegThreads"], 2)
        self.assertEqual(plan["device"], "cpu")
        self.assertEqual(plan["computeType"], "int8")


class MemoryBudgetTests(unittest.TestCase):
    def test_a_cgroup_limit_reserves_less_than_a_whole_host(self):
        """A cgroup already excludes the OS and the scoring model.

        Reserving for them twice held concurrency at one on a machine that
        could carry four.
        """
        self.assertLess(cap._RESERVED_CGROUP_GB, cap._RESERVED_HOST_GB)

    def _limit_file(self, contents):
        import tempfile
        handle = tempfile.NamedTemporaryFile("w", suffix=".limit", delete=False)
        handle.write(contents)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return (handle.name,)

    def test_a_real_limit_is_read_in_gigabytes(self):
        self.assertAlmostEqual(cap._cgroup_memory_limit_gb(self._limit_file(str(2 * 1024 ** 3))), 2.0)

    def test_cgroup_v2_unlimited_is_ignored(self):
        self.assertIsNone(cap._cgroup_memory_limit_gb(self._limit_file("max")))

    def test_cgroup_v1_unlimited_is_ignored(self):
        """v1 writes "unlimited" as a number near 2**63.

        Read literally that is several exabytes of RAM, which would size the
        worker for a machine that does not exist.
        """
        self.assertIsNone(cap._cgroup_memory_limit_gb(self._limit_file("9223372036854771712")))

    def test_rubbish_in_the_file_is_ignored_rather_than_crashing(self):
        self.assertIsNone(cap._cgroup_memory_limit_gb(self._limit_file("not-a-number")))

    def test_a_missing_file_is_ignored(self):
        self.assertIsNone(cap._cgroup_memory_limit_gb(("/nonexistent/cgroup/limit",)))


if __name__ == "__main__":
    unittest.main()
