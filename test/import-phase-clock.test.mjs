/**
 * The worker names the import, the app starts a clock, and the step moves.
 *
 * Youssef, 9 Sept 2026: "it says it's on fifty seven MB, but it's zero percent
 * of this step. So surely, it would be more than zero percent at that stage."
 *
 * The three pieces are in three files and each was correct on its own, which is
 * why a green suite said nothing: the worker's pulse reported bytes, the app
 * stamps `phaseStartedAt` when the phase CHANGES, and the dashboard falls back
 * to elapsed-over-expected when a phase can report no fraction of its own. The
 * download simply never sent a phase, so the middle piece never fired and the
 * last had nothing to measure from.
 *
 * test/import-eta.test.mjs already covers the dashboard's arithmetic -- but its
 * fixture HARDCODES `phase: 'import'`, so it passed for a fortnight against a
 * production payload that carries none. That is the fixture-does-not-match-
 * production trap this repo has now hit three times, and it is why this file
 * drives the app's own writer rather than a hand-typed row.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-phase-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'import-phase-clock-test-secret-long-enough';

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

await import('../src/public/studio-runtime.js');
await import('../src/public/studio-template.generated.js');
await import('../src/public/safe-zones.js');
await import('../src/public/studio-adapter.js');
const { StudioAdapter } = globalThis;

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

/** One beat of the worker's import pulse, exactly as the record carries it. */
const beat = (bytesDone, extra = {}) => ({
  status: 'processing', stage: 'importing', progress: 3, phase: 'import',
  bytesDone, bytesPerSec: 283 * 1024, heartbeatAt: Date.now(), ...extra,
});

const project = () => state.projects.find((p) => p.id === 'ph1');

test('the import stamps a clock, and only once', () => {
  state.authUsers.push({ id: 'user_ph', email: 'p@p', role: 'owner', providers: {}, createdAt: Date.now() });
  state.projects.push({
    id: 'ph1', userId: 'user_ph', title: 'Lecture', status: 'processing',
    engine: 'remote', durationSec: 3600, clipsRequested: 6, submittedAt: Date.now(),
  });

  engine.acceptRemoteUpdate('ph1', beat(1_000_000));
  const started = project().phaseStartedAt;
  assert.ok(started > 0, 'the download names its phase, so the app can time it');

  // Every later beat of the SAME phase leaves it alone. A clock re-stamped on
  // each poll is worth exactly as much as no clock: elapsed is always ~0 and
  // the step reads 0% for the whole download, which is the reported bug.
  engine.acceptRemoteUpdate('ph1', beat(31 * 1024 * 1024));
  assert.equal(project().phaseStartedAt, started, 'the same phase does not restart the clock');

  // A real phase change does move it -- otherwise transcription would be timed
  // from the moment the download began and read as nearly finished on arrival.
  // Rolled back two minutes first, because the whole point is that the new
  // stamp is LATER and both calls otherwise land in the same millisecond.
  project().phaseStartedAt = started - 120_000;
  engine.acceptRemoteUpdate('ph1', { ...beat(0), phase: 'transcribe', stage: 'Transcribing', progress: 12 });
  assert.ok(project().phaseStartedAt > started - 120_000, 'the next phase starts its own clock');
  assert.equal(project().phase, 'transcribe');
});

test('THE REPORTED SCREEN: megabytes climbing no longer read 0% of this step', () => {
  const at = Date.now();
  const row = (over) => StudioAdapter.bindings({
    projects: [Object.assign({
      id: 'ph2', title: 'Lecture', status: 'processing', engine: 'remote',
      durationSec: 3600, clipsRequested: 6, submittedAt: at - 130_000,
      stage: 'importing', progress: 3, bytesDone: 31 * 1024 * 1024, bytesPerSec: 283 * 1024,
    }, over)],
    clips: [], tracks: [],
  }).liveAll[0];

  // Production's payload before this release: a stage word, bytes, a speed, and
  // no phase at all. This is the row in Youssef's screenshot.
  const blind = row({});
  assert.match(blind.meta, /(^|[^\d])0% of this step/, 'without a clock the step cannot move');

  // With the phase the worker now sends, and the clock the app stamps from it.
  const timed = row({ phase: 'import', phaseStartedAt: at - 130_000 });
  assert.doesNotMatch(timed.meta, /(^|[^\d])0% of this step/,
    'two minutes into a download that is plainly running reads as progress');
  assert.match(timed.meta, /31\.0 MB/, 'the megabytes still travel beside it');
});
