import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The cash-register bell: every business event pushed to the owner's phone,
// on a SEPARATE topic from the alarms so routine activity never buries a fire.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-feed-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'owner-feed-test-secret-long-enough';

const { state } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const feed = await import('../src/owner-feed.js');

const pushed = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('ntfy.sh')) {
    pushed.push({ topic: String(url).split('/').pop(), title: options.headers?.Title, tags: options.headers?.Tags, body: options.body });
    return new Response('{}', { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ } });

test.beforeEach(() => { pushed.length = 0; feed.reset(); config.activityNtfyTopic = 'biz-topic'; });

test('events land on the activity topic, never the alarm topic', async () => {
  config.alertNtfyTopic = 'alarm-topic';
  await feed.signedUp({ email: 'new@example.com' }, 'google');
  await feed.jobStarted({ title: 'Friday khutbah', sourceDurationSec: 2580 }, 'new@example.com');
  await feed.revenue('topup', { email: 'new@example.com' }, 1499, 'aud', '300 tokens');
  assert.equal(pushed.length, 3);
  for (const message of pushed) assert.equal(message.topic, 'biz-topic', 'the feed must not cry wolf on the alarm channel');
  assert.match(pushed[0].body, /new@example\.com/);
  assert.match(pushed[0].body, /google/);
  assert.match(pushed[1].body, /Friday khutbah/);
  assert.match(pushed[1].body, /43m/);
  assert.match(pushed[2].body, /AUD 14\.99/);
});

test('unconfigured means silent, not broken', async () => {
  config.activityNtfyTopic = '';
  assert.equal(await feed.signedUp({ email: 'x@x' }, 'email'), false);
  assert.equal(pushed.length, 0);
});

test('a runaway loop is throttled instead of carpet-bombing the phone', async () => {
  for (let i = 0; i < 60; i++) await feed.feed(`event ${i}`);
  assert.ok(pushed.length <= 40, `sent ${pushed.length}, cap is 40`);
  assert.match(pushed[pushed.length - 1].body, /throttled/i, 'the last message says why it went quiet');
});

test('the daily pulse reads the true business state', () => {
  const now = Date.now();
  state.authUsers.push(
    { id: 'u_new', email: 'a@a', createdAt: now - 3600_000, billing: { plan: 'monthly', status: 'active' } },
    { id: 'u_old', email: 'b@b', createdAt: now - 90 * 24 * 3600_000, billing: { plan: 'free', status: 'free' } },
    { id: 'u_admin', email: 'admin@a', createdAt: now - 90 * 24 * 3600_000, billing: { plan: 'admin', status: 'active' } },
  );
  state.projects.push(
    { id: 'p_done', title: 'L1', status: 'done', submittedAt: now - 7200_000 },
    { id: 'p_fail', title: 'L2', status: 'failed', submittedAt: now - 3600_000 },
  );
  state.clips.push(
    { id: 'c1', projectId: 'p_done', status: 'waiting', createdAt: now - 3600_000 },
    { id: 'c2', projectId: 'p_done', status: 'posted', createdAt: now - 3600_000, postedAt: new Date(now - 1800_000).toISOString() },
  );
  state.revenueEvents = [{ id: 'r1', kind: 'topup', amountMinor: 1499, currency: 'aud', createdAt: now - 3600_000 }];
  state.ownerCosts = [
    { id: 'c_soon', name: 'Webshare proxy', amountMinor: 600, currency: 'usd', active: true, nextDueAt: now + 3 * 24 * 3600_000 },
    { id: 'c_far', name: 'Hetzner', amountMinor: 800, currency: 'eur', active: true, nextDueAt: now + 20 * 24 * 3600_000 },
  ];

  const pulse = feed.composePulse(now);
  assert.match(pulse, /1 signup/, 'only the last 24h counts');
  assert.match(pulse, /2 job\(s\) \(1 done, 1 failed\)/);
  assert.match(pulse, /1 posted/);
  assert.match(pulse, /AUD 14\.99 taken/);
  assert.match(pulse, /1 active subscriber/, 'the admin plan is not a subscriber');
  assert.match(pulse, /1 clip\(s\) waiting/);
  assert.match(pulse, /Webshare proxy: USD 6\.00 due/, 'a bill due within the week is named');
  assert.doesNotMatch(pulse, /Hetzner/, 'a bill three weeks out is not "coming up"');
});


test('a deploy announces itself, so a blip at the same moment explains itself', async () => {
  process.env.RENDER_GIT_COMMIT = 'abc1234def5678';
  await feed.announceBoot();
  delete process.env.RENDER_GIT_COMMIT;
  assert.equal(pushed.length, 1);
  assert.match(pushed[0].body, /Update live/);
  assert.match(pushed[0].body, /v\d+\.\d+\.\d+/, 'a human version number, not just a sha');
  assert.match(pushed[0].body, /abc1234/, 'the build sha rides along');
  assert.match(pushed[0].body, /switchover, not an outage/, 'the blip explanation rides along');
});
