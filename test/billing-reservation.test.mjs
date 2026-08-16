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

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

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
