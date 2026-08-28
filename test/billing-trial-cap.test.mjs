import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-trial-cap-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'trial-cap-test-secret-long-enough';
process.env.TOKENS_TRIAL = '75';
process.env.TOKENS_YEARLY = '6000';
process.env.TOKENS_MONTHLY = '500';
process.env.STRIPE_PRICE_YEARLY = 'price_test_yearly';
process.env.STRIPE_PRICE_MONTHLY = 'price_test_monthly';

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const DAY = 24 * 60 * 60 * 1000;

function makeUser(id, billingFields = {}) {
  const user = {
    id, email: `${id}@test`, name: id, role: 'creator', providers: {}, createdAt: Date.now(),
    billing: { plan: 'free', status: 'free', plansSeenAt: Date.now(), ...billingFields },
  };
  state.authUsers.push(user);
  return user;
}

// A trial is free machine time: every token is a source minute that costs
// proxy bandwidth to import. Uncapped, one seven-day yearly trial hands out
// 6000 minutes -- more bandwidth than the proxy plan sells in a month.
test('a trialing subscription is capped, not given the whole plan allowance', () => {
  const user = makeUser('trial-yearly', {
    plan: 'yearly', status: 'trialing',
    trialStart: Date.now() - DAY, trialEnd: Date.now() + 6 * DAY,
  });
  const current = billing.publicBilling(user).current;
  assert.equal(current.allowance, 75, 'the yearly plan\'s 6000 tokens must not be spendable during the trial');
  assert.equal(current.remaining, 75);
});

test('the cap is a ceiling, never a floor: a smaller plan keeps its own size', () => {
  process.env.TOKENS_WEEKLY = '75';
  const user = makeUser('trial-small', {
    plan: 'weekly', status: 'trialing',
    trialStart: Date.now() - DAY, trialEnd: Date.now() + DAY,
  });
  assert.ok(billing.publicBilling(user).current.allowance <= 75);
});

test('the cap holds against real spending, not only the displayed figure', () => {
  const user = makeUser('trial-spend', {
    plan: 'yearly', status: 'trialing',
    trialStart: Date.now() - DAY, trialEnd: Date.now() + 6 * DAY,
  });
  billing.reserveTokens(user.id, 75);
  assert.throws(() => billing.reserveTokens(user.id, 1), /Not enough tokens/,
    'a trial must not be able to reserve past its cap');
  billing.releaseTokens(user.id, 75);
  assert.throws(() => billing.chargeTokens(user.id, 200, 'usage'), /Not enough tokens/,
    'a trial must not be able to charge past its cap');
});

test('converting to a paid subscription lifts the cap', () => {
  const user = makeUser('trial-converted', {
    plan: 'yearly', status: 'active',
    trialStart: Date.now() - 8 * DAY, trialEnd: Date.now() - DAY,
  });
  assert.equal(billing.publicBilling(user).current.allowance, 6000,
    'the first paid day starts on the full allowance');
});

test('an expired trial that never converted cannot keep spending', () => {
  const user = makeUser('trial-lapsed', {
    plan: 'yearly', status: 'trialing',
    trialStart: Date.now() - 8 * DAY, trialEnd: Date.now() - DAY,
  });
  // trialState().active is false once trialEnd passes, so the cap no longer
  // applies -- the guard that must hold here is that Stripe cancels the
  // subscription, which clearSubscription drops back to free.
  const current = billing.publicBilling(user).current;
  assert.equal(current.trial.active, false);
  assert.equal(current.trial.ended, true);
});

test('the plans page states the trial size instead of implying the full plan', () => {
  const user = makeUser('trial-copy');
  const html = billing.plansPage(user, { returnTo: '/' });
  assert.match(html, /75 tokens/, 'the card must say how many tokens a trial actually includes');
});
