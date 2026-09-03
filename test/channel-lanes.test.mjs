import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Three channels, three schedules.
 *
 * Youssef, 3 Sept 2026: "with the three accounts, there should be three
 * different schedules ... How will it work with three different accounts?"
 *
 * Two things had to change for the answer to be anything but "it doesn't":
 *
 *  1. SLOTS WERE CLAIMED ACCOUNT-WIDE. Every scheduled clip took an instant
 *     away from every other, so three connected channels competed for one set
 *     of eight daily windows -- a Studio customer paying for three channels
 *     got eight posts a day between them. Slots are per channel now.
 *  2. EVERY CLIP WENT EVERYWHERE. The same clip on three channels at the same
 *     minute is your own channels competing with each other. `spread: rotate`
 *     gives each clip to one of them instead.
 *
 * The default is unchanged ('all'), because turning three channels into three
 * different schedules is a decision the account makes, not one a release makes
 * for it.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-lanes-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
const { state } = await import('../src/store.js');
const social = await import('../src/social.js');
const agent = await import('../src/agent.js');

const userId = 'user_lanes';

/** Three YouTube channels connected and switched on. */
function seed({ spread = 'all', clips = [] } = {}) {
  // Three channels on one platform is a Studio allowance: accountsPerPlatform
  // truncates to ONE for everybody else, which is the cap this whole feature
  // sits on top of. The operator counts as Studio (atLeast, not
  // paysForAtLeast), so the role is the cheapest way to say so here.
  state.authUsers = [{ id: userId, email: 'lanes@example.com', role: 'owner' }];
  state.socialConnections = {
    [userId]: {
      youtube: [
        { provider: 'youtube', accountId: 'y1', name: 'Main', tokens: {} },
        { provider: 'youtube', accountId: 'y2', name: 'Shorts', tokens: {} },
        { provider: 'youtube', accountId: 'y3', name: 'Arabic', tokens: {} },
      ],
      tiktok: [{ provider: 'tiktok', accountId: 't1', name: 'TikTok', tokens: {} }],
    },
  };
  state.userSettings = state.userSettings || {};
  state.userSettings[userId] = {
    ...(state.userSettings[userId] || {}),
    publishingSettings: {
      enabled: true,
      spread,
      youtube: { enabled: true, accountId: 'y1', accountIds: ['y1', 'y2', 'y3'] },
      tiktok: { enabled: false },
      instagram: { enabled: false },
      facebook: { enabled: false },
    },
  };
  state.clips = clips;
  state.projects = [{ id: 'p1', userId }];
}

function clip(id, addedAt) {
  return { id, userId, projectId: 'p1', title: id, addedAt, approvedBy: 'manual', targets: [] };
}

test('the default is unchanged: one clip, every channel', () => {
  const c = clip('c1', 1);
  seed({ clips: [c] });
  const lanes = social.enabledTargetsForClip(c).map(t => t.id);
  assert.deepEqual(lanes, ['youtube:y1', 'youtube:y2', 'youtube:y3']);
});

test('share out gives each clip ONE channel, and rotates', () => {
  const a = clip('a', 1); const b = clip('b', 2); const c = clip('c', 3); const d = clip('d', 4);
  seed({ spread: 'rotate', clips: [a, b, c, d] });
  const at = x => social.enabledTargetsForClip(x).map(t => t.id);
  assert.deepEqual(at(a), ['youtube:y1']);
  assert.deepEqual(at(b), ['youtube:y2']);
  assert.deepEqual(at(c), ['youtube:y3']);
  // Round again, so four clips fill three channels evenly rather than piling
  // the remainder on the last one.
  assert.deepEqual(at(d), ['youtube:y1']);
});

test('the same clip asked twice gets the same channel', () => {
  // This function runs at schedule time AND again when targets are rebuilt. A
  // rotation that drifted between the two would move a clip to a different
  // channel after it had already been scheduled for the first.
  const a = clip('a', 1); const b = clip('b', 2);
  seed({ spread: 'rotate', clips: [a, b] });
  const first = social.enabledTargetsForClip(b).map(t => t.id);
  const second = social.enabledTargetsForClip(b).map(t => t.id);
  const third = social.enabledTargetsForClip(b).map(t => t.id);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});

test('it rotates WITHIN a platform, never across them', () => {
  // A clip must still reach YouTube and TikTok both. Rotating across platforms
  // would mean a clip landing on one network and not the other, which is not
  // what anybody means by "share the clips out".
  const a = clip('a', 1);
  seed({ spread: 'rotate', clips: [a] });
  state.userSettings[userId].publishingSettings.tiktok = {
    enabled: true, accountId: 't1', accountIds: ['t1'],
  };
  a.tiktokConsentAt = Date.now();
  const providers = social.enabledTargetsForClip(a).map(t => t.provider).sort();
  assert.deepEqual(providers, ['tiktok', 'youtube'], 'both platforms, one channel each');
});

