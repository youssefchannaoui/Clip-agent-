import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Studio posts one clip to several accounts on the same platform.
 *
 * The cap is per PLATFORM and it is two limits multiplied together: what the
 * plan sells, and what the credentials can physically hold. `setConnection`
 * writes `socialConnections[userId][provider] = connection` -- one object,
 * overwritten -- so a second YouTube channel would destroy the first one's
 * refresh token. Meta is the exception by construction: one Facebook login
 * stores a LIST of Pages. So Studio gets three on Facebook and Instagram and
 * one on YouTube and TikTok, and that is a fact about the store, not a
 * pricing decision.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-multi-'));
process.env.DATA_DIR = dataDir;
process.env.AUTH_REQUIRED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'multi-channel-test-key-over-32-characters!!';
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
// So validatePublishingSettings gets past "developer credentials are not
// configured" and the CAP is what the route is actually judged on.
process.env.META_APP_ID = 'test-meta-app';
process.env.META_APP_SECRET = 'test-meta-secret';
// Enabling Facebook is refused while clips can run past 60s, which is a Reels
// rule and nothing to do with the cap under test here.
process.env.CLIP_MAX_SECONDS = '60';
// providerConfigured also requires a public base URL -- without it every
// provider reads as unconfigured and the route refuses before the cap is
// reached, which would make this test pass for the wrong reason.

process.env.APP_SESSION_SECRET = 'multi-channel-session-secret-long-enough';
// Before the first import of anything that pulls in config.js, which reads the
// port once.
const port = 37100 + Math.floor(Math.random() * 300);
process.env.PORT = String(port);
const base = `http://127.0.0.1:${port}`;
// providerConfigured needs a public base URL -- without one every provider
// reads as unconfigured and the route refuses before the cap is reached, which
// would make this test pass for the wrong reason. It has to be THIS server's
// address, because the sign-in route checks Origin against it.
process.env.PUBLIC_BASE_URL = base;

const billing = await import('../src/billing.js');
const store = await import('../src/store.js');
const social = await import('../src/social.js');
const agent = await import('../src/agent.js');
const { state } = store;

/* The server comes up ABOVE every test() on purpose: with top-level await the
   runner starts the tests already registered at the module's first yield, so a
   server imported below them is closed by the file's after-hook before the
   route tests run. */
const realFetch = globalThis.fetch;
const { server } = await import('../src/server.js');
test.after(() => new Promise(resolve => server.close(() => resolve())));
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await realFetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

function makeUser(id, plan) {
  const user = {
    id, email: `${id}@deenclipped.test`, role: 'creator', createdAt: Date.now(),
    billing: { plan, status: plan === 'free' ? 'free' : 'active', tokensUsed: 0, tokensReserved: 0, bonusTokens: 0 },
  };
  state.authUsers.push(user);
  return user;
}

const studio = makeUser('studio-user', 'studio_monthly');
const pro = makeUser('pro-user', 'pro_monthly');

// One Facebook login carrying three Pages, which is the shape connectMeta writes.
function connectMeta(userId) {
  state.socialConnections[userId] = {
    ...(state.socialConnections[userId] || {}),
    meta: {
      provider: 'meta',
      accounts: [1, 2, 3].map(n => ({
        pageId: `page-${n}`, pageName: `Page ${n}`,
        instagramId: `ig-${n}`, instagramName: `insta${n}`,
      })),
      connectedAt: Date.now(),
    },
  };
}
connectMeta(studio.id);
connectMeta(pro.id);

test('the cap is per platform, and bounded by what the credentials can hold', () => {
  // All four now: the provider slot holds a LIST of connections and every
  // credential path resolves by account id, so YouTube and TikTok are no longer
  // limited to the one connection their slot used to hold.
  for (const provider of ['facebook', 'instagram', 'youtube', 'tiktok']) {
    assert.equal(billing.accountsPerPlatform(studio, provider), 3, provider);
  }

  assert.equal(billing.accountsPerPlatform(pro, 'facebook'), 1, 'Pro is one account per platform');
  assert.equal(billing.accountsPerPlatform({ id: 'nobody' }, 'facebook'), 1, 'Basic is one');
});

test('a record written before multi-account reads back as a list', () => {
  // Every settings record on disk holds a single accountId string. The list is
  // derived at read time rather than by a migration pass, and accountId is kept
  // in step as its first entry so every existing reader carries on working.
  store.setPublishingSettings(pro, { enabled: true, facebook: { enabled: true, accountId: 'page-2' } });
  const read = store.publishingSettings(pro);
  assert.deepEqual(read.facebook.accountIds, ['page-2']);
  assert.equal(read.facebook.accountId, 'page-2', 'the scalar the publish path reads still resolves');
});

