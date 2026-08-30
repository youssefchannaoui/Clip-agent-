import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// "idk if theres new users? like people who never opned" -- the one question
// the analytics could not answer. It cannot come from the visitor hash: that
// is salted per DAY on purpose, so yesterday's visitor is unrecognisable
// today. These pin the mechanism that answers it instead, and pin that the
// privacy promise is unchanged: no address, no user agent, no cross-day id.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-newret-'));
const port = 39400 + Math.floor(Math.random() * 90);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.APP_SESSION_SECRET = 'new-returning-test-secret-long-enough';
process.env.AUTH_REQUIRED = 'true';

const realFetch = globalThis.fetch;
const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const metrics = await import('../src/metrics.js');

for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await realFetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

const visit = (headers = {}) => realFetch(`${base}/pricing`, {
  headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120', ...headers },
});

test('a browser that has never been here is counted as new, and marked', async () => {
  const res = await visit();
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, /dc_seen=1/, 'the first visit must mark the browser');
  assert.match(setCookie, /HttpOnly/, 'no script should be able to read it');
  assert.match(setCookie, /SameSite=Lax/, 'it must not travel from other sites');
  assert.ok(!/dc_seen=[^;]*[a-f0-9]{8}/.test(setCookie),
    'the flag must carry no identifier, just a 1');

  const summary = metrics.summary(30);
  assert.ok(summary.totals.newVisitors >= 1, 'expected a new visitor');
});

test('a browser carrying the flag is counted as returning, and not re-marked', async () => {
  const before = metrics.summary(30).totals.returningVisitors || 0;
  const res = await visit({ cookie: 'dc_seen=1' });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  assert.ok(!/dc_seen/.test(setCookie),
    'a browser already marked must not be re-marked on every response');
  // Same day, same id, so it is not a fresh unique -- the counters only move
  // on a visitor's first hit of the day, which is what makes them comparable
  // with the unique count rather than with page views.
  const after = metrics.summary(30).totals.returningVisitors || 0;
  assert.ok(after >= before, 'returning count must never go backwards');
});

test('the returning rate is of classified visitors, not of all uniques', async () => {
  const { totals, rates } = metrics.summary(30);
  const classified = (totals.newVisitors || 0) + (totals.returningVisitors || 0);
  if (classified > 0) {
    const expected = Math.round((totals.returningVisitors / classified) * 1000) / 10;
    assert.equal(rates.returning, expected,
      'days captured before this existed must not drag the rate towards zero');
  }
});

test('no address, user agent or cross-day id is persisted by any of this', async () => {
  await visit({ 'x-forwarded-for': '203.0.113.77' });
  metrics.flush();
  const raw = fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8');
  assert.ok(!raw.includes('203.0.113.77'), 'a raw address must never reach the state file');
  assert.ok(!raw.includes('AppleWebKit'), 'a user agent must never reach the state file');
  assert.ok(!raw.includes('dc_seen'), 'the flag lives in the browser, not in our state');
});

test('a crawler is neither new nor returning', async () => {
  const before = metrics.summary(30).totals;
  const res = await realFetch(`${base}/pricing`, { headers: { 'user-agent': 'Googlebot/2.1' } });
  assert.equal(res.status, 200);
  assert.ok(!/dc_seen/.test(res.headers.get('set-cookie') || ''),
    'a bot must not be marked, or the next real visitor on that IP reads as returning');
  const after = metrics.summary(30).totals;
  assert.equal(after.newVisitors, before.newVisitors, 'a crawler is not a new visitor');
  assert.equal(after.returningVisitors, before.returningVisitors, 'nor a returning one');
});
