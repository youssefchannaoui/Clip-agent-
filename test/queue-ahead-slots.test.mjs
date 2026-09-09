/**
 * "How many jobs ahead of yours" means how many must FINISH first.
 *
 * Youssef, 9 Sept 2026, having asked how many lectures the box takes at once:
 * "I think you... I think it was three different people can work in the same
 * time." He is right -- production says so in as many words, every boot:
 * "[info] The worker reports 3 render slots."
 *
 * This counted every RUNNING lecture as one to wait for, which was exactly
 * right at one slot and wrong at three: a lecture queued behind a single import
 * is not waiting for it, two slots are free and it starts on the next pump. The
 * row said "1 job ahead of yours" anyway -- and pipelineEta's queued branch
 * multiplies that count by what a whole lecture costs, so it also quoted a
 * lecture's worth of wait that was never going to happen.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-queue-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'queue-ahead-slots-test-secret-long-enough';
// Remote mode, so concurrencyLimit() asks the box rather than answering from
// the app's own setting -- which is the arrangement production runs.
process.env.PROCESSING_MODE = 'remote';
process.env.WORKER_BASE_URL = 'http://127.0.0.1:9';
process.env.WORKER_SHARED_SECRET = 'queue-ahead-slots-secret';

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

const at = Date.now();
const seed = (rows) => {
  state.projects.length = 0;
  state.authUsers.length = 0;
  state.authUsers.push({ id: 'u1', email: 'q@q', role: 'owner', providers: {}, createdAt: at });
  rows.forEach((row, i) => state.projects.push({
    id: 'q' + i, userId: 'u1', title: 'Lecture ' + i, engine: 'remote',
    submittedAt: at + i, ...row,
  }));
};

test('THE REPORTED ROW: one import running on a three-slot box is nothing to wait for', () => {
  // What the box actually reports, taken the way the app takes it.
  engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: 3 } });
  seed([{ status: 'processing' }, { status: 'queued' }]);
  assert.equal(engine.queueAhead('q1'), 0,
    'two slots are free, so nothing has to finish first');
});

test('a full box is one wait, and a queue behind it counts up from there', () => {
  engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: 3 } });
  seed([{ status: 'processing' }, { status: 'processing' }, { status: 'processing' }, { status: 'queued' }]);
  assert.equal(engine.queueAhead('q3'), 1, 'one of the three has to finish');

  seed([
    { status: 'processing' }, { status: 'processing' }, { status: 'processing' },
    { status: 'queued' }, { status: 'queued' },
  ]);
  assert.equal(engine.queueAhead('q4'), 2, 'and the one in front of me as well');
});

test('at one slot it answers exactly what it always did', () => {
  // The property that makes this safe to change: a single-slot deployment --
  // every deployment before the CPX41 resize -- sees no difference at all.
  engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: 1 } });
  seed([{ status: 'processing' }, { status: 'queued' }]);
  assert.equal(engine.queueAhead('q1'), 1);
  seed([{ status: 'processing' }, { status: 'queued' }, { status: 'queued' }]);
  assert.equal(engine.queueAhead('q2'), 2);
});

test('finished and failed lectures are not in front of anybody', () => {
  engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: 1 } });
  seed([{ status: 'done' }, { status: 'failed' }, { status: 'cancelled' }, { status: 'queued' }]);
  assert.equal(engine.queueAhead('q3'), 0);
});