test('setting accountId replaces the list rather than being outvoted by it', () => {
  // The bug this pins: reusing the read-side merge on the write side left a
  // caller that named accountId alone -- which is every caller written before
  // this release -- posting to whatever was stored first.
  store.setPublishingSettings(studio, { enabled: true, facebook: { enabled: true, accountIds: ['page-1', 'page-2'] } });
  assert.deepEqual(store.publishingSettings(studio).facebook.accountIds, ['page-1', 'page-2']);

  store.setPublishingSettings(studio, { facebook: { accountId: 'page-3' } });
  assert.deepEqual(store.publishingSettings(studio).facebook.accountIds, ['page-3'], 'the caller wins');
  assert.equal(store.publishingSettings(studio).facebook.accountId, 'page-3');
});

test('the same account chosen twice is one destination, not a double post', () => {
  store.setPublishingSettings(studio, { facebook: { accountIds: ['page-1', 'page-1', 'page-2'] } });
  assert.deepEqual(store.publishingSettings(studio).facebook.accountIds, ['page-1', 'page-2']);
});

function seedClip(owner, over = {}) {
  const clip = {
    id: 'clip-' + Math.random().toString(36).slice(2, 10),
    userId: owner.id, projectId: 'proj-multi', title: 'Patience', status: 'approved',
    approvedBy: 'manual', targets: [], addedAt: Date.now(), scheduledAt: Date.now(), ...over,
  };
  state.clips.push(clip);
  return clip;
}

test('one clip fans out to every chosen account, each with its own identity', () => {
  store.setPublishingSettings(studio, {
    enabled: true,
    facebook: { enabled: true, accountIds: ['page-1', 'page-2', 'page-3'] },
  });
  const clip = seedClip(studio);
  const targets = social.enabledTargetsForClip(clip);
  const fb = targets.filter(t => t.provider === 'facebook');

  assert.equal(fb.length, 3, 'three Pages, three destinations');
  assert.deepEqual(fb.map(t => t.accountId), ['page-1', 'page-2', 'page-3']);
  assert.deepEqual(fb.map(t => t.accountName), ['Page 1', 'Page 2', 'Page 3']);
  // Identity is what makes a single destination addressable. Without it the
  // only handle a Retry button has is the provider, which means all three.
  assert.equal(new Set(fb.map(t => t.id)).size, 3, 'every destination is distinct');
  assert.ok(fb.every(t => t.id.startsWith('facebook:')));
  // Each target carries its OWN account in its settings snapshot, not a clone
  // of the shared object naming whichever account happened to be first.
  assert.deepEqual(fb.map(t => t.settings.accountId), ['page-1', 'page-2', 'page-3']);
});

test('a plan that lapses stops posting to the extra accounts', () => {
  // A settings record outlives the plan that was allowed to write it. Three ids
  // stay on disk when Studio lapses to Pro, and the render path must not keep
  // posting to all three because a past subscription once permitted it.
  store.setPublishingSettings(pro, {
    enabled: true,
    facebook: { enabled: true, accountIds: ['page-1', 'page-2', 'page-3'] },
  });
  const clip = seedClip(pro);
  const fb = social.enabledTargetsForClip(clip).filter(t => t.provider === 'facebook');
  assert.equal(fb.length, 1, 'Pro posts to one, however many are stored');
  assert.equal(fb[0].accountId, 'page-1');
});

test('retry addresses one destination, leaving the others untouched', () => {
  store.setPublishingSettings(studio, {
    enabled: true,
    facebook: { enabled: true, accountIds: ['page-1', 'page-2', 'page-3'] },
  });
  const clip = seedClip(studio, { status: 'publish_failed' });
  clip.targets = social.enabledTargetsForClip(clip).map(target => ({
    ...target, status: 'failed', error: `${target.accountName} refused`, nextTryAt: null,
  }));
  const [one, two, three] = clip.targets;

  agent.retryPublishing(clip.id, { targetId: two.id });

  // Not asserted as 'retrying': retryPublishing kicks off publishClip, whose
  // synchronous head moves the target straight on to 'publishing'. What matters
  // is that it LEFT the failed state and lost its error, and that the other two
  // did not move at all.
  assert.notEqual(two.status, 'failed', 'the one that was asked for is re-armed');
  assert.equal(two.error, null);
  // The bug this pins: selecting by provider re-armed all three and wiped the
  // reason the other two gave, so retrying a rate-limited Page also re-ran the
  // one that had been refused outright.
  assert.equal(one.status, 'failed', 'the others are left alone');
  assert.equal(one.error, 'Page 1 refused', 'and keep the reason they were given');
  assert.equal(three.status, 'failed');
  assert.equal(three.error, 'Page 3 refused');
});

