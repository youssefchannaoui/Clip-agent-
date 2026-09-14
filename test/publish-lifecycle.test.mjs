import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * FOUR WAYS THE PUBLISHING LIFECYCLE LET A CLIP DOWN.
 *
 * Each was found by reading the path rather than by a report, and each is
 * silent: the app renders, the suite stays green, and a clip either goes out
 * when it should not or sits still when it should go.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-publife-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'x'.repeat(48);
process.env.PUBLIC_BASE_URL = 'https://example.test';
process.env.TIKTOK_CLIENT_KEY = 'tk';
process.env.TIKTOK_CLIENT_SECRET = 'ts';

const { state, save } = await import('../src/store.js');
const agent = await import('../src/agent.js');

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const socialSource = fs.readFileSync(path.join(ROOT, 'src/social.js'), 'utf8');

const userId = 'user_life';
const HOUR = 3600_000;

function seedClip({ status = 'scheduled', targets = [], scheduledAt = Date.now() + HOUR, extra = {} } = {}) {
  state.authUsers = [{ id: userId, email: 'life@example.test', role: 'owner' }];
  state.socialConnections = { [userId]: { tiktok: [{ provider: 'tiktok', accountId: 't1', name: 'TikTok', token: '' }] } };
  state.userSettings = { [userId]: { publishingSettings: {
    enabled: true, tiktok: { enabled: true, accountId: 't1', accountIds: ['t1'] },
  } } };
  state.projects = [{ id: 'proj', userId }];
  state.clips = [{
    id: 'c1', userId, projectId: 'proj', title: 'A clip', addedAt: 1,
    status, approvedBy: 'manual', approvedAt: 1, scheduledAt, targets, ...extra,
  }];
  save();
  return state.clips[0];
}

/* ------------------------------------------------------------------ 1 */
test('a clip being UPLOADED RIGHT NOW cannot be rejected', () => {
  /*
   * This refused a POSTED clip and nothing else, so a clip mid-upload was
   * marked rejected and `clip.targets = []` wiped the in-flight target with it
   * -- while the upload carried on at the platform. Instagram and TikTok
   * finish asynchronously, so the post could go live minutes later with the
   * app showing the clip as rejected and NO TARGET LEFT to record where it
   * went.
   */
  for (const status of ['publishing', 'processing']) {
    const clip = seedClip({ status: 'publishing', targets: [{ id: 'tiktok:t1', provider: 'tiktok', accountId: 't1', status }] });
    assert.throws(() => agent.rejectClip('c1'), /uploaded to tiktok right now/i,
      `a ${status} target must stop the rejection`);
    assert.equal(state.clips[0].status, 'publishing', 'and the clip is left exactly as it was');
    assert.equal(state.clips[0].targets.length, 1, 'with its in-flight target intact');
    assert.ok(clip, 'clip present');
  }
});

test('AND A CLIP THAT IS NOT GOING OUT IS STILL REJECTED', () => {
  // The direction that matters second: a guard that refuses everything would
  // take the reject button away, which is worse than the bug.
  seedClip({ targets: [{ id: 'tiktok:t1', provider: 'tiktok', accountId: 't1', status: 'scheduled' }] });
  const clip = agent.rejectClip('c1');
  assert.equal(clip.status, 'rejected');
  assert.deepEqual(clip.targets, [], 'and its destinations are cleared as they always were');
});

test('a posted clip still refuses, by its own older rule', () => {
  seedClip({ targets: [{ id: 'tiktok:t1', provider: 'tiktok', accountId: 't1', status: 'posted' }] });
  assert.throws(() => agent.rejectClip('c1'), /already posted/i);
});

