import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Free used to be unlimited in time: 40 tokens that never expired, so an
// account could sit on the free plan forever and never pay. The rule now is
// three days and forty tokens, and BOTH walls have to actually stop work --
// a warning that does not block is not a limit.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-freewin-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'free-window-test-secret-long-enough';
process.env.STRIPE_TRIAL_DAYS = '3';
process.env.TOKENS_FREE = '40';
process.env.TOKENS_TRIAL = '40';
process.env.TOKENS_MONTHLY = '500';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

test.after(() => {
  // Guarded: a leftover temp directory on a CI runner is harmless; a red
  // branch from a cleanup race is not. See admin-page.test.mjs for the race.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

const DAY = 24 * 60 * 60 * 1000;

function makeUser(id, ageDays = 0, billingFields = {}, role = 'creator') {
  const user = {
    id, email: `${id}@test`, name: id, role, providers: {},
    createdAt: Date.now() - ageDays * DAY,
    billing: { plan: 'free', status: 'free', ...billingFields },
  };
  state.authUsers.push(user);
  return user;
}

test('a brand new account gets its 40 free tokens and 3 days', () => {
  const user = makeUser('day-zero', 0);
  const current = billing.publicBilling(user).current;
  assert.equal(current.allowance, 40);
  assert.equal(current.freeTrial.expired, false);
  assert.equal(current.freeTrial.daysLeft, 3);
});

test('day two still works', () => {
  const user = makeUser('day-two', 2);
  assert.equal(billing.publicBilling(user).current.freeTrial.expired, false);
  assert.doesNotThrow(() => billing.assertCanStartProject(user));
});

test('after 3 days the free wallet is empty, not merely low', () => {
  const user = makeUser('day-four', 4);
  const current = billing.publicBilling(user).current;
  assert.equal(current.freeTrial.expired, true);
  assert.equal(current.allowance, 0, 'an expired window grants nothing');
  assert.equal(current.remaining, 0);
});

test('an expired free account is BLOCKED from starting work, with the right reason', () => {
  const user = makeUser('blocked', 5);
  assert.throws(() => billing.assertCanStartProject(user), error => {
    assert.match(error.message, /free trial has ended/i,
      'the message must say the days ran out, not that tokens ran low');
    assert.match(error.message, /Choose a plan/i, 'and it must say what to do next');
    assert.equal(error.statusCode, 402);
    assert.equal(error.needsPlan, true);
    return true;
  });
});

test('running out of tokens inside the window says something different', () => {
  const user = makeUser('spent-it', 1);
  billing.chargeTokens(user.id, 40, 'usage');
  assert.throws(() => billing.assertCanStartProject(user), error => {
    assert.match(error.message, /Not enough tokens/i);
    assert.equal(error.needsTokens, true);
    assert.ok(!error.needsPlan, 'this user still has free days left — do not tell them to buy a plan for that reason');
    return true;
  });
});

test('an expired free account is told to choose a plan, and a notice says so', () => {
  const user = makeUser('noticed', 6);
  const notices = billing.publicBilling(user).notices || [];
  const ended = notices.find(n => n.kind === 'free_ended');
  assert.ok(ended, `expected a free_ended notice, got ${JSON.stringify(notices.map(n => n.kind))}`);
  assert.equal(ended.blocking, true);
  assert.match(ended.message, /Choose a plan/i);
});

test('a warning arrives before the window closes, not only after', () => {
  const user = makeUser('warned', 2);
  const notices = billing.publicBilling(user).notices || [];
  assert.ok(notices.some(n => n.kind === 'free_ending'), 'the last day must be announced in advance');
});

test('paying lifts the block immediately', () => {
  const user = makeUser('paid-up', 10, {
    plan: 'monthly', status: 'active',
    periodStart: Date.now(), periodEnd: Date.now() + 30 * DAY,
  });
  const current = billing.publicBilling(user).current;
  assert.equal(current.allowance, 500, 'an old account that pays gets its full plan');
  assert.doesNotThrow(() => billing.assertCanStartProject(user));
});

test('a lapsed subscriber does not fall back into a fresh free trial', () => {
  const user = makeUser('lapsed', 40, { plan: 'free', status: 'cancelled', tokensUsed: 0 });
  const current = billing.publicBilling(user).current;
  assert.equal(current.allowance, 0, 'the free window is measured from signup and never restarts');
  assert.throws(() => billing.assertCanStartProject(user), /free trial has ended/i);
});

test('the owner is never blocked by any of this', () => {
  const user = makeUser('the-owner', 500, { plan: 'admin', status: 'active' }, 'owner');
  assert.doesNotThrow(() => billing.assertCanStartProject(user));
  assert.equal(billing.publicBilling(user).current.freeTrial.expired, false);
});
