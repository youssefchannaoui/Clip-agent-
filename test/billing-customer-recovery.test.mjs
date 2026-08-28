import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The day the test key became the live key, every account still carried a
// `cus_...` that only existed in test mode. Live Stripe answered "No such
// customer", checkout returned 400, and nobody could pay -- the error naming
// an id no customer has ever seen. These pin the recovery.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-cus-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'customer-recovery-test-secret-long';
process.env.STRIPE_SECRET_KEY = 'sk_live_testdouble';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly_live';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

// Intercept at the network, so these also prove the calls are shaped the way
// Stripe's API actually takes them.
const calls = [];
const realFetch = globalThis.fetch;
let liveCustomers = new Set();
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const method = options.method || 'GET';
  calls.push(`${method} ${href.replace('https://api.stripe.com/v1', '')}`);

  const readCustomer = href.match(/\/v1\/customers\/(cus_[^/?]+)$/);
  if (method === 'GET' && readCustomer) {
    const id = readCustomer[1];
    if (!liveCustomers.has(id)) {
      return new Response(JSON.stringify({ error: { code: 'resource_missing', message: `No such customer: '${id}'` } }), { status: 404 });
    }
    return new Response(JSON.stringify({ id }), { status: 200 });
  }
  if (method === 'POST' && href.endsWith('/v1/customers')) {
    const id = `cus_fresh${calls.length}`;
    liveCustomers.add(id);
    return new Response(JSON.stringify({ id }), { status: 200 });
  }
  if (method === 'POST' && href.endsWith('/v1/checkout/sessions')) {
    const params = new URLSearchParams(options.body);
    return new Response(JSON.stringify({ id: 'cs_test', url: 'https://checkout.stripe.com/c/pay/cs_test', customer: params.get('customer') }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

function makeUser(id, billingFields = {}) {
  const user = {
    id, email: `${id}@test`, name: id, role: 'creator', providers: {}, createdAt: Date.now(),
    billing: { plan: 'free', status: 'free', ...billingFields },
  };
  state.authUsers.push(user);
  return user;
}

test('a stored customer that Stripe no longer knows is replaced, not reported', async () => {
  const user = makeUser('stale-customer', { stripeCustomerId: 'cus_fromTestMode' });
  const session = await billing.createCheckoutSession(user, 'monthly');
  assert.equal(session.url, 'https://checkout.stripe.com/c/pay/cs_test',
    'checkout must succeed rather than throwing "No such customer"');
  assert.notEqual(user.billing.stripeCustomerId, 'cus_fromTestMode', 'the dead id must not be kept');
  assert.match(user.billing.stripeCustomerId, /^cus_fresh/);
});

test('the subscription pointer does not outlive the customer it belonged to', async () => {
  const user = makeUser('stale-subscription', {
    stripeCustomerId: 'cus_alsoGone', stripeSubscriptionId: 'sub_gone', stripePriceId: 'price_gone',
  });
  await billing.createCheckoutSession(user, 'monthly');
  assert.equal(user.billing.stripeSubscriptionId, '', 'a subscription under a dead customer is unreachable');
  assert.equal(user.billing.stripePriceId, '');
});

test('a customer that does exist is reused, and costs exactly one extra read', async () => {
  const user = makeUser('good-customer');
  await billing.createCheckoutSession(user, 'monthly');
  const issued = user.billing.stripeCustomerId;
  calls.length = 0;
  await billing.createCheckoutSession(user, 'monthly');
  assert.equal(user.billing.stripeCustomerId, issued, 'a live customer must not be churned');
  assert.deepEqual(calls, [`GET /customers/${issued}`, 'POST /checkout/sessions'],
    'the check is one GET; no customer is created when the stored one is real');
});
