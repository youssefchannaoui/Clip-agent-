/*
 * The undefined-id bug, reproduced, and the audit that finds what it left.
 *
 * The bug: `userBySubscription(subscriptionId)` compared its argument against
 * every account's `billing.stripeSubscriptionId`. When an invoice carried no
 * subscription — a one-off, a proration, an invoice Stripe raised without one —
 * that argument was `undefined`, and `undefined === undefined` is TRUE for
 * every account holding a billing record and no subscription of its own. The
 * first such account matched, and the money went onto their books.
 *
 * The first test below reproduces the comparison exactly. It fails against the
 * old code and passes against the new, which is the only kind of regression
 * test worth writing for a bug about money.
 *
 * Fixing the comparison does not fix rows already written, so the rest of this
 * file tests the audit that finds them. That audit REPORTS and never writes:
 * correcting a misattributed payment is a decision about a real person's money
 * and needs the invoice open in Stripe beside it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-finance-'));
process.env.DATA_DIR = dataDir;
// Port 0, so the OS assigns a free one and hands it back. A port picked at
// random out of 43300-43500 sits INSIDE Linux's ephemeral range
// (32768-60999), so the kernel can hand the same number to an outgoing
// socket between the choice and the listen -- EADDRINUSE, the file aborts,
// and the run reports fewer tests rather than a failure anyone can read.
// Measured before this change: 1 abort in 6 full runs.
process.env.PORT = '0';
process.env.APP_SESSION_SECRET = 'finance-integrity-test-secret-long-enough';

const billing = await import('../src/billing.js');
const store = await import('../src/store.js');
const { auditFinance } = await import('../src/finance-audit.js');
const seo = await import('../src/seo-pages.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

const KNOWN = new Set(seo.indexablePages().map(page => page.path));

test('an invoice with no subscription id is not billed to a bystander', () => {
  // The exact shape that caused it: one account with a billing record and no
  // subscription, and an invoice that names neither a subscription nor a
  // customer this app knows.
  store.state.authUsers = [
    { id: 'user_bystander', email: 'bystander@example.com', billing: { plan: 'free' } },
    { id: 'user_real', email: 'real@example.com', billing: { stripeCustomerId: 'cus_real', stripeSubscriptionId: 'sub_real' } },
  ];
  store.state.revenueEvents = [];
  store.state.processedStripeEvents = [];

  billing.handleWebhookEvent({
    id: `evt_nosub_${Date.now()}`,
    type: 'invoice.paid',
    data: { object: { id: `in_nosub_${Date.now()}`, amount_paid: 4900, currency: 'aud',
      lines: { data: [{ description: 'An invoice naming no subscription' }] } } },
  });

  const recorded = store.state.revenueEvents[0];
  assert.ok(recorded, 'money that arrived must still be recorded');
  assert.equal(recorded.amountMinor, 4900);
  assert.equal(recorded.userId, '',
    'an unidentifiable invoice belongs to no account — never to the first one with an empty field');
  assert.notEqual(recorded.userId, 'user_bystander',
    'this is the bug: the bystander must not be charged with a stranger’s invoice');
});

test('an invoice naming a real customer still reaches the right account', () => {
  // The guard must refuse EMPTY ids without refusing real ones, or it trades
  // a wrong attribution for no attribution at all.
  store.state.revenueEvents = [];
  store.state.processedStripeEvents = [];
  billing.handleWebhookEvent({
    id: `evt_real_${Date.now()}`,
    type: 'invoice.paid',
    data: { object: { id: `in_real_${Date.now()}`, customer: 'cus_real', amount_paid: 2900, currency: 'aud',
      lines: { data: [{ description: 'Pro monthly' }] } } },
  });
  assert.equal(store.state.revenueEvents[0].userId, 'user_real');
});

// ── the audit over what the bug left behind ─────────────────────────────────

test('two accounts claiming one Stripe customer is critical', () => {
  const report = auditFinance({
    authUsers: [
      { id: 'a', email: 'a@x.com', billing: { stripeCustomerId: 'cus_shared' } },
      { id: 'b', email: 'b@x.com', billing: { stripeCustomerId: 'cus_shared' } },
    ],
    revenueEvents: [],
  }, KNOWN);
  const finding = report.findings.find(f => f.kind === 'shared-stripe-id');
  assert.ok(finding, 'a shared customer id must be reported');
  assert.equal(finding.severity, 'critical');
  // A finding nobody can act on gets ignored on the second reading.
  assert.ok(finding.benignIf, 'every finding must say what would make it benign');
});

test('subscription revenue on an account with no Stripe ids is flagged', () => {
  // The signature the bug leaves behind: subscription money filed against an
  // account that has never held a subscription.
  const report = auditFinance({
    authUsers: [{ id: 'v', email: 'victim@x.com', billing: { plan: 'free' } }],
    revenueEvents: [{ kind: 'subscription', userId: 'v', amountMinor: 2900, currency: 'aud', stripeId: 'in_x' }],
  }, KNOWN);
  const finding = report.findings.find(f => f.kind === 'possible-misattribution');
  assert.ok(finding, 'this is the shape the bug left; it must be surfaced');
  assert.match(finding.detail, /victim@x\.com/);
  // Reported as a question, not as a verdict: a cancelled subscription clears
  // both ids and looks identical.
  assert.match(finding.benignIf, /cancelled/i);
});

test('one Stripe object counted twice is critical', () => {
  const report = auditFinance({
    authUsers: [{ id: 'a', billing: {} }],
    revenueEvents: [
      { kind: 'subscription', userId: 'a', amountMinor: 2900, currency: 'aud', stripeId: 'in_dupe' },
      { kind: 'subscription', userId: 'a', amountMinor: 2900, currency: 'aud', stripeId: 'in_dupe' },
    ],
  }, KNOWN);
  assert.ok(report.findings.some(f => f.kind === 'double-counted' && f.severity === 'critical'));
});

test('attribution to a page that does not exist is reported', () => {
  const report = auditFinance({
    authUsers: [{ id: 'a', email: 'a@x.com', signupLanding: '/not-a-real-page', billing: {} }],
    revenueEvents: [],
  }, KNOWN);
  assert.ok(report.findings.some(f => f.kind === 'impossible-landing'));
});

test('a retired page is still a page a customer could have landed on', () => {
  // /tools/long-video-to-shorts was merged away. Someone who arrived on it and
  // then paid is correctly attributed, and must not be reported as impossible.
  const retired = Object.keys(seo.RETIRED_PAGES)[0];
  const known = new Set([...KNOWN, ...Object.keys(seo.RETIRED_PAGES)]);
  const report = auditFinance({
    authUsers: [{ id: 'a', email: 'a@x.com', signupLanding: retired, billing: {} }],
    revenueEvents: [],
  }, known);
  assert.ok(!report.findings.some(f => f.kind === 'impossible-landing'),
    'a page that has been retired is not an impossible landing page');
});

test('the audit never writes', () => {
  // The whole safety property. A misattributed payment is a question about a
  // real person's money; an automatic fix that guessed would make one wrong
  // row into two.
  const state = {
    authUsers: [{ id: 'a', email: 'a@x.com', billing: { stripeCustomerId: 'cus_1' }, signupLanding: '/nope' }],
    revenueEvents: [{ kind: 'subscription', userId: 'ghost', amountMinor: 2900, currency: 'aud', stripeId: 'in_1' }],
  };
  const before = JSON.stringify(state);
  auditFinance(state, KNOWN);
  assert.equal(JSON.stringify(state), before, 'auditFinance must not mutate a single byte of state');
});

test('a clean report says what it did NOT check', () => {
  const report = auditFinance({ authUsers: [], revenueEvents: [] }, KNOWN);
  assert.equal(report.counts.critical, 0);
  // Without this, a clean result reads as "Stripe agrees with us", which this
  // cannot know — it never calls Stripe.
  assert.ok(report.limits.some(line => /does not mean they match Stripe/i.test(line)));
});
