"""The render plan checkpoint (6 Sept 2026).

A job interrupted while RENDERING used to pay the whole score again -- minutes
of Ollama on a single-slot box -- when the worker came back. clip_worker now
writes the selected, snapped, titled clips beside the job record the moment
they are known, and a RESUMED job (service.py hands it `resume`) reads them
back and renders only the clips whose ids the service says were not uploaded.
"""
import inspect
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
import clip_worker as cw  # noqa: E402


def candidate(**overrides):
    fields = dict(start=10.0, end=40.0, text="the words", segments=[{"start": 10.0, "end": 40.0, "text": "the words"}],
                  score=42, reasons=["question opening"], quote_risk=False)
    fields.update(overrides)
    return cw.Candidate(**fields)


class RenderPlanTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="deenclipped-plan-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_a_plan_round_trips_without_its_verse_map(self):
        first = candidate(ai_title="A title", ai_description="A description", ai_reason="why", ayat=[{"start": 1.0, "ayah": "x"}])
        second = candidate(start=50.0, end=80.0, text="more words", cuts=[[50.0, 60.0], [65.0, 80.0]])
        path = self.root / "jobs" / "j" / "plan.json"
        cw.write_plan(path, [first, second])
        self.assertFalse(path.with_suffix(".tmp").exists(), "written atomically")
        back = cw.load_plan(path)
        self.assertEqual(len(back), 2)
        one, two = back
        self.assertEqual((one.start, one.end, one.text, one.score, one.reasons, one.quote_risk), (10.0, 40.0, "the words", 42, ["question opening"], False))
        self.assertEqual((one.ai_title, one.ai_description, one.ai_reason), ("A title", "A description", "why"))
        self.assertEqual(one.segments, first.segments)
        self.assertIsNone(one.ayat, "the verse map is re-derived on resume, never stored")
        self.assertEqual(two.cuts, [[50.0, 60.0], [65.0, 80.0]])

    def test_anything_but_a_plan_is_refused(self):
        self.assertIsNone(cw.load_plan(self.root / "missing.json"))
        garbage = self.root / "garbage.json"
        garbage.write_text("{not json")
        self.assertIsNone(cw.load_plan(garbage))
        wrong = self.root / "wrong.json"
        wrong.write_text(json.dumps({"version": 99, "clips": []}))
        self.assertIsNone(cw.load_plan(wrong))
        short = self.root / "short.json"
        short.write_text(json.dumps({"version": cw.PLAN_VERSION, "clips": [{"start": 1.0}]}))
        self.assertIsNone(cw.load_plan(short), "a row missing the required fields is not a plan")
        empty = self.root / "empty.json"
        empty.write_text(json.dumps({"version": cw.PLAN_VERSION, "clips": []}))
        self.assertIsNone(cw.load_plan(empty), "an empty plan is no plan: score the lecture")

    def test_the_main_path_reads_the_plan_only_on_a_resume_and_skips_the_uploaded_clips(self):
        source = inspect.getsource(cw.process)
        load = source.index("load_plan(")
        build = source.index("build_candidates(")
        title = source.index("title_selected_clips(")
        write = source.index("write_plan(")
        render = source.index("render_clip(")
        self.assertLess(load, build, "the plan is consulted before any scoring is paid for")
        self.assertLess(title, write, "and written only once the clips are titled")
        self.assertLess(write, render)
        self.assertIn("load_plan(plan_file) if (resume and plan_file) else None", source,
                      "a fresh run of the same id never reads a plan made from other settings")
        skip = source.index("uploadedIds")
        self.assertLess(skip, render, "clips the service says were uploaded are skipped before rendering")
        self.assertIn("f\"{job['id']}-{index:02d}\" in already_done", source,
                      "matched by the same id render_clip mints")
        self.assertIn('"clipCount": len(rendered) + skipped', source)


if __name__ == "__main__":
    unittest.main()
