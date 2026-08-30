/*
 * Referrals, activation and the money attached to them.
 *
 * The rule the whole file exists to defend: **an account is not a referral.**
 * Signing up costs nothing, so paying for one buys fake accounts. A referral
 * counts when the invited person has ACTIVATED — processed a video and
 * approved a clip — because that is the first moment they have seen what the
 * product does and it is expensive enough that faking it is not worth doing.
 *
 * Everything else here is a way that rule, or the money behind it, could be
 * got around.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-growth-'));
const port = 43300 + Math.floor(Math.random() * 200);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.APP_SESSION_SECRET = 'referral-growth-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const store = await import('../src/store.js');
const referrals = await import('../src/referrals.js');
const growth = await import('../src/growth.js');
const billing = await import('../src/billing.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

const reset = () => {
  store.state.authUsers = [];
  store.state.projects = [];
  store.state.clips = [];
  store.state.revenueEvents = [];
  store.state.referralRewards = {};
};
const user = (id, extra = {}) => ({ id, email: `${id}@example.com`, billing: {}, ...extra });
const activate = id => {
  store.state.projects.push({ userId: id, status: 'complete' });
  store.state.clips.push({ userId: id, status: 'approved' });
};

// ── the code itself ─────────────────────────────────────────────────────────

test('a referral code reveals nothing about the account behind it', () => {
  reset();
  const a = user('user_00000001');
  store.state.authUsers = [a];
  const code = referrals.codeFor(store.state, a);
  assert.match(code, /^[2-9A-HJ-NP-Z]{8}$/, 'unambiguous alphabet, fixed length');
  // A code derived from the id lets anyone holding one enumerate the rest and
  // count the customers.
  assert.ok(!code.includes('00000001'));
  assert.ok(!/^\d+$/.test(code), 'never sequential');
  // Stable once issued: a link already shared must keep working.
  assert.equal(referrals.codeFor(store.state, a), code);
});

test('two accounts never get the same code', () => {
  reset();
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const u = user(`u${i}`);
    store.state.authUsers.push(u);
    const code = referrals.codeFor(store.state, u);
    assert.ok(!seen.has(code), 'collision');
    seen.add(code);
  }
});

// ── attaching a referral ────────────────────────────────────────────────────

test('a valid code links the two accounts', () => {
  reset();
  const referrer = user('ref');
  const invited = user('new');
  store.state.authUsers = [referrer, invited];
  const code = referrals.codeFor(store.state, referrer);
  const link = referrals.attachReferral(store.state, invited, code);
  assert.ok(link);
  assert.equal(link.referrerId, 'ref');
  assert.equal(link.activatedAt, null, 'signing up is not activation');
  assert.equal(link.convertedAt, null);
});

test('an unknown code is ignored, not invented', () => {
  reset();
  const invited = user('new');
  store.state.authUsers = [invited];
  assert.equal(referrals.attachReferral(store.state, invited, 'ZZZZZZZZ'), null);
  assert.equal(invited.referredBy, undefined, 'a hand-edited cookie must not mint a referrer');
});

test('an account cannot refer itself', () => {
  reset();
  const solo = user('solo');
  store.state.authUsers = [solo];
  const code = referrals.codeFor(store.state, solo);
  assert.equal(referrals.attachReferral(store.state, solo, code), null);
  assert.equal(solo.referredBy, undefined);
});

test('a second referral never overwrites the first', () => {
  // First touch is the answer to "who sent them". A later link is a later
  // link, and letting it win means the last person to share a code takes
  // credit for someone else's introduction.
  reset();
  const first = user('first');
  const second = user('second');
  const invited = user('new');
  store.state.authUsers = [first, second, invited];
  referrals.attachReferral(store.state, invited, referrals.codeFor(store.state, first));
  referrals.attachReferral(store.state, invited, referrals.codeFor(store.state, second));
  assert.equal(invited.referredBy.referrerId, 'first');
});

test('a malformed code cannot be used to probe or to inject', () => {
  reset();
  store.state.authUsers = [user('a')];
  for (const nasty of ['../../etc/passwd', '<script>', "' OR 1=1", 'x'.repeat(500), '', null, undefined]) {
    assert.equal(referrals.attachReferral(store.state, store.state.authUsers[0], nasty), null);
  }
  assert.equal(referrals.normaliseCode('ab-cd_ef!'), 'ABCDEF');
  assert.equal(referrals.normaliseCode('x'.repeat(100)).length, 16, 'bounded');
});

// ── activation is the bar ───────────────────────────────────────────────────

test('signing up is not activation, and neither half alone is', () => {
  reset();
  store.state.authUsers = [user('u')];
  assert.equal(referrals.isActivated(store.state, 'u'), false, 'an account on its own');

  store.state.projects.push({ userId: 'u', status: 'complete' });
  assert.equal(referrals.isActivated(store.state, 'u'), false, 'processed but nothing approved');

  store.state.projects = [];
  store.state.clips.push({ userId: 'u', status: 'approved' });
  assert.equal(referrals.isActivated(store.state, 'u'), false, 'approved but nothing processed');

  store.state.projects.push({ userId: 'u', status: 'complete' });
  assert.equal(referrals.isActivated(store.state, 'u'), true, 'both halves');
});

test('publishing a clip does not un-activate the account', () => {
  // A clip that reached 'posted' was approved to get there. Reading only
  // 'approved' would drop the user out of activation the moment they
  // succeeded, which is the opposite of what the metric is for.
  reset();
  store.state.authUsers = [user('u')];
  store.state.projects.push({ userId: 'u', status: 'complete' });
  store.state.clips.push({ userId: 'u', status: 'posted', postedAt: Date.now() });
  assert.equal(referrals.isActivated(store.state, 'u'), true);
});

test('activation and conversion are each stamped exactly once', () => {
  reset();
  const referrer = user('ref');
  const invited = user('new');
  store.state.authUsers = [referrer, invited];
  referrals.attachReferral(store.state, invited, referrals.codeFor(store.state, referrer));
  activate('new');
  store.state.revenueEvents.push({ userId: 'new', kind: 'subscription', amountMinor: 2900, stripeId: 'in_1' });

  const first = referrals.settleReferrals(store.state);
  assert.equal(first.length, 2, 'activated and converted');
  const stampedAt = invited.referredBy.activatedAt;

  // A renewal arrives. It must change nothing.
  store.state.revenueEvents.push({ userId: 'new', kind: 'subscription', amountMinor: 2900, stripeId: 'in_2' });
  const second = referrals.settleReferrals(store.state);
  assert.deepEqual(second, [], 'a renewal is not a new referral');
  assert.equal(invited.referredBy.activatedAt, stampedAt, 'the stamp is never rewritten');
});

// ── the money ───────────────────────────────────────────────────────────────

test('a bonus grant with the same key never pays twice', () => {
  reset();
  const u = user('u');
  store.state.authUsers = [u];
  assert.equal(billing.grantBonusTokens(u, 30, 'referral', 'activated:new').granted, 30);
  assert.equal(billing.grantBonusTokens(u, 30, 'referral', 'activated:new').granted, 0);
  assert.equal(u.billing.bonusTokens, 30, 'the settle pass can run as often as it likes');
});

test('a grant refuses to run without a key', () => {
  // Without a key there is no idempotency, and a pass that runs on every read
  // would top somebody up on every read.
  reset();
  const u = user('u');
  store.state.authUsers = [u];
  assert.throws(() => billing.grantBonusTokens(u, 30, '', ''), /needs a key/);
});

test('rewards are off unless configured', async () => {
  // The economics are not approved. Code that pays by default pays before
  // anybody decided to.
  const { config } = await import('../src/config.js');
  assert.equal(config.referralBonusInvited, 0);
  assert.equal(config.referralBonusActivated, 0);
  assert.equal(config.referralBonusPaid, 0);
  assert.equal(config.affiliatesEnabled, false);
  assert.equal(config.affiliateCommissionPercent, 0);
});

// ── the invite link over HTTP ───────────────────────────────────────────────

test('/r/CODE sets a cookie holding a code and nothing else', async () => {
  const res = await fetch(`${base}/r/ABCD2345`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const cookies = res.headers.getSetCookie().join(' ; ');
  assert.match(cookies, /dc_ref=ABCD2345/);
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /SameSite=Lax/);
  // No identifier, no account id, nothing derived from one.
  assert.ok(!/user_/.test(cookies));
});

test('an unknown code still redirects rather than confirming it is unknown', async () => {
  // Refusing at the door tells a stranger which codes exist. The code is
  // validated at sign-up, where the worst it can do is find no referrer.
  const res = await fetch(`${base}/r/ZZZZZZZZ`, { redirect: 'manual' });
  assert.equal(res.status, 302);
});

test('a referral link is not an open redirect', async () => {
  for (const nasty of ['/r/..%2F..%2Fetc', '/r/https://evil.example']) {
    const res = await fetch(`${base}${nasty}`, { redirect: 'manual' });
    const location = res.headers.get('location') || '';
    assert.ok(!location.startsWith('http'), `${nasty} must never send a visitor off-site`);
  }
});

test('the referral API is scoped to the caller and refuses a stranger', async () => {
  const res = await fetch(`${base}/api/referral`);
  assert.equal(res.status, 401, 'signed out must not see anybody’s code');
});

test('the growth report is owner-only', async () => {
  const res = await fetch(`${base}/api/owner/growth`);
  assert.ok([401, 403, 404].includes(res.status), `growth data leaked with ${res.status}`);
});

// ── the funnel ──────────────────────────────────────────────────────────────

test('the funnel counts stages passed, not the furthest reached', () => {
  reset();
  store.state.authUsers = [user('a'), user('b')];
  activate('a');
  store.state.revenueEvents.push({ userId: 'a', kind: 'subscription', amountMinor: 2900 });
  store.state.projects.push({ userId: 'b', status: 'queued' });

  const stages = growth.funnel(store.state, store.state.authUsers);
  assert.equal(stages.signedUp, 2);
  assert.equal(stages.imported, 2);
  assert.equal(stages.processed, 1);
  assert.equal(stages.approved, 1);
  assert.equal(stages.paid, 1);
});

test('a renewal is never a new customer', () => {
  reset();
  store.state.authUsers = [user('a', { convertedAt: Date.now(), firstPaidAmountMinor: 2900, firstPaidPlan: 'pro_monthly' })];
  activate('a');
  store.state.revenueEvents = [
    { userId: 'a', kind: 'subscription', amountMinor: 2900, stripeId: 'in_1' },
    { userId: 'a', kind: 'subscription', amountMinor: 2900, stripeId: 'in_2' },
    { userId: 'a', kind: 'subscription', amountMinor: 2900, stripeId: 'in_3' },
  ];
  const report = growth.report(store.state, { uniques: 100 });
  assert.equal(report.paidSubscribers, 1, 'three payments, one customer');
  assert.equal(report.mrrMinor, 2900, 'and one monthly figure');
});

test('a yearly plan is not twelve monthly customers', () => {
  reset();
  store.state.authUsers = [user('a', { convertedAt: Date.now(), firstPaidAmountMinor: 29000, firstPaidPlan: 'pro_yearly' })];
  activate('a');
  store.state.revenueEvents = [{ userId: 'a', kind: 'subscription', amountMinor: 29000 }];
  const report = growth.report(store.state, {});
  assert.equal(report.mrrMinor, Math.round(29000 / 12), 'normalised to a month');
});

test('channels rank by paying customers, never by traffic', () => {
  reset();
  const many = Array.from({ length: 20 }, (_, i) => user(`vol${i}`, { signupLanding: '/guides' }));
  const few = [user('p1', { arrival: { utm_source: 'shaykh' }, convertedAt: Date.now(), firstPaidAmountMinor: 2900 })];
  store.state.authUsers = [...many, ...few];
  activate('p1');
  store.state.revenueEvents = [{ userId: 'p1', kind: 'subscription', amountMinor: 2900 }];
  const report = growth.report(store.state, {});
  assert.equal(report.channels[0].key, 'campaign',
    'one paying campaign must outrank twenty free signups');
});

test('the report says what it cannot see rather than showing zero', () => {
  reset();
  const report = growth.report(store.state, {});
  assert.ok(report.unavailable.some(line => /Search Console/i.test(line)));
  assert.ok(report.unavailable.some(line => /Renewals are excluded/i.test(line)));
  // A rate with no denominator is null, not 0: "nobody has come yet" and
  // "nobody converted" are different answers.
  assert.equal(report.rates.visitorToSignup, null);
});

test('the operator is excluded from their own funnel', () => {
  reset();
  store.state.authUsers = [user('owner', { role: 'owner' }), user('real')];
  const report = growth.report(store.state, {});
  assert.equal(report.funnel.signedUp, 1, 'the owner testing the product is not a customer');
});

// ── the next step ───────────────────────────────────────────────────────────

test('a user is told one next action, not a checklist', () => {
  reset();
  store.state.authUsers = [user('u')];
  assert.equal(referrals.nextStep(store.state, 'u').key, 'import');

  store.state.projects.push({ userId: 'u', status: 'complete' });
  store.state.clips.push({ userId: 'u', status: 'waiting' });
  assert.equal(referrals.nextStep(store.state, 'u').key, 'review');

  store.state.clips[0].status = 'approved';
  assert.equal(referrals.nextStep(store.state, 'u').key, 'publish');
});

test('suspicious pairs are flagged for a person, never auto-blocked', () => {
  reset();
  const now = Date.now();
  const referrer = user('ref', { email: 'a@onedomain.test' });
  const invited = user('new', { email: 'b@onedomain.test' });
  store.state.authUsers = [referrer, invited];
  referrals.attachReferral(store.state, invited, referrals.codeFor(store.state, referrer));
  invited.referredBy.createdAt = now;
  invited.referredBy.activatedAt = now + 5_000;

  const flags = referrals.suspicious(store.state);
  assert.ok(flags.some(f => f.kind === 'same-domain'));
  assert.ok(flags.some(f => f.kind === 'instant-activation'));
  // Flagged, not blocked: one person with two accounts and two colleagues on
  // one domain look identical, and the only honest way to tell them apart is
  // to ask.
  assert.ok(invited.referredBy, 'the link still stands; a human decides');
  for (const flag of flags) assert.ok(flag.detail);
});
