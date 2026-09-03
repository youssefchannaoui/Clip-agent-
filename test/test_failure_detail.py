"""What a customer is told when a job dies.

Youssef, 3 Sept 2026, on the Activity list: "error message?!?!?" One of the
four was a lecture that had FAILED with:

    Processing engine failed: @ 0x59cf21fd5c80] libass API ver

That is a fragment of ffmpeg's INFORMATIONAL banner -- the line it prints on
every render, successful or not -- cut mid-token. Three separate faults
produced it:

  1. `" ".join(stderr_lines[-10:])` takes the END of ffmpeg's output, which is
     its banner, not its complaint.
  2. `[-1000:]` keeps the last thousand CHARACTERS, so the front is sliced off
     wherever it happens to land.
  3. A child killed by a SIGNAL prints nothing at all, so that case -- the one
     that most needs explaining, because on a 3.7G box it means memory -- fell
     through to whatever ffmpeg had last said.

These drive the real function with the real banner lines.
"""
import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
_spec = importlib.util.spec_from_file_location("dc_service", ROOT / "worker" / "service.py")
service = importlib.util.module_from_spec(_spec)
try:
    _spec.loader.exec_module(service)
except SystemExit:  # the module guards its own CLI entry point
    pass

# Verbatim from a real render. ffmpeg prints these whether the job works or not.
BANNER = [
    "[Parsed_subtitles_0 @ 0x59cf21fd5c80] libass API version: 0x1601000",
    "[Parsed_subtitles_0 @ 0x59cf21fd5c80] libass source: tarball: 0.17.1",
    "[Parsed_subtitles_0 @ 0x59cf21fd5c80] Shaper: FriBidi 1.0.8 HarfBuzz-ng 6.0.0 (complex)",
    "[Parsed_subtitles_0 @ 0x59cf21fd5c80] Using font provider fontconfig",
    "[Parsed_subtitles_0 @ 0x59cf21fd5c80] Added subtitle file: caption.ass",
]


class FailureDetailTests(unittest.TestCase):
    def detail(self, code, reported="", lines=None):
        return service.failure_detail(code, reported, list(BANNER if lines is None else lines))

    def test_the_banner_never_reaches_the_customer(self):
        """The exact fault reported. Nothing in the banner may be quoted."""
        said = self.detail(1)
        self.assertNotIn("libass", said)
        self.assertNotIn("0x59cf21fd5c80", said)
        self.assertNotIn("font provider", said)
        # And what it says instead is honest rather than empty.
        self.assertIn("exited with code 1", said)
        self.assertIn("nothing that explains why", said)

    def test_a_killed_engine_says_it_was_killed(self):
        """Popen.wait() returns a NEGATIVE code for a signal, and prints nothing.

        This is the branch that matters most: the box has 3.7G, an AI container
        capped at 2G and ffmpeg beside it, and the kernel has killed processes
        here before (five llama-server OOM kills are in dmesg). Without this
        the customer was shown ffmpeg's banner for an out-of-memory kill.
        """
        said = self.detail(-9)
        self.assertIn("killed by the system", said)
        self.assertIn("SIGKILL", said)
        self.assertIn("memory", said, "and it names the cause worth checking first")
        self.assertNotIn("libass", said)

    def test_another_signal_is_named_rather_than_guessed(self):
        said = self.detail(-15)
        self.assertIn("SIGTERM", said)
        # Only SIGKILL gets the memory explanation; the rest must not claim it.
        self.assertNotIn("memory", said)

    def test_a_real_complaint_is_found_under_the_banner(self):
        """ffmpeg prints its error BEFORE the tail of its banner, which is
        exactly why taking the last ten lines lost it."""
        said = self.detail(1, lines=BANNER + [
            "[out#0/mp4 @ 0x1] Error opening output file /out/clip.mp4: No space left on device",
            "[Parsed_subtitles_0 @ 0x59cf21fd5c80] Using font provider fontconfig",
        ])
        self.assertIn("No space left on device", said)

    def test_a_python_traceback_keeps_its_last_line(self):
        """A traceback's meaning is in its final line, never its first."""
        said = self.detail(1, lines=[
            "Traceback (most recent call last):",
            '  File "/app/worker/clip_worker.py", line 3612, in render_clip',
            "ValueError: ayah size must be positive",
        ])
        self.assertIn("ValueError: ayah size must be positive", said)

    def test_the_worker_s_own_error_always_wins(self):
        """When clip_worker reports a reason, nothing else is consulted."""
        said = self.detail(1, reported="Nasheed rotation needs two or more tracks.")
        self.assertEqual(said, "Nasheed rotation needs two or more tracks.")

    def test_nothing_at_all_still_says_something(self):
        said = self.detail(3, lines=[])
        self.assertIn("exited with code 3", said)

    def test_the_message_is_bounded(self):
        said = self.detail(1, lines=["Error: " + "x" * 5000])
        self.assertLessEqual(len(said), 1000)


if __name__ == "__main__":
    unittest.main()
