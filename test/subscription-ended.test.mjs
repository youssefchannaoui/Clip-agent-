import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * A CANCELLED SUBSCRIPTION IS CUT OFF AT PERIOD END.
 *
 * Youssef, 14 Sept 2026: "fix the cancelled subscription thing, cut them off
 * at period end."
 *
 * Measured on the live account before this was written: a Pro subscription
 * cancelled forty days ago was byte-for-byte indistinguishable from an active
 * one -- the same 650 tokens, DeenAI unlocked, clips still posting. The whole
 * wind-down had rested on `customer.subscription.deleted` arriving, and this
 * deployment's signing secret has been rejecting webhook deliveries since
 * 29 Aug. So the customer cancelled and kept everything they cancelled.
 *
 * THE DANGEROUS DIRECTION IS THE OTHER ONE, and it is what most of this file
 * pins. Because the webhook is failing, a `periodEnd` in the past is the
 * ORDINARY state of a healthy renewing subscriber -- their renewal never
 * reached us either. A rule that read a stale date as an ending would lock out
 * every paying customer on the deployment at once. Each of those cases gets a
 * test here, and each was proven red against a rule that cut off on the date
 * alone.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-sub-ended-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'subscription-ended-test-secret-long-enough';
process.env.STRIPE_SECRET_KEY = 'sk_live_testdouble';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

const DAY = 24 * 60 * 60 * 1000;

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* a leftover temp dir must never fail a green suite */ }
});

let seq = 0;
function makeUser(fields = {}, userFields = {}) {
  const id = `u${seq += 1}`;
  const user = {
    id,
    email: `${id}@test`,
    name: id,
    role: 'creator',
    providers: {},
    // Old enough that the free window is long gone, which is the real shape of
    // a lapsed subscriber and the one where the allowance must reach zero.
    createdAt: Date.now() - 300 * DAY,
    billing: { plan: 'free', status: 'free', tokensUsed: 0, ...fields },
    ...userFields,
  };
  state.authUsers.push(user);
  return user;
}

/** A Pro subscriber whose paid period ended 40 days ago, cancellation recorded. */
function lapsed(extra = {}) {
  return makeUser({
    plan: 'pro_monthly',
    status: 'active',
    stripeCustomerId: 'cus_x',
    stripeSubscriptionId: 'sub_x',
    periodStart: Date.now() - 70 * DAY,
    periodEnd: Date.now() - 40 * DAY,
    cancelAtPeriodEnd: true,
    cancelAt: Date.now() - 40 * DAY,
    ...extra,
  });
}

// ── the fault itself ────────────────────────────────────────────────────────

test('a cancelled subscription past its end buys nothing: no tier, no tokens, no posting', () => {
  const user = lapsed();

  assert.equal(billing.paidTierOf(user), 'basic', 'the tier stops at the period end');
  assert.equal(billing.tierOf(user), 'basic', 'and so does feature access');
  assert.equal(billing.isPaid(user), false, 'the one paid check agrees');
  assert.equal(billing.planFeatures(user).deenai, false, 'a Pro feature is locked again');

  const shown = billing.publicBilling(user);
  assert.equal(shown.current.allowance, 0, 'the allowance is gone, not merely smaller');
  assert.equal(shown.current.remaining, 0);

  const publish = billing.canPublish(user);
  assert.equal(publish.allowed, false, 'and clips stop going out');
  assert.match(publish.reason, /subscription has ended/i);
});

test('the screen says it has ended, rather than naming the plan they cancelled', () => {
  const shown = billing.publicBilling(lapsed());
  assert.equal(shown.current.plan, 'free', 'the card no longer claims the paid plan');
  assert.equal(shown.current.planName, 'Basic');
  assert.equal(shown.current.status, 'cancelled');
  assert.equal(shown.current.cancelAtPeriodEnd, false,
    '"Ending soon" is a promise about the future; this ending has happened');
  assert.equal(shown.current.cancelAt, null);
  assert.ok(shown.current.endedAt, 'and the date it ended is carried, so the screen can say it');

  const kinds = shown.notices.map(n => n.kind);
  assert.ok(kinds.includes('subscription_ended'), 'it is stated');
  assert.equal(kinds[0], 'subscription_ended', 'and first: the adapter shows only the first blocking notice');
  assert.ok(!kinds.includes('free_ended'),
    '"your free trial has ended" is the wrong sentence for somebody whose paid period ran out');
});

test('checkout asks the ACTIVE plan, so nobody is refused the button that fixes their account', async () => {
  /*
   * WRITTEN ONCE AS A VACUOUS TEST AND CORRECTED. The first version simply
   * called createCheckoutSession and asserted the rejection was not "already
   * on" -- and with no fetch stub it never got past `liveSubscription`, so it
   * passed against the unfixed guard too. The probe caught it.
   *
   * Stripe normally makes this guard unreachable for an ended subscription:
   * `liveSubscription` keeps only active/trialing/past_due/unpaid, and an
   * ended one is `canceled`. This is the belt-and-braces case -- our record
   * says ended while Stripe still reports the subscription live -- and it is
   * pinned because "what plan is this account on" must have ONE answer
   * wherever it is asked, not an answer that depends on which function asks.
   */
  const user = lapsed();
  const realFetch = globalThis.fetch;
  const sub = {
    id: 'sub_x', status: 'active', customer: 'cus_x',
    current_period_start: Math.floor((Date.now() - 70 * DAY) / 1000),
    current_period_end: Math.floor((Date.now() - 40 * DAY) / 1000),
    cancel_at_period_end: true, cancel_at: Math.floor((Date.now() - 40 * DAY) / 1000),
    items: { data: [{ id: 'si_1', price: { id: 'price_monthly' } }] },
    metadata: { userId: user.id },
  };
  globalThis.fetch = async () => new Response(JSON.stringify(sub), { status: 200 });
  try {
    // It must not refuse. Whether it switches the plan or opens checkout is
    // Stripe's business; what matters is that the account is not told it
    // already has the thing it has just lost.
    await billing.createCheckoutSession(user, 'pro_monthly');
  } catch (error) {
    assert.doesNotMatch(error.message, /already on/i,
      'an ended subscriber is not already on the plan they are trying to buy');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── the direction that must never fire ──────────────────────────────────────

test('A STALE PERIOD END ALONE CHANGES NOTHING -- this is the one that would lock out everybody', () => {
  /*
   * The deployment's webhook secret is wrong, so a renewal that Stripe
   * processed perfectly well never reaches us and `periodEnd` simply goes
   * stale. That describes most healthy subscribers here, not an ending.
   */
  const user = makeUser({
    plan: 'pro_monthly', status: 'active',
    stripeSubscriptionId: 'sub_live',
    periodStart: Date.now() - 70 * DAY,
    periodEnd: Date.now() - 40 * DAY,
    cancelAtPeriodEnd: false,
  });
  assert.equal(billing.subscriptionEnded(user.billing).ended, false);
  assert.equal(billing.paidTierOf(user), 'pro', 'a paying customer keeps their plan');
  assert.ok(billing.publicBilling(user).current.allowance > 0, 'and their tokens');
  assert.equal(billing.canPublish(user).allowed, true, 'and their posting');
});

test('a failed payment is not an ending: Stripe retries those for weeks', () => {
  for (const status of ['past_due', 'unpaid']) {
    const user = makeUser({
      plan: 'pro_monthly', status,
      periodEnd: Date.now() - 10 * DAY,
      cancelAtPeriodEnd: false,
    });
    assert.equal(billing.subscriptionEnded(user.billing).ended, false, status);
    assert.equal(billing.paidTierOf(user), 'pro', `${status} keeps working while Stripe retries`);
  }
});

test('a cancellation that has not arrived yet is untouched -- the period is paid for', () => {
  const user = makeUser({
    plan: 'pro_monthly', status: 'active',
    periodStart: Date.now() - 18 * DAY,
    periodEnd: Date.now() + 12 * DAY,
    cancelAtPeriodEnd: true,
    cancelAt: Date.now() + 12 * DAY,
  });
  assert.equal(billing.subscriptionEnded(user.billing).ended, false);
  assert.equal(billing.paidTierOf(user), 'pro', 'everything keeps working until the day arrives');
  const shown = billing.publicBilling(user);
  assert.equal(shown.current.cancelAtPeriodEnd, true, 'and it still reads as winding down');
  assert.ok(shown.current.remaining > 0);
  assert.ok(!shown.notices.some(n => n.kind === 'subscription_ended'));
});

test('the operator is never cut off by this', () => {
  const owner = makeUser(
    { plan: 'pro_monthly', status: 'canceled', periodEnd: Date.now() - 40 * DAY, cancelAtPeriodEnd: true, cancelAt: Date.now() - 40 * DAY },
    { role: 'owner' },
  );
  assert.equal(billing.tierOf(owner), 'studio');
  assert.equal(billing.canPublish(owner).allowed, true);
  const shown = billing.publicBilling(owner);
  assert.ok(shown.current.unlimited, 'the owner is unlimited whatever the billing row says');
  assert.ok(!shown.notices.some(n => n.kind === 'subscription_ended'),
    'and is never told their own product has cut them off');
});

test('a running access code outranks the ending, because it genuinely gives access', () => {
  const user = lapsed({
    grant: { tier: 'pro', tokens: 650, endsAt: Date.now() + 9 * DAY, startedAt: Date.now() - 5 * DAY, code: 'DEEN-TEST' },
  });
  assert.equal(billing.tierOf(user), 'pro', 'the code raises the tier on its own');
  const shown = billing.publicBilling(user);
  assert.ok(shown.current.allowance >= 650, 'and carries its own allowance');
  assert.equal(billing.canPublish(user).allowed, true,
    'blocking somebody a code is actively paying for would stop them working for no reason');
  assert.ok(!shown.notices.some(n => n.kind === 'subscription_ended'));
});

test('a terminal Stripe status ends it even with no date to compare', () => {
  // `customer.subscription.updated` carrying status `canceled` leaves the plan
  // set and no usable end instant -- and that status cannot describe anybody
  // who is still paying.
  const user = makeUser({ plan: 'pro_monthly', status: 'canceled', periodEnd: null, cancelAtPeriodEnd: false });
  assert.equal(billing.subscriptionEnded(user.billing).ended, true);
  assert.equal(billing.paidTierOf(user), 'basic');
});

test('an account that never subscribed is unaffected, and reads as the free account it is', () => {
  const user = makeUser({ plan: 'free', status: 'free' });
  assert.equal(billing.subscriptionEnded(user.billing).ended, false);
  const kinds = billing.publicBilling(user).notices.map(n => n.kind);
  assert.ok(!kinds.includes('subscription_ended'), 'there is no subscription to have ended');
});

test('bought top-up tokens survive the ending', () => {
  // They were paid for separately and outright. Taking them with the
  // subscription would be keeping money for nothing.
  const user = lapsed({ bonusTokens: 120 });
  const shown = billing.publicBilling(user);
  assert.equal(shown.current.allowance, 0, 'the plan is gone');
  assert.equal(shown.current.bonusTokens, 120, 'the tokens they bought are not');
  assert.equal(shown.current.remaining, 120, 'and are still spendable');
});

test('the local reading never writes -- Stripe stays the authority', () => {
  /*
   * If this wrote the account to free, a webhook arriving late (or Stripe
   * being asked directly) could never correct it. Read-only means a wrong
   * reading heals itself; a wrong write is permanent.
   */
  const user = lapsed();
  billing.publicBilling(user);
  billing.canPublish(user);
  billing.tierOf(user);
  assert.equal(user.billing.plan, 'pro_monthly', 'the stored plan is untouched');
  assert.equal(user.billing.status, 'active');
  assert.equal(user.billing.cancelAtPeriodEnd, true);
});
