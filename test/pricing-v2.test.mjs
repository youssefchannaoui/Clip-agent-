import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-pricing-'));
process.env.AUTH_REQUIRED = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_test_deenclipped';
process.env.STRIPE_PRICE_WEEKLY = 'price_weekly';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
process.env.STRIPE_PRICE_YEARLY = 'price_yearly';
process.env.STRIPE_COUPON_MONTHLY = 'LAUNCH500';
process.env.PLAN_PRICE_WEEKLY_LABEL = 'A$9.99 / week';
process.env.PLAN_PRICE_MONTHLY_LABEL = 'A$29.99';
process.env.PLAN_PRICE_MONTHLY_LIST_LABEL = 'A$34.99';
process.env.PLAN_PRICE_YEARLY_LABEL = 'A$249';
process.env.FREE_TIER_DAYS = '3';
process.env.STRIPE_TRIAL_DAYS = '7';

const billing = await import('../src/billing.js');
const { config } = await import('../src/config.js');
const { state } = await import('../src/store.js');

const DAY = 24 * 60 * 60 * 1000;

function makeUser(id, overrides = {}) {
  return {
    id,
    email: `${id}@deenclipped.test`,
    role: 'creator',
    createdAt: Date.now(),
    billing: {
      plan: 'free', status: 'free', tokensUsed: 0, tokensReserved: 0,
      bonusTokens: 0, ...overrides,
    },
  };
}

test('allowances match the Stripe product descriptions', () => {
  const p = billing.plans();
  assert.equal(p.weekly.tokens, 75);
  assert.equal(p.monthly.tokens, 400);
  assert.equal(p.yearly.tokens, 4800);
  assert.equal(p.free.tokens, 40);
});

test('top-ups price above the monthly plan rate', () => {
  // The leak this closes: Creator boost used to cost less per token than the
  // subscription, so upgrading was never the rational move.
  const monthlyRate = 29.99 / billing.plans().monthly.tokens;
  const packs = billing.topups();
  const rate = (label, tokens) => Number(String(label).replace(/[^\d.]/g, '')) / tokens;
  for (const pack of Object.values(packs)) {
    const packRate = rate(pack.priceLabel, pack.tokens);
    assert.ok(
      packRate > monthlyRate,
      `${pack.name} at ${packRate.toFixed(4)}/token undercuts the monthly plan at ${monthlyRate.toFixed(4)}`,
    );
  }
});

test('trials apply to monthly and yearly but never weekly', () => {
  // A 7-day trial on a 7-day billing cycle makes the whole first period free.
  assert.equal(billing.trialAllowed('weekly'), false);
  assert.equal(billing.trialAllowed('monthly'), true);
  assert.equal(billing.trialAllowed('yearly'), true);
  assert.equal(billing.plans().weekly.trialEligible, false);
  assert.equal(billing.plans().monthly.trialEligible, true);
});

test('trialAllowed is false everywhere when trial days are zero', () => {
  const original = config.stripeTrialDays;
  config.stripeTrialDays = 0;
  try {
    assert.equal(billing.trialAllowed('monthly'), false);
    assert.equal(billing.trialAllowed('yearly'), false);
  } finally {
    config.stripeTrialDays = original;
  }
});

test('free accounts get a 3-day expiry stamped at creation', () => {
  const user = makeUser('free-fresh');
  state.authUsers = [user];
  const bill = billing.ensureUserBilling(user);
  assert.ok(bill.freeExpiresAt, 'freeExpiresAt should be set');
  const days = Math.round((bill.freeExpiresAt - bill.periodStart) / DAY);
  assert.equal(days, 3);
});

test('the expiry is stamped once and never extended', () => {
  const user = makeUser('free-stable');
  state.authUsers = [user];
  const first = billing.ensureUserBilling(user).freeExpiresAt;
  billing.ensureUserBilling(user);
  billing.ensureUserBilling(user);
  assert.equal(billing.ensureUserBilling(user).freeExpiresAt, first);
});

test('an expired free account is blocked even with tokens left', () => {
  // The whole point of the gate: unspent tokens must not buy extra days.
  const user = makeUser('free-expired', {
    periodStart: Date.now() - 10 * DAY,
    freeExpiresAt: Date.now() - 7 * DAY,
  });
  state.authUsers = [user];

  const info = billing.publicBilling(user);
  assert.ok(info.current.remaining > 0, 'should still show unspent tokens');
  assert.equal(info.current.freeTier.expired, true);

  assert.throws(
    () => billing.assertCanSpend(user, 1, 'start a job'),
    err => err.code === 'free_expired' && err.name === 'BillingError',
  );
});

test('a free account inside the window can still spend', () => {
  const user = makeUser('free-active', {
    periodStart: Date.now() - 1 * DAY,
    freeExpiresAt: Date.now() + 2 * DAY,
  });
  state.authUsers = [user];
  assert.equal(billing.assertCanSpend(user, 5, 'start a job'), true);
});

test('running out of tokens raises a structured refusal, not a bare Error', () => {
  const user = makeUser('broke', {
    plan: 'monthly', status: 'active',
    tokensUsed: 398, periodStart: Date.now(), periodEnd: Date.now() + 30 * DAY,
  });
  state.authUsers = [user];
  assert.throws(
    () => billing.assertCanSpend(user, 50, 'render clips'),
    err => err.code === 'insufficient_tokens'
      && err.needed === 50
      && err.remaining === 2
      && err.shortfall === 48,
  );
});

