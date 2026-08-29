import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The reported state: four clips live on YouTube, sitting under "4 posts missed
// their slots", each offering "Post now" -- which posts to YouTube a SECOND
// time, because the only thing separating "retry the one that refused" from
// "post the whole set" is postedAt, and theirs was never set.
//
// refreshPublishingStatus has done the right thing since v3.20.0, but it only
// runs when a publish attempt finishes, so every clip filed before it stayed
// exactly as it was. This is the heal, and the guards on it.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-heal-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'partial-publish-heal-secret-long-enough';

const store = await import('../src/store.js');
const agent = await import('../src/agent.js');

const clip = (id, targets, extra = {}) => ({
  id, title: id, status: 'publish_failed',
  scheduledAt: Date.now() - 3 * 60 * 60_000,
  targets, ...extra,
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

test('a clip that posted to one destination and failed another is posted', () => {
  store.state.clips = [clip('c1', [
    { provider: 'youtube', status: 'posted', updatedAt: Date.now() },
    { provider: 'tiktok', status: 'failed', error: 'unaudited_client_can_only_post_to_private_accounts' },
  ])];

  const healed = agent.healPartialPublishes();
  assert.equal(healed, 1);

  const [c] = store.state.clips;
  assert.equal(c.status, 'posted', 'it went out; it is posted');
  assert.ok(c.postedAt, 'postedAt is what moves it out of the overdue row');
  assert.equal(c.scheduledAt, null, 'and out of the schedule as work still to do');
  // The failure belongs to the destination, not the clip.
  assert.equal(c.targets.find(t => t.provider === 'tiktok').status, 'failed');
});

test('the destination that refused is still the one a retry targets', () => {
  const [c] = store.state.clips;
  const outstanding = agent.unpostedTargets(c);
  assert.equal(outstanding.length, 1);
  assert.equal(outstanding[0].provider, 'tiktok',
    'a retry must not re-run YouTube, which already posted');
});

test('a clip where nothing landed is left alone', () => {
  store.state.clips = [clip('c2', [
    { provider: 'youtube', status: 'failed', error: 'quota' },
    { provider: 'tiktok', status: 'failed', error: '403' },
  ])];
  assert.equal(agent.healPartialPublishes(), 0);
  assert.ok(!store.state.clips[0].postedAt, 'nothing posted, so nothing to correct');
});

test('a clip still publishing is left alone', () => {
  store.state.clips = [clip('c3', [
    { provider: 'youtube', status: 'posted' },
    { provider: 'tiktok', status: 'publishing' },
  ], { status: 'publishing' })];
  assert.equal(agent.healPartialPublishes(), 0,
    'a destination still in flight may yet succeed; this corrects records, it does not decide');
  assert.ok(!store.state.clips[0].postedAt);
});

test('an already-correct clip is not touched twice', () => {
  const at = Date.now() - 90_000;
  store.state.clips = [clip('c4', [
    { provider: 'youtube', status: 'posted' },
    { provider: 'tiktok', status: 'failed' },
  ], { status: 'posted', postedAt: at, scheduledAt: null })];
  assert.equal(agent.healPartialPublishes(), 0);
  assert.equal(store.state.clips[0].postedAt, at, 'the original time survives');
});

test('running it again changes nothing', () => {
  store.state.clips = [clip('c5', [
    { provider: 'youtube', status: 'posted' },
    { provider: 'tiktok', status: 'failed' },
  ])];
  assert.equal(agent.healPartialPublishes(), 1);
  const first = store.state.clips[0].postedAt;
  assert.equal(agent.healPartialPublishes(), 0, 'it is a correction, not a recurring job');
  assert.equal(store.state.clips[0].postedAt, first);
});
