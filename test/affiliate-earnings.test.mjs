import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * EVERY AFFILIATE HAS EARNED ZERO, AND NOTHING ANYWHERE SAID SO.
 *
 * `commissions()` is computed from `state.revenueEvents` rows of
 * `kind: 'subscription'`, and those were written in exactly ONE place: the
 * `invoice.paid` webhook handler. The signing secret on this deployment has
 * been rejecting deliveries since 29 Aug 2026 -- so no such row has been
 * written since, every affiliate statement reads 0, the operator's ledger owes
 * nobody anything, and the owner funnel reports no paid conversions.
 *
 * It is the same root cause as the cancelled subscription that kept its
 * allowance (v3.197.0), reaching a different surface. The second net
 * (v3.39.0) already makes the CUSTOMER whole without the webhook; it did not
 * make the BOOKS whole, deliberately -- "inventing an invoice would
 * double-count against the real one when it arrives".
 *
 * That reasoning is right about a FORGED id and stops being right the moment
 * the session carries the REAL one. `session.invoice` expanded is the very
 * invoice `invoice.paid` will name, so recordRevenue's dedupe on the Stripe
 * object id makes the redelivery a no-op.
 *
 * THE DANGEROUS DIRECTION IS DOUBLE-COUNTING somebody's money, and the test
 * that matters most here drives the two nets in the order production will
 * actually run them: confirm now, webhook when the secret is fixed.
 */

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-affearn-'));
process.env.STRIPE_SECRET_KEY = 'sk_test_deenclipped';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
process.env.AFFILIATES_ENABLED = 'true';
process.env.AFFILIATE_COMMISSION_PERCENT = '25';
process.env.AFFILIATE_COMMISSION_MONTHS = '12';

const billing = await import('../src/billing.js');
const affiliates = await import('../src/affiliates.js');
// A NAMED export. `.default` is undefined here, and affiliates.js then falls
// back to its own percent-0 stub -- so every commission is zero and the test
// reports the bug it is meant to be proving fixed.
const { config } = await import('../src/config.js');
const { state } = await import('../src/store.js');

const AFFILIATE = 'aff_1';
const BUYER = 'buyer_1';
const INVOICE = 'in_first_month';

function seed() {
  state.authUsers = [
    { id: AFFILIATE, email: 'aff@deenclipped.test', role: 'creator', createdAt: 1 },
    {
      id: BUYER, email: 'buyer@deenclipped.test', role: 'creator', createdAt: 1,
      // The affiliate brought them: this is what referrals.js stamps.
      referredBy: { referrerId: AFFILIATE, at: 1 },
      billing: { plan: 'free', status: 'free', tokensUsed: 0, tokensReserved: 0, bonusTokens: 0, stripeCustomerId: 'cus_buyer' },
    },
  ];
  // `state.affiliates`, which is what apply() writes -- NOT
  // `affiliateApplications`, which is what this fixture said first and which
  // made every commission vanish for a reason that had nothing to do with the
  // code under test.
  state.affiliates = [{
    id: 'app_1', userId: AFFILIATE, status: 'approved', approvedAt: 10,
    terms: affiliates.termsSnapshot(config),
  }];
  state.affiliatePayouts = [];
  state.revenueEvents = [];
  state.billingEvents = [];
  state.processedStripeEvents = [];
}

/** The Checkout session Stripe hands back, with the invoice expanded. */
function subscriptionSession({ amountPaid = 2999, invoiceId = INVOICE } = {}) {
  return {
    id: 'cs_sub_live', status: 'complete', mode: 'subscription', payment_status: 'paid',
    customer: 'cus_buyer', currency: 'aud', amount_total: amountPaid,
    metadata: { userId: BUYER, plan: 'pro_monthly' },
    subscription: {
      id: 'sub_live', status: 'active', items: { data: [{ price: { id: 'price_monthly' } }] },
      current_period_end: Math.floor((Date.now() + 30 * 86400_000) / 1000),
    },
    invoice: {
      id: invoiceId, amount_paid: amountPaid, currency: 'aud', charge: 'ch_first_month',
      lines: { data: [{ description: 'Pro monthly' }] },
    },
  };
}

