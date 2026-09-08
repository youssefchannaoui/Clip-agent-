import assert from 'node:assert/strict';
import test from 'node:test';

import * as affiliates from '../src/affiliates.js';

/**
 * The affiliate programme's arithmetic, driven rather than read.
 *
 * Every assertion here calls the real functions against a real state shape and
 * reads what comes back — never the source. The whole module is about money,
 * and a test that greps for a rule passes just as happily against a rule that
 * has stopped being applied.
 *
 * The fixture is deliberately the awkward case: one approved affiliate, one
 * declined applicant, a customer who was referred, a customer who was not, a
 * refunded payment, a self-referral, and a payment from before the affiliate
 * was approved.
 */

const CONFIG = {
  affiliatesEnabled: true,
  affiliateCommissionPercent: 25,
  affiliateCommissionMonths: 12,
  affiliateCookieDays: 60,
  affiliatePendingDays: 30,
  affiliateMinimumPayoutMinor: 2000,
};

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 10);         // the affiliate is approved
const NOW = T0 + 400 * DAY;

function fixture() {
  return {
    authUsers: [
      // The affiliate's own account carries a referral naming ITSELF, and it
      // is approved -- so the self-referral guard is the only thing that can
      // refuse it. `selfref` below cannot test that: it has no approved
      // application, so the approval gate catches it first and the two guards
      // mask each other. Both red probes came back GREEN until this existed.
      { id: 'aff', email: 'creator@example.com', name: 'A Creator', referredBy: { referrerId: 'aff', createdAt: T0 } },
      { id: 'other', email: 'nobody@example.com' },
      { id: 'cust1', email: 'one@example.com', referredBy: { referrerId: 'aff', createdAt: T0 } },
      { id: 'cust2', email: 'two@example.com', referredBy: { referrerId: 'aff', createdAt: T0 } },
      { id: 'walkin', email: 'walkin@example.com' },
      { id: 'declined', email: 'declined@example.com' },
      { id: 'selfref', email: 'self@example.com', referredBy: { referrerId: 'selfref', createdAt: T0 } },
      { id: 'cust3', email: 'three@example.com', referredBy: { referrerId: 'aff', createdAt: NOW - 5 * DAY } },
      // Referred by the DECLINED applicant, and pays. The approval gate is the
      // ONLY thing between this payment and a commission -- without a customer
      // of their own, removing that gate changes nothing and the test that
      // pins it passes against code that no longer checks.
      { id: 'custD', email: 'declined-customer@example.com', referredBy: { referrerId: 'declined', createdAt: T0 } },
    ],
    affiliates: [
      { userId: 'aff', status: 'approved', approvedAt: T0, terms: { percent: 25 }, payoutMethod: 'wise', payoutDetail: 'creator@example.com' },
      { userId: 'declined', status: 'declined', decidedAt: T0 },
    ],
    revenueEvents: [
      // before the approval: not the affiliate's
      { id: 'r0', kind: 'subscription', userId: 'cust1', amountMinor: 2999, currency: 'aud', stripeId: 'in_before', chargeId: 'ch_before', createdAt: T0 - DAY },
      // the first paid invoice: starts cust1's twelve months
      { id: 'r1', kind: 'subscription', userId: 'cust1', amountMinor: 2999, currency: 'aud', stripeId: 'in_1', chargeId: 'ch_1', createdAt: T0 + DAY },
      // inside the window, past the hold
      { id: 'r2', kind: 'subscription', userId: 'cust1', amountMinor: 2999, currency: 'aud', stripeId: 'in_2', chargeId: 'ch_2', createdAt: T0 + 40 * DAY },
      // inside the window and REFUNDED
      { id: 'r3', kind: 'subscription', userId: 'cust1', amountMinor: 2999, currency: 'aud', stripeId: 'in_3', chargeId: 'ch_3', createdAt: T0 + 70 * DAY },
      // past twelve months: outside the window
      { id: 'r4', kind: 'subscription', userId: 'cust1', amountMinor: 2999, currency: 'aud', stripeId: 'in_4', chargeId: 'ch_4', createdAt: T0 + 380 * DAY },
      // a different currency, and still inside its own window
      { id: 'r5', kind: 'subscription', userId: 'cust2', amountMinor: 2199, currency: 'usd', stripeId: 'in_5', chargeId: 'ch_5', createdAt: T0 + 5 * DAY },
      // nobody referred this one
      { id: 'r6', kind: 'subscription', userId: 'walkin', amountMinor: 2999, currency: 'aud', stripeId: 'in_6', chargeId: 'ch_6', createdAt: T0 + 5 * DAY },
      // an account naming itself as its own referrer
      { id: 'r7', kind: 'subscription', userId: 'selfref', amountMinor: 2999, currency: 'aud', stripeId: 'in_7', chargeId: 'ch_7', createdAt: T0 + 5 * DAY },
      // a TOP-UP is not recurring revenue somebody introduced
      { id: 'r8', kind: 'topup', userId: 'cust1', amountMinor: 4900, currency: 'aud', stripeId: 'pi_8', chargeId: 'ch_8', createdAt: T0 + 5 * DAY },
      // the approved affiliate paying for their OWN subscription
      { id: 'r10', kind: 'subscription', userId: 'aff', amountMinor: 2999, currency: 'aud', stripeId: 'in_self', chargeId: 'ch_self', createdAt: T0 + 5 * DAY },
      // a customer the DECLINED applicant referred, paying
      { id: 'r11', kind: 'subscription', userId: 'custD', amountMinor: 2999, currency: 'aud', stripeId: 'in_declined', chargeId: 'ch_declined', createdAt: T0 + 5 * DAY },
      // A THIRD customer, whose FIRST payment is three days old -- so it is
      // inside their own twelve months and inside the 30-day hold. It has to
      // be a new customer: cust2's window opened 400 days ago and nothing
      // recent can be inside it, which is what the first cut of this fixture
      // got wrong and the window arithmetic correctly refused.
      { id: 'r9', kind: 'subscription', userId: 'cust3', amountMinor: 2199, currency: 'usd', stripeId: 'in_9', chargeId: 'ch_9', createdAt: NOW - 3 * DAY },
    ],
    refundEvents: [
      { stripeId: 'ch_3', chargeId: 'ch_3', invoiceId: 'in_3', amountMinor: 2999, currency: 'aud', reason: 'refund', createdAt: T0 + 75 * DAY },
    ],
    affiliatePayouts: [],
  };
}

