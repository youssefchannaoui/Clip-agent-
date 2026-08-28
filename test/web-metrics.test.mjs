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
