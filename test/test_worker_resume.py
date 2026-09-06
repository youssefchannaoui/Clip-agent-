"""The worker survives being stopped (6 Sept 2026).

Youssef: "MAKE SURE THE AI WORKER IS WORKING COMPLETELY FINE FIX ALL ISSUES
MAKE IT BULLETPROOF." What was measured before anything was built:

  - a cancel, the budget and a shutdown all sent ONE SIGTERM to
    clip_worker.py and nothing to the ffmpeg or Whisper it had started;
  - a restart requeued an unfinished job at progress 5 with nothing kept, so
    the render it was three clips into started again from the import -- twice
    in one afternoon for one customer, because two deploys landed four minutes
    apart;
  - housekeeping ran once, at boot;
  - a recovered preview render went to the main lane behind whatever lecture
    was queued.

Every test here drives the real service module against a fake clip_worker or
the real job store, and reads what it did: exit paths, status records, the job
file handed to the child. All were proven red against the unpatched service.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

WORKER = Path(__file__).resolve().parents[1] / "worker"
sys.path.insert(0, str(WORKER))
import importlib  # noqa: E402

REPO = Path(__file__).resolve().parents[1]

HEARTBEATS = (
    "import json, sys, time\n"
    "while True:\n"
    "    print(json.dumps({'type': 'heartbeat'}), flush=True); time.sleep(0.1)\n"
)

# A fake clip_worker that starts a grandchild which IGNORES SIGTERM -- what a
# wedged ffmpeg looks like -- and writes its pid beside the job file. The
# grandchild inherits the child's stdout PIPE, as a real ffmpeg does, so the
# service's reader loop stays blocked on it for as long as the grandchild
# lives. Heartbeats are SLOW on purpose: CI's first run of this test had the
# child die on SIGTERM before its next line, so the loop never reached its own
# cancel check and sat on that pipe -- and the escalation checked the CHILD,
# which poll() had already reaped, instead of the group, so nothing ever
# killed the grandchild. Fast heartbeats hid all of that locally.
# The grandchild writes a READY marker once its handler is installed: sent
# the SIGTERM a few milliseconds earlier, during interpreter start-up, it
# would die of it like any process and the test would pass against code
# that never reached it -- which is what happened locally the first time.
GRANDCHILD = (
    "import json, subprocess, sys, time\n"
    "g = subprocess.Popen([sys.executable, '-c',\n"
    "    'import signal, sys, time; signal.signal(signal.SIGTERM, signal.SIG_IGN);'\n"
    "    ' open(sys.argv[1], \"w\").write(\"ready\"); time.sleep(120)', sys.argv[1] + '.ready'])\n"
    "open(sys.argv[1] + '.pid', 'w').write(str(g.pid))\n"
    "while True:\n"
    "    print(json.dumps({'type': 'heartbeat'}), flush=True); time.sleep(2)\n"
)


def alive(pid: int) -> bool:
    """Running, as opposed to gone or a zombie nobody has reaped yet.

    THROUGH `ps`, NOT /proc. procfs is Linux-only, so on a Mac this answered
    False for every living process and `assertTrue(alive(grandchild))` failed
    -- while CI, which is Ubuntu, went green. That is the mirror of the
    case-sensitive-path trap this repo already records, and the worse
    direction of the two: a suite that is red only on the developer's own
    machine is a tick nobody can trust, and this one had been red here since
    the feature landed in v3.133.0.

    `ps -o state=` is POSIX and prints the same first letter on both (`Z` for
    a zombie, `S`/`R` for a live one); macOS decorates it (`S+`), hence the
    startswith rather than an equality.
    """
    try:
        out = subprocess.run(["ps", "-o", "state=", "-p", str(pid)],
                             capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:  # noqa: BLE001 - a probe must never fail the test it serves
        return False
    return bool(out) and not out.startswith("Z")


class WorkerResumeTests(unittest.TestCase):
    def setUp(self):
        # RESOLVED, because on macOS /var is a symlink to /private/var: mkdtemp
        # hands back the /var spelling and the service resolves the other, so a
        # path assertion compared two names for one directory and failed here
        # while passing on Linux.
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="deenclipped-resume-"))
        os.environ["WORKER_DATA_DIR"] = self.root
        os.environ["WORKER_SHARED_SECRET"] = "s" * 40
        self.service = importlib.reload(importlib.import_module("service"))

    def tearDown(self):
        for key in ("WORKER_DATA_DIR",):
            os.environ.pop(key, None)
        shutil.rmtree(self.root, ignore_errors=True)

    def fake_worker(self, script: str) -> Path:
        fake_root = Path(self.root) / "fake"
        (fake_root / "worker").mkdir(parents=True, exist_ok=True)
        (fake_root / "worker" / "clip_worker.py").write_text(script)
        return fake_root

    def run_child(self, processor, job_id: str, fake_root: Path):
        """run_clip_worker on a thread; returns (thread, outcome dict)."""
        job_file = Path(self.root) / f"{job_id}.json"
        job_file.write_text("{}")
        outcome: dict = {}

        def run():
            try:
                outcome["result"] = processor.run_clip_worker(job_id, job_file, Path(self.root) / "result.json")
            except Exception as exc:  # noqa: BLE001 - the exception IS the result under test
                outcome["error"] = exc

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        deadline = time.time() + 10
        while time.time() < deadline and job_id not in processor.running:
            time.sleep(0.02)
        self.assertIn(job_id, processor.running, "the child started")
        return thread, outcome, job_file

    # ── stopping a job stops all of it ────────────────────────────────────

    def test_a_cancel_stops_the_child_and_everything_it_started(self):
        fake_root = self.fake_worker(GRANDCHILD)
        store = self.service.JobStore()
        store.create({"id": "grp", "settings": {}})
        processor = self.service.Processor(store)
        with mock.patch.object(self.service, "ROOT", fake_root), \
             mock.patch.object(self.service, "KILL_GRACE_SECONDS", 0.5):
            thread, outcome, job_file = self.run_child(processor, "grp", fake_root)
            pid_file = Path(str(job_file) + ".pid")
            ready_file = Path(str(job_file) + ".ready")
            deadline = time.time() + 10
            while time.time() < deadline and not (pid_file.exists() and ready_file.exists()):
                time.sleep(0.02)
            self.assertTrue(pid_file.exists() and ready_file.exists(), "the grandchild is up and ignoring SIGTERM")
            grandchild = int(pid_file.read_text())
            self.assertTrue(alive(grandchild))
            processor.cancel("grp")
            thread.join(timeout=10)
        self.assertFalse(thread.is_alive(), "the reader loop ended")
        self.assertIsInstance(outcome.get("error"), self.service.ImportProviderError)
        self.assertNotIn("grp", processor.running, "the slot is released")
        # The grandchild ignores SIGTERM. Only a signal to the whole process
        # group, escalated to SIGKILL, reaches it -- a plain terminate() left
        # it rendering on beside the next job.
        deadline = time.time() + 6
        while time.time() < deadline and alive(grandchild):
            time.sleep(0.05)
        self.assertFalse(alive(grandchild), "the grandchild was killed with the group")

    def test_a_shutdown_marks_the_job_interrupted_and_the_child_exits_as_interrupted(self):
        fake_root = self.fake_worker(HEARTBEATS)
        store = self.service.JobStore()
        store.create({"id": "shut", "settings": {}})
        processor = self.service.Processor(store)
        with mock.patch.object(self.service, "ROOT", fake_root):
            thread, outcome, _ = self.run_child(processor, "shut", fake_root)
            marked = processor.shutdown(grace=0.5)
            thread.join(timeout=10)
        self.assertEqual(marked, ["shut"])
        self.assertTrue(processor.stop.is_set(), "the consumer threads are told to stop picking up work")
        status = store.read("shut")
        self.assertEqual(status["status"], "interrupted")
        self.assertIn("restart", status["stage"])
        self.assertIsNone(status["error"])
        self.assertIsInstance(outcome.get("error"), self.service.JobInterrupted,
                              "the child's exit is reported as an interruption, never a failure")

    # ── the record after a restart ────────────────────────────────────────

    def test_recover_keeps_what_was_done_and_counts_the_restarts(self):
        store = self.service.JobStore()
        store.create({"id": "res", "settings": {}})
        clips = [{"id": "res-01", "clipUrl": "https://media.test/res-01.mp4", "title": "one"}]
        plan = [{"index": 1, "title": "one"}, {"index": 2, "title": "two"}]
        store.update("res", status="Rendering clip 2 of 2", stage="Rendering clip 2 of 2", progress=85,
                     partialClips=clips, clipPlan=plan, totalClips=2, currentClip=2, clipPercent=40, etaSec=30)
        self.assertEqual(store.recover(), ["res"])
        status = store.read("res")
        self.assertEqual(status["status"], "queued")
        self.assertEqual(status["resumed"], 1)
        self.assertEqual(status["partialClips"], clips, "the clip already uploaded is kept")
        self.assertEqual(status["clipPlan"], plan, "and the plan it came from")
        self.assertEqual(status["totalClips"], 2)
        for key in ("currentClip", "clipPercent", "etaSec"):
            self.assertIsNone(status[key], f"{key} described a render that is no longer running")
        # An interrupted job is exactly what recover() is for.
        store.update("res", status="interrupted", stage="interrupted by a worker restart")
        store.recover()
        self.assertEqual(store.read("res")["resumed"], 2)
        store.update("res", status="Rendering clip 2 of 2")
        store.recover()
        self.assertEqual(store.read("res")["resumed"], 3)
        self.assertEqual(store.read("res")["status"], "queued", "three restarts are still resumed")
        store.update("res", status="Rendering clip 2 of 2")
        self.assertEqual(store.recover(), [], "the fourth is not")
        status = store.read("res")
        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["error"], self.service.RESUME_GIVE_UP)

    def test_a_finished_job_is_left_alone_by_recover(self):
        store = self.service.JobStore()
        for job_id, final in (("done", "completed"), ("bad", "failed"), ("off", "cancelled")):
            store.create({"id": job_id, "settings": {}})
            store.update(job_id, status=final, stage=final)
        self.assertEqual(store.recover(), [])
        for job_id, final in (("done", "completed"), ("bad", "failed"), ("off", "cancelled")):
            self.assertEqual(store.read(job_id)["status"], final)
            self.assertNotIn("resumed", store.read(job_id))

    def test_start_puts_a_recovered_preview_back_on_the_quick_lane_and_arms_housekeeping(self):
        store = self.service.JobStore()
        store.create({"id": "pv", "lane": "quick", "settings": {}})
        store.update("pv", status="rendering", stage="Rendering", progress=70)
        store.create({"id": "lec", "settings": {}})
        store.update("lec", status="transcribing", stage="Transcribing", progress=40)
        processor = self.service.Processor(store)
        processor.threads = []
        with mock.patch.object(self.service, "announce_boot"), \
             mock.patch.object(processor, "cleanup_abandoned"), \
             mock.patch.object(self.service.threading, "Thread") as thread_cls:
            processor.start()
        self.assertEqual(processor.quick_queue.qsize(), 1, "the preview went back to its own lane")
        self.assertEqual(processor.queue.qsize(), 1, "the lecture to the main one")
        names = {call.kwargs.get("name") for call in thread_cls.call_args_list}
        self.assertIn("housekeeping", names, "the prune runs on a timer, not once at boot")
        self.assertIn("queue-pulse", names)

    def test_housekeeping_prunes_on_a_timer(self):
        store = self.service.JobStore()
        processor = self.service.Processor(store)
        with mock.patch.object(self.service, "HOUSEKEEPING_SECONDS", 0.03), \
             mock.patch.object(processor, "cleanup_abandoned") as prune:
            thread = threading.Thread(target=processor.housekeeping, daemon=True)
            thread.start()
            time.sleep(0.3)
            processor.stop.set()
            thread.join(timeout=2)
        self.assertGreaterEqual(prune.call_count, 3)

    # ── the resume itself ─────────────────────────────────────────────────

    def test_process_keeps_an_interrupted_job_interrupted_and_tells_nobody_it_failed(self):
        store = self.service.JobStore()
        for job_id in ("imp", "imp2"):
            store.create({"id": job_id, "source": {"url": "https://example.test/x.mp4"},
                          "settings": {"musicEnabled": False}})
        # Going down: the import is aborted and surfaces as an ordinary error.
        processor = self.service.Processor(store)
        processor.stop.set()
        with mock.patch.object(self.service, "import_with_fallback", side_effect=RuntimeError("the download was aborted")), \
             mock.patch.object(processor, "callback") as callback:
            processor.process("imp")
        status = store.read("imp")
        self.assertEqual(status["status"], "interrupted")
        self.assertIsNone(status["error"])
        callback.assert_not_called()
        # Not going down: the same error is the failure it always was.
        steady = self.service.Processor(store)
        with mock.patch.object(self.service, "import_with_fallback", side_effect=RuntimeError("the download was aborted")), \
             mock.patch.object(steady, "callback") as callback:
            steady.process("imp2")
        status = store.read("imp2")
        self.assertEqual(status["status"], "failed")
        self.assertIn("aborted", status["error"])
        callback.assert_called_once()

    def test_a_resumed_job_hands_clip_worker_its_plan_and_the_clips_already_uploaded(self):
        store = self.service.JobStore()
        store.create({"id": "res", "source": {"url": "https://example.test/x.mp4"}, "settings": {"musicEnabled": False}})
        uploaded = {"id": "res-01", "clipUrl": "https://media.test/res-01.mp4", "thumbUrl": "https://media.test/res-01.jpg", "title": "one"}
        store.update("res", status="Rendering clip 2 of 2", progress=85, partialClips=[uploaded])
        self.assertEqual(store.recover(), ["res"])
        # Created AFTER the recover: a job the restart never saw.
        store.create({"id": "fresh", "source": {"url": "https://example.test/x.mp4"}, "settings": {"musicEnabled": False}})
        processor = self.service.Processor(store)
        seen: dict = {}

        def fake_import(source_payload, destination, pulse, storage):
            Path(destination).write_bytes(b"\x00" * 16)
            return self.service.ImportedSource(file=Path(destination), provider="test")

        def fake_run(job_id, job_file, result_path):
            seen[job_id] = json.loads(job_file.read_text(encoding="utf-8"))
            seen[job_id + ":uploads"] = dict(processor.partial_uploads.get(job_id, {}))
            return {"project": {"clipCount": 1}, "clips": []}

        with mock.patch.object(self.service, "import_with_fallback", side_effect=fake_import), \
             mock.patch.object(processor, "run_clip_worker", side_effect=fake_run), \
             mock.patch.object(processor, "callback"):
            processor.process("res")
            processor.process("fresh")
        job = seen["res"]
        self.assertEqual(job["resume"], {"attempt": 1, "uploadedIds": ["res-01"]})
        self.assertEqual(job["planFile"], str(Path(self.root) / "jobs" / "res" / "plan.json"),
                         "the plan lives beside the job record, which survives a restart")
        self.assertEqual(list(seen["res:uploads"]), ["res-01"], "partial_uploads was seeded from the record")
        status = store.read("res")
        self.assertEqual(status["status"], "completed")
        self.assertEqual([clip["id"] for clip in status["result"]["clips"]], ["res-01"],
                         "the clip the earlier attempt uploaded is in the result without being rendered again")
        self.assertEqual(status["result"]["project"]["clipCount"], 1)
        self.assertIsNone(seen["fresh"]["resume"], "a first run resumes nothing")
        self.assertTrue(seen["fresh"]["planFile"].endswith("/jobs/fresh/plan.json"))

    def test_upload_result_puts_the_earlier_attempts_clips_back_in_plan_order(self):
        store = self.service.JobStore()
        store.create({"id": "m", "settings": {}})
        processor = self.service.Processor(store)
        processor.partial_uploads["m"] = {
            "m-03": {"id": "m-03", "clipUrl": "u3"},
            "m-01": {"id": "m-01", "clipUrl": "u1"},
        }
        with mock.patch.object(processor, "upload_clip", side_effect=lambda job_id, clip: {"id": clip["id"], "clipUrl": "u2"}):
            public = processor.upload_result("m", {"project": {"clipCount": 1}, "clips": [{"id": "m-02"}]})
        self.assertEqual([clip["id"] for clip in public["clips"]], ["m-01", "m-02", "m-03"])
        self.assertEqual(public["project"]["clipCount"], 3)

    # ── the deploy waits, and the readiness says what for ─────────────────

    def test_readiness_names_the_jobs_in_flight_and_the_deploy_waits_for_them(self):
        source = (WORKER / "service.py").read_text(encoding="utf-8")
        readiness = source[source.index('path == "/readiness"'):source.index('path == "/ai/advise"')]
        self.assertIn('"inFlight": PROCESSOR.in_flight_ids()', readiness)
        drain = (WORKER / "drain.sh").read_text(encoding="utf-8")
        self.assertIn('idle = {"queued", "completed", "failed", "cancelled", "interrupted"}', drain,
                      "a queued job has not started and loses nothing; an interrupted one is already waiting")
        self.assertIn("deploying anyway, they will resume", drain, "a timeout warns and proceeds")
        self.assertIn('DEPLOY_DRAIN_MINUTES=0', drain)
        deploy = (WORKER / "deploy.sh").read_text(encoding="utf-8")
        self.assertLess(deploy.index("bash worker/drain.sh"), deploy.index("docker compose -f worker/docker-compose.yml up -d --build"),
                        "the drain runs BEFORE the container is recreated")
        compose = (WORKER / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("stop_grace_period: 45s", compose, "time for the SIGTERM handler to mark and stop")
        workflow = (REPO / ".github" / "workflows" / "deploy-worker.yml").read_text(encoding="utf-8")
        self.assertIn("DEPLOY_DRAIN_MINUTES=$DRAIN bash -s", workflow)
        self.assertRegex(workflow, r"case \"\$DRAIN\" in ''\|\*\[!0-9\]\*\) DRAIN=20 ;; esac",
                         "the one interpolated value is digits only")
        verify = (WORKER / "verify-deploy.sh").read_text(encoding="utf-8")
        for marker in ("start_new_session", "def shutdown", "def write_plan"):
            self.assertIn(f'"{marker}"', verify, f"the deploy proof reads {marker} out of the running container")

    def test_the_signal_handler_marks_before_it_closes_the_server(self):
        source = (WORKER / "service.py").read_text(encoding="utf-8")
        main = source[source.index("def main() -> int:"):]
        # The CODE, not the comment above it that mentions server.shutdown().
        code = "\n".join(line for line in main.splitlines() if not line.strip().startswith("#"))
        self.assertLess(code.index("PROCESSOR.shutdown()"), code.index("server.shutdown()"))
        self.assertIn("start_new_session=True", source)
        self.assertEqual(source.count(".terminate()"), 0, "every stop goes through stop_child, which reaches the group")


if __name__ == "__main__":
    unittest.main()
