import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Preview-quality clips must never leave the platform.
 *
 * Bulk template re-renders can be encoded with a fast preset so a batch comes
 * back quickly, which is the wait a customer actually feels. The file that
 * produces is fine to review inside the app and is not fine to publish or
 * hand over as a download, so every exit point has to upgrade first.
 *
 * These assert the guard itself. If it is ever weakened, a customer publishes
 * a visibly worse video to their channel and nothing tells them.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-export-guard-'));
process.env.DATA_DIR = dataDir;

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function reset() {
  state.clips = [];
  state.rerenderJobs = [];
  state.projects = [];
}

/** Run something expected to throw and hand back the error itself. */
function caught(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return assert.fail('expected this to throw, but it returned normally');
}

test('an export-quality clip passes straight through', () => {
  reset();
  const clip = { id: 'clip_1', userId: 'user_a', renderTier: 'export' };
  assert.equal(engine.assertExportQuality(clip), clip);
});

test('a clip with no tier at all is treated as export quality', () => {
  reset();
  // Every clip rendered before this feature existed has no tier. Treating an
  // unknown tier as "needs upgrading" would block publishing on all of them.
  const clip = { id: 'clip_legacy', userId: 'user_a' };
  assert.equal(engine.assertExportQuality(clip), clip);
  assert.equal(engine.assertExportQuality(null), null);
});

test('a preview clip is refused with a retryable error', () => {
  reset();
  const clip = { id: 'clip_2', userId: 'user_a', renderTier: 'preview', templateId: 'missing-template' };
  state.clips.push(clip);
  const error = caught(() => engine.assertExportQuality(clip));
  assert.equal(error.statusCode, 409);
  assert.match(error.message, /full-quality/i);
});

test('a preview clip whose upgrade is already queued does not queue a second one', () => {
  reset();
  const clip = { id: 'clip_3', userId: 'user_a', renderTier: 'preview' };
  state.clips.push(clip);
  state.rerenderJobs.push({
    id: 'job_1', clipId: 'clip_3', userId: 'user_a', status: 'queued',
    renderTier: 'export', createdAt: Date.now(),
  });
  const before = state.rerenderJobs.length;
  const error = caught(() => engine.assertExportQuality(clip));
  assert.equal(error.code, 'export_render_pending');
  assert.equal(state.rerenderJobs.length, before, 'a duplicate upgrade job was queued');
});

test('a queued preview job does not count as the upgrade', () => {
  reset();
  const clip = { id: 'clip_4', userId: 'user_a', renderTier: 'preview', templateId: 'missing-template' };
  state.clips.push(clip);
  // Another batched preview render is pending — that is not an upgrade, and
  // waiting for it would leave the clip preview quality forever.
  state.rerenderJobs.push({
    id: 'job_2', clipId: 'clip_4', userId: 'user_a', status: 'queued',
    renderTier: 'preview', createdAt: Date.now(),
  });
  const error = caught(() => engine.assertExportQuality(clip));
  assert.equal(error.statusCode, 409);
});

test('publishing a preview clip is blocked', async () => {
  reset();
  state.clips.push({ id: 'clip_5', userId: 'user_a', renderTier: 'preview', templateId: 'missing-template' });
  await assert.rejects(
    () => engine.socialPublishFile('clip_5', 'youtube'),
    error => error.statusCode === 409,
  );
});