const rowsOf = (state, now = NOW) => affiliates.commissions(state, CONFIG, { now });

test('commission is earned only on subscription money the affiliate introduced', () => {
  const state = fixture();
  const rows = rowsOf(state);
  const keys = rows.map(r => r.key).sort();

  // in_before: before approval. in_4: past twelve months. in_6: not referred.
  // in_7 and in_self: self-referral. pi_8: a top-up, not recurring revenue.
  // in_declined: referred by somebody whose application was refused.
  assert.deepEqual(keys, ['in_1', 'in_2', 'in_3', 'in_5', 'in_9']);
  assert.ok(rows.every(r => r.affiliateId === 'aff'));
});

test('an APPROVED affiliate cannot earn on their own subscription', () => {
  // The affiliate's own account names itself as its referrer, and is approved,
  // so this is the one case where the self-referral guard is the only thing
  // standing between a payment and a commission.
  const rows = rowsOf(fixture());
  assert.ok(!rows.some(r => r.key === 'in_self'),
    'an affiliate paying their own subscription is not an introduction');
  assert.ok(!rows.some(r => r.customerId === 'aff'));
});

test('a DECLINED applicant earns nothing, however many people they referred', () => {
  // custD was referred, paid, is inside the window and past the hold. Only the
  // approval gate refuses it.
  const state = fixture();
  assert.ok(!rowsOf(state).some(r => r.key === 'in_declined'));
  assert.ok(!rowsOf(state).some(r => r.affiliateId === 'declined'));

  // And approving them turns exactly that payment into a commission -- proving
  // the fixture reaches the gate rather than failing for some other reason.
  affiliates.decide(state, 'declined', 'approved', { by: 'owner@x' });
  state.affiliates.find(a => a.userId === 'declined').approvedAt = T0;
  const after = rowsOf(state);
  assert.ok(after.some(r => r.key === 'in_declined' && r.affiliateId === 'declined'));
});

test('the rate is applied to the payment, and never across currencies', () => {
  const rows = rowsOf(fixture());
  const aud = rows.find(r => r.key === 'in_1');
  assert.equal(aud.amountMinor, Math.round(2999 * 0.25));   // 750
  assert.equal(aud.currency, 'aud');
  const usd = rows.find(r => r.key === 'in_5');
  assert.equal(usd.amountMinor, Math.round(2199 * 0.25));   // 550
  assert.equal(usd.currency, 'usd');

  const sums = affiliates.totals(rows);
  assert.deepEqual(Object.keys(sums).sort(), ['aud', 'usd'],
    'balances are held per currency: nothing here converts money');
});

