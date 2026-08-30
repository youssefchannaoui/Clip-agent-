import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-autoretry-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'auto-retry-test-secret-long-enough';

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => {
  // Guarded: a leftover temp directory on a CI runner is harmless; a red
  // branch from a cleanup race is not. See admin-page.test.mjs for the race.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

// Measured 26 Aug 2026: the import service takes 30+ minutes on a long
// lecture's first fetch, keeps fetching after our budget runs out, and then
// serves the same URL from cache in seconds. A timeout is therefore not a
// verdict -- it is "not yet". One automatic retry converts "failed after half
// an hour" into "succeeded without the customer touching anything".

const SLOW = 'socialkit: SocialKit download timed out after 30m 00s. Upload the original MP4 or retry later.';

function makeProject(id) {
  state.projects.push({
    id, userId: 'user_admin', title: 'Long lecture', status: 'processing',
    engine: 'remote', submittedAt: Date.now(),
  });
  return state.projects[state.projects.length - 1];
}

test('an import timeout retries itself once instead of failing', () => {
  state.authUsers.push({ id: 'user_admin', email: 'a@a', role: 'owner', providers: {}, createdAt: Date.now() });
  const project = makeProject('ar1');

  engine.acceptRemoteUpdate('ar1', { status: 'failed', error: SLOW, progress: 3 });

  assert.equal(project.status, 'queued', 'a slow fetch re-queues rather than failing');
  assert.equal(project.importRetries, 1);
  assert.ok(project.workerJobId && project.workerJobId !== 'ar1',
    'the worker keys jobs by id, so a rerun needs a fresh one');
  assert.ok(project.nextRetryAt > Date.now(), 'the retry waits for the cache to warm');
  assert.equal(project.error, null, 'no error shown for a job that is still being worked');
});

test('the second identical failure is final, with the classified error kept', () => {
  const project = makeProject('ar2');
  project.importRetries = 1; // the one automatic retry has been spent

  engine.acceptRemoteUpdate('ar2', { status: 'failed', error: SLOW, progress: 3 });

  assert.equal(project.status, 'failed', 'one retry, not a loop');
  assert.ok(project.error, 'the customer is told what happened');
});

test('a failure that is not the slow-fetch signature does not retry', () => {
  const project = makeProject('ar3');

  engine.acceptRemoteUpdate('ar3', {
    status: 'failed',
    error: 'socialkit: This video is unavailable',
    progress: 3,
  });

  assert.equal(project.status, 'failed', 'a private or deleted video will not change on retry');
  assert.equal(Number(project.importRetries || 0), 0);
});

test('the stall message from the worker also qualifies as slow, not dead', () => {
  const project = makeProject('ar4');

  engine.acceptRemoteUpdate('ar4', {
    status: 'failed',
    error: 'socialkit: SocialKit accepted the job but never started delivering it (25m 00s with no progress).',
    progress: 3,
  });

  assert.equal(project.status, 'queued');
  assert.equal(project.importRetries, 1);
});