/* ------------------------------------------------------------------ 2 */
test('moving a clip to a slot clears the backoff that would ignore it', () => {
  /*
   * A failed target carries nextTryAt on a doubling backoff capped at SIX
   * HOURS. The move changed scheduledAt and nothing else, so the new slot
   * arrived and tick()'s own condition was still false: the clip sat on the
   * slot it was dragged to and did not go out, with the calendar showing it in
   * the right place.
   */
  const stale = Date.now() + 5 * HOUR;
  seedClip({ targets: [{ id: 'tiktok:t1', provider: 'tiktok', accountId: 't1', status: 'failed', nextTryAt: stale }] });
  const to = Date.now() + 2 * HOUR;

  agent.moveClipToSlot('c1', to);

  assert.equal(state.clips[0].scheduledAt, to, 'it moved');
  assert.ok(!state.clips[0].targets[0].nextTryAt,
    'and the old backoff went with it, or the move silently does not take');
});

test('a SWAP clears the backoff on BOTH clips', () => {
  // Leaving the held clip's backoff stale just moves the fault to the other
  // clip, which is the harder one to notice because nobody dragged it.
  const a = Date.now() + 2 * HOUR;
  const b = Date.now() + 3 * HOUR;
  seedClip({ scheduledAt: a, targets: [{ id: 'tiktok:t1', provider: 'tiktok', accountId: 't1', status: 'failed', nextTryAt: Date.now() + 5 * HOUR }] });
  state.clips.push({
    id: 'c2', userId, projectId: 'proj', title: 'Other', addedAt: 2,
    status: 'scheduled', approvedBy: 'manual', scheduledAt: b,
    targets: [{ id: 'tiktok:t1', provider: 'tiktok', accountId: 't1', status: 'failed', nextTryAt: Date.now() + 5 * HOUR }],
  });
  save();

  const out = agent.moveClipToSlot('c1', b);
  assert.equal(out.swapped, true, 'precondition: this is a swap');
  for (const id of ['c1', 'c2']) {
    const clip = state.clips.find(c => c.id === id);
    assert.ok(!clip.targets[0].nextTryAt, `${id} must not keep a backoff from the slot it left`);
  }
});

test('a POSTED destination keeps its state through a move', () => {
  // Nothing about a move is a reason to re-arm something that is already out.
  const posted = { id: 'tiktok:t1', provider: 'tiktok', accountId: 't1', status: 'posted', nextTryAt: 123 };
  seedClip({ targets: [posted, { id: 'x:1', provider: 'youtube', accountId: 'y1', status: 'failed', nextTryAt: Date.now() + HOUR }] });
  // A clip with a posted target is settled, so the move is refused outright --
  // which is the older guard doing exactly this job.
  assert.throws(() => agent.moveClipToSlot('c1', Date.now() + 2 * HOUR), /already gone out/i);
  assert.equal(state.clips[0].targets[0].nextTryAt, 123, 'and nothing was touched on the way');
});

/* ------------------------------------------------------------------ 3 */
test("'ready' is no longer terminal: a clip with somewhere to go comes back", async () => {
  /*
   * Nothing anywhere looked at a `ready` clip again, so an approved clip that
   * reached its slot with nowhere to go stayed there for ever -- and connecting
   * a channel an hour later released nothing.
   */
  seedClip({ status: 'ready', targets: [], scheduledAt: Date.now() - HOUR, extra: { readyAt: Date.now() - HOUR } });
  await agent.tick();

  const clip = state.clips[0];
  assert.equal(clip.status, 'scheduled', 'it is back on the schedule');
  assert.ok(!clip.readyAt, 'and no longer carries the state it was stuck in');
  assert.ok(clip.scheduledAt <= Date.now(), 'on a slot that has arrived, since it has already waited');
});

test('AND AN ACCOUNT EXPORTING BY HAND IS LEFT ALONE', async () => {
  /*
   * The direction that matters. `ready` legitimately means "yours to download"
   * for somebody who publishes nowhere, and re-arming those would start posting
   * clips for a person who never asked.
   *
   * WRITTEN FIRST AS "publishing switched off", AND IT FAILED AGAINST CORRECT
   * CODE -- which is how the dead conjunct in the fix was found. v3.116.0
   * retired that master switch with a read-time correction hardcoding
   * `enabled: true`, so it cannot be false and guarded nothing. Every platform
   * unticked is what "publishes nowhere" actually looks like now.
   */
  seedClip({ status: 'ready', targets: [], scheduledAt: Date.now() - HOUR });
  state.userSettings[userId].publishingSettings.tiktok.enabled = false;
  save();
  await agent.tick();
  assert.equal(state.clips[0].status, 'ready', 'nothing is re-armed for an account that publishes nowhere');
});