const realFetch = globalThis.fetch;
let session = subscriptionSession();
globalThis.fetch = async (url, options) => {
  const href = String(url);
  if (!href.startsWith('https://api.stripe.com/')) return realFetch(url, options);
  if (href.includes('/checkout/sessions/')) {
    return new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const subscriptionRows = () => state.revenueEvents.filter(r => r.kind === 'subscription');
const statement = () => affiliates.statementFor(state, AFFILIATE, config);

test('WITH NO WEBHOOK AT ALL, the affiliate earns what they were promised', async () => {
  seed();
  // `totals` is keyed by CURRENCY and nothing converts between them -- the
  // same rule the pricing pages hold. There is no single total to read.
  assert.deepEqual(statement().totals, {}, 'precondition: nothing earned yet');

  const buyer = state.authUsers.find(u => u.id === BUYER);
  const result = await billing.confirmCheckoutSession(buyer, 'cs_sub_live');
  assert.equal(result.applied, true, 'the plan is granted, as it always was');

  const rows = subscriptionRows();
  assert.equal(rows.length, 1, 'and the money is now on the books');
  assert.equal(rows[0].stripeId, INVOICE, "under Stripe's OWN invoice id, never one we made up");
  assert.equal(rows[0].amountMinor, 2999);

  const earned = statement();
  assert.equal(earned.commissions.length, 1, 'the affiliate has a commission at last');
  // 25% of A$29.99.
  assert.equal(earned.commissions[0].amountMinor, 750, '25% of what was actually paid');
  assert.equal(earned.commissions[0].currency, 'aud');
});

test('AND THE REDELIVERED WEBHOOK DOES NOT PAY THEM TWICE', () => {
  /*
   * The direction that matters. Stripe retries for ~3 days and a fixed secret
   * redelivers everything missed, so a second row here would double every
   * commission earned while the secret was broken -- and pay it out.
   */
  const before = subscriptionRows().length;
  const earnedBefore = statement().commissions.length;

  billing.handleWebhookEvent({
    id: 'evt_redelivered', type: 'invoice.paid',
    data: { object: { id: INVOICE, amount_paid: 2999, currency: 'aud', subscription: 'sub_live', customer: 'cus_buyer', charge: 'ch_first_month', lines: { data: [{ description: 'Pro monthly' }] } } },
  });

  assert.equal(subscriptionRows().length, before, 'the money is booked once, not twice');
  assert.equal(statement().commissions.length, earnedBefore, 'and the commission is earned once');
  // Within the 30-day hold, so it is PENDING rather than due -- and a delay
  // that nothing checks is just a delay, which is why the refund test below
  // exists beside it.
  assert.equal(statement().totals.aud.pending, 750, 'the total did not double');
});

test('the charge id travels, so a refund can still void the commission', () => {
  // A refund names the CHARGE; an invoice id alone cannot be joined to it.
  // Without this the hold window would be a delay that checks nothing.
  const row = subscriptionRows()[0];
  assert.equal(row.chargeId, 'ch_first_month');

  state.refundEvents = [{ chargeId: 'ch_first_month', at: Date.now() }];
  const voided = affiliates.commissions(state, config).filter(r => r.affiliateId === AFFILIATE);
  assert.equal(voided.length, 1, 'the row is still reported');
  assert.equal(voided[0].state, 'void', 'and it is voided rather than owed');
  state.refundEvents = [];
});

test('a TRIAL books nothing, because no money arrived', async () => {
  seed();
  session = subscriptionSession({ amountPaid: 0, invoiceId: 'in_trial' });
  const buyer = state.authUsers.find(u => u.id === BUYER);
  const result = await billing.confirmCheckoutSession(buyer, 'cs_sub_live');

  assert.equal(result.applied, true, 'the trial still switches the plan on');
  assert.equal(subscriptionRows().length, 0, 'but nothing is booked');
  assert.equal(statement().commissions.length, 0, 'and no commission is owed on a trial');
  session = subscriptionSession();
});

test('a session with no invoice books nothing and does not throw', async () => {
  // An older session, or one Stripe answers without the expansion. The plan
  // must still be granted: the customer being made whole never depended on
  // this, and a books change must not be able to take that away.
  seed();
  session = { ...subscriptionSession(), invoice: null };
  const buyer = state.authUsers.find(u => u.id === BUYER);
  const result = await billing.confirmCheckoutSession(buyer, 'cs_sub_live');

  assert.equal(result.applied, true, 'the plan is still granted');
  assert.equal(subscriptionRows().length, 0, 'and nothing is invented to book');
  session = subscriptionSession();
});

test('the session is fetched WITH the invoice expanded, or none of this happens', async () => {
  /*
   * Silent when it breaks: `session.invoice` is a bare id string without the
   * expansion, the object check below it fails, and the books quietly stay
   * empty exactly as they were -- with every test above still passing on a
   * fixture that supplies the object anyway.
   */
  seed();
  let asked = '';
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes('/checkout/sessions/')) asked = href;
    return saved(url, options);
  };
  await billing.confirmCheckoutSession(state.authUsers.find(u => u.id === BUYER), 'cs_sub_live');
  globalThis.fetch = saved;

  assert.match(decodeURIComponent(asked), /expand\[\]=invoice/, 'the invoice must be asked for');
});

test.after(() => {
  globalThis.fetch = realFetch;
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
  catch { /* a leftover temp directory on a runner is harmless */ }
});
