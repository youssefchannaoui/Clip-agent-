import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The affiliate routes, over HTTP, with real accounts.
 *
 * The engine's arithmetic is driven in `affiliates.test.mjs`. What can only be
 * tested here is who is allowed to CALL it: the operator routes decide who is
 * approved and who is paid, and an affiliate's own route must never carry
 * another account's payout details or another customer's identity.
 *
 * The sign-up throttle is real and a file that spends it reports a broken
 * route when the route is fine — three accounts, made once, reused throughout.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-affroutes-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
// Deliberately NOT one of the accounts below: the ADMIN_EMAIL record is seeded
// at boot and is provider-backed, so signing up with that address does not
// produce a session. The operator here is an ordinary account promoted by
// ROLE, which is what `requireOperator` actually reads.
process.env.ADMIN_EMAIL = 'seeded-owner@deenclipped.test';
process.env.APP_SESSION_SECRET = 'affiliate-routes-secret-long-enough-for-the-check';
process.env.SOCIAL_TOKEN_KEY = 'affiliate-routes-social-key-over-32-characters';

const { server } = await import('../src/server.js');
const base = `http://127.0.0.1:${server.address().port}`;
const store = await import('../src/store.js');

test.after(() => new Promise(resolve => {
  server.close(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 }); } catch {}
    resolve();
  });
}));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

async function signup(email) {
  const res = await fetch(`${base}/auth/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ email, password: 'correct horse battery staple', returnTo: '/' }),
    redirect: 'manual',
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('dc_session='), `${email} did not sign up`);
  return cookie;
}

const operator = await signup('operator@deenclipped.test');
const creator = await signup('creator@deenclipped.test');
const stranger = await signup('stranger@deenclipped.test');

// The operator check is a ROLE, never a plan -- a customer cannot set their
// own, which is what keeps these routes closed.
store.state.authUsers.find(u => u.email === 'operator@deenclipped.test').role = 'owner';

const call = (cookie, url, body, method = 'POST') => fetch(`${base}${url}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const get = (cookie, url) => call(cookie, url, undefined, 'GET');

const APPLICATION = {
  audience: '40k subscribers, weekly khutbah clips',
  payoutMethod: 'wise',
  payoutDetail: 'creator-payout@example.com',
  agreed: true,
};

test('signed out, the programme says nothing at all', async () => {
  assert.equal((await get('', '/api/affiliate')).status, 401);
  assert.equal((await call('', '/api/affiliate/apply', APPLICATION)).status, 401);
});

test('applying refuses without the terms, and then works', async () => {
  const refused = await call(creator, '/api/affiliate/apply', { ...APPLICATION, agreed: false });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /terms/);

  const ok = await call(creator, '/api/affiliate/apply', APPLICATION);
  const okBody = await ok.json().catch(() => ({}));
  assert.equal(ok.status, 200, JSON.stringify(okBody));
  assert.equal(okBody.status, 'pending');

  const again = await call(creator, '/api/affiliate/apply', APPLICATION);
  assert.equal(again.status, 400, 'a second application is refused');
});

test('a customer cannot approve themselves, or read the ledger', async () => {
  // The whole programme's integrity is this: only an operator decides.
  const decide = await call(creator, '/api/owner/affiliates/decide', { userId: 'user_creator', status: 'approved' });
  assert.ok(decide.status === 404 || decide.status === 403, `got ${decide.status}`);

  const ledger = await get(creator, '/api/owner/affiliates');
  assert.ok(ledger.status === 404 || ledger.status === 403, `got ${ledger.status}`);

  const payout = await call(creator, '/api/owner/affiliates/payout', { userId: 'user_creator', keys: ['in_x'] });
  assert.ok(payout.status === 404 || payout.status === 403, `got ${payout.status}`);
});

test('the operator sees the application, and the payout detail is on THAT screen only', async () => {
  const res = await get(operator, '/api/owner/affiliates');
  assert.equal(res.status, 200);
  const body = await res.json();
  const app = body.applications.find(a => a.audience === APPLICATION.audience);
  assert.ok(app, 'the application is listed');
  assert.equal(app.payoutDetail, APPLICATION.payoutDetail,
    'the operator is the one who has to pay it, so they are the one who sees it');
  assert.equal(body.terms.percent, 25);
});

test('an affiliate\'s own view never carries their payout detail', async () => {
  const body = await (await get(creator, '/api/affiliate')).json();
  assert.equal(body.status, 'pending');
  assert.ok(!JSON.stringify(body).includes(APPLICATION.payoutDetail),
    'the payload has no reason to carry a bank account back to the browser');
  assert.match(body.url, /\/r\/[A-Z0-9]+$/, 'the invite link IS the affiliate link');
});

test('approval is what starts commission, and a stranger cannot read the statement', async () => {
  const creatorId = store.state.authUsers.find(u => u.email === 'creator@deenclipped.test').id;
  const decided = await call(operator, '/api/owner/affiliates/decide', { userId: creatorId, status: 'approved' });
  assert.equal(decided.status, 200, JSON.stringify(await decided.json().catch(() => ({}))));

  const mine = await (await get(creator, '/api/affiliate')).json();
  assert.equal(mine.status, 'approved');
  assert.ok(mine.statement, 'an approved affiliate gets a statement');

  // There is no id on this route to tamper with -- it reads currentUser -- so
  // the strongest thing to assert is that a different session gets a different
  // answer rather than the affiliate's.
  const theirs = await (await get(stranger, '/api/affiliate')).json();
  assert.equal(theirs.status, 'none');
  assert.equal(theirs.statement, undefined);
});

test('a payout cannot be recorded for commission that does not exist', async () => {
  const creatorId = store.state.authUsers.find(u => u.email === 'creator@deenclipped.test').id;
  const res = await call(operator, '/api/owner/affiliates/payout', { userId: creatorId, keys: ['in_invented'] });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not this affiliate|Nothing selected/);
});

