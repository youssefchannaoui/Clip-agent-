/**
 * The ETA is quoted at the pace this box actually runs at.
 *
 * Youssef, 9 Sept 2026: "it could stay on fifteen minutes for longer than
 * fifteen minutes ... it actually finishes in the time it says it will finish."
 *
 * Every ETA in the product was quoted from four constants measured on 26 Aug
 * 2026 against a two-core box that has since been rescaled to eight cores,
 * moved toward a larger Whisper model and taught to render clips in parallel
 * lanes. Measured on the box against a real 1936-second lecture that made 12
 * clips, those constants were wrong in both directions at once -- 42% short on
 * transcription, 74% short on scoring, 193% long on rendering, and 40% long
 * overall. This is the module that learns the real ones.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { measurePace, phaseCosts, sourceSecondsOf, SHIPPED_PACE } from '../src/pace.js';

// The lecture the box reported, and the one in the screenshot the complaint
// came with: `timings: total 1269s -- import 0s audio 2s transcribe 531s
// score 286s render 450s`, window 0..1936, 12 clips.
const MEASURED = { sourceSec: 1936, clips: 12, timings: { import: 0, audio: 2, transcribe: 531, score: 286, render: 450, total: 1269 } };

const lecture = (over = {}) => ({
  status: 'done', completedAt: Date.now(), sourceStartSec: 0, sourceEndSec: MEASURED.sourceSec,
  clipCount: MEASURED.clips, timings: { ...MEASURED.timings }, ...over,
});

test('with no history the shipped pace is what the box actually does', () => {
  // A new deployment has nothing to learn from, so what it starts with has to
  // be right rather than historical. Checked against the real job above.
  const pace = measurePace([]);
  assert.equal(pace.lectures, 0);
  const cost = phaseCosts(pace, MEASURED.sourceSec, MEASURED.clips);
  // The import was a cache hit on that run and cost nothing, so it is not in
  // the comparison -- there is nothing to compare it against.
  const predicted = cost.transcribe + cost.score + cost.render + cost.tail;
  const real = MEASURED.timings.total - MEASURED.timings.import - MEASURED.timings.audio;
  assert.ok(Math.abs(predicted / real - 1) < 0.1,
    `the shipped pace must land within 10% of the box: predicted ${Math.round(predicted)}s against ${real}s`);
});

test('the retired constants are what this replaced, and they were 40% out', () => {
  // Kept as a measurement rather than a memory: if someone reinstates them,
  // this says by how much they were wrong and on which phase.
  const old = Math.max(20, MEASURED.sourceSec * 0.16) + 75 + MEASURED.clips * 110 + 20;
  const real = MEASURED.timings.total - MEASURED.timings.import - MEASURED.timings.audio;
  assert.ok(old / real > 1.3, 'the old model over-quoted the job as a whole');
  const pace = measurePace([]);
  const now = phaseCosts(pace, MEASURED.sourceSec, MEASURED.clips);
  assert.ok(Math.abs((now.transcribe + now.score + now.render + now.tail) / real - 1)
    < Math.abs(old / real - 1), 'and the shipped pace is closer than they were');
});

test('rates are learned from finished lectures', () => {
  const pace = measurePace([lecture(), lecture(), lecture()]);
  assert.equal(pace.lectures, 3);
  assert.equal(pace.learned.transcribePerSourceSec, true);
  assert.ok(Math.abs(pace.transcribePerSourceSec - 531 / 1936) < 0.001);
  assert.ok(Math.abs(pace.renderPerClipSec - 450 / 12) < 0.1);
});

test('ONE pathological lecture cannot move everybody else’s estimate', () => {
  // The median is the whole reason for the choice. A job that sat behind a
  // stalled Ollama, or a three-hour upload, is exactly the shape that would
  // drag a mean -- and it would drag it for every customer, on every screen.
  const slow = lecture({ timings: { ...MEASURED.timings, transcribe: 9000 } });
  const pace = measurePace([lecture(), lecture(), lecture(), slow]);
  assert.ok(Math.abs(pace.transcribePerSourceSec - 531 / 1936) < 0.01,
    'the outlier is outvoted, not averaged in');
});

test('two lectures are not enough to learn from', () => {
  // Two samples can agree with each other and still both be unusual.
  const pace = measurePace([lecture(), lecture()]);
  assert.equal(pace.learned.transcribePerSourceSec, false);
  assert.equal(pace.transcribePerSourceSec, SHIPPED_PACE.transcribePerSourceSec);
  assert.equal(pace.samples.transcribePerSourceSec, 2, 'counted even when not yet trusted');
});

test('A CACHE HIT IS NOT A FAST IMPORT', () => {
  // The worker keeps a source cache keyed by URL and window, so re-running the
  // same stretch reports 0s. Learning from those teaches the model that
  // downloads are free and quotes an ETA that omits the longest phase of all.
  const cached = [lecture(), lecture(), lecture()].map(item => ({ ...item, timings: { ...item.timings, import: 0 } }));
  const pace = measurePace(cached);
  assert.equal(pace.learned.importPerSourceSec, false);
  assert.equal(pace.importPerSourceSec, SHIPPED_PACE.importPerSourceSec);
  const real = [1, 2, 3].map(() => lecture({ timings: { ...MEASURED.timings, import: 120 } }));
  assert.equal(measurePace(real).learned.importPerSourceSec, true, 'a real import does teach');
});

test('a rate that could not be true is refused rather than believed', () => {
  // Against mis-recorded timings, not against a slow box: the band is wide
  // enough that any real hardware change passes through it.
  const absurd = [1, 2, 3].map(() => lecture({ timings: { ...MEASURED.timings, transcribe: 500_000 } }));
  const pace = measurePace(absurd);
  assert.equal(pace.learned.transcribePerSourceSec, false);
  assert.equal(pace.transcribePerSourceSec, SHIPPED_PACE.transcribePerSourceSec);
});

test('the rates describe the hardware, so only recent lectures teach', () => {
  // A rate averaged over every job this product has ever run would be
  // dominated by the two-core box for months after it was retired.
  const old = Array.from({ length: 40 }, (_, i) => lecture({
    completedAt: 1000 + i, timings: { ...MEASURED.timings, transcribe: 1500 },
  }));
  const recent = Array.from({ length: 25 }, (_, i) => lecture({ completedAt: 9_000_000 + i }));
  const pace = measurePace([...old, ...recent]);
  assert.ok(Math.abs(pace.transcribePerSourceSec - 531 / 1936) < 0.01,
    'the retired hardware does not go on setting the estimate');
});

test('an unfinished or untimed lecture teaches nothing', () => {
  assert.equal(measurePace([{ status: 'processing', timings: MEASURED.timings }]).lectures, 0);
  assert.equal(measurePace([{ status: 'done' }]).lectures, 0);
  assert.equal(measurePace(null).lectures, 0, 'and a missing list is not a crash');
});

test('the seconds a lecture cost are the stretch it asked for', () => {
  // A five-minute section of a 38-minute talk costs five minutes, which is the
  // whole reason the section download exists.
  assert.equal(sourceSecondsOf({ sourceStartSec: 600, sourceEndSec: 900, durationSec: 2280 }), 300);
  assert.equal(sourceSecondsOf({ durationSec: 2280 }), 2280, 'and the whole file when none was selected');
  assert.equal(sourceSecondsOf(null), 0);
});
