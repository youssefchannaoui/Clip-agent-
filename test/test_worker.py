import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("clip_worker", ROOT / "worker" / "clip_worker.py")
worker = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

class WorkerScoringTests(unittest.TestCase):
    def setUp(self):
        self.segments = [
            {"start": 0.0, "end": 8.0, "text": "Remember that hardship can bring a believer closer to Allah."},
            {"start": 8.1, "end": 16.0, "text": "The important question is how you respond to the test."},
            {"start": 16.1, "end": 24.0, "text": "Return sincerely, repair what you can, and continue forward."},
            {"start": 24.1, "end": 32.0, "text": "Hope and responsibility should remain together."},
        ]

    def test_builds_complete_candidates(self):
        candidates = worker.build_candidates(self.segments, 15, 35)
        self.assertTrue(candidates)
        selected = worker.select_candidates(candidates, 2)
        self.assertLessEqual(len(selected), 2)
        self.assertTrue(all(15 <= item.duration <= 35 for item in selected))
        self.assertTrue(all(1 <= item.score <= 100 for item in selected))

    def test_religious_quote_is_flagged_for_review(self):
        score, reasons, risk = worker.score_candidate(0, 35, "The hadith says this wording must be reviewed.", self.segments)
        self.assertTrue(risk)
        self.assertIn("religious quotation needs human review", reasons)
        self.assertGreater(score, 0)

    def test_quality_report_contains_retention_metrics(self):
        candidate = worker.Candidate(0, 32, "Remember that hardship can bring a believer closer to Allah.", self.segments, 84, ["stands alone"], False)
        report = worker.quality_report(candidate, {"captionFontSize": 62, "captionMaxWords": 6})
        self.assertGreaterEqual(report["overall"], 1)
        self.assertLessEqual(report["overall"], 100)
        self.assertIn("hook", report)
        self.assertIn("readability", report)

if __name__ == "__main__":
    unittest.main()