test('one channel on a platform is unaffected by the mode', () => {
  // With nothing to rotate between, "share out" and "everywhere" are the same
  // thing -- and an account that switches the mode on before connecting a
  // second channel must not see its posting change.
  const a = clip('a', 1);
  seed({ spread: 'rotate', clips: [a] });
  state.userSettings[userId].publishingSettings.youtube = {
    enabled: true, accountId: 'y1', accountIds: ['y1'],
  };
  assert.deepEqual(social.enabledTargetsForClip(a).map(t => t.id), ['youtube:y1']);
});

test('laneKeysForClip answers without writing to the log', () => {
  // The scheduler needs a clip's lanes BEFORE it has picked a time. Building
  // the targets to find out wrote every "no account selected" warning twice
  // for every clip, on every sweep.
  const a = clip('a', 1);
  seed({ clips: [a] });
  state.userSettings[userId].publishingSettings.youtube = {
    enabled: true, accountId: '', accountIds: [],
  };
  state.log = [];
  const keys = social.laneKeysForClip(a);
  assert.deepEqual(keys, []);
  assert.equal(state.log.length, 0, 'nothing was logged');
  // The loud path still warns.
  social.enabledTargetsForClip(a);
  assert.ok(state.log.length > 0, 'the real call still says why');
});

test('the lane key travels to the browser', () => {
  // The schedule filters a channel by this id. Deriving it in the browser
  // instead would be two places building one key.
  const out = social.targetPublic({ id: 'youtube:y2', provider: 'youtube', accountId: 'y2', status: 'scheduled' });
  assert.equal(out.id, 'youtube:y2');
  // A target written before the id existed still resolves, the same way.
  const old = social.targetPublic({ provider: 'youtube', accountId: 'y2', status: 'scheduled' });
  assert.equal(old.id, 'youtube:y2');
  const single = social.targetPublic({ provider: 'tiktok', accountId: '', status: 'scheduled' });
  assert.equal(single.id, 'tiktok:default');
});

test('two channels may share an instant; one channel may not', () => {
  // THE CHANGE THAT MAKES THREE CHANNELS WORTH HAVING. `taken` used to be
  // every scheduledAt the account held, so the second clip was pushed to the
  // next window whichever channel it was going to -- three channels sharing
  // eight windows instead of having eight each.
  const a = clip('a', 1); const b = clip('b', 2); const c = clip('c', 3);
  seed({ spread: 'rotate', clips: [a, b, c] });
  for (const x of [a, b, c]) x.status = 'approved';

  agent.scheduleApprovedClip(a);
  agent.scheduleApprovedClip(b);
  // a -> y1, b -> y2 (the rotation), so they are in different lanes and the
  // second may take the same instant as the first.
  assert.deepEqual(a.targets.map(t => t.id), ['youtube:y1']);
  assert.deepEqual(b.targets.map(t => t.id), ['youtube:y2']);
  assert.equal(b.scheduledAt, a.scheduledAt, 'different channels, same window');

  // c rotates back round to y3 -- still free, still the same instant.
  agent.scheduleApprovedClip(c);
  assert.deepEqual(c.targets.map(t => t.id), ['youtube:y3']);
  assert.equal(c.scheduledAt, a.scheduledAt);
});

test('a fourth clip on a full lane moves to the next window', () => {
  // The lane is the thing that fills up. Four clips over three channels puts
  // the fourth back on the first channel, which already holds one at that
  // instant -- so it takes the next window instead of stacking.
  const a = clip('a', 1); const b = clip('b', 2); const c = clip('c', 3); const d = clip('d', 4);
  seed({ spread: 'rotate', clips: [a, b, c, d] });
  for (const x of [a, b, c, d]) x.status = 'approved';
  [a, b, c, d].forEach(x => agent.scheduleApprovedClip(x));
  assert.deepEqual(d.targets.map(t => t.id), ['youtube:y1'], 'back round to the first channel');
  assert.equal(d.scheduledAt > a.scheduledAt, true, 'and to a later window than the clip already there');
});

test('posting everywhere still queues one clip per window', () => {
  // With 'all' every clip is in every lane, so every clip collides with every
  // other and the behaviour is exactly what it has always been. A release must
  // not change the schedule of an account that changed nothing.
  const a = clip('a', 1); const b = clip('b', 2);
  seed({ clips: [a, b] });
  for (const x of [a, b]) x.status = 'approved';
  agent.scheduleApprovedClip(a);
  agent.scheduleApprovedClip(b);
  assert.equal(a.targets.length, 3, 'all three channels');
  assert.notEqual(b.scheduledAt, a.scheduledAt, 'and they queue as before');
});

test('a clip going nowhere still queues account-wide', () => {
  // Publishing off, or a local export: it has no lane to be alone in, and
  // letting it stack on top of everything would put two exports on one slot.
  const a = clip('a', 1); const b = clip('b', 2);
  seed({ clips: [a, b] });
  state.userSettings[userId].publishingSettings.enabled = false;
  for (const x of [a, b]) x.status = 'approved';
  agent.scheduleApprovedClip(a);
  agent.scheduleApprovedClip(b);
  assert.deepEqual(a.targets, []);
  assert.notEqual(b.scheduledAt, a.scheduledAt);
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });
