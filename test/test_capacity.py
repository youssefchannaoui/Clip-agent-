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
    "WORKER_MAX_CONCURRENT_JOBS", "FFMPEG_THREADS", "WHISPER_CPU_THREADS",
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

    def test_the_transcriber_gets_the_same_share_as_ffmpeg(self):
        """Both thread budgets are ONE job's share of the machine.

        Told nothing, ctranslate2 sizes its pool from every core it can see --
        free while the box ran one job at a time, and threefold
        oversubscription against ffmpeg's own capped threads now that CAPACITY
        allows three. Deliberately the same share rather than half of it:
        Whisper and ffmpeg never run at the same instant WITHIN one job, so the
        honest budget for each is what one job owns.
        """
        plan = self.plan(cores=8, ram=12.0)
        self.assertEqual(plan["maxConcurrentJobs"], 4)
        self.assertEqual(plan["cpuThreads"], 2, "8 cores across 4 jobs")
        self.assertEqual(plan["cpuThreads"], plan["ffmpegThreads"])

    def test_the_transcribers_share_follows_the_cores_and_the_concurrency(self):
        # A lecture running ALONE now gets cores//jobs rather than the whole
        # machine, and that is the trade this was made for. Several together
        # stop contending, which is what a bigger box was bought for.
        self.assertEqual(self.plan(cores=8, ram=32.0)["cpuThreads"], 2, "8 cores, 4 jobs")
        self.assertEqual(self.plan(cores=16, ram=32.0)["cpuThreads"], 2, "16 cores, 8 jobs")
        self.assertEqual(self.plan(cores=2, ram=2.0)["cpuThreads"], 2, "2 cores, 1 job")

    def test_the_transcribers_share_is_never_zero(self):
        """More jobs than cores must not cap the transcriber at nothing."""
        os.environ["WORKER_MAX_CONCURRENT_JOBS"] = "7"
        plan = self.plan(cores=2, ram=16.0)
        self.assertEqual(plan["maxConcurrentJobs"], 7)
        self.assertGreaterEqual(plan["cpuThreads"], 1)

    def test_the_two_thread_budgets_are_overridden_separately(self):
        """One env var must never drag the other with it.

        FFMPEG_THREADS is about the renderer and WHISPER_CPU_THREADS about the
        transcriber; an operator tuning one has said nothing about the other.
        """
        os.environ["FFMPEG_THREADS"] = "3"
        plan = self.plan(cores=8, ram=12.0)
        self.assertEqual(plan["ffmpegThreads"], 3)
        self.assertEqual(plan["cpuThreads"], 2, "still 8 cores across 4 jobs")

        os.environ["WHISPER_CPU_THREADS"] = "6"
        plan = self.plan(cores=8, ram=12.0)
        self.assertEqual(plan["cpuThreads"], 6)
        self.assertEqual(plan["ffmpegThreads"], 3)

    def test_a_gpu_does_not_invite_unlimited_parallelism(self):
        """One GPU's memory serialises the work whatever the CPU says."""
        self.assertLessEqual(self.plan(cores=32, ram=64.0, gpus=1)["maxConcurrentJobs"], 2)

    def test_a_bigger_model_costs_a_job_slot(self):
        """medium is roughly twice small's weights, and four of them do not fit.

        The box as it stands: 8 cores, a 9G container. Left alone the model
        would be `small` and four jobs would fit; forcing `medium` (which the
        compose file does, deliberately) has to cost a slot, or the container
        OOM killer takes the fourth job mid-render.

        9G, not 10: the compose file moved a gigabyte to Ollama, which was
        sitting at 90% of its own ceiling. THIS TEST IS WHY THAT WAS SAFE --
        the trade only holds while 9G still buys three medium jobs, and if a
        future model or reserve makes it buy two, this goes red rather than
        the box quietly losing a third of its throughput.
        """
        small = self.plan(cores=8, ram=9.0, reserved=0.5)
        self.assertEqual(small["model"], "small")
        self.assertEqual(small["maxConcurrentJobs"], 4)

        os.environ["WHISPER_MODEL"] = "medium"
        big = self.plan(cores=8, ram=9.0, reserved=0.5)
        self.assertEqual(big["model"], "medium")
        self.assertEqual(big["maxConcurrentJobs"], 3)
        self.assertEqual(big["ffmpegThreads"], 2, "8 cores across 3 jobs")
        self.assertEqual(big["cpuThreads"], 2, "and the transcriber gets the same share")

    def test_the_small_models_are_costed_exactly_as_they_were(self):
        """Only medium and larger move the number.

        A machine running base or small must not change its concurrency
        because this table exists.
        """
        for model in ("tiny", "base", "small"):
            self.assertEqual(cap._gb_per_job(model), cap._GB_PER_JOB, model)

    # ── the operator always wins ──

    def test_every_value_can_be_overridden(self):
        os.environ.update({
            "WHISPER_DEVICE": "cuda", "WHISPER_COMPUTE_TYPE": "int8_float16",
            "WHISPER_MODEL": "tiny", "WORKER_MAX_CONCURRENT_JOBS": "7",
            "FFMPEG_THREADS": "3", "WHISPER_CPU_THREADS": "5",
        })
        plan = self.plan(cores=2, ram=2.0)
        self.assertEqual(plan["device"], "cuda")
        self.assertEqual(plan["computeType"], "int8_float16")
        self.assertEqual(plan["model"], "tiny")
        self.assertEqual(plan["maxConcurrentJobs"], 7)
        self.assertEqual(plan["ffmpegThreads"], 3)
        self.assertEqual(plan["cpuThreads"], 5)

    # ── the current box keeps behaving as it does today ──

    def test_todays_worker_box_is_unchanged(self):
        """2 cores, a 2G container limit: one job, two threads, small on CPU."""
        plan = self.plan(cores=2, ram=2.0, reserved=0.5)
        self.assertEqual(plan["maxConcurrentJobs"], 1)
        self.assertEqual(plan["ffmpegThreads"], 2)
        self.assertEqual(plan["device"], "cpu")
        self.assertEqual(plan["computeType"], "int8")
        # New key, same answer: one job owns both cores either way, so adding
        # a transcriber budget changed nothing this machine already did.
        self.assertEqual(plan["cpuThreads"], 2)


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


