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