test('a refunded payment is void, and a fresh one is still pending', () => {
  const rows = rowsOf(fixture());
  assert.equal(rows.find(r => r.key === 'in_3').state, 'void');
  assert.equal(rows.find(r => r.key === 'in_9').state, 'pending', 'inside the 30-day hold');
  assert.equal(rows.find(r => r.key === 'in_1').state, 'due');
});

test('the hold window is what makes a commission payable, and it is real', () => {
  const state = fixture();
  const justPaid = rowsOf(state, T0 + 2 * DAY).find(r => r.key === 'in_1');
  assert.equal(justPaid.state, 'pending', 'one day old is inside the hold');
  const later = rowsOf(state, T0 + 32 * DAY).find(r => r.key === 'in_1');
  assert.equal(later.state, 'due', 'past 30 days it is payable');
});

test('the twelve months belong to the CUSTOMER, measured by the calendar', () => {
  // Twelve 30-day months is 360 days, so a payment at day 370 would be inside
  // a naive window and outside a real year. The fixture's in_4 is at day 380.
  const start = Date.UTC(2026, 0, 31);
  assert.equal(affiliates.addMonths(start, 1), Date.UTC(2026, 1, 28),
    '31 January plus a month is the end of February, not the 3rd of March');
  assert.equal(affiliates.addMonths(start, 12), Date.UTC(2027, 0, 31));
});

