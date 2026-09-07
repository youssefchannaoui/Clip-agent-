import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * FACEBOOK REELS TAKES 4 TO 60 SECONDS, AND THE CLIPPER MAKES 62.
 *
 * Measured on the live account, 6 Sept 2026: of the last eight Facebook posts,
 * five landed and THREE FAILED -- every one of them on
 * "Facebook Reels publishing requires a 4-60 second video; this clip is 61/62
 * seconds." The clip itself was fine and went out on YouTube and Instagram.
 *
 * The fault was not the refusal, which was correct and already happened before
 * any bytes were sent. It was that a target was BUILT for a clip Facebook could
 * never accept: scheduled, shown to the customer in the review queue as a
 * destination this clip was going to, and then turned into a red failure after
 * the fact. A destination that is certain to refuse is not a destination.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-fbreels-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
const { state } = await import('../src/store.js');
const social = await import('../src/social.js');

const userId = 'user_fb';

/** An account posting to Facebook, Instagram and YouTube. */
function seed(durationMs) {
  state.authUsers = [{ id: userId, email: 'fb@example.com', role: 'owner' }];
  // Facebook and Instagram are Pages inside ONE Meta login -- selectedAccount
  // resolves them out of connection(userId, 'meta').accounts by pageId and
  // instagramId. Seeding a `facebook:` slot instead reads as "switched on but
  // no account selected", which looks exactly like the drop being tested and
  // would have made this pass for the wrong reason.
  state.socialConnections = {
    [userId]: {
      meta: [{ provider: 'meta', accountId: 'm1', tokens: {}, accounts: [
        { pageId: 'p1', pageName: 'The Page', instagramId: 'i1', instagramName: 'insta', token: '' },
      ] }],
      youtube: [{ provider: 'youtube', accountId: 'y1', name: 'Main', tokens: {} }],
    },
  };
  state.userSettings = { [userId]: { publishingSettings: {
    enabled: true,
    facebook: { enabled: true, accountId: 'p1', accountIds: ['p1'] },
    instagram: { enabled: true, accountId: 'i1', accountIds: ['i1'] },
    youtube: { enabled: true, accountId: 'y1', accountIds: ['y1'] },
    tiktok: { enabled: false },
  } } };
  state.projects = [{ id: 'p1', userId }];
  const clip = {
    id: 'c1', userId, projectId: 'p1', title: 'A clip', addedAt: 1,
    approvedBy: 'manual', targets: [], durationMs,
  };
  state.clips = [clip];
  state.log = [];
  return clip;
}

const providers = clip => social.enabledTargetsForClip(clip).map(t => t.provider).sort();

test('a 62-second clip still posts everywhere except Facebook', () => {
  const clip = seed(62_000);
  assert.deepEqual(providers(clip), ['instagram', 'youtube'],
    'Facebook is dropped; the clip is not');
});

test('and the reason is written down, never silently dropped', () => {
  // Two destinations vanishing from a customer's account with no line anywhere
  // is how a "my clips stopped posting" report starts.
  const clip = seed(62_000);
  social.enabledTargetsForClip(clip);
  const said = state.log.map(row => row.message || '').join('\n');
  assert.match(said, /will not post to facebook/i);
  assert.match(said, /62 seconds/, 'and it names the clip\'s own length');
});

test('a clip inside the band keeps Facebook', () => {
  assert.deepEqual(providers(seed(45_000)), ['facebook', 'instagram', 'youtube']);
  // The edges themselves are inclusive, or a clip of exactly 60 would be
  // refused by us and accepted by Facebook.
  assert.ok(providers(seed(60_000)).includes('facebook'), '60 seconds is allowed');
  assert.ok(providers(seed(4_000)).includes('facebook'), '4 seconds is allowed');
  assert.ok(!providers(seed(3_000)).includes('facebook'), 'under 4 is not');
});

test('the review card is told the same thing the publisher would be', () => {
  // plannedChannelsFor is what the queue draws as "Posts to". It ran through
  // the same builder, so a clip Facebook cannot take must not be shown as
  // going there -- that was the visible half of this fault.
  const clip = seed(62_000);
  const planned = social.plannedChannelsFor(clip).map(c => c.provider).sort();
  assert.deepEqual(planned, ['instagram', 'youtube']);
});

