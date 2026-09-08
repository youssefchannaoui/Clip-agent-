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

/**
 * THE TRIGGER HAD BEEN DEAD CODE FOR A FORTNIGHT.
 *
 * It matched two SocialKit strings, and SocialKit was removed on 26 Aug 2026 --
 * so from that day nothing could match it and this retry never ran once.
 * CLAUDE.md filed it as "a no-op without a hosted provider", which read as
 * harmless and was not: Youssef's own import failed on 9 Sept and imported
 * when he retried it by hand, which is precisely what this code exists to do
 * for him.
 *
 * These two are the pair. Either alone is worse than neither: retrying nothing
 * is the bug being fixed, and retrying everything spends five minutes and a
 * worker slot arriving at an answer already in hand.
 */
const REFUSED = 'ytdlp: YouTube refused this download from every client tried. '
  + 'Tried 3 times over several minutes. A proxy or cookies are configured and were used, '
  + 'so this looks like the video itself rather than the address it was asked from. '
  + 'yt-dlp 2026.09.09. Attempts: r3/full/tv: ERROR: unable to download video data: HTTP Error 403: Forbidden';

// The worker's own wording for a NON-blocked refusal. It exists so this test
// can tell a permanent failure from a transient one -- before it, both came
// back as "refused from every client tried" and were indistinguishable here.
const GONE = 'ytdlp: YouTube would not release this video: Private video. '
  + "Sign in if you have been granted access";

test('a YouTube refusal the worker could not clear IS retried automatically', () => {
  const project = makeProject('ar-refused');

  engine.acceptRemoteUpdate('ar-refused', { status: 'failed', error: REFUSED, progress: 3 });

  assert.equal(project.status, 'queued', 'it is queued again rather than failed');
  assert.equal(project.importRetries, 1);
  assert.ok(project.workerJobId && project.workerJobId !== 'ar-refused',
    'a fresh worker job id, or the worker hands back the failure it already has');
  assert.ok(project.nextRetryAt > Date.now());
  assert.match(project.stage, /trying again/i);
});

test('a video that is GONE is never retried, however many minutes pass', () => {
  const project = makeProject('ar-gone');

  engine.acceptRemoteUpdate('ar-gone', { status: 'failed', error: GONE, progress: 3 });

  assert.equal(project.status, 'failed', 'a permanent refusal fails now, not in five minutes');
  assert.equal(Number(project.importRetries || 0), 0, 'and it spends no retry');
});
