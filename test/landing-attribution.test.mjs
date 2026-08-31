/*
 * Which landing page earned a subscription.
 *
 * Every other number in metrics.js counts traffic. This one counts money, and
 * it is the only thing that says whether writing landing pages was worth the
 * effort: a page with a thousand visits and no subscription is a page to
 * rewrite or delete, and views alone cannot tell you that.
 *
 * The loop crosses four modules and a Stripe webhook, so it is tested by
 * driving it rather than by asserting any one piece:
 *   arrive on a page  ->  cookie
 *   sign up           ->  cookie read, account stamped, signup counted
 *   subscribe         ->  webhook has NO cookie, reads the account, paid counted
 * The middle step is where it would silently break, because the webhook is the
 * only part that cannot see the browser.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-attr-'));
// Ports 32768-60999 are Linux's EPHEMERAL range: the kernel hands them out
// to outgoing sockets, so a port chosen there can be taken between the
// choice and the listen. The file then dies with EADDRINUSE and the run
// reports FEWER TESTS rather than a failure anyone can read -- measured at
// 1 abort in 6 full runs. This window is below the range, and every test
// file gets its own so two cannot collide with each other either.
const port = 17900 + Math.floor(Math.random() * 100);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.APP_SESSION_SECRET = 'landing-attribution-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const metrics = await import('../src/metrics.js');
const store = await import('../src/store.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

const landingCookie = (setCookie) => {
  const match = /dc_land=([^;]*)/.exec(String(setCookie || ''));
  return match ? decodeURIComponent(match[1]) : '';
};

test('arriving on a landing page sets a cookie holding a path and nothing else', async () => {
  const res = await fetch(`${base}/tools/ai-video-clipper`, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 attribution-test' },
  });
  const raw = res.headers.getSetCookie().join(' ; ');
  assert.equal(landingCookie(raw), '/tools/ai-video-clipper');
  // A path. No identifier, nothing derived from one, nothing to join against.
  assert.ok(!/dc_land=[^;]*[0-9a-f]{16}/.test(raw), 'the landing cookie must never carry an id');
  assert.match(raw, /dc_land=[^;]*;[^,]*HttpOnly/, 'script must not be able to read it');
  assert.match(raw, /dc_land=[^;]*;[^,]*SameSite=Lax/);
});

test('the landing cookie is never overwritten by a later page', async () => {
  // Otherwise the last page before checkout takes the credit that belongs to
  // the page that actually brought them.
  const res = await fetch(`${base}/pricing`, {
    headers: {
      accept: 'text/html',
      'user-agent': 'Mozilla/5.0 attribution-test-2',
      cookie: 'dc_land=%2Ftools%2Fai-video-clipper',
    },
  });
  assert.equal(landingCookie(res.headers.getSetCookie().join(' ; ')), '',
    'a visitor who already has a landing page must keep it');
});

test('setting the landing cookie does not drop the cookies already on the response', async () => {
  // A bare setHeader here would replace the session cookie. Signing people out
  // in order to count them is not a trade worth making -- the same lesson the
  // dc_seen counter had to learn.
  const res = await fetch(`${base}/tools/long-video-to-shorts`, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 attribution-test-3' },
  });
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some(c => c.startsWith('dc_seen=')), 'dc_seen must survive');
  assert.ok(cookies.some(c => c.startsWith('dc_land=')), 'dc_land must be set');
});

test('a hand-edited cookie cannot invent a page to count against', async () => {
  // The value comes from the visitor, so it is checked against the registry
  // before it is used as a state key. Otherwise a scanner mints unbounded
  // state one request at a time.
  metrics.attribute('signup', '/tools/../../etc/passwd');
  metrics.attribute('signup', '/wp-admin');
  metrics.attribute('signup', 'x'.repeat(500));
  const rows = metrics.summary({ days: 1 }).landingPages || [];
  assert.deepEqual(rows.filter(r => !r.path.startsWith('/')), []);
  assert.ok(!rows.some(r => r.path.includes('passwd') || r.path.includes('wp-admin')));
});

test('signing up credits the page the visitor arrived on, and only once', async () => {
  const before = metrics.summary({ days: 1 }).landingPages
    .find(r => r.path === '/islamic-video-clipper')?.signups || 0;

  const form = new URLSearchParams({
    email: `attribution-${Date.now()}@example.com`,
    password: 'a-long-enough-password',
    name: 'Attribution Test',
  });
  const res = await fetch(`${base}/auth/email`, {
    method: 'POST', redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // A browser sends this on every form post, and sign-in refuses anything
      // whose origin is not the site's own PUBLIC_BASE_URL -- not the port the
      // test server happens to be on.
      origin: process.env.PUBLIC_BASE_URL,
      cookie: 'dc_land=%2Fislamic-video-clipper',
    },
    body: form,
  });
  assert.ok([302, 303].includes(res.status), `sign-up returned ${res.status}`);

  const after = metrics.summary({ days: 1 }).landingPages
    .find(r => r.path === '/islamic-video-clipper');
  assert.equal(after.signups, before + 1, 'the landing page should be credited exactly once');

  // Stamped on the account too -- the webhook that reports the payment later
  // carries no cookie, so this field is the only way back to the page.
  const user = store.state.authUsers.find(u => u.email.startsWith('attribution-'));
  assert.equal(user.signupLanding, '/islamic-video-clipper');
});

test('a payment is credited to the page from the account, not from a cookie', async () => {
  const billing = await import('../src/billing.js');
  const user = store.state.authUsers.find(u => u.signupLanding === '/islamic-video-clipper');
  assert.ok(user, 'the previous test should have made one');

  const before = metrics.summary({ days: 1 }).landingPages
    .find(r => r.path === '/islamic-video-clipper')?.paid || 0;

  // Driven through the real webhook handler, because the whole point is that
  // this path has no browser: no cookie, no session, nothing but the account
  // Stripe names. A test that called the recorder directly would prove the
  // recorder works and say nothing about the leg that could actually break.
  user.billing = { ...(user.billing || {}), stripeCustomerId: 'cus_attribution_test' };
  billing.handleWebhookEvent({
    id: `evt_paid_${Date.now()}`,
    type: 'invoice.paid',
    data: { object: {
      id: `in_${Date.now()}`, customer: 'cus_attribution_test',
      amount_paid: 2900, currency: 'aud',
      lines: { data: [{ description: 'Pro monthly' }] },
    } },
  });

  const after = metrics.summary({ days: 1 }).landingPages
    .find(r => r.path === '/islamic-video-clipper');
  assert.equal(after.paid, before + 1, 'the subscription should credit the landing page');
});

test('a renewal does not credit the page a second time', async () => {
  // A subscription renewing monthly is not the landing page winning a new
  // customer every month, and counting it that way would make the oldest page
  // look like the best one.
  const billing = await import('../src/billing.js');
  const user = store.state.authUsers.find(u => u.signupLanding === '/islamic-video-clipper');
  const before = metrics.summary({ days: 1 }).landingPages
    .find(r => r.path === '/islamic-video-clipper').paid;

  billing.handleWebhookEvent({
    id: `evt_renew_${Date.now()}`,
    type: 'invoice.paid',
    data: { object: {
      id: `in_renew_${Date.now()}`, customer: 'cus_attribution_test',
      amount_paid: 2900, currency: 'aud',
      lines: { data: [{ description: 'Pro monthly renewal' }] },
    } },
  });

  const after = metrics.summary({ days: 1 }).landingPages
    .find(r => r.path === '/islamic-video-clipper').paid;
  assert.equal(after, before, 'a renewal must not be counted as a new conversion');
});

test('the table ranks by money, not by traffic', async () => {
  // Sorting by views would put the homepage first forever and answer a
  // question nobody asked.
  const rows = metrics.summary({ days: 1 }).landingPages;
  const earning = rows.findIndex(r => r.paid > 0);
  const nonEarning = rows.findIndex(r => !r.paid && !r.signups);
  if (earning >= 0 && nonEarning >= 0) {
    assert.ok(earning < nonEarning, 'a page that earns must rank above one that does not');
  }
});

test('an invoice with no subscription id is not credited to a stranger', async () => {
  // Found while building the test above, and worse than the bug being looked
  // for. userBySubscription(undefined) compared undefined against every
  // account's stripeSubscriptionId -- also undefined for anyone with a billing
  // record and no subscription -- so the FIRST such account matched and took
  // the money on its books. Both lookups refuse an empty id now.
  const billing = await import('../src/billing.js');
  const before = (store.state.revenueEvents || []).length;
  billing.handleWebhookEvent({
    id: `evt_orphan_${Date.now()}`,
    type: 'invoice.paid',
    data: { object: {
      id: `in_orphan_${Date.now()}`, amount_paid: 500, currency: 'aud',
      lines: { data: [{ description: 'Invoice naming nobody' }] },
    } },
  });
  const added = (store.state.revenueEvents || []).slice(0, (store.state.revenueEvents || []).length - before);
  assert.equal(added.length, 1, 'money that arrived is still recorded');
  assert.equal(added[0].userId, '', 'but it belongs to no account rather than to an arbitrary one');
});

test('attribution keeps no address, user agent or cross-day identifier', async () => {
  // The same assertion the rest of metrics.js is held to, applied to the new
  // map: the state bytes are the evidence, not the intent.
  const bytes = JSON.stringify(store.state.webMetrics || {});
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(bytes), 'no IP addresses in analytics state');
  assert.ok(!/Mozilla|Chrome\/|Safari\//.test(bytes), 'no user agents in analytics state');
});
