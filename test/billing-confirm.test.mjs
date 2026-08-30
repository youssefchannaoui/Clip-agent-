import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Confirming a purchase on the way back from Stripe.
 *
 * Until this existed the webhook was not a safety net, it was the only net: a
 * plan was granted by `checkout.session.completed` and made real by
 * `customer.subscription.*`. A signing secret that does not match -- which is
 * exactly what has been alerting on the live deployment -- therefore meant a
 * customer paid Stripe successfully and their account stayed on free.
 *
 * These tests run the confirm path with NO webhook at all, which is the
 * scenario that matters, and then run the webhook afterwards to prove the two
 * nets cannot both grant.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-confirm-'));
process.env.AUTH_REQUIRED = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_test_deenclipped';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_deenclipped';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
process.env.STRIPE_PRICE_TOPUP_100 = 'price_topup_100';
// Set before anything imports config.js, which reads the port once at import.
const port = 38200 + Math.floor(Math.random() * 300);
process.env.PORT = String(port);

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

const buyer = {
  id: 'confirm-buyer', email: 'buyer@deenclipped.test', role: 'creator', createdAt: Date.now(),
  billing: { plan: 'free', status: 'free', tokensUsed: 0, tokensReserved: 0, bonusTokens: 0, stripeCustomerId: 'cus_buyer' },
};
const stranger = {
  id: 'confirm-stranger', email: 'stranger@deenclipped.test', role: 'creator', createdAt: Date.now(),
  billing: { plan: 'free', status: 'free', tokensUsed: 0, tokensReserved: 0, bonusTokens: 0, stripeCustomerId: 'cus_stranger' },
};
state.authUsers = [buyer, stranger];
state.billingEvents = [];
state.processedStripeEvents = [];
state.revenueEvents = [];

// Every Stripe read the code makes is answered from here, so a test can put the
// account in the state a real purchase would have left it in without a network.
const realFetch = globalThis.fetch;
let sessions = {};
let stripeCalls = [];
globalThis.fetch = async (url, options) => {
  const href = String(url);
  if (!href.startsWith('https://api.stripe.com/')) return realFetch(url, options);
  stripeCalls.push(href);
  const id = href.split('/checkout/sessions/')[1]?.split('?')[0];
  const session = sessions[decodeURIComponent(id || '')];
  if (!session) return new Response(JSON.stringify({ error: { message: 'No such checkout session' } }), { status: 404 });
  return new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

/* The route, over a real socket. A function tested in isolation says nothing
   about whether anything reaches it -- that mistake is written into CLAUDE.md
   twice, once for a rate limiter and once for a schedule parameter.

   This block sits ABOVE every test() on purpose. With top-level await, the
   runner starts the tests already registered at the module's FIRST yield, so a
   server imported below them comes up, the earlier tests run, the file's
   after-hook fires and closes it -- and the route test then fails with a bare
   "fetch failed" against a socket that was open moments earlier. */
const { server } = await import('../src/server.js');
test.after(() => new Promise(resolve => server.close(() => resolve())));
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await realFetch(`http://127.0.0.1:${port}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

const seconds = ms => Math.floor(ms / 1000);

function subscriptionSession(over = {}) {
  const startedAt = Date.now();
  return {
    id: 'cs_sub_live', object: 'checkout.session', mode: 'subscription', status: 'complete',
    payment_status: 'paid', customer: 'cus_buyer', currency: 'aud', amount_total: 2999,
    metadata: { userId: buyer.id, plan: 'pro_monthly' },
    subscription: {
      id: 'sub_live', status: 'active', customer: 'cus_buyer',
      current_period_start: seconds(startedAt), current_period_end: seconds(startedAt + 30 * 86400000),
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_monthly' } }] },
      metadata: { userId: buyer.id, plan: 'pro_monthly' },
    },
    ...over,
  };
}

function topupSession(over = {}) {
  return {
    id: 'cs_top_live', object: 'checkout.session', mode: 'payment', status: 'complete',
    payment_status: 'paid', customer: 'cus_buyer', currency: 'aud', amount_total: 1500,
    metadata: { userId: buyer.id, kind: 'token_topup', package: 'boost100' },
    line_items: { data: [{ price: { id: 'price_topup_100' } }] },
    ...over,
  };
}

test('a subscription lands with no webhook at all', async () => {
  sessions = { cs_sub_live: subscriptionSession() };
  assert.equal(buyer.billing.plan, 'free', 'precondition: the account has not been granted anything');

  const result = await billing.confirmCheckoutSession(buyer, 'cs_sub_live');

  assert.equal(result.applied, true);
  assert.equal(result.kind, 'subscription');
  assert.equal(buyer.billing.plan, 'pro_monthly', 'the plan is on');
  assert.equal(buyer.billing.status, 'active', 'and it is ACTIVE, not a half-state waiting on a webhook');
  assert.equal(buyer.billing.stripeSubscriptionId, 'sub_live');
  assert.ok(buyer.billing.periodEnd > Date.now(), 'the period came from Stripe, not from a guess');
  assert.equal(state.processedStripeEvents.length, 0, 'no webhook was involved in any of that');
});

test('a session belonging to someone else is refused', async () => {
  sessions = { cs_sub_live: subscriptionSession() };
  await assert.rejects(
    () => billing.confirmCheckoutSession(stranger, 'cs_sub_live'),
    /different account/,
    'a session id is a bearer token if the owner is not checked, and it travels in a URL',
  );
  assert.equal(stranger.billing.plan, 'free', 'nothing was granted to the wrong account');
});

test('a malformed session id never reaches Stripe', async () => {
  stripeCalls = [];
  await assert.rejects(() => billing.confirmCheckoutSession(buyer, '../subscriptions/sub_live'), /not a Checkout session/);
  await assert.rejects(() => billing.confirmCheckoutSession(buyer, ''), /not a Checkout session/);
  assert.deepEqual(stripeCalls, [], 'the shape is checked before the network call is spent');
});

test('an incomplete session applies nothing', async () => {
  sessions = { cs_sub_live: subscriptionSession({ status: 'open', payment_status: 'unpaid' }) };
  const before = { ...stranger.billing };
  const result = await billing.confirmCheckoutSession(buyer, 'cs_sub_live');
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'incomplete');
  assert.equal(stranger.billing.plan, before.plan);
});

test('a trial subscription is applied even though nothing was charged', async () => {
  // no_payment_required is what a trial checkout returns. Refusing anything but
  // 'paid' here would strand every trial that started while the webhook was down.
  const trial = subscriptionSession({ id: 'cs_trial_start', payment_status: 'no_payment_required' });
  trial.subscription = { ...trial.subscription, id: 'sub_trial', status: 'trialing' };
  sessions = { cs_trial_start: trial };

  const result = await billing.confirmCheckoutSession(buyer, 'cs_trial_start');
  assert.equal(result.applied, true);
  assert.equal(buyer.billing.status, 'trialing');
});

test('a top-up grants once however many times the page is reloaded', async () => {
  sessions = { cs_top_live: topupSession() };
  buyer.billing.bonusTokens = 0;

  const first = await billing.confirmCheckoutSession(buyer, 'cs_top_live');
  assert.equal(first.applied, true);
  assert.equal(first.granted, 100);
  assert.equal(buyer.billing.bonusTokens, 100);

  const second = await billing.confirmCheckoutSession(buyer, 'cs_top_live');
  assert.equal(second.duplicate, true, 'a refresh of the success page is not a second purchase');
  assert.equal(buyer.billing.bonusTokens, 100);
});

test('a webhook arriving after a confirm does not grant a second time', async () => {
  // The whole design rests on this: both nets converge on grantTopup, which
  // dedupes on the session id, and recordRevenue, which dedupes on the Stripe
  // object id. If that were not true, fixing the signing secret would double
  // every purchase made while it was broken.
  assert.equal(buyer.billing.bonusTokens, 100, 'precondition: the confirm above granted');
  const revenueBefore = state.revenueEvents.length;

  billing.handleWebhookEvent({
    id: 'evt_late_delivery', type: 'checkout.session.completed',
    data: { object: { ...topupSession(), payment_intent: 'pi_top_live' } },
  });

  assert.equal(buyer.billing.bonusTokens, 100, 'the late webhook must not add the tokens again');
  assert.equal(state.revenueEvents.length, revenueBefore, 'nor count the money twice');
});

test('the money is recorded once, by whichever net got there first', () => {
  const forSession = state.revenueEvents.filter(row => row.stripeId === 'cs_top_live');
  assert.equal(forSession.length, 1);
  assert.equal(forSession[0].amountMinor, 1500);
  assert.equal(forSession[0].userId, buyer.id);
});

test('the confirm route exists and refuses a signed-out caller', async () => {
  const res = await realFetch(`http://127.0.0.1:${port}/api/billing/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'cs_sub_live' }),
  });
  assert.equal(res.status, 401, 'a session id in a URL must not be spendable by a stranger');
});