test('the old provider selector still means the whole platform', () => {
  const clip = seedClip(studio, { status: 'publish_failed' });
  clip.targets = social.enabledTargetsForClip(clip).map(target => ({ ...target, status: 'failed', nextTryAt: null }));
  // A string is the pre-multi-account signature, and saved UI still sends it.
  agent.retryPublishing(clip.id, 'facebook');
  assert.ok(clip.targets.every(target => target.status !== 'failed'), 'every Page on the platform');
});

test('the cap is refused over HTTP, not merely hidden in the interface', async () => {
  // One sign-up only: the sign-in throttle is a real protection and a suite
  // that spends it reports a broken route when the route is fine.
  const res = await realFetch(`${base}/auth/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ email: 'cap@deenclipped.test', password: 'a long enough password', returnTo: '/' }),
    redirect: 'manual',
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('dc_session='), 'expected a session');
  const me = await (await realFetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).json();

  const account = state.authUsers.find(u => u.id === me.user.id);
  account.billing = { ...(account.billing || {}), plan: 'studio_monthly', status: 'active' };
  connectMeta(account.id);

  const save = body => realFetch(`${base}/api/publishing-settings`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const tooMany = await save({ enabled: true, facebook: { enabled: true, accountIds: ['page-1', 'page-2', 'page-3', 'page-1x'] } });
  assert.equal(tooMany.status, 400, 'four Pages on a three-Page plan is refused');
  assert.match((await tooMany.json()).error, /3 facebook accounts/);

  const allowed = await save({ enabled: true, facebook: { enabled: true, accountIds: ['page-1', 'page-2', 'page-3'] } });
  assert.equal(allowed.status, 200, 'three is allowed');
  assert.deepEqual(store.publishingSettings(account).facebook.accountIds, ['page-1', 'page-2', 'page-3']);

  // YouTube accepts three now too; the fourth is what the cap refuses.
  const fourChannels = await save({ enabled: true, youtube: { enabled: true, accountIds: ['a', 'b', 'c', 'd'] } });
  assert.equal(fourChannels.status, 400);
  assert.match((await fourChannels.json()).error, /3 youtube accounts/);
});

test('the plan is named the way a customer would say it', () => {
  // The header capitalised the raw id straight into "Studio_monthly", which is
  // the app failing to answer "what am I paying for?". The period is part of
  // the answer, so it is said rather than spelled.
  const named = plan => billing.publicBilling({ id: 'n', billing: { plan, status: plan === 'free' ? 'free' : 'active' } }).current;
  assert.equal(named('studio_monthly').planName, 'Studio · monthly');
  assert.equal(named('pro_yearly').planName, 'Pro · yearly');
  assert.equal(named('free').planName, 'Basic');
  // The three original ids are still on paying subscribers' records.
  assert.equal(named('weekly').planName, 'Pro · weekly');
  assert.equal(named('studio_monthly').tierName, 'Studio');
});

test('what a plan does NOT include is named, with the tier that would', () => {
  // A locked thing that is simply absent reads as a broken app. Each one says
  // what it is and what unlocks it.
  const pro = billing.publicBilling({ id: 'p', billing: { plan: 'pro_monthly', status: 'active' } }).current;
  assert.equal(pro.locked.multiChannel.tierName, 'Studio');
  assert.ok(pro.locked.multiChannel.label.length, 'and says what the feature is');
  assert.ok(!pro.locked.templates, 'what the plan DOES include is not listed as locked');

  const studio = billing.publicBilling({ id: 's', billing: { plan: 'studio_monthly', status: 'active' } }).current;
  assert.deepEqual(studio.locked, {}, 'Studio has nothing locked');

  const basic = billing.publicBilling({ id: 'b', billing: { plan: 'free', status: 'free' } }).current;
  assert.equal(Object.keys(basic.locked).length, Object.keys(billing.FEATURES).length, 'Basic is sold nothing');
});