test('paid plans are not subject to the free expiry gate', () => {
  const user = makeUser('paid', {
    plan: 'monthly', status: 'active',
    freeExpiresAt: Date.now() - 30 * DAY,
    periodStart: Date.now(), periodEnd: Date.now() + 30 * DAY,
  });
  state.authUsers = [user];
  assert.equal(billing.assertCanSpend(user, 10, 'render clips'), true);
});

test('owners and admins bypass every gate', () => {
  const owner = { ...makeUser('owner'), role: 'owner' };
  owner.billing.freeExpiresAt = Date.now() - 90 * DAY;
  state.authUsers = [owner];
  assert.equal(billing.assertCanSpend(owner, 100000, 'render clips'), true);
});

test('the plans page renders each period suffix exactly once', () => {
  const user = makeUser('viewer');
  state.authUsers = [user];
  const html = billing.plansPage(user, {});
  // Regression: the label carried '/ week' and the template appended another,
  // producing 'A$9.99 / week / week'.
  assert.ok(!/\/\s*week\s*<\/small>\s*<\/div>[\s\S]{0,40}\/\s*week/.test(html));
  assert.equal((html.match(/A\$9\.99/g) || []).length, 1);
  assert.ok(!html.includes('week / week'));
  assert.ok(!html.includes('month / month'));
});

test('the monthly card shows the struck-through list price', () => {
  const user = makeUser('viewer2');
  state.authUsers = [user];
  const html = billing.plansPage(user, {});
  assert.ok(html.includes('<s>A$34.99</s>'), 'expected A$34.99 strikethrough');
  assert.ok(html.includes('A$29.99'), 'expected the real A$29.99 price');
});

test('weekly offers Subscribe while monthly offers the trial', () => {
  const user = makeUser('viewer3');
  state.authUsers = [user];
  const html = billing.plansPage(user, {});
  const weeklyCard = html.slice(html.indexOf('>Weekly<'), html.indexOf('>Monthly<'));
  assert.ok(weeklyCard.includes('Subscribe'), 'weekly should say Subscribe');
  assert.ok(!weeklyCard.includes('7-day trial'), 'weekly must not advertise a trial');
  assert.ok(html.includes('Start 7-day trial'), 'monthly/yearly should offer the trial');
});

test('the monthly card carries one badge, not two', () => {
  const user = makeUser('viewer4');
  state.authUsers = [user];
  const html = billing.plansPage(user, {});
  assert.equal((html.match(/Most popular/g) || []).length, 1, 'only the top-up pack keeps "Most popular"');
});

test('cards show a per-minute rate', () => {
  const user = makeUser('viewer5');
  state.authUsers = [user];
  const html = billing.plansPage(user, {});
  // A$29.99 / 400 tokens = 7.5c
  assert.ok(html.includes('7.5c per source minute'), 'monthly per-minute rate missing');
});

test('the free card states the expiry window', () => {
  const user = makeUser('viewer6');
  state.authUsers = [user];
  const html = billing.plansPage(user, {});
  assert.ok(html.includes('Expires 3 days after signup'));
});

// The highest-risk change in this patch. If the coupon is not attached
// server-side, Stripe bills the A$34.99 list price and the customer pays A$5
// more than the page advertised — with no error anywhere to notice it by.
async function captureCheckout(planId, user) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const params = new URLSearchParams(options.body);
    calls.push({ url: String(url), params });
    return {
      ok: true,
      json: async () => (String(url).includes('/customers')
        ? { id: 'cus_test' }
        : { id: 'cs_test', url: 'https://checkout.stripe.test/cs_test' }),
    };
  };
  try {
    await billing.createCheckoutSession(user, planId);
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls.find(call => call.url.includes('/checkout/sessions'));
}

test('monthly checkout attaches the coupon and drops promo codes', async () => {
  const user = makeUser('checkout-monthly', { stripeCustomerId: 'cus_test' });
  state.authUsers = [user];
  const call = await captureCheckout('monthly', user);

  assert.equal(call.params.get('line_items[0][price]'), 'price_monthly');
  assert.equal(call.params.get('discounts[0][coupon]'), 'LAUNCH500');
  // Stripe rejects a session carrying both.
  assert.equal(call.params.get('allow_promotion_codes'), null);
  assert.equal(call.params.get('subscription_data[trial_period_days]'), '7');
});

test('weekly checkout sends no trial period', async () => {
  const user = makeUser('checkout-weekly', { stripeCustomerId: 'cus_test' });
  state.authUsers = [user];
  const call = await captureCheckout('weekly', user);

  assert.equal(call.params.get('subscription_data[trial_period_days]'), null,
    'a 7-day trial on a 7-day cycle would make the first period free');
  assert.equal(call.params.get('discounts[0][coupon]'), null);
  assert.equal(call.params.get('allow_promotion_codes'), 'true');
});

test('yearly checkout keeps the trial and allows promo codes', async () => {
  const user = makeUser('checkout-yearly', { stripeCustomerId: 'cus_test' });
  state.authUsers = [user];
  const call = await captureCheckout('yearly', user);

  assert.equal(call.params.get('subscription_data[trial_period_days]'), '7');
  assert.equal(call.params.get('allow_promotion_codes'), 'true');
});

test('publicBilling warns before and after the free window closes', () => {
  const ending = makeUser('ending', { freeExpiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  state.authUsers = [ending];
  assert.ok(billing.publicBilling(ending).notices.some(n => n.kind === 'free_ending'));

  const expired = makeUser('expired2', { freeExpiresAt: Date.now() - DAY });
  state.authUsers = [expired];
  assert.ok(billing.publicBilling(expired).notices.some(n => n.kind === 'free_expired'));
});
