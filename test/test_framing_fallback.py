"""Automatic framing must never cost a lecture (9 Sept 2026).

Youssef, on a two-person podcast: "how are things still failing and not
finishing". The box's own job record answered it:

    job project_mtttu0hd_bac41caa  status='failed' progress=85
    error: Command failed (1): ffmpeg ...
           *(587.0+(-57.0)*(t-44.500)/0.500)+530*gte(t,45.000)*lt(t,45.500)
           +(gte(t,45.500)*lt(t,45.950))*(530.0+(74.0)*(t-45.500)/0.450)
    title: MOST Muslims Don't Realize This About Allah | ...

A MOVING crop is an ffmpeg expression -- one gated term per keyframe, evaluated
per frame -- and the active-speaker tracker emits a long one on a two-person
shot where it cannot tell who is talking. ffmpeg refused it at the render
stage, and the whole 19-minute lecture died with it: six clips, an hour of
work and a customer's tokens, lost to a FRAMING preference.

The crop gives way now and the clip still ships, framed on its first keyframe
-- the static crop every render produced before the tracker existed.
"""
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
import clip_worker as cw  # noqa: E402


MOVING = {
    "x": 530, "y": 0, "w": 608, "h": 1080, "srcW": 1920, "srcH": 1080,
    "method": "active-speaker",
    "keyframes": [
        {"t": 0.0, "x": 530, "y": 0, "w": 608, "h": 1080},
        {"t": 0.5, "x": 604, "y": 0, "w": 608, "h": 1080},
        {"t": 1.0, "x": 530, "y": 0, "w": 608, "h": 1080},
    ],
}
STILL = {"x": 530, "y": 0, "w": 608, "h": 1080, "srcW": 1920, "srcH": 1080,
         "method": "face", "keyframes": None}


class FramingFallbackTests(unittest.TestCase):
    """The fallback itself, driven rather than read."""

    def test_a_refused_moving_crop_is_retried_without_the_movement(self):
        seen = []

        def attempt(plan):
            seen.append(plan)
            if plan.get("keyframes"):
                raise RuntimeError("Command failed (1): ffmpeg ... gte(t,45.500)")

        used = cw.export_with_framing_fallback(
            attempt=attempt, plan=MOVING, on_refusal=lambda _: None)

        self.assertEqual(len(seen), 2, "it must try again rather than give up")
        self.assertTrue(seen[0].get("keyframes"), "the first attempt keeps the movement")
        self.assertIsNone(seen[1].get("keyframes"), "the second gives it up")
        self.assertIsNone(used.get("keyframes"), "and reports which plan rendered")
        # The clip is still FRAMED -- on the first keyframe, not reset to centre.
        self.assertEqual(seen[1]["x"], MOVING["x"])
        self.assertEqual(seen[1]["w"], MOVING["w"])

    def test_the_original_plan_is_not_mutated(self):
        # render_clip reads crop_plan again for the result metadata, and a
        # dict quietly emptied here would misreport how the clip was framed.
        cw.export_with_framing_fallback(
            attempt=lambda plan: (_ for _ in ()).throw(RuntimeError("no"))
            if plan.get("keyframes") else None,
            plan=MOVING, on_refusal=lambda _: None)
        self.assertEqual(len(MOVING["keyframes"]), 3)

    def test_the_reason_is_reported_rather_than_swallowed(self):
        # Falling back silently is how a feature goes quietly dead for months.
        told = []
        cw.export_with_framing_fallback(
            attempt=lambda plan: (_ for _ in ()).throw(RuntimeError("ffmpeg said no"))
            if plan.get("keyframes") else None,
            plan=MOVING, on_refusal=told.append)
        self.assertEqual(len(told), 1)
        self.assertIn("ffmpeg said no", str(told[0]))

    def test_a_still_crop_that_fails_is_NOT_retried(self):
        # There is no framing left to give up, so a second identical attempt
        # would cost another hour and fail the same way.
        seen = []

        def attempt(plan):
            seen.append(plan)
            raise RuntimeError("something else is wrong")

        with self.assertRaises(RuntimeError):
            cw.export_with_framing_fallback(attempt=attempt, plan=STILL,
                                            on_refusal=lambda _: None)
        self.assertEqual(len(seen), 1)

    def test_no_crop_plan_at_all_is_NOT_retried(self):
        seen = []

        def attempt(plan):
            seen.append(plan)
            raise RuntimeError("something else is wrong")

        with self.assertRaises(RuntimeError):
            cw.export_with_framing_fallback(attempt=attempt, plan=None,
                                            on_refusal=lambda _: None)
        self.assertEqual(len(seen), 1)

    def test_a_TIMEOUT_is_not_a_refusal_and_is_never_retried(self):
        # The render was too SLOW. Spending the budget again would take the
        # job down rather than save it.
        seen = []

        def attempt(plan):
            seen.append(plan)
            raise subprocess.TimeoutExpired(["ffmpeg"], 3600)

        with self.assertRaises(subprocess.TimeoutExpired):
            cw.export_with_framing_fallback(attempt=attempt, plan=MOVING,
                                            on_refusal=lambda _: None)
        self.assertEqual(len(seen), 1, "a timeout must not buy a second hour")

    def test_a_render_that_works_is_left_completely_alone(self):
        seen = []
        used = cw.export_with_framing_fallback(
            attempt=seen.append, plan=MOVING, on_refusal=lambda _: None)
        self.assertEqual(len(seen), 1)
        self.assertTrue(used.get("keyframes"), "the moving crop still ships when it works")

    def test_the_retry_failing_too_raises_rather_than_hiding_it(self):
        with self.assertRaises(RuntimeError):
            cw.export_with_framing_fallback(
                attempt=lambda plan: (_ for _ in ()).throw(RuntimeError("still broken")),
                plan=MOVING, on_refusal=lambda _: None)


class StillGraphTests(unittest.TestCase):
    """And the still plan really does drop the expression ffmpeg refused."""

    def graph(self, plan):
        return cw.build_video_filter(
            {"width": 1080, "height": 1920, "fitMode": "crop"},
            Path("/tmp/none.ass"), crop_plan=plan)

    def test_a_moving_plan_builds_a_time_expression(self):
        # If this stops being true the fallback is guarding nothing.
        self.assertIn("gte(t", self.graph(MOVING))

    def test_the_still_plan_builds_plain_integers(self):
        graph = self.graph(dict(MOVING, keyframes=None))
        self.assertNotIn("gte(t", graph)
        self.assertIn("crop=608:1080:530:0", graph)


if __name__ == "__main__":
    unittest.main()
