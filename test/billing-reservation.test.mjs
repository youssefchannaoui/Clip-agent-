import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-reserve-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'reservation-test-secret-long-enough';

const billing = await import('../src/billing.js');
const { state } = await import('../src/store.js');

test.after(() => {
  // Guarded: a leftover temp directory on a CI runner is harmless; a red
  // branch from a cleanup race is not. See admin-page.test.mjs for the race.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

function makeUser(id, plan = 'free') {
  const user = { id, email: `${id}@test`, name: id, role: 'creator', providers: {}, createdAt: Date.now(), billing: { plan, status: 'free', plansSeenAt: Date.now() } };
  state.authUsers.push(user);
  return user;
}

test('a reservation reduces what is available without charging anything', () => {
  const user = makeUser('reserve-a');
  const before = billing.publicBilling(user).current;
  billing.reserveTokens(user.id, 10);
  const after = billing.publicBilling(user).current;
  assert.equal(after.reserved, 10);
  assert.equal(after.used, before.used, 'reserving is not spending');
  assert.equal(after.remaining, before.remaining - 10, 'in-flight work is subtracted from what is left');
});

test('releasing gives the hold back', () => {
  const user = makeUser('reserve-b');
  const before = billing.publicBilling(user).current.remaining;
  billing.reserveTokens(user.id, 8);
  billing.releaseTokens(user.id, 8);
  assert.equal(billing.publicBilling(user).current.reserved, 0);
  assert.equal(billing.publicBilling(user).current.remaining, before);
});

test('releasing more than is held clamps at zero rather than creating tokens', () => {
  const user = makeUser('reserve-c');
  const before = billing.publicBilling(user).current.remaining;
  billing.reserveTokens(user.id, 5);
  billing.releaseTokens(user.id, 5);
  billing.releaseTokens(user.id, 5);
  assert.equal(billing.publicBilling(user).current.reserved, 0);
  assert.equal(billing.publicBilling(user).current.remaining, before, 'a double release must not mint tokens');
});

test('a second job cannot be started against tokens the first is about to spend', () => {
  // This is the overdraw the reservation exists to prevent.
  const user = makeUser('reserve-d');
  const total = billing.publicBilling(user).current.remaining;
  billing.reserveTokens(user.id, total);
  assert.throws(() => billing.reserveTokens(user.id, 1), /Not enough tokens/);
});

test('charging still works against what is left after a hold', () => {
  const user = makeUser('reserve-e');
  const total = billing.publicBilling(user).current.remaining;
  billing.reserveTokens(user.id, 5);
  billing.chargeTokens(user.id, 3, 'test');
  const current = billing.publicBilling(user).current;
  assert.equal(current.used, 3);
  assert.equal(current.reserved, 5);
  assert.equal(current.remaining, total - 8, 'spent and held are both accounted for');
});

test('a charge larger than what is left after a hold is refused', () => {
  const user = makeUser('reserve-f');
  const total = billing.publicBilling(user).current.remaining;
  billing.reserveTokens(user.id, total - 2);
  assert.throws(() => billing.chargeTokens(user.id, 5, 'test'), /Not enough tokens/);
});

test('reserving nothing is a no-op, not an error', () => {
  const user = makeUser('reserve-g');
  assert.equal(billing.reserveTokens(user.id, 0).reserved, 0);
  assert.equal(billing.releaseTokens(user.id, 0).released, 0);
  assert.equal(billing.publicBilling(user).current.reserved, 0);
});

// ── holds must come back when the work stops ───────────────────────────────
// These leaked. A free account never rolls over (periodEnd is null), so every
// cancelled or deleted job permanently shrank the balance with no way back.

const engine = await import('../src/local-engine.js');
const { save } = await import('../src/store.js');

function makeHeldProject(id, userId, tokens) {
  const project = { id, userId, engine: 'remote', status: 'processing', title: 'L', tokensReserved: tokens };
  state.projects.push(project);
  billing.reserveTokens(userId, tokens, { projectId: id });
  save();
  return project;
}

test('cancelling a project gives its hold back', () => {
  const user = makeUser('reserve-cancel');
  const start = billing.publicBilling(user).current.remaining;
  makeHeldProject('project_cancel_hold', user.id, 12);
  assert.equal(billing.publicBilling(user).current.remaining, start - 12, 'held while running');
  engine.cancelProject('project_cancel_hold');
  assert.equal(billing.publicBilling(user).current.reserved, 0);
  assert.equal(billing.publicBilling(user).current.remaining, start, 'a cancelled job costs nothing');
});

test('deleting a project gives its hold back', () => {
  const user = makeUser('reserve-delete');
  const start = billing.publicBilling(user).current.remaining;
  makeHeldProject('project_delete_hold', user.id, 7);
  assert.equal(billing.publicBilling(user).current.remaining, start - 7);
  engine.deleteProject('project_delete_hold');
  assert.equal(billing.publicBilling(user).current.remaining, start, 'a deleted job costs nothing');
});

test('releasing twice cannot refund the same hold twice', () => {
  const user = makeUser('reserve-double');
  const start = billing.publicBilling(user).current.remaining;
  makeHeldProject('project_double_hold', user.id, 9);
  engine.cancelProject('project_double_hold');
  engine.cancelProject('project_double_hold');
  assert.equal(billing.publicBilling(user).current.remaining, start, 'no free tokens from cancelling twice');
});

test('a source length that costs a given number of tokens round-trips', () => {
  // Used to hold a floor when the real duration is unknown, which in remote
  // mode is every link import.
  for (const tokens of [1, 5, 10, 40]) {
    assert.equal(billing.tokenCostForSeconds(billing.secondsForTokenCost(tokens)), tokens);
  }
});

test('a completed job that costs more than the balance takes the balance, not nothing', () => {
  const user = makeUser('reserve-h');
  const total = billing.publicBilling(user).current.remaining;
  const result = billing.chargeTokens(user.id, total + 7, 'test', {}, { allowPartial: true });
  assert.equal(result.charged, total, 'everything the account had was charged');
  assert.equal(result.shortfall, 7, 'and the uncovered remainder is reported');
  assert.equal(billing.publicBilling(user).current.remaining, 0);
  // With nothing left, the next job cannot start -- the shortfall cannot repeat.
  assert.throws(() => billing.reserveTokens(user.id, 1), /Not enough tokens/);
});

test('a period rollover keeps the holds of jobs still running', () => {
  const user = makeUser('reserve-i', 'monthly');
  billing.reserveTokens(user.id, 30); // job A
  user.billing.periodEnd = Date.now() - 1000; // the month ends while A is running
  billing.reserveTokens(user.id, 25); // job B starts in the new period
  billing.releaseTokens(user.id, 30); // A finishes
  assert.equal(billing.publicBilling(user).current.reserved, 25, "B's hold is still counted");
});
