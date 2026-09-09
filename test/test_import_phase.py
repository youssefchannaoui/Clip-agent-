"""The import names its own phase, so the app can time it.

Youssef, 9 Sept 2026, watching an import: "it says it's on fifty seven MB, but
it's zero percent of this step. So surely, it would be more than zero percent
at that stage."

He was right, and the fault was one missing field. The pipeline's phases carry a
stable identifier -- clip_worker.py stamps `phase` for transcribe, score and
render (phase_for) -- and the DOWNLOAD runs in service.py before clip_worker is
spawned, so nothing ever wrote one for it. The app stamps `phaseStartedAt` when
the phase CHANGES, so the import had no clock; and the dashboard's last-resort
fraction is elapsed-over-expected, which with no clock returns 0 for the whole
download. Reproduced against the shipped adapter with production's own payload:

    no phase   "importing - 0% of this step - 31.0 MB - 283 KB/s"
    phase      "importing - 33% of this step - 31.0 MB - 283 KB/s"

A denominator would answer it too, and often does -- but a fragmented format and
every section download (ffmpeg, which fires no byte hooks) have none, and those
are exactly the imports that read 0%.
"""
import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))


class ImportPhaseTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        os.environ["WORKER_DATA_DIR"] = self.root
        self.service = importlib.reload(importlib.import_module("service"))
        self.store = self.service.JobStore()
        self.processor = self.service.Processor(self.store)
        self.job = "job_import_phase"
        self.store.create({"id": self.job, "url": "https://example.test/x", "settings": {}})

    def tearDown(self):
        self.processor.stop.set()
        os.environ.pop("WORKER_DATA_DIR", None)

    def record(self):
        return self.store.read(self.job) or {}

    def test_the_download_is_named_before_a_single_byte_has_landed(self):
        # The provider calls this as its cancellation check long before any
        # bytes exist, and that first call is what starts the clock. Gating the
        # name on having bytes would leave the slowest part of a slow import --
        # the wait for the first byte through the proxy pool -- unmeasured.
        pulse = self.processor.import_pulse(self.job)
        pulse()
        self.assertEqual(self.record().get("phase"), "import")

    def test_it_does_not_change_between_beats(self):
        # THIS IS THE PROPERTY THAT MATTERS. The app stamps phaseStartedAt when
        # the phase changes, so a name that moves every beat is worth exactly as
        # much as no name at all: the clock resets on every poll and the
        # fraction goes straight back to zero. A provider's human note is a
        # separate thing and belongs in the stage line.
        pulse = self.processor.import_pulse(self.job)
        pulse(note="Waiting on the pool (0m 05s)")
        first = self.record().get("phase")
        pulse(1_000_000, 0, "Waiting on the pool (2m 41s)")
        pulse(9_000_000, 0, "Downloading")
        self.assertEqual(first, "import")
        self.assertEqual(self.record().get("phase"), "import")

    def test_the_bytes_still_travel_with_it(self):
        # The name is added to the beat, not instead of it.
        pulse = self.processor.import_pulse(self.job)
        pulse(31 * 1024 * 1024, 0)
        row = self.record()
        self.assertEqual(row.get("phase"), "import")
        self.assertEqual(row.get("bytesDone"), 31 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
