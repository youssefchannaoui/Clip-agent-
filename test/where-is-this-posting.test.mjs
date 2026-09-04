import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * "How do I know where I'm posting my video?"
 *
 * Youssef, 4 Sept 2026, asked for a rethink of Studio and multi-channel
 * posting: "it's not just scheduling. It's more than just scheduling ... how
 * do I know where I'm posting my video?"
 *
 * The honest answer was that you could not. `targets` are only written when a
 * clip is SCHEDULED, so the review queue -- the one screen where a person is
 * deciding whether to publish something -- had nothing to say about the
 * destination. You approved blind and found out afterwards, on the Schedule.
 *
 * So the server answers it: `plannedChannelsFor` says where a clip will go
 * once approved, and every clip carries it as `willPostTo`. Computed on the
 * server on purpose -- where a clip posts is the product of the account's
 * channels, its share-out mode, the lecture's own narrowing and the plan's
 * cap, and a second implementation of those rules in the browser would drift.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-where-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
const { state } = await import('../src/store.js');
const social = await import('../src/social.js');

const userId = 'user_where';

function seed({ spread, tiktok = true } = {}) {
  state.authUsers = [{ id: userId, email: 'w@example.com', role: 'owner' }];
  state.socialConnections = {
    [userId]: {
      youtube: [
        { provider: 'youtube', accountId: 'y1', name: 'Main', tokens: {} },
        { provider: 'youtube', accountId: 'y2', name: 'Shorts', tokens: {} },
        { provider: 'youtube', accountId: 'y3', name: 'Arabic', tokens: {} },
      ],
      tiktok: [{ provider: 'tiktok', accountId: 't1', name: 'tt', tokens: {} }],
    },
  };
  state.userSettings = { [userId]: { publishingSettings: {
    enabled: true, ...(spread ? { spread } : {}),
    youtube: { enabled: true, accountId: 'y1', accountIds: ['y1', 'y2', 'y3'] },
    tiktok: { enabled: tiktok, accountId: 't1', accountIds: ['t1'] },
    instagram: { enabled: false }, facebook: { enabled: false },
  } } };
  state.projects = [{ id: 'p1', userId }];
  state.clips = [1, 2, 3].map(n => ({
    id: `c${n}`, userId, projectId: 'p1', title: `Clip ${n}`,
    status: 'waiting', addedAt: n, targets: [],
  }));
  return state.clips;
}
const names = clip => social.plannedChannelsFor(clip).map(c => c.accountName);

test('a clip waiting for review already knows where it is going', () => {
  // The whole point: this clip has never been scheduled and has no targets.
  const [first] = seed();
  assert.deepEqual(first.targets, [], 'nothing is committed yet');
  assert.ok(social.plannedChannelsFor(first).length, 'and it can still answer');
});

test('sharing out shows a DIFFERENT channel per clip, before any approval', () => {
  const [a, b, c] = seed();
  assert.deepEqual(names(a), ['Main', 'tt']);
  assert.deepEqual(names(b), ['Shorts', 'tt']);
  assert.deepEqual(names(c), ['Arabic', 'tt']);
  // Rotation is WITHIN a platform: TikTok has one channel, so every clip still
  // reaches it. A clip landing on YouTube but not TikTok is not what anyone
  // means by sharing clips out.
});

test('mirroring shows every channel on every clip', () => {
  const [a] = seed({ spread: 'all' });
  assert.deepEqual(names(a), ['Main', 'Shorts', 'Arabic', 'tt']);
});

test('TikTok is shown even though approving is what consents to it', () => {
  // THE TRAP THIS EXISTS TO AVOID. Consent is stamped by approveClip, so a
  // waiting clip has none -- and answering honestly from the stored value
  // would tell every reviewer their clip is not going to TikTok, right up
  // until the moment they approve it and it does.
  const [a] = seed({ spread: 'all' });
  assert.equal(a.tiktokConsentAt, undefined, 'no consent yet, by definition');
  assert.ok(names(a).includes('tt'), 'and the preview still names it');
  // The preview never publishes. The real build still refuses without consent,
  // which is what keeps TikTok's per-post rule intact.
  const real = social.enabledTargetsForClip(a).map(t => t.provider);
  assert.ok(!real.includes('tiktok'), 'the publishing path is unchanged');
});

test('with nothing connected it says so rather than guessing', () => {
  const [a] = seed();
  state.userSettings[userId].publishingSettings.youtube.enabled = false;
  state.userSettings[userId].publishingSettings.tiktok.enabled = false;
  assert.deepEqual(social.plannedChannelsFor(a), [],
    'an empty answer is what the card turns into "Nowhere to post"');
});

test('a lecture that narrows its platforms narrows the preview too', () => {
  const [a] = seed({ spread: 'all' });
  state.projects[0].publishTo = ['youtube'];
  assert.deepEqual(names(a), ['Main', 'Shorts', 'Arabic'], 'TikTok was turned off for this lecture');
});

test('the plan cap applies to the preview, so it cannot promise more than it posts', () => {
  const [a] = seed({ spread: 'all' });
  // A settings record outlives the plan that wrote it: three ids stay on disk
  // when Studio lapses. The preview must not keep naming all three.
  state.authUsers[0].role = 'user';
  state.authUsers[0].billing = { plan: 'free' };
  const planned = social.plannedChannelsFor(a).filter(c => c.provider === 'youtube');
  assert.equal(planned.length, 1, 'one channel is what a non-Studio plan buys');
});

test('the browser is told, never left to work it out', () => {
  // Where a clip posts is four rules deep. A second implementation in the
  // dashboard would drift from social.js, and the two would disagree about a
  // customer's own channels -- which is the confusion this release is fixing.
  const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  assert.match(server, /willPostTo:/, 'every clip carries the answer');
  assert.match(server, /social\.plannedChannelsFor\(clip\)/, 'from the one place that knows');

  const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const painter = /function paintClipDestinations\(vals, data\)\{[\s\S]*?\n\}/.exec(host)[0];
  assert.ok(painter.includes('willPostTo'), 'the card renders what it was told');
  // It must not rebuild the rules: no share-out mode, no plan cap, no consent.
  for (const rule of ['spread', 'rotate', 'accountsPerPlatform', 'tiktokConsent']) {
    assert.ok(!painter.includes(rule), `the painter must not re-derive ${rule}`);
  }
  // window.DATA is a DIFFERENT object in that scope -- measured, empty, while
  // the scoped DATA held four clips. index.html has several inline script
  // scopes and this is the fifth time that has cost something.
  assert.ok(!/window\.DATA/.test(painter), 'DATA arrives as a parameter');
  assert.ok(/paintClipDestinations\(vals,DATA\)/.test(host), 'and is passed in');
});

test('Studio is sold as what it now does', () => {
  // Both labels described something else: the windows read as one shared
  // allowance rather than one per channel, and multi-channel described
  // mirroring -- the mode that is no longer the default.
  const billing = fs.readFileSync(path.join(ROOT, 'src/billing.js'), 'utf8');
  assert.match(billing, /times a day on every channel/, '8 a day on EACH channel');
  assert.match(billing, /channels on each platform, each with its own schedule/);
  assert.ok(!/accounts on a platform`/.test(billing), 'the old mirroring line is gone');
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });
