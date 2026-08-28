import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Checkout only ever creates. A customer moving from weekly to monthly got a
// SECOND subscription while the first kept billing, and the app overwrote the
// stored id so only the newer one was visible here -- two charges a month, one
// of them invisible. And the trial was re-applied every time, so cancelling and
// re-subscribing minted another free week on every lap.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-switch-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'plan-switch-test-secret-long-enough';
process.env.STRIPE_SECRET_KEY = 'sk_live_testdouble';
process.env.STRIPE_PRICE_WEEKLY = 'price_weekly';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
process.env.STRIPE_TRIAL_DAYS = '3';
process.env.TOKENS_TRIAL = '40';
process.env.TOKENS_FREE = '40';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

const DAY = 24 * 60 * 60 * 1000;
const calls = [];
const realFetch = globalThis.fetch;
let liveSubs = new Map();

globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const method = options.method || 'GET';
  const body = new URLSearchParams(options.body || '');
  calls.push(`${method} ${href.replace('https://api.stripe.com/v1', '')}`);

  const readSub = href.match(/\/v1\/subscriptions\/(sub_[^/?]+)$/);
  if (readSub && method === 'GET') {
    const sub = liveSubs.get(readSub[1]);
    if (!sub) return new Response(JSON.stringify({ error: { message: 'No such subscription' } }), { status: 404 });
    return new Response(JSON.stringify(sub), { status: 200 });
  }
  if (readSub && method === 'POST') {
    const sub = liveSubs.get(readSub[1]);
    sub.items.data[0].price.id = body.get('items[0][price]');
    return new Response(JSON.stringify(sub), { status: 200 });
  }
  if (href.endsWith('/v1/customers') && method === 'POST') {
    return new Response(JSON.stringify({ id: 'cus_live1' }), { status: 200 });
  }
  if (href.match(/\/v1\/customers\/cus_/)) {
    return new Response(JSON.stringify({ id: 'cus_live1' }), { status: 200 });
  }
  if (href.endsWith('/v1/checkout/sessions')) {
    return new Response(JSON.stringify({
      id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1',
      trialDays: body.get('subscription_data[trial_period_days]') || '',
    }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

test.after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function makeUser(id, billingFields = {}, createdAt = Date.now()) {
  const user = {
    id, email: `${id}@test`, name: id, role: 'creator', providers: {}, createdAt,
    billing: { plan: 'free', status: 'free', ...billingFields },
  };
  state.authUsers.push(user);
  return user;
}

function liveSub(id, priceId, status = 'active') {
  liveSubs.set(id, {
    id, status, customer: 'cus_live1',
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor((Date.now() + 30 * DAY) / 1000),
    items: { data: [{ id: 'si_1', price: { id: priceId } }] },
  });
}

test('an existing subscriber is moved, never sold a second subscription', async () => {
  liveSub('sub_existing', 'price_weekly');
  const user = makeUser('switcher', {
    plan: 'weekly', status: 'active',
    stripeCustomerId: 'cus_live1', stripeSubscriptionId: 'sub_existing',
  });
  calls.length = 0;
  const result = await billing.createCheckoutSession(user, 'monthly');

  assert.equal(result.switched, true, 'the plan must be switched in place');
  assert.ok(!result.url, 'no checkout page — that is what created the duplicate');
  assert.ok(!calls.some(c => c.includes('/checkout/sessions')),
    `no checkout session may be created; calls were ${JSON.stringify(calls)}`);
  assert.ok(calls.includes('POST /subscriptions/sub_existing'), 'the existing subscription is edited');
  assert.equal(liveSubs.size, 1, 'exactly one subscription may exist for this account');
  assert.equal(user.billing.plan, 'monthly');
  assert.equal(user.billing.stripeSubscriptionId, 'sub_existing', 'still the same subscription');
});

test('switching prorates rather than charging the full price again', async () => {
  liveSub('sub_prorate', 'price_weekly');
  const user = makeUser('prorater', {
    plan: 'weekly', status: 'active',
    stripeCustomerId: 'cus_live1', stripeSubscriptionId: 'sub_prorate',
  });
  let seen = null;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/subscriptions/sub_prorate') && (options.method === 'POST')) {
      seen = new URLSearchParams(options.body).get('proration_behavior');
    }
    return prev(url, options);
  };
  await billing.createCheckoutSession(user, 'monthly');
  globalThis.fetch = prev;
  assert.equal(seen, 'create_prorations');
});

test('a dead subscription id does not block a genuine new subscription', async () => {
  const user = makeUser('stale-sub', {
    plan: 'free', status: 'cancelled',
    stripeCustomerId: 'cus_live1', stripeSubscriptionId: 'sub_longGone',
  });
  const result = await billing.createCheckoutSession(user, 'monthly');
  assert.ok(result.url, 'a cancelled subscriber must be able to buy again');
});

test('picking the plan you are already on is refused, not double-sold', async () => {
  liveSub('sub_same', 'price_monthly');
  const user = makeUser('same-plan', {
    plan: 'monthly', status: 'active',
    stripeCustomerId: 'cus_live1', stripeSubscriptionId: 'sub_same',
  });
  await assert.rejects(() => billing.createCheckoutSession(user, 'monthly'), /already on Monthly/);
});

test('the free trial is granted once per account, ever', async () => {
  const fresh = makeUser('first-timer');
  const first = await billing.createCheckoutSession(fresh, 'monthly');
  assert.ok(first.url);

  const returning = makeUser('been-here-before', {
    plan: 'free', status: 'cancelled',
    trialStart: Date.now() - 30 * DAY, trialEnd: Date.now() - 27 * DAY,
  });
  let trialDays = null;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/v1/checkout/sessions')) {
      trialDays = new URLSearchParams(options.body).get('subscription_data[trial_period_days]');
    }
    return prev(url, options);
  };
  await billing.createCheckoutSession(returning, 'monthly');
  globalThis.fetch = prev;
  assert.equal(trialDays, null, 'someone who already had a trial must not get another one');
});
