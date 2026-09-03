import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * A clip asks where it is going when it POSTS, not when it was scheduled.
 *
 * Youssef, 3 Sept 2026, looking at the Schedule screen: "once I get to the end
 * to then click post now or when it goes to the scheduler, it says no accounts
 * are connected. Even though on the right side, you can clearly see that there
 * has been accounts connected and TikTok is connected."
 *
 * Both halves of the screen were telling the truth about different things. The
 * ROW reads `clip.targets`, stamped once by setTargets when the clip was
 * scheduled; the SIDEBAR reads the live connections. Schedule a clip while
 * nothing is connected, connect TikTok an hour later, and the two disagree for
 * ever -- because nothing ever refreshed the clip.
 *
 * The consequence was worse than the label. At its slot, tick() filed a clip
 * with no targets as `ready` ("ready to download and post") and it silently
 * never posted, however many channels were connected by then. publishNow had
 * re-derived since it was written, so pressing the button worked and letting
 * the slot arrive did not.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-stale-dests-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'stale-destinations-secret-long-enough';
process.env.SOCIAL_TOKEN_KEY = 'social-token-key-at-least-thirty-two-chars';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.TIKTOK_CLIENT_KEY = 'sbawtestkey';
process.env.TIKTOK_CLIENT_SECRET = 'sbawtestsecret';

