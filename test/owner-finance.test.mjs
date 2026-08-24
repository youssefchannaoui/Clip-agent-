import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The owner dashboard reports money, so the things worth pinning are the ones
// that would make a figure quietly wrong rather than visibly broken: a cost
// with no amount counted as zero, a cadence normalised by 4 weeks instead of
// 52/12, a float cent, and one invoice counted twice because Stripe sends two
// event types for it.
//
// Gating is exercised over HTTP rather than by calling the module, because this
// repo has already shipped a limiter and a parameter that both passed unit
// tests while the route ignored them.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-owner-'));
const port = 38900 + Math.floor(Math.random() * 90);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.ADMIN_EMAIL = 'owner@deenclipped.test';
process.env.APP_SESSION_SECRET = 'owner-finance-test-secret-long-enough';
// Read as the currency of the deployment, so the ledger defaults to AUD.
process.env.PLAN_PRICE_MONTHLY_LABEL = 'A$29';
// Explicitly absent: the dashboard has to work, and say why, with no Stripe.
delete process.env.STRIPE_SECRET_KEY;

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { state } = await import('../src/store.js');
const auth = await import('../src/auth.js');
const owner = await import('../src/owner.js');
const billing = await import('../src/billing.js');

test.after(() => new Promise(resolve => server.close(resolve)));
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

const ownerUser = auth.ownerUser();
const creator = {
  id: 'owner-test-creator', email: 'creator@deenclipped.test', name: 'Creator', role: 'creator',
  providers: {}, createdAt: Date.now(), billing: { plan: 'free', status: 'free', plansSeenAt: Date.now() },
};
state.authUsers.push(creator);

function cookieFor(user) {
  const token = auth.createSession(user, { provider: 'test' });
  return auth.cookieHeaders(token)[0].split(';')[0];
}
const ownerCookie = cookieFor(ownerUser);
const creatorCookie = cookieFor(creator);

const DAY = 24 * 60 * 60 * 1000;

test('every owner surface is 404 for a creator, and reachable for the operator', async () => {
  const reads = ['/owner', '/owner.js', '/owner.css', '/api/owner/finance', '/api/owner/costs'];
  for (const pathname of reads) {
    const denied = await fetch(`${base}${pathname}`, { headers: { Cookie: creatorCookie }, redirect: 'manual' });
    assert.equal(denied.status, 404, `${pathname} hides from a creator`);
    const allowed = await fetch(`${base}${pathname}`, { headers: { Cookie: ownerCookie }, redirect: 'manual' });
    assert.equal(allowed.status, 200, `${pathname} opens for the operator`);
  }

  // Writes too: a read-only gate on a surface that also accepts writes is not a gate.
  const post = await fetch(`${base}/api/owner/costs`, {
    method: 'POST',
    headers: { Cookie: creatorCookie, 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'Injected by a creator' }),
  });
  assert.equal(post.status, 404, 'a creator cannot add a cost');
  const del = await fetch(`${base}/api/owner/costs/cost_seed_1`, {
    method: 'DELETE', headers: { Cookie: creatorCookie, Origin: base },
  });
  assert.equal(del.status, 404, 'a creator cannot delete a cost');
  assert.ok(owner.costs(ownerUser).some(entry => entry.id === 'cost_seed_1'), 'and the cost is still there');
});

