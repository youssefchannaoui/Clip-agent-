/**
 * The import says something true, and something that moves.
 *
 * Youssef, 9 Sept 2026, watching one: "it could stay on fifteen minutes for
 * longer than fifteen minutes ... it says it's on zero percent, but you can
 * clearly see the MB has went up ... now it's four hundred MB, still fifteen
 * minutes left, and zero percent of the step done. So, yeah, nothing really
 * adds up."
 *
 * All three complaints were ONE fault. yt-dlp had reported no byte TOTAL for
 * that download, and the entire import model was gated on having one: no total
 * meant no fraction, so the step percentage could only read 0; no fraction meant
 * the worker wrote no progress and no ETA, so the dashboard fell back to
 * `cost.import * (1 - 0)` -- a constant, which is why fifteen minutes stayed
 * fifteen minutes however long it ran. The megabytes climbed because they were
 * the only figure not behind the gate.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

await import('../src/public/studio-runtime.js');
await import('../src/public/studio-template.generated.js');
await import('../src/public/safe-zones.js');
await import('../src/public/studio-adapter.js');
const { StudioAdapter } = globalThis;

const HOUR = 3600;
const rowFor = (project, extra = {}) => StudioAdapter.bindings(Object.assign({
  projects: [Object.assign({
    id: 'p', title: 'Lecture', status: 'processing', engine: 'remote',
    durationSec: HOUR, clipsRequested: 6, submittedAt: Date.now(),
  }, project)],
  clips: [], tracks: [],
}, extra)).liveAll[0];

const importing = (over = {}) => rowFor(Object.assign({
  stage: 'importing', phase: 'import', progress: 3,
}, over));

test('THE REPORTED BUG: bytes climbing with no total no longer reads 0%', () => {
  // The download reports what it has and nothing else -- a fragmented format,
  // or a section fetched through ffmpeg. Before this the worker sent no
  // fraction at all and the row printed "0% of this step" for the whole wait.
  const started = Date.now() - 120_000;
  const early = importing({ bytesDone: 214_000_000, phaseStartedAt: started });
  // Binary units, matching what the OS reports for the same file.
  assert.match(early.meta, /204\.1 MB/, 'the megabytes are shown');
  assert.doesNotMatch(early.meta, /0% of this step/,
    'and the step percentage is not pinned to zero beside them');
  assert.match(early.meta, /\d+% of this step/);
});

test('and the ETA does not stay on the same number while it runs', () => {
  // Two identical downloads, one two minutes further into the same phase. The
  // constant this replaced could not tell them apart.
  const at = Date.now();
  const young = importing({ bytesDone: 214_000_000, phaseStartedAt: at - 30_000 });
  const older = importing({ bytesDone: 400_000_000, phaseStartedAt: at - 300_000 });
  assert.notEqual(young.eta, older.eta, 'the answer moves as the phase does');
  const seconds = text => {
    const m = /(\d+) min/.exec(text); return m ? Number(m[1]) : 0;
  };
  assert.ok(seconds(older.eta) <= seconds(young.eta), 'and it moves DOWN, never up');
});

test('the worker’s own ETA is believed for EVERY stage, not only the import', () => {
  // Transcription measures its own throughput -- seconds of audio per second of
  // work -- and sends the remaining time with every progress line. That is the
  // best number in the system and it was read for the import alone, so it was
  // discarded for the phase that is 42% of a job and the longest wait in it.
  const model = rowFor({ stage: 'Transcribing speech', phase: 'transcribe', progress: 30 });
  const measured = rowFor({ stage: 'Transcribing speech', phase: 'transcribe', progress: 30, etaSec: 42 });
  assert.notEqual(measured.eta, model.eta, 'the measurement is used rather than the model');
  // 42s of transcription left, then scoring, rendering and the tail.
  assert.match(measured.eta, /min left/);
});

test('an exact fraction from the worker beats anything inferred', () => {
  // The import owns five points of the global bar, so a fraction read back off
  // it can only ever be 0, 20, 40, 60, 80 or 100 per cent.
  assert.match(importing({ stageFraction: 0.37, bytesDone: 1 }).meta, /37% of this step/);
  assert.match(rowFor({ stage: 'Transcribing speech', phase: 'transcribe', progress: 30, stageFraction: 0.63 }).meta,
    /63% of this step/);
});

test('the decimal is on the moving half, and the total has none', () => {
  // A slow exit from the proxy pool moves half a megabyte a second, so a whole
  // number sat still for seconds at a time and read as a stalled import.
  assert.equal(importing({ bytesDone: 149_000_000, bytesTotal: 398_000_000 }).transfer, '142.1 MB / 380 MB');
});

test('the speed is shown, because on some downloads it is the only proof of life', () => {
  assert.match(importing({ bytesDone: 214_000_000, bytesPerSec: 3_500_000 }).meta, /3\.3 MB\/s/);
  assert.match(importing({ bytesDone: 500_000, bytesPerSec: 400_000 }).meta, /391 KB\/s/);
});

test('the byte counters disappear when the import does', () => {
  // NOTHING CLEARS THEM on the job record -- they stay for the rest of its life
  // -- so a row that showed them by their presence alone went on reporting
  // "806 MB / 806 MB" through the whole transcription. With a speed beside them
  // that reads as a download still running an hour after it finished.
  const later = rowFor({ stage: 'Transcribing speech', phase: 'transcribe', progress: 30,
    bytesDone: 806_000_000, bytesTotal: 806_000_000, bytesPerSec: 3_500_000 });
  assert.equal(later.transfer, '');
  assert.doesNotMatch(later.meta, /MB|MB\/s/);
});

test('A STILL BAR STILL CANNOT BALLOON THE NUMBER', () => {
  // The estimator this model replaced extrapolated the whole job from how fast
  // the global percentage moved, so a bar that held still drove the ETA from
  // "5 min left" to "2h left" on a healthy job -- the exact number that makes
  // someone close the tab. A clock now reaches the estimate as a last resort,
  // so this is the guard that it can only ever make the answer SHRINK.
  const at = Date.now();
  const minutes = text => { const m = /(\d+)h|(\d+) min/.exec(text || ''); return m && m[1] ? Number(m[1]) * 60 : (m ? Number(m[2]) : 0); };
  const first = importing({ phaseStartedAt: at - 10_000 });
  const hours = importing({ phaseStartedAt: at - 3 * HOUR * 1000 });
  assert.doesNotMatch(hours.eta, /h left/, 'three hours in, still no hallucinated hours');
  assert.ok(minutes(hours.eta) <= minutes(first.eta), 'the clock cannot grow the answer');
});

test('a phase that overruns stops counting down to a finish that is not coming', () => {
  // Capped below 1 deliberately: a bar that sits at 100% while the work plainly
  // continues is the same lie as one that sits at 0.
  const overrun = importing({ phaseStartedAt: Date.now() - 6 * HOUR * 1000 });
  assert.notEqual(overrun.eta, '', 'it still answers');
  assert.doesNotMatch(overrun.meta, /100% of this step/);
});

test('the ETA is quoted at the pace the payload reports', () => {
  // src/pace.js learns how fast this box is from the lectures it has finished
  // and sends it with the state. A dashboard that ignored it would go on
  // quoting constants measured against hardware that has been replaced twice.
  const slow = rowFor({ stage: 'Transcribing speech', phase: 'transcribe', progress: 30 },
    { pace: { transcribePerSourceSec: 1.2, scorePerSourceSec: 0.15, renderPerClipSec: 40, scoreFloorSec: 60, importPerSourceSec: 0.03, tailSec: 20 } });
  const quick = rowFor({ stage: 'Transcribing speech', phase: 'transcribe', progress: 30 },
    { pace: { transcribePerSourceSec: 0.05, scorePerSourceSec: 0.15, renderPerClipSec: 40, scoreFloorSec: 60, importPerSourceSec: 0.03, tailSec: 20 } });
  assert.notEqual(slow.eta, quick.eta, 'a slower box quotes a longer wait');
});

test('no known source length still means no invented countdown', () => {
  assert.equal(importing({ durationSec: 0 }).eta, '');
});
