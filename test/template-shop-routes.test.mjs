import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-template-shop-routes-'));
const port = 38000 + Math.floor(Math.random() * 1000);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.EMAIL_REGISTRATION_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator-template-shop@deenclipped.test';
process.env.SOCIAL_PUBLISH_ENABLED = 'false';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_PRICE_TEMPLATE_MIDNIGHT_SIGNAL;

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { state } = await import('../src/store.js');
test.after(() => new Promise(resolve => server.close(resolve)));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 30)); }
}

async function signUp(email) {
  const response = await fetch(`${base}/auth/email`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: 'a correct long password', returnTo: '/' }),
  });
  return (response.headers.get('set-cookie') || '').split(';')[0];
}

const request = (cookie, pathname, options = {}) => fetch(`${base}${pathname}`, {
  ...options,
  headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(options.headers || {}) },
});

test('shop routes require a session and expose no raw template definitions', async () => {
  assert.equal((await fetch(`${base}/api/template-shop`)).status, 401);
  const cookie = await signUp('route-shop@deenclipped.test');
  const response = await request(cookie, '/api/template-shop');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.products.length, 4);
  assert.ok(body.products.every(product => !('template' in product)));
});

test('free acquire and customise remain unselected, while paid checkout fails explicitly', async () => {
  const cookie = await signUp('route-actions@deenclipped.test');
  const before = await (await request(cookie, '/api/templates')).json();

  const acquired = await request(cookie, '/api/template-shop/clean-focus/acquire', { method: 'POST', body: '{}' });
  assert.equal(acquired.status, 200);
  const acquiredBody = await acquired.json();
  assert.ok(acquiredBody.templates.some(template => template.id === 'dc-shop-clean-focus'));

  const customised = await request(cookie, '/api/template-shop/clean-focus/customize', {
    method: 'POST', body: JSON.stringify({ name: 'Route Copy' }),
  });
  assert.equal(customised.status, 201);
  const customBody = await customised.json();
  assert.equal(customBody.selected, false);
  assert.equal(customBody.template.name, 'Route Copy');

  const after = await (await request(cookie, '/api/templates')).json();
  assert.equal(after.selectedTemplate.id, before.selectedTemplate.id);

  const checkout = await request(cookie, '/api/template-shop/midnight-signal/checkout', { method: 'POST', body: '{}' });
  assert.equal(checkout.status, 503);
  const checkoutBody = await checkout.json();
  assert.equal(checkoutBody.code, 'template_checkout_not_configured');
});

test('preview is tenant-safe, token-free and leaves every persisted record untouched', async () => {
  const aliceCookie = await signUp('route-preview-alice@deenclipped.test');
  const bobCookie = await signUp('route-preview-bob@deenclipped.test');
  const aliceState = await (await request(aliceCookie, '/api/auth/me')).json();
  const bobState = await (await request(bobCookie, '/api/auth/me')).json();
  const aliceId = aliceState.user.id;
  const bobId = bobState.user.id;
  state.projects.push({ id: 'shop-preview-project-a', userId: aliceId, title: 'Alice source', status: 'done' });
  state.clips.push({
    id: 'shop-preview-clip-a', projectId: 'shop-preview-project-a', userId: aliceId,
    title: 'Alice clip', transcript: 'A useful preview keeps the original clip safe.',
    startSec: 10, endSec: 20, durationMs: 10000, status: 'waiting',
    templateId: 'deenclipped-gold', templateName: 'Starter', templateVersion: 2,
  });
  const alice = state.authUsers.find(user => user.id === aliceId);
  alice.billing.tokensUsed = 7;
  const beforeClip = structuredClone(state.clips.find(clip => clip.id === 'shop-preview-clip-a'));
  const beforeJobs = state.rerenderJobs.length;
  const beforeEntitlements = state.templateEntitlements.length;

  // Locked shop products may be evaluated without becoming an entitlement.
  const preview = await request(aliceCookie, '/api/template-shop/midnight-signal/preview', {
    method: 'POST', body: JSON.stringify({ clipId: 'shop-preview-clip-a' }),
  });
  assert.equal(preview.status, 200);
  const payload = await preview.json();
  assert.equal(payload.mode, 'style_composition');
  assert.equal(payload.exportIdentical, false);
  assert.equal(payload.tokenCost, 0);
  assert.equal(payload.mutatesClip, false);
  assert.equal(payload.clip.id, 'shop-preview-clip-a');
  assert.equal(payload.style.width, 1080);
  assert.equal(payload.style.height, 1920);
  assert.ok(payload.clip.words.length > 0);
  assert.match(payload.message, /not a rendered export/i);
  assert.ok(!('userId' in payload.clip));
  assert.ok(!('template' in payload.product));
  assert.equal(alice.billing.tokensUsed, 7);
  assert.equal(state.rerenderJobs.length, beforeJobs);
  assert.equal(state.templateEntitlements.length, beforeEntitlements);
  assert.deepEqual(state.clips.find(clip => clip.id === 'shop-preview-clip-a'), beforeClip);

  const crossTenant = await request(bobCookie, '/api/template-shop/clean-focus/preview', {
    method: 'POST', body: JSON.stringify({ clipId: 'shop-preview-clip-a' }),
  });
  assert.equal(crossTenant.status, 404);
  assert.equal((await crossTenant.json()).error, 'Clip not found.');
  assert.ok(bobId);
});
