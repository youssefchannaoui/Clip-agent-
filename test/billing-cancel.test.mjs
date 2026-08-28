import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Cancelling is cancel-at-period-end, never an immediate cut: the period is
// paid for, so access runs to its end and Stripe flips the account to free by
// webhook when that day comes. What these tests pin is the half the app used
// to lose entirely -- a pending cancellation was invisible, so a customer who
// cancelled saw "Current plan" with no end date and concluded it had failed.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-cancel-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'billing-cancel-test-secret-long-enough';
process.env.STRIPE_SECRET_KEY = 'sk_live_testdouble';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

const DAY = 24 * 60 * 60 * 1000;
const calls = [];
const realFetch = globalThis.fetch;
const liveSubs = new Map();

globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const method = options.method || 'GET';
  const body = new URLSearchParams(options.body || '');
  calls.push(`${method} ${href.replace('https://api.stripe.com/v1', '')}`);

  const subMatch = href.match(/\/v1\/subscriptions\/(sub_[^/?]+)$/);
  if (subMatch && method === 'POST') {
    const sub = liveSubs.get(subMatch[1]);
    if (!sub) return new Response(JSON.stringify({ error: { message: 'No such subscription' } }), { status: 404 });
    if (body.has('cancel_at_period_end')) {
      // Stripe reflects the flag back and, when set, stamps cancel_at with the
      // period end. The double mirrors that so the code reads the response,
      // not its own argument.
      sub.cancel_at_period_end = body.get('cancel_at_period_end') === 'true';
      sub.cancel_at = sub.cancel_at_period_end ? sub.current_period_end : null;
    }
    return new Response(JSON.stringify(sub), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

test.after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeUser(id, billingFields = {}) {
  const user = {
    id, email: `${id}@test`, name: id, role: 'creator', providers: {}, createdAt: Date.now(),
    billing: { plan: 'free', status: 'free', ...billingFields },
  };
  state.authUsers.push(user);
  return user;
}

function liveSub(id) {
  liveSubs.set(id, {
    id, status: 'active', customer: 'cus_c1',
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor((Date.now() + 12 * DAY) / 1000),
    cancel_at_period_end: false, cancel_at: null,
    items: { data: [{ id: 'si_1', price: { id: 'price_monthly' } }] },
    metadata: {},
  });
  return liveSubs.get(id);
}

test('cancelling winds down at period end and the account stays fully usable until then', async () => {
  liveSub('sub_c1');
  const user = makeUser('canceller', {
    plan: 'monthly', status: 'active', tokensUsed: 213,
    stripeCustomerId: 'cus_c1', stripeSubscriptionId: 'sub_c1',
    periodStart: Date.now() - 18 * DAY, periodEnd: Date.now() + 12 * DAY,
  });

  calls.length = 0;
  const result = await billing.setCancelAtPeriodEnd(user, true);

  assert.ok(calls.includes('POST /subscriptions/sub_c1'), 'the cancellation goes to Stripe');
  assert.equal(result.cancelAtPeriodEnd, true);
  assert.ok(result.cancelAt > Date.now(), 'access ends in the future, not today');

  // The half that matters: nothing about the plan is degraded today.
  assert.equal(user.billing.plan, 'monthly', 'still on the paid plan');
  assert.equal(user.billing.status, 'active', 'still active');
  const shown = billing.publicBilling(user);
  assert.equal(shown.current.cancelAtPeriodEnd, true, 'the screen is told it is winding down');
  assert.ok(shown.current.cancelAt > Date.now(), 'with the date access actually stops');
  assert.ok(shown.current.remaining > 0, 'the period\'s tokens are still spendable');
});

test('resuming before the end takes the cancellation back', async () => {
  const user = state.authUsers.find(item => item.id === 'canceller');
  const result = await billing.setCancelAtPeriodEnd(user, false);
  assert.equal(result.cancelAtPeriodEnd, false);
  assert.equal(result.cancelAt, null);
  const shown = billing.publicBilling(user);
  assert.equal(shown.current.cancelAtPeriodEnd, false);
  assert.equal(shown.current.cancelAt, null, 'no phantom end date lingers after a resume');
});

test('an account with no subscription gets a plain refusal, not a Stripe call', async () => {
  const user = makeUser('freeloader', { plan: 'free', status: 'free' });
  calls.length = 0;
  await assert.rejects(() => billing.setCancelAtPeriodEnd(user, true), /no active subscription/i);
  assert.equal(calls.length, 0, 'nothing was sent to Stripe');
});

test('a cancellation made in the Stripe portal reaches the screen through the webhook', async () => {
  // The portal never touches our endpoint -- Stripe just sends
  // customer.subscription.updated with cancel_at_period_end set. Losing this
  // was the original bug: the app stored nothing, so the customer saw nothing.
  const sub = liveSub('sub_portal');
  const user = makeUser('portal-user', {
    plan: 'monthly', status: 'active',
    stripeCustomerId: 'cus_c1', stripeSubscriptionId: 'sub_portal',
  });
  sub.cancel_at_period_end = true;
  sub.cancel_at = sub.current_period_end;
  sub.metadata = { userId: user.id };

  billing.handleWebhookEvent({ id: 'evt_cancel_1', type: 'customer.subscription.updated', data: { object: sub } });

  const shown = billing.publicBilling(user);
  assert.equal(shown.current.cancelAtPeriodEnd, true);
  assert.ok(shown.current.cancelAt, 'the end date came from the webhook');

  // And the wind-down completing clears the pending state with it.
  billing.handleWebhookEvent({ id: 'evt_cancel_2', type: 'customer.subscription.deleted', data: { object: sub } });
  const after = billing.publicBilling(user);
  assert.equal(user.billing.plan, 'free', 'the account is free once the period actually ends');
  assert.equal(after.current.cancelAtPeriodEnd, false, 'nothing still claims to be winding down');
  assert.equal(after.current.cancelAt, null);
});