test('a payout settles exactly the rows it names, and cannot pay one twice', () => {
  const state = fixture();
  const due = rowsOf(state).filter(r => r.state === 'due' && r.currency === 'aud');
  const keys = due.map(r => r.key);
  const expected = due.reduce((sum, r) => sum + r.amountMinor, 0);

  const first = affiliates.recordPayout(state, 'aff', { keys, method: 'wise', reference: 'TX-1' }, CONFIG, { now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.payout.amountMinor, expected, 'the amount comes from the keys, never off the wire');
  assert.equal(first.payout.currency, 'aud');

  const after = rowsOf(state).filter(r => keys.includes(r.key));
  assert.ok(after.every(r => r.state === 'paid'), 'a settled commission reads as paid');

  const again = affiliates.recordPayout(state, 'aff', { keys, method: 'wise' }, CONFIG, { now: NOW });
  assert.equal(again.ok, false, 'the same commission cannot be paid a second time');
  assert.match(again.error, /paid/);
});

test('a payout refuses a pending commission, a foreign one, and mixed currencies', () => {
  const state = fixture();
  const pendingKey = rowsOf(state).find(r => r.state === 'pending').key;
  assert.match(affiliates.recordPayout(state, 'aff', { keys: [pendingKey] }, CONFIG, { now: NOW }).error,
    /pending/, 'paying inside the hold jumps the refund window');

  assert.match(affiliates.recordPayout(state, 'other', { keys: ['in_1'] }, CONFIG, { now: NOW }).error,
    /not an approved affiliate/);

  const audKey = rowsOf(state).find(r => r.state === 'due' && r.currency === 'aud').key;
  const usdKey = rowsOf(state).find(r => r.state === 'due' && r.currency === 'usd').key;
  assert.match(affiliates.recordPayout(state, 'aff', { keys: [audKey, usdKey] }, CONFIG, { now: NOW }).error,
    /one currency/);
});

test('a commission refunded AFTER payout is reported, never silently deducted', () => {
  const state = fixture();
  const key = rowsOf(state).find(r => r.state === 'due' && r.currency === 'aud').key;
  affiliates.recordPayout(state, 'aff', { keys: [key], method: 'wise' }, CONFIG, { now: NOW });
  state.refundEvents.push({ stripeId: 'ch_1', chargeId: 'ch_1', invoiceId: 'in_1', amountMinor: 2999, currency: 'aud', createdAt: NOW });

  const row = rowsOf(state).find(r => r.key === key);
  assert.equal(row.state, 'paid', 'a paid commission stays paid');
  assert.equal(row.refunded, true);
  const backs = affiliates.clawbacks(state, CONFIG, { now: NOW });
  assert.equal(backs.length, 1);
  assert.equal(backs[0].key, key);
});

test('an affiliate statement never names the customers behind it', () => {
  const state = fixture();
  const statement = affiliates.statementFor(state, 'aff', CONFIG, { now: NOW });
  const text = JSON.stringify(statement);
  for (const email of ['one@example.com', 'two@example.com', 'three@example.com', 'walkin@example.com']) {
    assert.ok(!text.includes(email), `${email} reached the affiliate's own statement`);
  }
  assert.ok(!text.includes('cust1') && !text.includes('cust2'), 'no customer id either');
  assert.equal(statement.referred, 4, 'counts are fine; identities are not — cust1, cust2, cust3 and the affiliate\'s own self-referral row');
  assert.equal(statement.status, 'approved');
});

test('the public view hides the payout detail, and says nothing when switched off', () => {
  const state = fixture();
  const view = affiliates.publicView(state, { id: 'aff' }, CONFIG, { now: NOW });
  assert.ok(!JSON.stringify(view).includes('creator@example.com'),
    'the payout account is the operator\'s to see, not the payload\'s to carry');
  assert.equal(view.enabled, true);

  const off = affiliates.publicView(state, { id: 'aff' }, { ...CONFIG, affiliatesEnabled: false }, { now: NOW });
  assert.equal(off.enabled, false);
  const noRate = affiliates.publicView(state, { id: 'aff' }, { ...CONFIG, affiliateCommissionPercent: 0 }, { now: NOW });
  assert.equal(noRate.enabled, false, 'a programme paying nothing is not a programme');
});

test('nothing is earned at a rate of zero, whatever else is true', () => {
  const state = fixture();
  assert.deepEqual(affiliates.commissions(state, { ...CONFIG, affiliateCommissionPercent: 0 }, { now: NOW }), [],
    'the rate defaults to zero for a reason: code that pays by default pays before anybody decided to');
});

test('the rate an affiliate agreed to is the rate they are paid', () => {
  const state = fixture();
  state.affiliates[0].terms = { percent: 40 };   // an older, better deal
  const row = affiliates.commissions(state, CONFIG, { now: NOW }).find(r => r.key === 'in_1');
  assert.equal(row.ratePercent, 40);
  assert.equal(row.amountMinor, Math.round(2999 * 0.4),
    'a rate change must not rewrite what somebody was already promised');
});

test('applying refuses what it should, and stamps the terms', () => {
  affiliates.useConfig(CONFIG);
  const state = fixture();
  const user = { id: 'other', email: 'nobody@example.com' };
  const good = { audience: '40k on YouTube', payoutMethod: 'wise', payoutDetail: 'me@example.com', agreed: true };

  assert.match(affiliates.apply(state, user, { ...good, agreed: false }).error, /terms/);
  assert.match(affiliates.apply(state, user, { ...good, audience: '' }).error, /where you would share/);
  assert.match(affiliates.apply(state, user, { ...good, payoutMethod: 'bitcoin' }).error, /how you would like to be paid/);
  assert.match(affiliates.apply(state, user, { ...good, payoutDetail: '' }).error, /account we should pay/);

  const ok = affiliates.apply(state, user, good);
  assert.equal(ok.ok, true);
  assert.equal(ok.application.status, 'pending');
  assert.equal(ok.application.terms.percent, 25, 'the rates are stamped at application time');
  assert.match(affiliates.apply(state, user, good).error, /already applied/);
});

test('an application is decided by a person, and approval is stamped once', () => {
  affiliates.useConfig(CONFIG);
  const state = fixture();
  assert.match(affiliates.decide(state, 'nobody', 'approved').error, /No application/);
  assert.match(affiliates.decide(state, 'declined', 'pending').error, /not a decision|Not a decision/i);

  const first = affiliates.decide(state, 'declined', 'approved', { by: 'owner@x' });
  assert.equal(first.ok, true);
  const stamped = first.application.approvedAt;
  affiliates.decide(state, 'declined', 'suspended', { by: 'owner@x' });
  affiliates.decide(state, 'declined', 'approved', { by: 'owner@x' });
  assert.equal(affiliates.applicationFor(state, 'declined').approvedAt, stamped,
    'a suspend-then-reapprove must not backdate a claim over the gap');
});

test('the ledger reports the minimum rather than enforcing it', () => {
  const state = fixture();
  const rows = affiliates.ledger(state, CONFIG, { now: NOW });
  const aff = rows.find(r => r.affiliateId === 'aff');
  assert.ok(aff, 'the affiliate with commission is in the ledger');
  const aud = aff.currencies.find(c => c.currency === 'aud');
  assert.equal(typeof aud.overMinimum, 'boolean');
  // A small balance is still payable: the floor exists so a transfer does not
  // cost more in fees than it moves, not to trap somebody's money.
  const small = affiliates.recordPayout(state, 'aff',
    { keys: [affiliates.commissions(state, CONFIG, { now: NOW }).find(r => r.state === 'due' && r.currency === 'usd').key], method: 'wise' },
    { ...CONFIG, affiliateMinimumPayoutMinor: 100000 }, { now: NOW });
  assert.equal(small.ok, true, 'the operator may settle a balance under the floor');
});