test('the whole programme goes quiet when it is switched off', async () => {
  const { config } = await import('../src/config.js');
  const was = config.affiliatesEnabled;
  config.affiliatesEnabled = false;
  try {
    const view = await (await get(stranger, '/api/affiliate')).json();
    assert.equal(view.enabled, false, 'the panel must not offer a programme that is closed');
    const apply = await call(stranger, '/api/affiliate/apply', APPLICATION);
    assert.equal(apply.status, 400);
  } finally { config.affiliatesEnabled = was; }
});

test('the public terms page states the rates the engine actually applies', async () => {
  const { config } = await import('../src/config.js');
  const page = await (await fetch(`${base}/affiliates`)).text();
  // Read from config on BOTH sides: a page quoting a rate the engine does not
  // apply is the fault this codebase has paid for with prices and trial
  // lengths, and here the disagreement would be about somebody's commission.
  assert.ok(page.includes(`${config.affiliateCommissionPercent}%`), 'the rate is on the page');
  assert.ok(page.includes(`${config.affiliateCookieDays}-day window`), 'the attribution window is on the page');
  assert.ok(page.includes(`${config.affiliatePendingDays}-day hold`), 'the hold is on the page');
  // The refusals are the substance. A programme that does not say these up
  // front argues about them after the money is owed.
  for (const rule of ['Referring yourself', 'Bidding on our name', 'Coupon and deal sites']) {
    assert.ok(page.includes(rule), `the terms do not forbid: ${rule}`);
  }
});

test('the invite cookie and the terms agree about the attribution window', async () => {
  const { config } = await import('../src/config.js');
  const res = await fetch(`${base}/r/ABCD2345`, { redirect: 'manual' });
  const cookies = res.headers.getSetCookie().join(' ; ');
  const seconds = config.affiliateCookieDays * 24 * 60 * 60;
  assert.match(cookies, new RegExp(`Max-Age=${seconds}\\b`),
    'one cookie carries both the token referral and the commission claim, so there is one window');
  // The privacy policy names it too, and a stale number there is a false
  // statement about what is stored rather than a cosmetic drift.
  const privacy = await (await fetch(`${base}/privacy`)).text();
  assert.ok(privacy.includes(`kept for ${config.affiliateCookieDays} days`),
    'the privacy policy still names the real cookie lifetime');
});
