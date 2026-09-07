import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// THE TEST THAT DID NOT EXIST (v3.141.3).
//
// DeenAI's Ask was sold at Pro by the FEATURES table and enforced at Studio by
// a hardcoded tier in deenaiAskAccess. Three law tests asserted the "one tier"
// rule and every one of them read `billing.featuresForTier(...)` -- the table
// reflected back at itself -- so all three passed green for three days while a
// paying Pro subscriber was shown an unlocked Ask box and refused by the route.
//
// This file CALLS the gate. A test that reads the table to check the table can
// only ever agree with itself; the drift lives between the table and the
// function, so that is where the comparison has to be.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-aigate-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'deenai-gate-secret-long-enough-yes-yes';

const billing = await import('../src/billing.js');
const deenai = await import('../src/deenai.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

const account = plan => ({ id: 'u_' + plan, email: `${plan}@x`, role: 'user', billing: { plan } });

// tier -> a plan id that really sits at it, so this drives the same
// normalisation a customer's stored record goes through.
const PLANS = { free: 'free', pro: 'pro_monthly', studio: 'studio_monthly' };

test('every DeenAI gate answers exactly what the FEATURES table sells', () => {
  const gates = [
    ['deenai', deenai.deenaiAccess],
    ['deenaiAsk', deenai.deenaiAskAccess],
  ];
  for (const [feature, gate] of gates) {
    assert.ok(billing.FEATURES[feature], `${feature} is in the table`);
    for (const [tier, plan] of Object.entries(PLANS)) {
      const user = account(plan);
      const sold = billing.planFeatures(user)[feature];
      const allowed = gate(user);
      assert.equal(allowed, sold,
        `${feature} at ${tier}: the table says ${sold} and the gate says ${allowed}. `
        + 'A feature sold at one tier and enforced at another is how a paying customer '
        + 'is shown a control and then refused it.');
    }
  }
});

test('the gates read the table rather than a typed tier', () => {
  // The property, not the spelling: a literal tier string in either gate is
  // exactly what drifted, so it is banned in the two functions themselves.
  const src = fs.readFileSync(new URL('../src/deenai.js', import.meta.url), 'utf8');
  for (const name of ['deenaiAccess', 'deenaiAskAccess']) {
    const at = src.indexOf(`export function ${name}(user) {`);
    const fn = at < 0 ? null : [src.slice(at, src.indexOf('\n}', at))];
    assert.ok(fn, `${name} is declared`);
    assert.match(fn[0], /billing\.FEATURES\./, `${name} reads the table`);
    assert.doesNotMatch(fn[0], /'(free|pro|studio)'/, `${name} names no tier of its own`);
  }
});

test('a refusal names the tier the gate actually enforces', () => {
  // The 403 said "Studio feature" while the gate was about to move to Pro.
  // Whatever the table says next, the sentence follows it.
  const tier = billing.FEATURES.deenaiAsk.tier;
  const expected = tier.charAt(0).toUpperCase() + tier.slice(1);
  assert.equal(deenai.deenaiAskTierName(), expected);
  // And it tracks the table rather than being a second copy of today's answer.
  const pretend = { FEATURES: { deenaiAsk: { tier: 'studio' } } };
  assert.equal(deenai.deenaiAskTierName(pretend), 'Studio');
});

test('both halves of DeenAI still sit at ONE tier', () => {
  // The law v3.122.0 set: "Two gates at two tiers is what let a button sell the
  // wrong plan in v3.72.10; one tier cannot." Asserted here against the GATES,
  // where the older tests assert it against the table.
  for (const plan of Object.values(PLANS)) {
    const user = account(plan);
    assert.equal(deenai.deenaiAccess(user), deenai.deenaiAskAccess(user),
      `on ${plan} the insights and the ask must unlock together`);
  }
});