class ImageDefaultsTests(unittest.TestCase):
    """The image must not carry the settings capacity.py is meant to decide.

    An ENV line in the Dockerfile is indistinguishable from an operator's
    override -- capacity.py's rule is that an explicit value always wins -- so
    five of them baked into the image meant the module could never decide
    anything, on any deployment, whatever the compose file said. It is exactly
    the shape that is invisible when it goes wrong: the worker runs, the suite
    is green, and a bigger machine changes nothing at all.

    WHISPER_MODEL is forced in docker-compose.yml, deliberately and with its
    reason beside it. That is where a force belongs: visible, and editable
    without rebuilding an image.
    """

    FORBIDDEN = (
        "WHISPER_DEVICE", "WHISPER_COMPUTE_TYPE", "WHISPER_MODEL",
        # The transcriber's thread budget joined this family the moment it
        # became a capacity decision. Baked into the image it would be
        # indistinguishable from an operator's override, and every container
        # ever built would carry a number chosen for a machine nobody measured.
        "WHISPER_CPU_THREADS",
        "FFMPEG_THREADS", "WORKER_MAX_CONCURRENT_JOBS",
    )

    def dockerfile(self):
        path = Path(__file__).resolve().parent.parent / "worker" / "Dockerfile"
        # Comments explain what was removed and name every one of these, so a
        # naive search matches the explanation rather than a setting. Strip
        # them; do not reword the note to appease the test.
        lines = [ln for ln in path.read_text().splitlines()
                 if not ln.lstrip().startswith("#")]
        return "\n".join(lines)

    def test_the_image_bakes_in_no_capacity_setting(self):
        body = self.dockerfile()
        for name in self.FORBIDDEN:
            self.assertNotIn(f"{name}=", body,
                             f"{name} is baked into the image; capacity.py can then never decide it")


class LiveShareTests(unittest.TestCase):
    """A job running alone must get the machine, not a full box's share.

    The static plan answers "what does one job own when every slot is busy",
    which is right for reporting and wrong for a lone import -- the case that
    happens most on this product today, where one person imports one lecture.
    """

    def setUp(self):
        self._saved = {k: os.environ.pop(k, None) for k in ENV_KEYS}
        importlib.reload(cap)
        cap.cpu_cores = lambda: 8

    def tearDown(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_one_job_gets_the_machine(self):
        self.assertEqual(cap.threads_for(1)["cpuThreads"], 8)

    def test_the_share_divides_as_jobs_arrive(self):
        self.assertEqual(cap.threads_for(2)["cpuThreads"], 4)
        self.assertEqual(cap.threads_for(3)["cpuThreads"], 2)

    def test_a_full_box_gets_exactly_what_the_plan_says(self):
        """The busy case must not move, or this is a retune wearing a fix's
        clothes: three jobs on this box got two threads each before and must
        still get two."""
        full = cap.plan()["maxConcurrentJobs"]
        self.assertEqual(cap.threads_for(full)["cpuThreads"], cap.plan()["cpuThreads"])
        self.assertEqual(cap.threads_for(full)["ffmpegThreads"], cap.plan()["ffmpegThreads"])

    def test_an_operator_override_is_never_reinterpreted(self):
        os.environ["WHISPER_CPU_THREADS"] = "5"
        os.environ["FFMPEG_THREADS"] = "1"
        importlib.reload(cap)
        cap.cpu_cores = lambda: 8
        for active in (1, 3, 9):
            self.assertEqual(cap.threads_for(active)["cpuThreads"], 5)
            self.assertEqual(cap.threads_for(active)["ffmpegThreads"], 1)

    def test_more_jobs_than_cores_still_leaves_a_thread_each(self):
        self.assertEqual(cap.threads_for(99)["cpuThreads"], 1)


if __name__ == "__main__":
    unittest.main()
