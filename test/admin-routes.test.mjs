import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-admin-'));
const port = 38000 + Math.floor(Math.random() * 1000);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'owner@deenclipped.test';
process.env.APP_SESSION_SECRET = 'admin-route-test-secret-long-enough';
delete process.env.STRIPE_PRICE_TOPUP_100;
delete process.env.STRIPE_PRICE_TOPUP_300;
delete process.env.STRIPE_PRICE_TOPUP_750;

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { state } = await import('../src/store.js');
const auth = await import('../src/auth.js');

test.after(() => new Promise(resolve => server.close(resolve)));

for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

const owner = auth.ownerUser();
const admin = { id: 'route-admin', email: 'admin@deenclipped.test', name: 'Admin', role: 'admin', providers: {}, createdAt: Date.now(), billing: { plan: 'admin', status: 'active', plansSeenAt: Date.now() } };
const creator = { id: 'route-creator', email: 'creator@deenclipped.test', name: 'Creator', role: 'creator', providers: {}, createdAt: Date.now(), billing: { plan: 'free', status: 'free', plansSeenAt: Date.now() } };
owner.billing = { ...(owner.billing || {}), plan: 'admin', status: 'active', plansSeenAt: Date.now() };
state.authUsers.push(admin, creator);

function cookieFor(user) {
  const token = auth.createSession(user, { provider: 'test' });
  return auth.cookieHeaders(token)[0].split(';')[0];
}

const ownerCookie = cookieFor(owner);
const adminCookie = cookieFor(admin);
const creatorCookie = cookieFor(creator);

test('public routes, pricing and dashboard assets remain available', async () => {
  for (const pathname of ['/', '/features', '/pricing', '/contact', '/privacy', '/terms']) {
    const response = await fetch(`${base}${pathname}`);
    assert.equal(response.status, 200, pathname);
  }
  const pricing = await (await fetch(`${base}/pricing`)).text();
  assert.match(pricing, /Token shop/i);
  assert.match(pricing, /Stripe price not configured/i);

  const privacy = await (await fetch(`${base}/privacy`)).text();
  assert.match(privacy, /Google API Services User Data Policy/i);
  assert.match(privacy, /Limited Use requirements/i);
  assert.match(privacy, /completed within 30 days/i);

  const terms = await (await fetch(`${base}/terms`)).text();
  assert.match(terms, /YouTube Terms of Service/i);
  assert.match(terms, /Google Privacy Policy/i);

  // /app now serves the Studio dashboard, which replaces the shell
  // activity-fix.js and premium-dashboard.js build. Both still ship, because
  // ?classic=1 is the escape hatch if the new one misbehaves in production.
  const app = await fetch(`${base}/app`, { headers: { Cookie: creatorCookie }, redirect: 'manual' });
  assert.equal(app.status, 200);
  const studioHtml = await app.text();
  assert.match(studioHtml, /STUDIO_SHELL=true/, 'the Studio dashboard is the default');
  assert.doesNotMatch(studioHtml, /src="\/premium-dashboard\.js"/, 'the old shell is not loaded alongside it');

  const classic = await fetch(`${base}/app?classic=1`, { headers: { Cookie: creatorCookie }, redirect: 'manual' });
  assert.equal(classic.status, 200);
  const classicHtml = await classic.text();
  assert.match(classicHtml, /src="\/premium-dashboard\.js"/, 'the previous dashboard is still reachable');
  assert.doesNotMatch(classicHtml, /STUDIO_SHELL=true/);

  assert.equal((await fetch(`${base}/premium-dashboard.js`)).status, 200);
  assert.equal((await fetch(`${base}/studio-adapter.js`)).status, 200);
});

test('admin analytics accepts owner and admin but rejects creators', async () => {
  for (const cookie of [ownerCookie, adminCookie]) {
    const response = await fetch(`${base}/api/admin/analytics`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.overview.users, 3);
    assert.ok(payload.social);
  }
  const creatorResponse = await fetch(`${base}/api/admin/analytics`, { headers: { Cookie: creatorCookie } });
  assert.equal(creatorResponse.status, 404);
  const anonymousResponse = await fetch(`${base}/api/admin/analytics`);
  assert.equal(anonymousResponse.status, 401);
});

test('billing API reports separated balances and rejects unknown top-up packs', async () => {
  creator.billing.tokensUsed = 10;
  creator.billing.bonusTokens = 25;
  const response = await fetch(`${base}/api/billing`, { headers: { Cookie: creatorCookie } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.current.baseRemaining, 30);
  assert.equal(payload.current.bonusTokens, 25);
  assert.equal(payload.current.remaining, 55);

  const invalid = await fetch(`${base}/api/billing/topup-checkout`, {
    method: 'POST',
    headers: { Cookie: creatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: 'unknown-pack' }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /valid token pack/i);
});
