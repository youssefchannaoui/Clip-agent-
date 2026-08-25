import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-billing-'));
process.env.AUTH_REQUIRED = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_test_deenclipped';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_deenclipped';
process.env.STRIPE_PRICE_WEEKLY = 'price_weekly';
process.env.STRIPE_PRICE_TOPUP_100 = 'price_topup_100';
process.env.STRIPE_PRICE_TOPUP_300 = 'price_topup_300';
process.env.STRIPE_PRICE_TOPUP_750 = 'price_topup_750';

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

const creator = {
  id: 'billing-creator',
  email: 'billing@deenclipped.test',
  role: 'creator',
  createdAt: Date.now(),
  billing: {
    plan: 'free', status: 'free', tokensUsed: 0, tokensReserved: 0,
    bonusTokens: 0, stripeCustomerId: 'cus_billing',
  },
};
state.authUsers = [creator];
state.billingEvents = [];
state.processedStripeEvents = [];

function checkoutEvent({ id, sessionId, packageId = 'boost100', paymentStatus = 'paid', type = 'checkout.session.completed' }) {
  return {
    id,
    type,
    data: { object: {
      id: sessionId,
      mode: 'payment',
      payment_status: paymentStatus,
      customer: 'cus_billing',
      payment_intent: `pi_${sessionId}`,
      metadata: { userId: creator.id, kind: 'token_topup', package: packageId },
    } },
  };
}

test('paid top-up webhooks credit once and retain audit references', () => {
  const first = billing.handleWebhookEvent(checkoutEvent({ id: 'evt_topup_1', sessionId: 'cs_topup_1' }));
  assert.equal(first.ok, true);
  assert.equal(creator.billing.bonusTokens, 100);

  const duplicateEvent = billing.handleWebhookEvent(checkoutEvent({ id: 'evt_topup_1', sessionId: 'cs_topup_1' }));
  assert.equal(duplicateEvent.duplicate, true);
  assert.equal(creator.billing.bonusTokens, 100);

  billing.handleWebhookEvent(checkoutEvent({ id: 'evt_topup_2', sessionId: 'cs_topup_1' }));
  assert.equal(creator.billing.bonusTokens, 100, 'a second event for the same Checkout session must not add tokens twice');

  const ledger = state.billingEvents.find(event => event.type === 'tokens_added');
  assert.equal(ledger.meta.sessionId, 'cs_topup_1');
  assert.equal(ledger.meta.stripeEventId, 'evt_topup_1');
  assert.equal(ledger.meta.paymentIntentId, 'pi_cs_topup_1');
});

test('unpaid completion does not credit, but async payment success does', () => {
  creator.billing.bonusTokens = 0;
  creator.billing.processedTopupSessions = [];
  billing.handleWebhookEvent(checkoutEvent({ id: 'evt_unpaid', sessionId: 'cs_async', packageId: 'boost300', paymentStatus: 'unpaid' }));
  assert.equal(creator.billing.bonusTokens, 0);

  billing.handleWebhookEvent(checkoutEvent({ id: 'evt_async_paid', sessionId: 'cs_async', packageId: 'boost300', type: 'checkout.session.async_payment_succeeded' }));
  assert.equal(creator.billing.bonusTokens, 300);
});

test('subscription allowance is spent before purchased top-up tokens', () => {
  creator.billing.plan = 'free';
  creator.billing.status = 'free';
  creator.billing.tokensUsed = 35;
  creator.billing.tokensReserved = 0;
  creator.billing.bonusTokens = 100;
  const result = billing.chargeTokens(creator.id, 10, 'test charge');
  assert.equal(creator.billing.tokensUsed, 40);
  assert.equal(creator.billing.bonusTokens, 95);
  assert.equal(result.event.meta.subscriptionUsed, 5);
  assert.equal(result.event.meta.bonusUsed, 5);
  assert.equal(billing.publicBilling(creator).current.remaining, 95);
});

test('subscription renewal and cancellation preserve top-up tokens', () => {
  creator.billing.plan = 'weekly';
  creator.billing.status = 'active';
  creator.billing.stripeSubscriptionId = 'sub_billing';
  creator.billing.periodStart = 1_700_000_000_000;
  creator.billing.tokensUsed = 50;
  creator.billing.bonusTokens = 77;

  billing.handleWebhookEvent({
    id: 'evt_renewal', type: 'customer.subscription.updated', data: { object: {
      id: 'sub_billing', customer: 'cus_billing', status: 'active',
      metadata: { userId: creator.id, plan: 'weekly' },
      current_period_start: 1_800_000_000,
      current_period_end: 1_800_604_800,
      items: { data: [{ price: { id: 'price_weekly' } }] },
    } },
  });
  assert.equal(creator.billing.tokensUsed, 0);
  assert.equal(creator.billing.bonusTokens, 77);

  billing.handleWebhookEvent({
    id: 'evt_cancel', type: 'customer.subscription.deleted', data: { object: {
      id: 'sub_billing', customer: 'cus_billing',
    } },
  });
  assert.equal(creator.billing.plan, 'free');
  assert.equal(creator.billing.bonusTokens, 77);
});

test('a busy few days cannot push an event out of the dedupe list', () => {
  // The list used to be trimmed to the newest 1000 entries, which is the wrong
  // axis: Stripe retries a failed delivery over about three days, so what
  // decides whether a replay is recognised is how long ago it arrived, not how
  // many events came after it. A thousand events inside the retry window --
  // which is what going public looks like -- pushed the oldest off, and a retry
  // of it credited the tokens a second time.
  const original = billing.handleWebhookEvent(checkoutEvent({ id: 'evt_old', sessionId: 'cs_old' }));
  assert.equal(original.ok, true);
  const afterFirst = creator.billing.bonusTokens;

  for (let n = 0; n < 1200; n += 1) {
    state.processedStripeEvents.unshift({ id: `evt_filler_${n}`, type: 'noise', objectId: '', processedAt: Date.now() });
  }

  const replay = billing.handleWebhookEvent(checkoutEvent({ id: 'evt_old', sessionId: 'cs_old' }));
  assert.equal(replay.duplicate, true, 'the original must still be recognised');
  assert.equal(creator.billing.bonusTokens, afterFirst, 'and must not credit twice');
});

test('an event older than the retry window is allowed to fall off', () => {
  // The list is a dedupe ledger, not an archive: it must not grow forever.
  state.processedStripeEvents = [
    { id: 'evt_ancient', type: 'x', objectId: '', processedAt: Date.now() - 60 * 24 * 60 * 60_000 },
  ];
  billing.handleWebhookEvent(checkoutEvent({ id: 'evt_recent', sessionId: 'cs_recent' }));
  assert.ok(
    !state.processedStripeEvents.some(item => item.id === 'evt_ancient'),
    'sixty days is well past any retry Stripe will make',
  );
});

test('unknown top-up pack is rejected before checkout and unsigned webhooks fail', async () => {
  await assert.rejects(() => billing.createTopupCheckoutSession(creator, 'not-a-pack'), /valid token pack/i);
  assert.throws(() => billing.verifyStripeSignature('{}', ''), /Missing Stripe signature/i);
});
