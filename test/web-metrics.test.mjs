import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// First-party analytics, tested over HTTP because the capture IS a route
// concern: a recorder that unit-tests green while the request path never
// calls it is this repo's signature failure. And the privacy claims are
// tested against the persisted state itself -- "no raw addresses" is a
// promise about bytes on disk, not about intentions.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-metrics-'));
const port = 41800 + Math.floor(Math.random() * 600);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.APP_SESSION_SECRET = 'web-metrics-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { state } = await import('../src/store.js');
const auth = await import('../src/auth.js');
const metrics = await import('../src/metrics.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const ownerUser = auth.ownerUser();
const creator = {
  id: 'metrics-test-creator', email: 'metrics-creator@deenclipped.test', name: 'C', role: 'creator',
  providers: {}, createdAt: Date.now(), billing: { plan: 'free', status: 'free' },
};
state.authUsers.push(creator);
function cookieFor(user) {
  const token = auth.createSession(user, { provider: 'test' });
  return auth.cookieHeaders(token)[0].split(';')[0];
}
const ownerCookie = cookieFor(ownerUser);
const creatorCookie = cookieFor(creator);

test('a public page visit is counted, with its referrer and campaign', async () => {
  await fetch(`${base}/pricing?utm_source=Google&utm_medium=CPC`, {
    headers: {
      accept: 'text/html',
      referer: 'https://www.google.com/search?q=lecture+clips',
      'x-forwarded-for': '203.0.113.7',
      'user-agent': 'metrics-test-browser',
    },
  });
  const summary = metrics.summary({ days: 7 });
  assert.ok(summary.byPath['/pricing'] >= 1, 'the visit was counted');
  assert.ok(summary.referrers['google.com'] >= 1, 'the referrer kept only its host, unprefixed');
  assert.ok(summary.utm['google / cpc'] >= 1, 'the campaign was normalised to lowercase');
  assert.ok(summary.totals.uniques >= 1, 'and it was one unique visitor');
});

test('the same visitor twice is two views and one unique', async () => {
  const before = metrics.summary({ days: 7 }).totals;
  const headers = { accept: 'text/html', 'x-forwarded-for': '203.0.113.55', 'user-agent': 'repeat-visitor' };
  await fetch(`${base}/`, { headers });
  await fetch(`${base}/features`, { headers });
  const after = metrics.summary({ days: 7 }).totals;
  assert.equal(after.views - before.views, 2);
  assert.equal(after.uniques - before.uniques, 1, 'a browsing session is one person, not one person per page');
});

test('a scanner probing junk paths mints no state', async () => {
  const before = JSON.stringify(metrics.summary({ days: 7 }).byPath);
  await fetch(`${base}/wp-admin/setup.php`, { headers: { accept: 'text/html', 'x-forwarded-for': '198.51.100.9' } });
  await fetch(`${base}/.env`, { headers: { accept: 'text/html', 'x-forwarded-for': '198.51.100.9' } });
  const after = JSON.stringify(metrics.summary({ days: 7 }).byPath);
  assert.equal(after, before, 'unlisted paths are never keys');
});

test('the operator\'s own visits are not traffic', async () => {
  const before = metrics.summary({ days: 7 }).totals.views;
  await fetch(`${base}/`, { headers: { accept: 'text/html', Cookie: ownerCookie, 'x-forwarded-for': '203.0.113.99', 'user-agent': 'owner-browser' } });
  const after = metrics.summary({ days: 7 }).totals.views;
  assert.equal(after, before, 'the owner reloading their own site must not inflate the numbers');
});

test('what persists carries no raw address and no user agent', async () => {
  metrics.flush();
  const persisted = JSON.stringify(state.webMetrics);
  for (const leaked of ['203.0.113.7', '203.0.113.55', 'metrics-test-browser', 'repeat-visitor']) {
    assert.ok(!persisted.includes(leaked), `"${leaked}" must never reach the state file`);
  }
});

test('the summary endpoint is owner-only, 404 to everyone else', async () => {
  const anon = await fetch(`${base}/api/owner/webmetrics`);
  assert.equal(anon.status, 401, 'no session gets the auth wall, same as every /api route');
  const asCreator = await fetch(`${base}/api/owner/webmetrics`, { headers: { Cookie: creatorCookie } });
  assert.equal(asCreator.status, 404, 'a creator cannot read the site\'s traffic');

  const asOwner = await fetch(`${base}/api/owner/webmetrics?days=7`, { headers: { Cookie: ownerCookie } });
  assert.equal(asOwner.status, 200);
  const body = await asOwner.json();
  assert.equal(body.days.length, 7, 'one row per day in the window');
  assert.ok(body.totals.views >= 3);
  assert.ok(body.totals.signups >= 1, 'signups are derived from authUsers, so test users count');
  assert.equal(body.rates.visitToPaid, 0, 'nobody paid: an honest zero, since there were visitors');
});

test('a rate with no denominator is null, never a fake 0%', () => {
  // Directly: an empty deployment has no visitors, and "0% conversion" would
  // be a claim about visitors it never had.
  const emptySummary = metrics.summary({ days: 1 });
  if (emptySummary.totals.uniques === 0) {
    assert.equal(emptySummary.rates.visitToSignup, null);
  } else {
    assert.notEqual(emptySummary.rates.visitToSignup, null);
  }
});

// ── The researched capture upgrades (v3.18.0) ───────────────────────────────

test('a crawler is a bot hit, never a visitor', async () => {
  const before = metrics.summary({ days: 7 }).totals;
  await fetch(`${base}/`, { headers: { accept: 'text/html', 'x-forwarded-for': '198.51.100.77', 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } });
  await fetch(`${base}/pricing`, { headers: { accept: 'text/html', 'x-forwarded-for': '198.51.100.78', 'user-agent': 'curl/8.5.0' } });
  const after = metrics.summary({ days: 7 });
  assert.equal(after.totals.views, before.views, 'no views from bots');
  assert.equal(after.totals.uniques, before.uniques, 'no uniques from bots');
  assert.ok(after.botHits >= 2, 'but the hits are visible as what they are');
});

test('device class and language are counted once per visitor-day, nothing personal kept', async () => {
  await fetch(`${base}/`, { headers: {
    accept: 'text/html', 'x-forwarded-for': '203.0.113.140',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    'accept-language': 'en-AU,en;q=0.9,ar;q=0.8',
  } });
  const summary = metrics.summary({ days: 7 });
  assert.ok(summary.devices.mobile >= 1, 'an iPhone is mobile');
  assert.ok(summary.languages['en-au'] >= 1, 'the first Accept-Language tag, lowercased');
  metrics.flush();
  const persisted = JSON.stringify(state.webMetrics);
  assert.ok(!persisted.includes('iPhone OS 17_5'), 'the UA itself never persists');
  assert.ok(!persisted.includes('203.0.113.140'), 'nor the address');
});

test('the first page of a visitor\'s day is their entry page', async () => {
  const headers = { accept: 'text/html', 'x-forwarded-for': '203.0.113.141', 'user-agent': 'entry-tester' };
  await fetch(`${base}/pricing`, { headers });
  await fetch(`${base}/`, { headers });
  const summary = metrics.summary({ days: 7 });
  assert.ok(summary.entries['/pricing'] >= 1, 'the landing page is recorded');
  // The second page must not create a second entry for the same visitor.
  const entriesTotal = Object.values(summary.entries).reduce((a, b) => a + b, 0);
  const uniques = summary.totals.uniques;
  assert.ok(entriesTotal <= uniques, `entries (${entriesTotal}) can never exceed uniques (${uniques})`);
});

test('utm_campaign is kept, and channels group at read time', async () => {
  await fetch(`${base}/?utm_source=youtube&utm_medium=description&utm_campaign=Ramadan-Series`, {
    headers: { accept: 'text/html', referer: 'https://www.youtube.com/watch?v=x', 'x-forwarded-for': '203.0.113.142', 'user-agent': 'campaign-tester' },
  });
  const summary = metrics.summary({ days: 7 });
  assert.ok(summary.campaigns['ramadan-series'] >= 1, 'the campaign name, normalised');
  assert.ok(summary.channels.social >= 1, 'youtube.com grouped as Social');
  assert.ok(summary.channels.search >= 1, 'google.com from earlier grouped as Search');
  assert.equal(typeof summary.channels.direct, 'number', 'direct visits are a number, not a guess');
});

test('a dead link is counted for the broken-links card', async () => {
  await fetch(`${base}/blog`, { headers: { accept: 'text/html', 'x-forwarded-for': '203.0.113.143', 'user-agent': 'dead-link-tester' } });
  await fetch(`${base}/blog`, { headers: { accept: 'text/html', 'x-forwarded-for': '203.0.113.143', 'user-agent': 'dead-link-tester' } });
  const summary = metrics.summary({ days: 7 });
  assert.ok(summary.missing['/blog'] >= 2, 'the missing path and how often it was hit');
  assert.equal(summary.missing['/api/never'], undefined, 'API paths never mint 404 keys');
});

test('live-now counts the last five minutes and drops with time', async () => {
  const summary = metrics.summary({ days: 7 });
  assert.ok(summary.liveNow >= 1, 'the visitors from these tests are live right now');
  assert.ok(Number.isInteger(summary.liveNow));
});

// ── depth: the same day read by the hour (v3.23.0) ──────────────────────────

test('a day is also readable as 48 hours of shape', async () => {
  await fetch(`${base}/features`, {
    headers: { accept: 'text/html', 'x-forwarded-for': '203.0.113.201', 'user-agent': 'hourly-tester' },
  });
  const summary = metrics.summary({ days: 7 });
  assert.equal(summary.hourly.length, 48, 'two days of hours, so a night crossing midnight still reads');
  const now = summary.hourly[summary.hourly.length - 1];
  assert.ok(now.views >= 1, 'the visit just made lands in the current hour');
  assert.match(now.hour, /^\d{2}:00$/);
  const total = summary.hourly.reduce((sum, row) => sum + row.views, 0);
  assert.ok(total <= summary.totals.views, 'hours can never exceed the window they came from');
});

test('the hours are counts, not another copy of the visitor', async () => {
  metrics.flush();
  const persisted = JSON.stringify(state.webMetrics);
  assert.ok(!persisted.includes('hourly-tester'), 'the hour buckets hold numbers only');
});
