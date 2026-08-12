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

  const app = await fetch(`${base}/app`, { headers: { Cookie: creatorCookie }, redirect: 'manual' });
  assert.equal(app.status, 200);
  const appHtml = await app.text();
  assert.match(appHtml, /activity-fix\.js\?v=[a-f0-9]{12}/);
  assert.match(appHtml, /premium-dashboard\.js\?v=[a-f0-9]{12}/);
  assert.equal((await fetch(`${base}/premium-dashboard.js`)).status, 200);
});

test('responses carry browser security headers and cross-site mutations are blocked', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

  const blocked = await fetch(`${base}/api/billing/estimate`, {
    method: 'POST',
    headers: { Cookie: creatorCookie, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: 1 }),
  });
  assert.equal(blocked.status, 403);
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

test('owner costs start with the confirmed SocialKit and Hetzner monthly spend', async () => {
  const response = await fetch(`${base}/api/admin/vendors`, { headers: { Cookie: ownerCookie } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.totalMonthly, 54);
  assert.deepEqual(
    payload.vendors.map(vendor => [vendor.name, vendor.cost, vendor.currency, vendor.cycle]).sort(),
    [
      ['Hetzner', 25, 'USD', 'monthly'],
      ['SocialKit', 29, 'USD', 'monthly'],
    ],
  );

  const creatorResponse = await fetch(`${base}/api/admin/vendors`, { headers: { Cookie: creatorCookie } });
  assert.equal(creatorResponse.status, 404);
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

  for (const endpoint of ['/api/billing/topup-checkout', '/api/billing/topup']) {
    const invalid = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: { Cookie: creatorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: 'unknown-pack' }),
    });
    assert.equal(invalid.status, 400, endpoint);
    assert.match((await invalid.json()).error, /valid token pack/i, endpoint);
  }
});

test('top-up API returns actionable account-state codes before opening Stripe', async () => {
  const originalBilling = structuredClone(creator.billing);
  try {
    creator.billing = {
      ...creator.billing,
      plan: 'free', status: 'free',
      periodStart: Date.now() - 10 * 86_400_000,
      freeExpiresAt: Date.now() - 86_400_000,
    };
    let response = await fetch(`${base}/api/billing/topup`, {
      method: 'POST',
      headers: { Cookie: creatorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: 'boost100' }),
    });
    assert.equal(response.status, 400);
    let payload = await response.json();
    assert.equal(payload.code, 'topups_require_active_plan');
    assert.equal(payload.expiredAt, creator.billing.freeExpiresAt);

    creator.billing = {
      ...creator.billing,
      plan: 'monthly', status: 'past_due',
      periodStart: Date.now(), periodEnd: Date.now() + 30 * 86_400_000,
    };
    response = await fetch(`${base}/api/billing/topup-checkout`, {
      method: 'POST',
      headers: { Cookie: creatorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: 'boost100' }),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.equal(payload.code, 'billing_past_due');
    assert.equal(payload.plan, 'monthly');
  } finally {
    creator.billing = originalBilling;
  }
});

test('Brand Kit enforces free watermarking and unlocks paid controls', async () => {
  creator.billing.plan = 'free';
  creator.billing.status = 'free';
  let response = await fetch(`${base}/api/brand-settings`, {
    method: 'POST',
    headers: { Cookie: creatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ watermarkEnabled: false, watermarkText: 'REMOVE ME', watermarkOpacity: 10 }),
  });
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.features.watermarkRequired, true);
  assert.equal(payload.settings.watermarkEnabled, true);
  assert.equal(payload.settings.watermarkText, 'DEENCLIPPED');
  assert.ok(payload.settings.watermarkOpacity >= 72);

  creator.billing.plan = 'monthly';
  creator.billing.status = 'active';
  response = await fetch(`${base}/api/brand-settings`, {
    method: 'POST',
    headers: { Cookie: creatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ watermarkEnabled: false, watermarkText: 'Creator Studio', watermarkOpacity: 55 }),
  });
  assert.equal(response.status, 200);
  payload = await response.json();
  assert.equal(payload.features.canRemoveWatermark, true);
  assert.equal(payload.settings.watermarkEnabled, false);
  assert.equal(payload.settings.watermarkText, 'Creator Studio');

  response = await fetch(`${base}/api/brand-settings`, {
    method: 'POST',
    headers: { Cookie: creatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandVocabulary: ['Alhamdulillah', 'Sulaiman'], audience: 'students',
      contentGoal: 'growth', brandTone: 'warm', avoidPhrases: ['guaranteed viral'],
    }),
  });
  payload = await response.json();
  assert.deepEqual(payload.settings.brandVocabulary, ['Alhamdulillah', 'Sulaiman']);
  assert.equal(payload.settings.audience, 'students');
  assert.equal(payload.settings.contentGoal, 'growth');
  assert.equal(payload.settings.brandTone, 'warm');
  assert.deepEqual(payload.settings.avoidPhrases, ['guaranteed viral']);

  response = await fetch(`${base}/api/brand-settings`, {
    method: 'POST',
    headers: { Cookie: creatorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ brandVocabulary: [], avoidPhrases: [] }),
  });
  payload = await response.json();
  assert.deepEqual(payload.settings.brandVocabulary, []);
  assert.deepEqual(payload.settings.avoidPhrases, []);
  assert.equal(payload.settings.audience, 'students');
  assert.equal(payload.settings.contentGoal, 'growth');
  assert.equal(payload.settings.brandTone, 'warm');
});

test('clip intelligence and remote queue positions reach the dashboard API', async () => {
  const project = {
    id: 'intelligence-project', userId: creator.id, title: 'Queue test', engine: 'remote',
    status: 'queued', stage: 'Waiting for processing capacity', progress: 4, queuePosition: 2,
    submittedAt: Date.now(), clipCount: 1,
  };
  const growthPack = { primaryTitle: 'A grounded title', alternateTitles: ['Another title'], searchTerms: ['faith'] };
  const clip = {
    id: 'intelligence-clip', userId: creator.id, projectId: project.id, projectTitle: project.title,
    title: 'A grounded title', description: 'Grounded description', transcript: 'Grounded transcript',
    score: 91, scoreBreakdown: { hook: 94, flow: 88, value: 92 }, confidence: 87,
    intelligenceSignals: { opening: 'question' }, growthPack,
    platformMetadata: { youtube: { title: 'A grounded title' } }, status: 'waiting',
  };
  state.projects.push(project); state.clips.push(clip);
  try {
    const payload = await (await fetch(`${base}/api/state`, { headers: { Cookie: creatorCookie } })).json();
    const visibleProject = payload.projects.find(item => item.id === project.id);
    const visibleClip = payload.clips.find(item => item.id === clip.id);
    assert.equal(visibleProject.queuePosition, 2);
    assert.deepEqual(visibleClip.scoreBreakdown, clip.scoreBreakdown);
    assert.equal(visibleClip.confidence, 87);
    assert.deepEqual(visibleClip.growthPack, growthPack);
    assert.equal(visibleClip.platformMetadata.youtube.title, 'A grounded title');
  } finally {
    state.projects = state.projects.filter(item => item.id !== project.id);
    state.clips = state.clips.filter(item => item.id !== clip.id);
  }
});
