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
 * connections, the lecture's own narrowing and the one-per-platform cap, and a
 * second implementation of those rules in the browser would drift.
 *
 * The SHARE-OUT MODE was a fourth rule here until 4 Sept 2026, when Youssef
 * retired multi-channel outright ("REMOVE ALL THINGS TO DO WITH 3 CHANNELS").
 * The three stored YouTube channels below are kept in the fixture on purpose:
 * an account that connected them while Studio sold them still has them on
 * disk, and what this file now proves is that the preview names ONE.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-where-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
const { state } = await import('../src/store.js');
const social = await import('../src/social.js');

const userId = 'user_where';

function seed({ tiktok = true } = {}) {
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
    enabled: true,
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

test('one channel per platform, whatever the record holds', () => {
  // Three YouTube channels are stored and the preview names the first, on
  // every clip. It named a different one per clip while the share-out mode
  // existed; that is the whole of what came off.
  const [a, b, c] = seed();
  assert.deepEqual(names(a), ['Main', 'tt']);
  assert.deepEqual(names(b), ['Main', 'tt']);
  assert.deepEqual(names(c), ['Main', 'tt'], 'and it is the same one every time');
});

test('TikTok is shown even though approving is what consents to it', () => {
  // THE TRAP THIS EXISTS TO AVOID. Consent is stamped by approveClip, so a
  // waiting clip has none -- and answering honestly from the stored value
  // would tell every reviewer their clip is not going to TikTok, right up
  // until the moment they approve it and it does.
  const [a] = seed();
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
  const [a] = seed();
  state.projects[0].publishTo = ['youtube'];
  assert.deepEqual(names(a), ['Main'], 'TikTok was turned off for this lecture');
});

test('the cap applies to the preview, so it cannot promise more than it posts', () => {
  // A settings record outlives the plan that wrote it, and now outlives the
  // FEATURE: three ids stay on disk from when Studio sold three channels. The
  // preview must not keep naming all three, on any plan -- including the
  // operator's, who was the one account that used to get them.
  const [a] = seed();
  const asOwner = social.plannedChannelsFor(a).filter(c => c.provider === 'youtube');
  assert.equal(asOwner.length, 1, 'the operator is capped like everybody else');
  state.authUsers[0].role = 'user';
  state.authUsers[0].billing = { plan: 'studio_monthly', status: 'active' };
  const asStudio = social.plannedChannelsFor(a).filter(c => c.provider === 'youtube');
  assert.equal(asStudio.length, 1, 'and so is a paying Studio subscriber');
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

test('Studio is sold as the two things it now is', () => {
  // Youssef, 4 Sept 2026: "THEY JUST GET 8 UPLAODS AND MORE TOKENS". The
  // second half was never on the feature list at all -- the token allowance
  // was only ever a number on the pricing card, so nobody comparing the two
  // columns could see that Studio buys more lectures a month.
  const billing = fs.readFileSync(path.join(ROOT, 'src/billing.js'), 'utf8');
  assert.match(billing, /times a day, not four/, 'the posting windows, said against the number they beat');
  assert.match(billing, /the tokens of Pro/, 'and the allowance, which was invisible before');
  // Nothing anywhere still sells a channel count.
  assert.ok(!/channels on each platform/.test(billing));
  assert.ok(!/multiChannel/.test(billing));
  assert.ok(!/accountsPerPlatformStudio/.test(fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8')),
    'and the setting that sized it is gone, not merely defaulted to one');
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });
