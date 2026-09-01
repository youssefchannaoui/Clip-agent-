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
process.env.DATA_DIR = dataDir;
// Port 0, so the OS assigns a free one and hands it back. A port picked at
// random out of 43300-43500 sits INSIDE Linux's ephemeral range
// (32768-60999), so the kernel can hand the same number to an outgoing
// socket between the choice and the listen -- EADDRINUSE, the file aborts,
// and the run reports fewer tests rather than a failure anyone can read.
// Measured before this change: 1 abort in 6 full runs.
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.APP_SESSION_SECRET = 'referral-growth-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const { server } = await import('../src/server.js');
const address = server.address();
assert.ok(address && typeof address === 'object', 'test server selected a port');
const base = `http://127.0.0.1:${address.port}`;
const store = await import('../src/store.js');
const referrals = await import('../src/referrals.js');
const growth = await import('../src/growth.js');
const billing = await import('../src/billing.js');
const { config } = await import('../src/config.js');

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

test('the inviter is paid only once the invited account subscribes', () => {
  // The reward Youssef asked for on 1 Sept 2026: the invited person gets 30%
  // off, and the INVITER gets tokens -- but only when a subscription actually
  // happens. Signing up must never pay, because signing up costs nothing and
  // a reward for it buys fake accounts.
  reset();
  const referrer = user('ref');
  const invited = user('new');
  store.state.authUsers = [referrer, invited];
  referrals.attachReferral(store.state, invited, referrals.codeFor(store.state, referrer));

  // Activated but not paying: nothing is converted yet.
  activate('new');
  let changes = referrals.settleReferrals(store.state);
  assert.deepEqual(changes.map(c => c.kind), ['activated'],
    'processing a lecture and keeping a clip is not a subscription');

  // Now they subscribe.
  store.state.revenueEvents.push({ userId: 'new', kind: 'subscription', amountMinor: 2900, stripeId: 'in_1' });
  changes = referrals.settleReferrals(store.state);
  assert.deepEqual(changes.map(c => c.kind), ['converted']);

  // The grant is what the config says, into the same balance a purchased
  // top-up writes to, and idempotent -- the settle pass runs on every owner
  // growth read, so a second run must not pay again.
  const key = `converted:${invited.id}`;
  assert.equal(billing.grantBonusTokens(referrer, config.referralBonusPaid, 'Referral bonus (converted)', key).granted,
    config.referralBonusPaid);
  assert.equal(billing.grantBonusTokens(referrer, config.referralBonusPaid, 'Referral bonus (converted)', key).granted, 0,
    'a replayed webhook or a second settle pass pays nothing');
  assert.equal(referrer.billing.bonusTokens, config.referralBonusPaid);
});

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

test('nothing pays out that has not actually been decided', async () => {
  // Code that pays by default pays before anybody decided to. The guard is
  // not "every reward is zero" -- it is that a non-zero one corresponds to a
  // real decision, and that the rest stay off until they do.
  const { config } = await import('../src/config.js');

  // Decided 1 Sept 2026 by Youssef: a reward for the INVITER, paid only when
  // the invited account subscribes. 50 tokens -- about 7.7% of a Pro month
  // (650), roughly one more lecture.
  assert.equal(config.referralBonusPaid, 50);

  // Still undecided, and therefore still off. Rewarding a mere SIGN-UP is the
  // one that buys fake accounts, so it stays at zero until somebody says
  // otherwise in as many words.
  assert.equal(config.referralBonusInvited, 0);
  assert.equal(config.referralBonusActivated, 0);
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

// ── the invite discount ─────────────────────────────────────────────────────
//
// Youssef, 31 Aug 2026: "attach 30% off for this invite link max 3 people and
// also it doesnt overlap other codes". Three rules, each with a way it leaks.

test('only an invited account gets the discount', async () => {
  const { config } = await import('../src/config.js');
  reset();
  const stranger = user('stranger');
  store.state.authUsers = [stranger];
  assert.equal(referrals.discountEligible(store.state, stranger, 3).eligible, false,
    'a discount for someone nobody referred is just a lower price');
});

test('the discount is spent once, not on every renewal', () => {
  reset();
  const referrer = user('ref');
  const invited = user('new');
  store.state.authUsers = [referrer, invited];
  referrals.attachReferral(store.state, invited, referrals.codeFor(store.state, referrer));

  assert.equal(referrals.discountEligible(store.state, invited, 3).eligible, true);
  assert.equal(referrals.markDiscountUsed(invited), true);
  // Second call is the renewal, or a replayed webhook.
  assert.equal(referrals.markDiscountUsed(invited), false);
  assert.equal(referrals.discountEligible(store.state, invited, 3).eligible, false,
    'the discount is for a first subscription, not for every future one');
});

test('a referrer can discount three people and no more', () => {
  reset();
  const referrer = user('ref');
  store.state.authUsers = [referrer];
  const code = referrals.codeFor(store.state, referrer);

  // Three invited accounts subscribe.
  for (let i = 0; i < 3; i += 1) {
    const invited = user(`invited${i}`);
    store.state.authUsers.push(invited);
    referrals.attachReferral(store.state, invited, code);
    assert.equal(referrals.discountEligible(store.state, invited, 3).eligible, true, `invite ${i + 1} should qualify`);
    referrals.markDiscountUsed(invited);
  }

  const fourth = user('invited3');
  store.state.authUsers.push(fourth);
  referrals.attachReferral(store.state, fourth, code);
  const verdict = referrals.discountEligible(store.state, fourth, 3);
  assert.equal(verdict.eligible, false, 'the fourth invite must not be discounted');
  assert.equal(verdict.reason, 'referrer-cap-reached');
  // The link still WORKS — it just stops carrying the discount.
  assert.ok(fourth.referredBy, 'the referral itself still counts');
});

test('the cap counts payments, not opened checkouts', () => {
  // Counting at checkout would let anyone burn a referrer's three by opening
  // three checkout pages and closing them.
  reset();
  const referrer = user('ref');
  store.state.authUsers = [referrer];
  const code = referrals.codeFor(store.state, referrer);
  for (let i = 0; i < 5; i += 1) {
    const invited = user(`browsing${i}`);
    store.state.authUsers.push(invited);
    referrals.attachReferral(store.state, invited, code);
    // They look at checkout and leave: no markDiscountUsed.
  }
  const real = user('real');
  store.state.authUsers.push(real);
  referrals.attachReferral(store.state, real, code);
  assert.equal(referrals.discountEligible(store.state, real, 3).eligible, true,
    'five abandoned checkouts must not exhaust the allowance');
});

test('a cap of zero switches the discount off entirely', () => {
  reset();
  const referrer = user('ref');
  const invited = user('new');
  store.state.authUsers = [referrer, invited];
  referrals.attachReferral(store.state, invited, referrals.codeFor(store.state, referrer));
  assert.equal(referrals.discountEligible(store.state, invited, 0).eligible, false);
});

test('the referrer can see how many discounts they have left', () => {
  reset();
  const referrer = user('ref');
  store.state.authUsers = [referrer];
  const code = referrals.codeFor(store.state, referrer);
  const invited = user('a');
  store.state.authUsers.push(invited);
  referrals.attachReferral(store.state, invited, code);
  referrals.markDiscountUsed(invited);
  assert.deepEqual(referrals.discountsLeft(store.state, referrer, 3), { used: 1, cap: 3, remaining: 2 });
});

test('the discount and a typed promo code can never both apply', () => {
  // Stripe rejects a session carrying both `discounts` and
  // `allow_promotion_codes`, so the no-stacking rule is enforced by Stripe
  // rather than by anyone remembering. This checks the code makes the CHOICE.
  //
  // Tested by CALLING it. The first version of this test read billing.js and
  // matched on text, and failed against a comment that happened to contain
  // the words it was looking for — which is the whole argument against
  // asserting on source strings.
  const cases = [
    ['an eligible invite', { eligible: true }, 'coupon_30off'],
    ['a cap that is spent', { eligible: false, reason: 'referrer-cap-reached' }, 'coupon_30off'],
    ['nobody referred them', { eligible: false, reason: 'not-referred' }, 'coupon_30off'],
    ['no coupon configured', { eligible: true }, ''],
  ];
  for (const [name, discount, coupon] of cases) {
    const params = billing.checkoutDiscountParams(discount, coupon);
    const hasCoupon = 'discounts[0][coupon]' in params;
    const hasPromoBox = 'allow_promotion_codes' in params;
    assert.ok(hasCoupon !== hasPromoBox, `${name}: exactly one of the two, never both and never neither`);
  }
  // And the eligible case really does carry the coupon rather than silently
  // falling through to the promo box.
  assert.equal(billing.checkoutDiscountParams({ eligible: true }, 'coupon_30off')['discounts[0][coupon]'], 'coupon_30off');
});

test('no coupon configured means no promise of one', async () => {
  const billing = await import('../src/billing.js');
  const { config } = await import('../src/config.js');
  assert.equal(config.stripeReferralCoupon, '', 'off by default');
  assert.equal(await billing.referralCouponSummary(), null,
    'without a coupon the panel must not name a percentage');
});
