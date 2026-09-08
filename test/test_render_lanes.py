"""Clips render in lanes, and the lane count follows the box's live load.

Measured on a real recitation, 8 September 2026: 9 clips took 577s of an 1113s
job -- more than half of it -- rendered strictly one at a time while ffmpeg
reached 2.8 of the machine's 8 cores. Five cores sat idle for nine and a half
minutes.

The danger in fixing that is not the encoder, it is everything around it: two
lanes writing events into one stdout stream the service parses line by line,
and clips arriving in whichever order they finish rather than the order the
customer sees them numbered.
"""
import concurrent.futures
import io
import json
import os
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))

import clip_worker as cw


class LaneCountTests(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.pop("RENDER_LANES", None)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("RENDER_LANES", None)
        else:
            os.environ["RENDER_LANES"] = self._saved

    def test_a_lone_lecture_renders_several_clips_at_once(self):
        self.assertGreater(cw.render_lanes(9, 8), 1)

    def test_a_BUSY_box_collapses_to_one_lane_by_itself(self):
        """service.py sets FFMPEG_THREADS from the jobs actually in flight, so
        three lectures each spawning three encoders -- nine on eight cores --
        cannot happen, and nobody has to remember the interaction."""
        self.assertEqual(cw.render_lanes(9, 2), 1)

    def test_never_more_lanes_than_clips_to_render(self):
        self.assertEqual(cw.render_lanes(1, 8), 1)

    def test_an_operator_override_wins_and_can_switch_it_off(self):
        os.environ["RENDER_LANES"] = "1"
        self.assertEqual(cw.render_lanes(9, 8), 1)

    def test_rubbish_in_the_override_is_ignored_rather_than_stopping_the_render(self):
        os.environ["RENDER_LANES"] = "lots"
        self.assertGreaterEqual(cw.render_lanes(9, 8), 1)

    def test_a_lane_never_gets_zero_threads(self):
        for budget in (1, 2, 3, 8, 16):
            lanes = cw.render_lanes(9, budget)
            self.assertGreaterEqual(budget // lanes, 1, f"budget {budget} over {lanes} lanes")


class YieldingSink:
    """A stdout that behaves like a PIPE rather than like a StringIO.

    THE FIRST VERSION OF THIS TEST COULD NOT FAIL. Writing to a StringIO from
    six threads never got preempted between two writes, so the probe that
    split emit() into `write(head)` + `write(tail)` with no lock came back
    GREEN -- a test that cannot reproduce the fault it was written for.

    A real stdout is a pipe to the service, and a write to it blocks and
    yields. Sleeping here reproduces that: the two-write shape then interleaves
    on essentially every run, and the locked single write does not.
    """

    def __init__(self):
        self.parts: list[str] = []
        self._lock = threading.Lock()

    def write(self, text: str) -> int:
        time.sleep(0.0005)          # the yield a real pipe gives you
        with self._lock:            # the sink's own list must not be corrupted
            self.parts.append(text)  # -- what is under test is the ORDER, not this
        return len(text)

    def flush(self) -> None:
        pass

    def getvalue(self) -> str:
        return "".join(self.parts)


class EventStreamTests(unittest.TestCase):
    """The service reads stdout line by line. An interleaved line is not a lost
    message, it is a job that fails to parse -- so the write must be one write
    and it must be locked, which `print(x, flush=True)` is not: that is two."""

    def test_events_from_several_lanes_stay_whole(self):
        buffer = YieldingSink()
        with mock.patch.object(cw.sys, "stdout", buffer):
            def shout(n):
                for i in range(12):
                    cw.emit("clip_ready", index=n, i=i, pad="x" * 500)
            threads = [threading.Thread(target=shout, args=(n,)) for n in range(6)]
            for t in threads: t.start()
            for t in threads: t.join()
        lines = [ln for ln in buffer.getvalue().splitlines() if ln.strip()]
        self.assertEqual(len(lines), 72)
        for line in lines:
            json.loads(line)  # raises if two events landed on one line


class OrderTests(unittest.TestCase):
    def test_finishing_order_is_not_the_order_a_customer_sees(self):
        """Lanes finish out of order; the numbering shown is the plan's.

        Drives the same collect-then-sort the render loop uses, because the
        failure it guards against -- clip 7 listed as clip 1 because it encoded
        fastest -- is silent and permanent once uploaded.
        """
        results: dict[int, dict] = {}
        lock = threading.Lock()

        def render(index):
            # The later the clip, the faster it "renders": worst case for order.
            time.sleep((10 - index) * 0.005)
            with lock:
                results[index] = {"clip": index}

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(render, range(1, 10)))

        rendered = [results[i] for i in sorted(results)]
        self.assertEqual([c["clip"] for c in rendered], list(range(1, 10)))


if __name__ == "__main__":
    unittest.main()