const { state, save } = await import('../src/store.js');
const agent = await import('../src/agent.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

const userId = 'user_stale';

/** An approved, fully checked clip sitting on a slot that has just arrived. */
function seed({ connected = true } = {}) {
  state.authUsers = [{
    id: userId, email: 'stale@test', name: 'Stale', role: 'creator', providers: {},
    createdAt: Date.now(), billing: { plan: 'pro', status: 'active' },
  }];
  state.clips = [{
    id: 'c1', userId, projectId: 'p1', title: 'A Reminder of Mercy',
    status: 'scheduled',
    // Its slot has arrived, which is the moment the bug bites.
    scheduledAt: Date.now() - 1000,
    approvedAt: Date.now() - 60_000, approvedBy: 'manual',
    musicEnabled: false, musicVerified: false, renderVerified: true, renderQuality: 'final',
    transcript: 'Some words.', templateId: 'clean-line',
    // THE BUG: scheduled while nothing was connected, so nowhere to go.
    targets: [],
    tiktokConsentAt: Date.now(),
  }];
  state.projects = [{ id: 'p1', userId, title: 'A lecture', status: 'done' }];
  // Connected AFTER the clip was scheduled — which is exactly the case.
  state.socialConnections = connected ? {
    [userId]: {
      tiktok: [{
        provider: 'tiktok', accountId: 'tt1', name: 'DeenClipped', avatar: '',
        scopes: 'user.info.basic,video.publish', token: '', connectedAt: Date.now(),
        creatorInfo: { at: Date.now(), privacyOptions: ['SELF_ONLY'] },
      }],
    },
  } : {};
  state.userSettings = {
    [userId]: {
      publishingSettings: {
        enabled: true,
        tiktok: { enabled: connected, accountId: 'tt1', accountIds: ['tt1'], privacy: 'SELF_ONLY' },
      },
    },
  };
  save();
  return state.clips[0];
}

test('a clip scheduled before connecting still posts once a channel is live', async () => {
  const clip = seed({ connected: true });
  assert.deepEqual(clip.targets, [], 'it starts with nowhere to go — the state on disk');

  await agent.tick();

  const after = state.clips[0];
  assert.ok((after.targets || []).length > 0,
    'the clip picked up the account’s connected channel at its slot');
  assert.equal(after.targets[0].provider, 'tiktok');
  assert.notEqual(after.status, 'ready',
    'and was NOT filed away as "ready to download and post", which is where it silently died');
});

test('with genuinely nowhere to post it still falls through honestly', async () => {
  seed({ connected: false });
  await agent.tick();
  const after = state.clips[0];
  assert.deepEqual(after.targets || [], [], 'nothing invented');
  assert.equal(after.status, 'ready', 'the old, correct behaviour is unchanged');
});

test('targets already in flight are never re-derived out from under a publish', async () => {
  // Re-deriving a list that already exists would discard an upload's own
  // status and retry state, so the refresh is only ever for an EMPTY list.
  const source = fs.readFileSync(new URL('../src/agent.js', import.meta.url), 'utf8');
  const at = source.indexOf("if (clip.status === 'scheduled' && clip.scheduledAt && clip.scheduledAt <= Date.now())");
  const block = source.slice(at, at + 1800);
  assert.match(block, /!clip\.targets\?\.length/,
    'the re-derive is guarded on the list being empty');
  assert.match(block, /catch\b/,
    'and a clip with still nowhere to go falls through rather than throwing out of the sweep');
});

test('the schedule row stops claiming nothing is connected when something is', () => {
  const source = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  // One answer to "is there anywhere to post right now", shared with the
  // sidebar that reads "Posting" — two answers is how they disagreed on screen.
  assert.match(source, /var anyOutletLive = function/, 'one shared test');
  const at = source.indexOf("dests: destinations(c).length ? destinations(c) :");
  const block = source.slice(at, at + 1200);
  assert.match(block, /anyOutletLive\(\)/, 'the row consults it');
  assert.match(block, /Set when it posts/, 'and says something true instead');
  assert.match(block, /No account connected/, 'keeping the honest message for when it IS true');
});

/*
 * TWO SWITCHES, and only reading the near one (v3.115.3) -- then ONE (v3.116.0).
 *
 * "im confused i click post now nothing happnes" -- with TikTok visibly
 * connected and the sidebar reading "Posting". The Render log said it all:
 *
 *   Scheduled "If you are a servant…" for local export.
 *   Publishing started for "A Reminder of Mercy…".
 *   "A Reminder of Mercy…" is ready to download and post.
 *
 * `setTargets` returns an EMPTY list without throwing, so the clip scheduled
 * to nowhere, Post now published to nowhere and reported success, and three
 * separate surfaces read TikTok's OWN switch while the account's master
 * automatic-publishing switch was off.
 *
 * v3.115.3 taught all three surfaces to read both switches. v3.116.0 RETIRED
 * the master one instead -- it defaulted to false with no control anywhere in
 * the studio, so it was never a decision anybody made. These tests now assert
 * the simpler shape that replaced it: a platform's own tick is the whole
 * answer. See test/publishing-always-on.test.mjs.
 */
test('Post now says why instead of silently doing nothing', async () => {
  const clip = seed({ connected: false });
  clip.status = 'scheduled';
  clip.targets = [];
  save();

  await assert.rejects(() => agent.publishNow('c1'), error => {
    assert.match(error.message, /no connected destination/i, 'it says what is missing');
    assert.match(error.message, /Connections/i, 'and where to fix it');
    return true;
  });
  assert.notEqual(state.clips[0].status, 'posted');
});

test('and it says so from EVERY state the button can be pressed in', async () => {
  // The guard used to sit inside the `scheduled` branch alone, so an approved
  // or ready clip still fell through to "Publishing started" and a success
  // toast. It sits after the branch chain now, which is what makes the
  // invariant true rather than true-in-one-case.
  for (const status of ['approved', 'ready', 'publish_failed']) {
    const clip = seed({ connected: false });
    clip.status = status;
    clip.targets = [];
    save();
    await assert.rejects(() => agent.publishNow('c1'), /no connected destination/i, status);
    assert.notEqual(state.clips[0].status, 'posted', status);
  }
});

test('the surfaces read the platform tick, and nothing else', () => {
  const source = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  assert.ok(!/autoPublishOn/.test(source), 'the retired master switch is gone from the adapter');

  // The sidebar dot and the row have to keep agreeing with each other, which
  // is the property the two-switch version existed to protect.
  const at = source.indexOf('schedOutlets: providers.map');
  const outlets = source.slice(at, at + 900);
  assert.match(outlets, /var live = p\.connected && p\.enabled;/, 'the dot needs the channel on');
  assert.match(outlets, /Switched off/, 'and says so when it is not');

  const rowAt = source.indexOf('dests: destinations(c).length');
  const row = source.slice(rowAt, rowAt + 1200);
  assert.match(row, /anyOutletLive\(\)/, 'the row asks the same question');
  assert.match(row, /No account connected/);
});

/*
 * Connecting a channel is asking to publish to it (v3.115.4, simplified in
 * v3.116.0).
 *
 * Youssef: "as soon as I have my thing connected ... it should work normally
 * ... I shouldn't be doing extra steps."
 *
 * It took TWO switches then: the platform's, and a master one defaulting to
 * false. So out of the box a customer could connect TikTok, see "successfully
 * linked", pick an audience, watch the dot go green -- and never have one clip
 * post. The master switch is retired, so connecting has one switch to set.
 */
test('connecting a channel is the whole of switching it on', async () => {
  const { publishingSettings, setPublishingSettings } = await import('../src/store.js');
  const social = await import('../src/social.js');
  seed({ connected: true });

  setPublishingSettings(userId, { youtube: { enabled: false } });
  assert.equal(publishingSettings(userId).youtube.enabled, false, 'off to start with');

  social.enableOnConnectForTests(userId, ['youtube']);

  const after = publishingSettings(userId);
  assert.equal(after.youtube.enabled, true, 'the channel is on');
  assert.equal(after.enabled, true, 'and there is no second switch left to find');
});

test('TikTok still waits for its audience', async () => {
  const { publishingSettings, setPublishingSettings } = await import('../src/store.js');
  const social = await import('../src/social.js');
  seed({ connected: true });
  setPublishingSettings(userId, { tiktok: { enabled: false, privacy: '' } });

  // TikTok's guidelines forbid a preselected audience, so connecting may not
  // switch it on -- it is marked and waits. Retiring the master switch must
  // not have loosened this: it is the one platform gate that is a rule rather
  // than a preference.
  social.enableOnConnectForTests(userId, ['tiktok']);
  const waiting = publishingSettings(userId);
  assert.equal(waiting.tiktok.enabled, false, 'not enabled without an audience');
  assert.equal(waiting.tiktok.enableWhenReady, true, 'but marked for the moment one is chosen');
});

test('the settings route finishes the job when the audience arrives', () => {
  // The other half lives in the route, because that is where an audience is
  // first saved.
  const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const at = source.indexOf('if (next.tiktok.enableWhenReady && String(next.tiktok.privacy');
  assert.ok(at > 0, 'found the branch');
  const block = source.slice(at, at + 700);
  assert.match(block, /next\.tiktok\.enabled = true;/);
});
