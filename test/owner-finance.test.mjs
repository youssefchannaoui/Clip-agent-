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
// Ports 32768-60999 are Linux's EPHEMERAL range: the kernel hands them out
// to outgoing sockets, so a port chosen there can be taken between the
// choice and the listen. The file then dies with EADDRINUSE and the run
// reports FEWER TESTS rather than a failure anyone can read -- measured at
// 1 abort in 6 full runs. This window is below the range, and every test
// file gets its own so two cannot collide with each other either.
const port = 18800 + Math.floor(Math.random() * 100);
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
  const reads = ['/api/owner/finance', '/api/owner/costs', '/api/owner/webmetrics'];
  for (const pathname of reads) {
    const denied = await fetch(`${base}${pathname}`, { headers: { Cookie: creatorCookie }, redirect: 'manual' });
    assert.equal(denied.status, 404, `${pathname} hides from a creator`);
    const allowed = await fetch(`${base}${pathname}`, { headers: { Cookie: ownerCookie }, redirect: 'manual' });
    assert.equal(allowed.status, 200, `${pathname} opens for the operator`);
  }

  // The standalone /owner page was replaced by the Owner tab inside the
  // studio (28 Aug 2026). Gone means gone for the operator too: a page that
  // still answered would be a second, unmaintained copy of the books.
  for (const gone of ['/owner', '/owner.js', '/owner.css']) {
    const response = await fetch(`${base}${gone}`, { headers: { Cookie: ownerCookie, accept: 'text/html' }, redirect: 'manual' });
    assert.equal(response.status, 404, `${gone} no longer exists for anyone`);
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

test('a signed-out visitor learns nothing from the retired /owner path', async () => {
  // It used to redirect to sign-in. Now the route is gone for everyone, which
  // leaks even less: signed out, signed in and operator all see the same 404.
  const response = await fetch(`${base}/owner`, { redirect: 'manual' });
  assert.equal(response.status, 404);
});

// This used to assert that NO seeded entry carried a price. The rule it was
// protecting is narrower than that and still holds: never invent an amount. A
// figure read off the vendor's own receipt is not an invention, and refusing to
// record it only meant the burn total read as zero -- the exact failure the
// test was written to prevent. So what is pinned now is the real rule: priced
// only where a receipt proves it, blank and flagged everywhere else.
test('the seeded ledger prices only what a receipt proves, and flags the rest', async () => {
  const seeded = owner.costs(ownerUser);
  assert.ok(seeded.length >= 4, 'this deployment\'s infrastructure is seeded');

  const priced = seeded.filter(entry => !entry.needsAmount);
  const unpriced = seeded.filter(entry => entry.needsAmount);
  assert.ok(priced.length >= 2, 'the receipted subscriptions carry their real amounts');
  assert.ok(unpriced.length >= 1, 'the ones with no receipt stay blank rather than guessing');
  for (const entry of unpriced) assert.equal(entry.monthlyMinor, 0, `${entry.name} contributes nothing`);

  const finance = await owner.finance(ownerUser);
  assert.equal(
    finance.moneyOut.monthlyBurnMinor,
    priced.reduce((sum, entry) => sum + entry.monthlyMinor, 0),
    'burn is exactly the receipted amounts, with nothing imputed for the rest',
  );
  assert.equal(finance.moneyOut.unpricedCount, unpriced.length);
  // The important part, unchanged: a burn missing entries must never read as complete.
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

// Every other test here starts from an empty DATA_DIR, which takes the fresh
// seed path. The deployment that matters took the other one: it was seeded
// months ago and is carrying four rows with no amounts, so unless the revision
// replays over them it learns nothing and the page keeps reporting zero burn.
test('a ledger seeded before the receipts were read is brought up to date', async () => {
  const savedLedger = state.ownerCosts;
  const savedRevision = state.ownerCostsRevision;
  try {
    // Exactly the shape the old seeding produced.
    state.ownerCosts = [
      { id: 'cost_seed_1', name: 'Render — web service', vendor: 'Render', category: 'hosting', cadence: 'monthly', amountMinor: 0, currency: 'aud', nextDueAt: null, active: true },
      { id: 'cost_seed_2', name: 'Hetzner — render worker', vendor: 'Hetzner', category: 'hosting', cadence: 'monthly', amountMinor: 0, currency: 'aud', nextDueAt: null, active: true },
      { id: 'cost_seed_3', name: 'Cloudflare R2 — media storage', vendor: 'Cloudflare', category: 'storage', cadence: 'monthly', amountMinor: 0, currency: 'aud', nextDueAt: null, active: true },
      { id: 'cost_seed_4', name: 'Domain — deenclipped.online', vendor: 'Registrar', category: 'domain', cadence: 'yearly', amountMinor: 0, currency: 'aud', nextDueAt: null, active: true },
    ];
    delete state.ownerCostsRevision;

    const ledger = owner.costs(ownerUser);
    const byName = name => ledger.find(row => row.name === name);

    // Filled in place: same row, now carrying the invoice's figure.
    const render = byName('Render — web service');
    assert.equal(render.id, 'cost_seed_1', 'the existing row is updated, not duplicated');
    assert.equal(render.amountMinor, 174);
    assert.equal(render.currency, 'usd');
    assert.ok(render.nextDueAt > Date.now(), 'and its date is live, not the anchor in the past');

    // Vendors the old seed never knew about have to arrive.
    assert.equal(byName('Webshare — proxy pool')?.amountMinor, 600);
    assert.ok(byName('Anthropic — Claude Pro'), 'Claude Pro is added');
    assert.equal(byName('Anthropic — Claude Pro').needsAmount, true, 'with no amount invented for it');

    // And the ones with no receipt stay exactly as they were.
    for (const name of ['Hetzner — render worker', 'Cloudflare R2 — media storage', 'Domain — deenclipped.online']) {
      assert.equal(byName(name).amountMinor, 0, `${name} is left blank`);
    }
    assert.equal(ledger.filter(row => row.name === 'Render — web service').length, 1, 'no row is duplicated');
  } finally {
    state.ownerCosts = savedLedger;
    state.ownerCostsRevision = savedRevision;
  }
});

// A figure the owner typed is better than ours and must survive the replay.
test('the seed replay never overwrites an amount the owner set themselves', async () => {
  const savedLedger = state.ownerCosts;
  const savedRevision = state.ownerCostsRevision;
  try {
    state.ownerCosts = [
      { id: 'cost_seed_1', name: 'Render — web service', vendor: 'Render', category: 'hosting', cadence: 'monthly', amountMinor: 4200, currency: 'aud', nextDueAt: Date.UTC(2026, 0, 9, 12), active: true },
    ];
    delete state.ownerCostsRevision;

    const render = owner.costs(ownerUser).find(row => row.name === 'Render — web service');
    assert.equal(render.amountMinor, 4200, 'their amount stands');
    assert.equal(render.currency, 'aud', 'and so does their currency');
    assert.equal(new Date(render.nextDueAt).getUTCDate(), 9, 'and their billing day');
  } finally {
    state.ownerCosts = savedLedger;
    state.ownerCostsRevision = savedRevision;
  }
});

// The roll is the whole reason these dates can be left alone, so it has to land
// on the day the vendor actually charges. Stepping by 30 days walks a monthly
// bill backwards through the calendar -- twelve steps is 360 days -- and that
// drift is invisible until a renewal is reported five days before it happens.
test('a rolled due date keeps the day of the month it was anchored to', async () => {
  const anchor = Date.UTC(2024, 0, 26, 12);
  const cost = owner.upsertCost(ownerUser, {
    name: 'Anchored monthly', amount: 6, cadence: 'monthly', nextDueAt: anchor,
  });
  const entry = owner.costs(ownerUser).find(row => row.id === cost.id);
  assert.equal(new Date(entry.nextDueAt).getUTCDate(), 26,
    'a bill charged on the 26th is still due on a 26th years later');
  assert.ok(entry.nextDueAt > Date.now(), 'and it is in the future');

  const yearly = owner.upsertCost(ownerUser, {
    name: 'Anchored yearly', amount: 20, cadence: 'yearly', nextDueAt: Date.UTC(2020, 1, 29, 12),
  });
  const yearlyEntry = owner.costs(ownerUser).find(row => row.id === yearly.id);
  // 29 Feb only exists in a leap year, so the clamp has to pick 28 Feb without
  // ever moving the anchor -- otherwise each leap year loses another day.
  assert.equal(new Date(yearlyEntry.nextDueAt).getUTCMonth(), 1, 'a February renewal stays in February');
  assert.ok([28, 29].includes(new Date(yearlyEntry.nextDueAt).getUTCDate()),
    'and lands on the last February day that exists that year');

  // A 31st clamped into a 30-day month must come back to the 31st, not stick.
  const endOfMonth = owner.upsertCost(ownerUser, {
    name: 'Anchored 31st', amount: 5, cadence: 'monthly', nextDueAt: Date.UTC(2024, 0, 31, 12),
  });
  const days = new Set();
  for (let month = 0; month < 14; month += 1) {
    const at = Date.UTC(2024, month, 15, 12);
    const rolled = owner.costs(ownerUser).find(row => row.id === endOfMonth.id);
    if (rolled.nextDueAt > at) days.add(new Date(rolled.nextDueAt).getUTCDate());
  }
  assert.ok([...days].some(day => day === 31) || days.size <= 1,
    'the 31st is not permanently lost to a short month');

  for (const entry of [cost, yearly, endOfMonth]) owner.removeCost(ownerUser, entry.id);
});

// The ledger is only useful if it holds the real bills. Amounts come from the
// vendor's own receipt or they are left blank and flagged -- a plausible-looking
// hosting figure is indistinguishable from a real one inside a burn total.
test('the seeded ledger carries the receipted subscriptions and flags the rest', async () => {
  const ledger = owner.costs(ownerUser);
  const byName = name => ledger.find(row => row.name === name);

  const webshare = byName('Webshare — proxy pool');
  assert.ok(webshare, 'the proxy pool the importer depends on is a tracked cost');
  assert.equal(webshare.amountMinor, 600, 'US$6.00, from the 26 Aug receipt');
  assert.equal(webshare.currency, 'usd');
  assert.equal(new Date(webshare.nextDueAt).getUTCDate(), 26, 'billed on the 26th');
  assert.ok(webshare.nextDueAt > Date.now(), 'and the date shown is never in the past');

  const render = byName('Render — web service');
  assert.equal(render.amountMinor, 174, 'US$1.74, from the 5 Aug invoice');
  assert.equal(render.needsAmount, false);

  // No receipt reached the inbox for these, so they must stay blank AND say so.
  for (const name of ['Hetzner — render worker', 'Domain — deenclipped.online']) {
    const entry = byName(name);
    assert.ok(entry, `${name} is listed`);
    assert.equal(entry.amountMinor, 0, `${name} invents no amount`);
    assert.equal(entry.needsAmount, true, `${name} is flagged as needing one`);
  }
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
  // Measured as a delta: the seeded ledger already holds receipted USD costs,
  // so asserting an absolute total here would be asserting the seed, not the
  // currency behaviour this test is about.
  const before = (await owner.finance(ownerUser)).moneyOut.byCurrency;
  const aud = owner.upsertCost(ownerUser, { name: 'AUD thing', amount: 10, currency: 'aud', cadence: 'monthly' });
  const usd = owner.upsertCost(ownerUser, { name: 'USD thing', amount: 10, currency: 'usd', cadence: 'monthly' });
  const finance = await owner.finance(ownerUser);

  assert.equal(finance.moneyOut.byCurrency.aud - (before.aud || 0), 1000);
  assert.equal(finance.moneyOut.byCurrency.usd - (before.usd || 0), 1000);
  // The total still adds up naively -- that is unavoidable without an FX rate.
  // What must never happen is showing it without saying so.
  // Both codes must be named; the order they appear in is insertion order and
  // not something worth pinning.
  assert.match(finance.moneyOut.mixedCurrency, /AUD/);
  assert.match(finance.moneyOut.mixedCurrency, /USD/);
  assert.match(finance.moneyOut.mixedCurrency, /not meaningful/);
  assert.match(finance.profit.completeness, /not meaningful/);

  // The warning must describe the ledger as it actually is, so assert exactly
  // that rather than an empty string: earlier tests leave AUD costs behind and
  // the seeds are USD, so "one currency" is not a state this point in the file
  // can assume. Naming every priced currency, and staying silent only when
  // there is genuinely one, is the whole behaviour.
  const namesItsCurrencies = report => {
    const codes = Object.keys(report.moneyOut.byCurrency);
    if (codes.length > 1) {
      for (const code of codes) {
        assert.match(report.moneyOut.mixedCurrency, new RegExp(code.toUpperCase()),
          `the warning names ${code.toUpperCase()}`);
      }
    } else {
      assert.equal(report.moneyOut.mixedCurrency, '', 'one currency, no warning');
    }
  };
  namesItsCurrencies(finance);
  owner.removeCost(ownerUser, aud.id);
  owner.removeCost(ownerUser, usd.id);
  namesItsCurrencies(await owner.finance(ownerUser));
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
  // The property, not the formula: the rate is the money divided by the days
  // it actually spans. An earlier version of this test pinned the arithmetic
  // instead and had to be rewritten the moment the divisor was corrected.
  assert.equal(log.monthlyAverageMinor, Math.round(log.totalMinor / log.coveredDays * 30));
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

test('the usage average uses the days the payments span, not the window asked for', async () => {
  for (const row of owner.spend(ownerUser, { days: 365 }).rows) owner.removeSpend(ownerUser, row.id);

  // Two payments ten days apart, asked for over a 90-day window. Dividing by 90
  // would report a third of the real rate -- worst on the day you start
  // recording, which is when someone decides whether to trust the page.
  owner.recordSpend(ownerUser, { name: 'A', amount: 10, externalId: 'span-a', paidAt: Date.now() - 10 * DAY });
  owner.recordSpend(ownerUser, { name: 'B', amount: 10, externalId: 'span-b', paidAt: Date.now() - 2 * DAY });

  const log = owner.spend(ownerUser, { days: 90 });
  assert.equal(log.totalMinor, 2000);
  assert.equal(log.coveredDays, 10, 'measured from the earliest payment to now');
  assert.equal(log.monthlyAverageMinor, Math.round(2000 / 10 * 30));

  // Floored at a week, so one charge today cannot extrapolate to a fortune.
  for (const row of log.rows) owner.removeSpend(ownerUser, row.id);
  owner.recordSpend(ownerUser, { name: 'C', amount: 10, externalId: 'span-c', paidAt: Date.now() });
  assert.equal(owner.spend(ownerUser, { days: 90 }).coveredDays, 7);
});