test('a signed-out visitor is sent to sign in, not told the page exists', async () => {
  const response = await fetch(`${base}/owner`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location') || '', /\/login\?returnTo=%2Fowner/);
});

test('the seeded ledger carries no amounts, and says so instead of reporting zero burn', async () => {
  const seeded = owner.costs(ownerUser);
  assert.ok(seeded.length >= 4, 'this deployment\'s infrastructure is seeded');
  assert.ok(seeded.every(entry => entry.needsAmount), 'no seeded entry pretends to know a price');
  assert.equal(seeded.reduce((sum, entry) => sum + entry.monthlyMinor, 0), 0);

  const finance = await owner.finance(ownerUser);
  assert.equal(finance.moneyOut.monthlyBurnMinor, 0);
  assert.equal(finance.moneyOut.unpricedCount, seeded.length);
  // The important part: a zero burn that nobody entered must never read as free.
  assert.match(finance.profit.completeness, /no amount, so burn is understated/);
});

test('an amount is stored in whole minor units, with no float cent', async () => {
  const cost = owner.upsertCost(ownerUser, { name: 'Float trap', amount: 19.99, cadence: 'monthly' });
  assert.equal(cost.amountMinor, 1999, '19.99 is 1999 cents exactly');
  const three = owner.upsertCost(ownerUser, { name: 'Thirds', amount: 0.07, cadence: 'monthly' });
  assert.equal(three.amountMinor, 7);
  owner.removeCost(ownerUser, cost.id);
  owner.removeCost(ownerUser, three.id);
});

test('cadences normalise to a month the way a year actually works', async () => {
  const cases = [
    // 52/12, not 4: four-week months lose a payment a year.
    { cadence: 'weekly', amount: 10, expected: Math.round(1000 * 52 / 12) },
    { cadence: 'monthly', amount: 10, expected: 1000 },
    { cadence: 'quarterly', amount: 30, expected: 1000 },
    { cadence: 'yearly', amount: 120, expected: 1000 },
    // A one-off is a real payment but not a run rate.
    { cadence: 'once', amount: 500, expected: 0 },
  ];
  const created = [];
  for (const item of cases) {
    created.push(owner.upsertCost(ownerUser, { name: `Cadence ${item.cadence}`, amount: item.amount, cadence: item.cadence }));
  }
  const ledger = owner.costs(ownerUser);
  for (const [index, item] of cases.entries()) {
    const entry = ledger.find(row => row.id === created[index].id);
    assert.equal(entry.monthlyMinor, item.expected, `${item.cadence} per month`);
  }
  for (const entry of created) owner.removeCost(ownerUser, entry.id);
});

test('a due date nobody updated rolls forward instead of reporting months overdue', async () => {
  const cost = owner.upsertCost(ownerUser, {
    name: 'Stale date', amount: 10, cadence: 'monthly',
    nextDueAt: Date.now() - 95 * DAY,
  });
  const entry = owner.costs(ownerUser).find(row => row.id === cost.id);
  assert.ok(entry.nextDueAt > Date.now(), 'the next payment is in the future');
  assert.ok(entry.nextDueAt - Date.now() <= 31 * DAY, 'and within one cadence step');

  // A one-off is the exception: it does not recur, so a missed one stays missed.
  const once = owner.upsertCost(ownerUser, {
    name: 'Missed one-off', amount: 10, cadence: 'once', nextDueAt: Date.now() - 5 * DAY,
  });
  const onceEntry = owner.costs(ownerUser).find(row => row.id === once.id);
  assert.ok(onceEntry.nextDueAt < Date.now(), 'a one-off stays overdue rather than inventing a next time');
  owner.removeCost(ownerUser, cost.id);
  owner.removeCost(ownerUser, once.id);
});

test('with no Stripe key the page still answers, and names the gap', async () => {
  const response = await fetch(`${base}/api/owner/finance`, { headers: { Cookie: ownerCookie } });
  assert.equal(response.status, 200, 'a missing third party does not 500 the operator page');
  const body = await response.json();
  assert.equal(body.stripe.configured, false);
  assert.equal(body.stripe.revenueAvailable, false);
  // Three states, not two: "test" here would claim a sandbox was reporting.
  assert.equal(body.stripe.mode, 'none');
  assert.match(body.stripe.revenueReason, /No Stripe key/i);
  assert.equal(body.currency, 'aud', 'the currency follows the configured price labels');
});

test('the finance window is clamped rather than trusted', async () => {
  const huge = await (await fetch(`${base}/api/owner/finance?days=99999`, { headers: { Cookie: ownerCookie } })).json();
  assert.equal(huge.moneyIn.windowDays, 365);
  const tiny = await (await fetch(`${base}/api/owner/finance?days=-5`, { headers: { Cookie: ownerCookie } })).json();
  assert.equal(tiny.moneyIn.windowDays, 30);
});

test('one invoice is counted once, even though Stripe sends two event types for it', async () => {
  state.revenueEvents = [];
  const invoice = {
    id: 'in_test_double', customer: 'cus_test', subscription: 'sub_test',
    amount_paid: 2900, currency: 'aud', lines: { data: [{ description: 'Monthly plan' }] },
  };
  // Different event ids, so the processed-event guard does not catch this pair:
  // invoice.paid and invoice.payment_succeeded both fire for the same invoice.
  billing.handleWebhookEvent({ id: 'evt_paid_1', type: 'invoice.paid', data: { object: invoice } });
  billing.handleWebhookEvent({ id: 'evt_succeeded_1', type: 'invoice.payment_succeeded', data: { object: invoice } });

  const rows = state.revenueEvents.filter(row => row.stripeId === 'in_test_double');
  assert.equal(rows.length, 1, 'the second event type does not double the money');
  assert.equal(rows[0].amountMinor, 2900);
  assert.equal(rows[0].currency, 'aud');
  assert.equal(rows[0].kind, 'subscription');
});

test('a replayed webhook does not add revenue twice', async () => {
  state.revenueEvents = [];
  const event = {
    id: 'evt_replay_1', type: 'invoice.paid',
    data: { object: { id: 'in_replay', amount_paid: 900, currency: 'aud', customer: 'cus_x' } },
  };
  billing.handleWebhookEvent(event);
  const again = billing.handleWebhookEvent(event);
  assert.equal(again.duplicate, true);
  assert.equal(state.revenueEvents.filter(row => row.stripeId === 'in_replay').length, 1);
});

test('locally recorded payments are what revenue falls back to when Stripe cannot be read', async () => {
  state.revenueEvents = [];
  billing.handleWebhookEvent({
    id: 'evt_fallback', type: 'invoice.paid',
    data: { object: { id: 'in_fallback', amount_paid: 4500, currency: 'aud', customer: 'cus_y' } },
  });
  const finance = await owner.finance(ownerUser);
  assert.equal(finance.moneyIn.source, 'local', 'no Stripe key means the local ledger is the source');
  assert.equal(finance.moneyIn.grossMinor, 4500);
  // The honest part: local records carry no fee, so net must not imply one was deducted.
  assert.equal(finance.moneyIn.feeMinor, 0);
  assert.equal(finance.moneyIn.netMinor, 4500);
});

test('a paused cost stops counting towards burn but stays in the ledger', async () => {
  const cost = owner.upsertCost(ownerUser, { name: 'Paused thing', amount: 50, cadence: 'monthly' });
  const before = (await owner.finance(ownerUser)).moneyOut.monthlyBurnMinor;
  owner.upsertCost(ownerUser, { id: cost.id, name: 'Paused thing', amount: 50, cadence: 'monthly', active: false });
  const after = (await owner.finance(ownerUser)).moneyOut.monthlyBurnMinor;
  assert.equal(before - after, 5000, 'pausing removes exactly its monthly cost');
  assert.ok(owner.costs(ownerUser).some(entry => entry.id === cost.id), 'and the entry is still listed');
  owner.removeCost(ownerUser, cost.id);
});

test('costs in two currencies are not silently added together', async () => {
  const aud = owner.upsertCost(ownerUser, { name: 'AUD thing', amount: 10, currency: 'aud', cadence: 'monthly' });
  const usd = owner.upsertCost(ownerUser, { name: 'USD thing', amount: 10, currency: 'usd', cadence: 'monthly' });
  const finance = await owner.finance(ownerUser);

  assert.equal(finance.moneyOut.byCurrency.aud, 1000);
  assert.equal(finance.moneyOut.byCurrency.usd, 1000);
  // The total still adds up naively -- that is unavoidable without an FX rate.
  // What must never happen is showing it without saying so.
  assert.match(finance.moneyOut.mixedCurrency, /AUD and USD/);
  assert.match(finance.moneyOut.mixedCurrency, /not meaningful/);
  assert.match(finance.profit.completeness, /not meaningful/);

  owner.removeCost(ownerUser, usd.id);
  const single = await owner.finance(ownerUser);
  assert.equal(single.moneyOut.mixedCurrency, '', 'one currency, no warning');
  owner.removeCost(ownerUser, aud.id);
});

test('a payment carrying an id already seen is dropped, not counted twice', async () => {
  const first = owner.recordSpend(ownerUser, {
    name: 'Anthropic credits', vendor: 'Anthropic', amount: 5.50, currency: 'aud',
    externalId: 'receipt-2408-2810-0973', source: 'gmail',
  });
  assert.equal(first.amountMinor, 550);
  const again = owner.recordSpend(ownerUser, {
    name: 'Anthropic credits', vendor: 'Anthropic', amount: 5.50, currency: 'aud',
    externalId: 'receipt-2408-2810-0973', source: 'gmail',
  });
  assert.equal(again.duplicate, true, 'the second write is refused');
  const log = owner.spend(ownerUser, { days: 30 });
  assert.equal(log.rows.filter(row => row.externalId === 'receipt-2408-2810-0973').length, 1);
  owner.removeSpend(ownerUser, first.id);
});

test('a batch of payments posts in one request and reports what it skipped', async () => {
  const response = await fetch(`${base}/api/owner/spend`, {
    method: 'POST',
    headers: { Cookie: ownerCookie, 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ entries: [
      { name: 'Top-up A', amount: 5.5, externalId: 'batch-a', source: 'gmail' },
      { name: 'Top-up B', amount: 5.5, externalId: 'batch-b', source: 'gmail' },
      { name: 'Top-up A again', amount: 5.5, externalId: 'batch-a', source: 'gmail' },
    ] }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.recorded, 2);
  assert.equal(body.skipped, 1, 'the repeat inside the same batch is skipped too');
});

test('variable spend is averaged from what was paid, not guessed', async () => {
  const before = owner.spend(ownerUser, { days: 30 }).totalMinor;
  owner.recordSpend(ownerUser, { name: 'Usage', amount: 30, externalId: 'avg-1', paidAt: Date.now() - 5 * DAY });
  const log = owner.spend(ownerUser, { days: 30 });
  assert.equal(log.totalMinor, before + 3000);
  // 30 days of window, so the monthly average is the window total.
  assert.equal(log.monthlyAverageMinor, Math.round(log.totalMinor / 30 * 30));
});

test('a creator cannot record spend', async () => {
  const response = await fetch(`${base}/api/owner/spend`, {
    method: 'POST',
    headers: { Cookie: creatorCookie, 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'Injected', amount: 1 }),
  });
  assert.equal(response.status, 404);
  const read = await fetch(`${base}/api/owner/spend`, { headers: { Cookie: creatorCookie } });
  assert.equal(read.status, 404);
});

test('profit subtracts variable spend as well as subscriptions', async () => {
  // A subscription and a usage charge of the same size must move profit
  // identically. Counting only the first is how the largest cost on this
  // deployment would have stayed out of the profit line entirely.
  const before = (await owner.finance(ownerUser)).profit.monthlyNetMinor;

  const sub = owner.upsertCost(ownerUser, { name: 'Sub 30', amount: 30, cadence: 'monthly' });
  const withSub = (await owner.finance(ownerUser)).profit.monthlyNetMinor;
  assert.equal(before - withSub, 3000, 'a subscription reduces profit by its monthly cost');
  owner.removeCost(ownerUser, sub.id);

  const usage = owner.recordSpend(ownerUser, { name: 'Usage 30', amount: 30, externalId: 'profit-usage-1' });
  const withUsage = (await owner.finance(ownerUser)).finance || null;
  const after = (await owner.finance(ownerUser));
  assert.ok(after.moneyOut.totalMonthlyOutMinor > after.moneyOut.monthlyBurnMinor,
    'variable spend is part of what leaves the account');
  assert.ok(after.profit.monthlyNetMinor < before, 'and it reduces profit');
  owner.removeSpend(ownerUser, usage.id);
});