test('and one with still nowhere to go stays ready rather than churning', async () => {
  seedClip({ status: 'ready', targets: [], scheduledAt: Date.now() - HOUR });
  state.socialConnections[userId] = {};
  state.userSettings[userId].publishingSettings.tiktok.enabled = false;
  save();
  await agent.tick();
  assert.equal(state.clips[0].status, 'ready', 'no road, no re-arm');
});

/* ------------------------------------------------------------------ 4 */
/*
 * Facebook, read from the source for the reason test/buffer-double-post.test.mjs
 * already gives: the property is an ORDERING one (stamp before the call, refuse
 * or resolve after), and the network shape of Facebook's video_reels API is not
 * verified anywhere in this repo -- so a stub would be asserting against an
 * invented contract.
 */
function uploadFacebookBody() {
  const at = socialSource.indexOf('async function uploadFacebook(');
  assert.ok(at > 0, 'uploadFacebook must exist');
  let i = socialSource.indexOf('{', at), depth = 0;
  for (; i < socialSource.length; i += 1) {
    if (socialSource[i] === '{') depth += 1;
    else if (socialSource[i] === '}') { depth -= 1; if (!depth) return socialSource.slice(at, i + 1); }
  }
  throw new Error('uploadFacebook body not found');
}

test('the Reel is recorded as attempted BEFORE the call that publishes it', () => {
  // `upload_phase: finish` publishes. Recording after it returns is no guard at
  // all: the answer that never came back is the one that matters.
  const body = uploadFacebookBody();
  const stamp = body.indexOf('publishAttemptedAt');
  const finish = body.indexOf("upload_phase: 'finish'");
  assert.ok(stamp > -1, 'uploadFacebook must record that it tried to publish');
  assert.ok(finish > -1, 'and must still make the call');
  assert.ok(stamp < finish, 'the stamp has to come first');
  assert.ok(body.slice(stamp, finish).includes('save()'), 'and be persisted, or a restart loses it');
});

test('a second attempt ASKS Facebook rather than publishing again', () => {
  /*
   * Facebook is the one platform where the ambiguity can be RESOLVED instead of
   * only made visible: the video id is stable, so the Reel can be asked whether
   * it published. Refusing is the fallback for when that question cannot be
   * answered.
   */
  const body = uploadFacebookBody();
  assert.match(body, /alreadyAttempted/, 'the second attempt has to know it is the second');
  assert.match(body, /facebookReelPermalink\(videoId/, 'and ask about the video it already sent');
  assert.match(body, /retryable: false|retryable: !alreadyAttempted/,
    'once it has been sent, the failure must stop being retryable');
  assert.match(body, /Check the Page/, 'and say where to look before anyone retries');
});

test('the question is asked in ONE place, so both callers get the same answer', () => {
  // It fills in a post URL as well as resolving a publish. Two copies would
  // eventually disagree about whether a Reel is live.
  assert.equal((socialSource.match(/async function facebookReelPermalink\(/g) || []).length, 1);
  assert.ok((uploadFacebookBody().match(/facebookReelPermalink\(/g) || []).length >= 2,
    'used for the post URL and for the ambiguous publish');
});

test('the providers that already had a guard still have one', () => {
  // A regression here is silent: the duplicate only ever appears at the
  // platform, never in a log on this side.
  assert.match(socialSource, /publishAttemptedAt/, 'Instagram and Buffer');
  assert.match(socialSource, /youtubeUploadStatus/, 'YouTube resumable session');
});

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
  catch { /* a leftover temp directory on a runner is harmless */ }
});