test('an unknown length is not a refusal in the preview, and IS one at the upload', () => {
  /*
   * The split that stops this being either too eager or too timid. A clip that
   * has not recorded its duration must not lose a destination in the preview
   * on a guess -- but the upload is about to spend bandwidth on a file
   * Facebook will reject, so there it stops.
   */
  assert.equal(social.platformRefusal('facebook', { durationMs: 0 }), '');
  assert.match(social.platformRefusal('facebook', { durationMs: 0 }, { assumeKnown: true }),
    /4.60 second/);
  const clip = seed(0);
  assert.ok(social.plannedChannelsFor(clip).map(c => c.provider).includes('facebook'),
    'the preview keeps it when the length is simply not known yet');
});

test('only Facebook has a length rule, and it is stated once', () => {
  // Instagram Reels and Shorts take far longer clips; inventing a limit for
  // them would drop destinations that work.
  for (const provider of ['youtube', 'instagram', 'tiktok']) {
    assert.equal(social.platformRefusal(provider, { durationMs: 62_000 }), '');
  }
  // Facebook is the only entry in the table, so it is the only platform that
  // can refuse on length at all.
  assert.deepEqual(Object.keys(social.PLATFORM_LENGTH_LIMITS), ['facebook']);

  // ONE sentence, and it is BUILT from the table rather than typed beside it.
  // The literal this used to count no longer exists -- the sentence became a
  // template when the table was introduced -- so pinning the bytes would fail
  // against correct code, which is the failure mode CLAUDE.md records most.
  // What must stay true is that the numbers a customer reads are the numbers
  // the refusal enforces.
  const limit = social.PLATFORM_LENGTH_LIMITS.facebook;
  const sentence = social.platformRefusal('facebook', { durationMs: 62_000 });
  const [, lo, hi] = sentence.match(/requires a (\d+)\u2013(\d+) second/) || [];
  assert.equal(Number(lo), limit.minSeconds, 'the sentence quotes the table');
  assert.equal(Number(hi), limit.maxSeconds, 'the sentence quotes the table');
  assert.ok(sentence.startsWith(limit.label), 'and names the platform from it');

  const src = fs.readFileSync(new URL('../src/social.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const built = src.match(/publishing requires a/g) || [];
  assert.equal(built.length, 1, 'the sentence is written in exactly one place');
  assert.match(src, /platformRefusal\('facebook', clip, \{ assumeKnown: true \}\)/,
    'the upload asks the shared function rather than re-testing the duration');
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });

test('a target already on disk for an impossible platform is healed at boot', async () => {
  /*
   * Targets are stamped once, at schedule time, and tick() only re-derives
   * them when the list is empty -- so every clip scheduled BEFORE this change
   * still carried a Facebook target and would still have failed at its slot.
   * Measured on the live account: one of eight. v3.29.1's lesson, applied.
   */
  const agent = await import('../src/agent.js');
  const clip = seed(61_000);
  clip.status = 'scheduled';
  clip.scheduledAt = Date.now() + 60_000;
  clip.targets = [
    { id: 'youtube:y1', provider: 'youtube', accountId: 'y1', status: 'scheduled' },
    { id: 'facebook:p1', provider: 'facebook', accountId: 'p1', status: 'scheduled' },
  ];
  state.log = [];

  const dropped = agent.healImpossibleTargets();
  assert.equal(dropped, 1);
  assert.deepEqual(clip.targets.map(t => t.provider), ['youtube'], 'the clip keeps everywhere it can go');
  assert.match(state.log.map(r => r.message || '').join('\n'), /will not post to facebook/i);

  // Idempotent: running it again finds nothing left to do.
  assert.equal(agent.healImpossibleTargets(), 0);
});

test('healing never touches a target that is posted or mid-flight', async () => {
  // A destination already in the air is not ours to withdraw, and one that has
  // POSTED is a fact about the world. Only a `scheduled` target is a plan.
  const agent = await import('../src/agent.js');
  const clip = seed(61_000);
  clip.status = 'scheduled';
  clip.targets = [
    { id: 'facebook:p1', provider: 'facebook', accountId: 'p1', status: 'posted', postUrl: 'https://fb/1' },
    { id: 'facebook:p2', provider: 'facebook', accountId: 'p2', status: 'publishing' },
  ];
  assert.equal(agent.healImpossibleTargets(), 0);
  assert.deepEqual(clip.targets.map(t => t.status), ['posted', 'publishing']);

  // And nothing at all on a clip that has already gone out.
  const done = seed(61_000);
  done.postedAt = Date.now();
  done.targets = [{ id: 'facebook:p1', provider: 'facebook', accountId: 'p1', status: 'scheduled' }];
  assert.equal(agent.healImpossibleTargets(), 0);
  assert.equal(done.targets.length, 1);
});
