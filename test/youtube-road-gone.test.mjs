import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * THE ROAD WAS TAKEN AWAY AND THE CLIPS WENT ON DRIVING AT IT.
 *
 * Measured on production, 14 Sept 2026, from the deployment's own log rather
 * than from the code:
 *
 *   11 Sept 15:53  Retired 3 direct YouTube OAuth connections; future YouTube
 *                  publishing now goes through Buffer.
 *   11 Sept 23:00  youtube (DeenClipped) publishing failed ...
 *   12 Sept 04:00  youtube (DeenClipped) publishing failed ...
 *   12 Sept 06:30  youtube (DeenClipped) publishing failed ...
 *                  "Connect your YouTube channel through Buffer before
 *                   publishing."
 *
 * `retireDirectYoutubeConnections` did its half correctly -- it switched
 * `youtube.enabled` off, so no NEW clip targets YouTube. But `targets` are
 * stamped ONCE at schedule time and `tick()` only re-derives an EMPTY list
 * (v3.115.2), so every clip scheduled before that minute still named a road
 * that no longer existed, and failed at its slot. Three days of red rows for a
 * destination nothing could ever deliver.
 *
 * This is v3.135.0's Facebook Reels shape with a different question: not "this
 * CLIP is wrong for that platform" but "this ACCOUNT has no road to it at
 * all". The remedy is the same one, and it is deliberately SELF-HEALING rather
 * than destructive -- tick() re-derives an empty list at the slot, so
 * connecting Buffer (which re-enables YouTube through enableOnConnect) puts
 * these clips back on the road by themselves.
 *
 * THE DANGEROUS DIRECTION IS THE OTHER ONE, and most of this file pins it: a
 * drop that fired on a WORKING destination would delete somebody's scheduled
 * posts, silently, at boot.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-ytroad-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'x'.repeat(48);
process.env.PUBLIC_BASE_URL = 'https://example.test';
process.env.BUFFER_CLIENT_ID = 'buffer-client';
process.env.BUFFER_CLIENT_SECRET = 'buffer-secret';

const { state, save } = await import('../src/store.js');
const social = await import('../src/social.js');
const agent = await import('../src/agent.js');

const userId = 'user_yt';

/**
 * @param {object} opts
 * @param {boolean} opts.bufferChannel  a YouTube channel connected THROUGH Buffer
 * @param {string}  opts.status         the YouTube target's status
 */
function seed({ bufferChannel = false, status = 'scheduled', postedAt = 0 } = {}) {
  state.authUsers = [{ id: userId, email: 'yt@example.com', role: 'owner' }];
  state.socialConnections = {
    [userId]: {
      // A Buffer connection with NO youtube channel in it is exactly the
      // production state: Buffer is configured on the deployment, and this
      // account has not connected a channel through it.
      ...(bufferChannel
        ? { buffer: { provider: 'buffer', accountId: 'buffer', accounts: [{ provider: 'youtube', id: 'y1', name: 'Main' }] } }
        : {}),
      tiktok: [{ provider: 'tiktok', accountId: 't1', name: 'TikTok', token: '' }],
    },
  };
  state.userSettings = { [userId]: { publishingSettings: {
    enabled: true,
    youtube: { enabled: bufferChannel, accountId: 'y1', accountIds: ['y1'] },
    tiktok: { enabled: true, accountId: 't1', accountIds: ['t1'] },
  } } };
  state.projects = [{ id: 'proj', userId }];
  state.clips = [{
    id: 'c1', userId, projectId: 'proj', title: 'Surah Al-Ahzaab 29-30', addedAt: 1,
    status: 'scheduled', approvedBy: 'manual', postedAt: postedAt || null,
    scheduledAt: Date.now() + 60_000, durationMs: 45_000,
    targets: [
      { id: 'youtube:y1', provider: 'youtube', accountId: 'y1', status, attempts: 0 },
      { id: 'tiktok:t1', provider: 'tiktok', accountId: 't1', status, attempts: 0 },
    ],
  }];
  save();
  return state.clips[0];
}

const providersOf = clip => (clip.targets || []).map(t => t.provider).sort();

test('a YouTube target with no Buffer channel is dropped -- the production bug', () => {
  const clip = seed({ bufferChannel: false });
  assert.deepEqual(providersOf(clip), ['tiktok', 'youtube'], 'seeded with both');

  const dropped = agent.healImpossibleTargets();

  assert.equal(dropped, 1, 'exactly the one destination that had no road');
  assert.deepEqual(providersOf(state.clips[0]), ['tiktok'],
    'YouTube goes and TikTok stays: the account can still reach TikTok');
});

test('AND THE SAME TARGET IS KEPT ONCE BUFFER CARRIES THE CHANNEL', () => {
  /*
   * The direction that matters. A drop firing here would delete a scheduled
   * post to a destination that works perfectly -- at boot, with nothing on any
   * screen to say it happened.
   */
  const clip = seed({ bufferChannel: true });
  const dropped = agent.healImpossibleTargets();

  assert.equal(dropped, 0, 'nothing is unreachable when Buffer carries the channel');
  assert.deepEqual(providersOf(state.clips[0]), ['tiktok', 'youtube'], 'both destinations survive');
  assert.ok(clip, 'clip still present');
});

test('targetUnreachable asks the SAME question publishTarget answers', () => {
  // Not a second implementation: the two must agree, or the heal would drop a
  // destination that would have published, or keep one that never could.
  seed({ bufferChannel: false });
  const target = { provider: 'youtube', accountId: 'y1' };
  assert.match(social.targetUnreachable(target, userId), /Buffer/,
    'with no channel through Buffer, YouTube cannot be reached');

  seed({ bufferChannel: true });
  assert.equal(social.targetUnreachable(target, userId), '',
    'with the channel connected, it can');
});

test('a destination on a platform that IS reachable is never touched', () => {
  seed({ bufferChannel: false });
  assert.equal(social.targetUnreachable({ provider: 'tiktok', accountId: 't1' }, userId), '',
    'TikTok has its own credential and is unaffected by YouTube losing its road');
});

test('only a SCHEDULED destination is dropped, never one mid-publish', () => {
  /*
   * A target that is publishing has already been handed to the platform. On
   * this path it cannot have been -- publishTarget throws first -- but the
   * guard is what stops a later, less certain reason from tearing out an
   * upload that is genuinely in flight.
   */
  seed({ bufferChannel: false, status: 'publishing' });
  const dropped = agent.healImpossibleTargets();
  assert.equal(dropped, 0, 'nothing in flight is removed');
  assert.deepEqual(providersOf(state.clips[0]), ['tiktok', 'youtube']);
});

test('a clip that has already posted is left entirely alone', () => {
  seed({ bufferChannel: false, postedAt: Date.now() });
  const dropped = agent.healImpossibleTargets();
  assert.equal(dropped, 0, 'a posted clip is history, not work');
  assert.deepEqual(providersOf(state.clips[0]), ['tiktok', 'youtube']);
});

test('the drop is self-healing: the clip keeps its slot and its approval', () => {
  /*
   * This is what makes dropping the right remedy rather than a destructive
   * one. tick() re-derives an EMPTY target list at the slot, so once Buffer is
   * connected -- which re-enables YouTube through enableOnConnect -- the clip
   * takes the road again on its own. Losing the approval or the time would
   * make that impossible and cost a re-review.
   */
  const before = seed({ bufferChannel: false });
  const slot = before.scheduledAt;
  assert.equal(agent.healImpossibleTargets(), 1, 'the unreachable destination did go');
  const after = state.clips[0];
  assert.deepEqual(providersOf(after), ['tiktok'], 'and it is the YouTube one');
  assert.equal(after.scheduledAt, slot, 'it keeps the time it was given');
  assert.equal(after.approvedBy, 'manual', 'and the decision a person made');
  assert.ok(!after.postedAt, 'and is not filed as posted');
});

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
  catch { /* a leftover temp directory on a runner is harmless */ }
});
