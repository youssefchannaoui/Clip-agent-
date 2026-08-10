import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('subscription is organised as an account and wallet centre', () => {
  assert.match(ui, /One place for your plan, wallet and payments/);
  assert.match(ui, /Current membership/);
  assert.match(ui, /Your unlocked workspace/);
  assert.match(ui, /Account access/);
  assert.match(ui, /Add tokens without changing your plan/);
  assert.match(ui, /Recent wallet activity/);
});

test('subscription redesign keeps every billing action wired', () => {
  for (const id of [
    'dcSubChangePlan', 'dcSubCompare', 'dcSubCompareBottom',
    'dcSubJumpTopups', 'dcSubPortal', 'dcSubTopups', 'dcSubActivity'
  ]) assert.match(ui, new RegExp(id), `${id} remains available`);
  assert.match(ui, /data-sub-topup/);
  assert.match(ui, /startTopupCheckout/);
  assert.match(ui, /openBillingPortal/);
});

test('subscription explains token and payment safety clearly', () => {
  assert.match(ui, /You always confirm the estimate before processing/);
  assert.match(ui, /Complete card details are never stored by DeenClipped/);
  assert.match(ui, /Purchased top-up tokens do not expire/);
  assert.match(ui, /Stripe securely handles payment details outside DeenClipped/);
});
