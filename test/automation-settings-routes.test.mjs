import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-auto-settings-route-'));
const port = 39000 + Math.floor(Math.random() * 500);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.EMAIL_REGISTRATION_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator-automation-settings@deenclipped.test';
process.env.APP_SESSION_SECRET = 'automation-settings-route-test-secret';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
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

function update(cookie, body) {
  return fetch(`${base}/api/automation-settings`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, minimumScore: 80, minimumQuality: 72, maxPerProject: 4, ...body }),
  });
}

test('canonical Review before posting is stored and returned without inversion', async () => {
  const cookie = await signUp('automation-canonical@deenclipped.test');
  const response = await update(cookie, { reviewBeforePosting: true });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.settings.reviewBeforePosting, true);
  assert.equal(payload.settings.skipReviewRequired, true);

  const disabled = await update(cookie, { reviewBeforePosting: false });
  const disabledPayload = await disabled.json();
  assert.equal(disabledPayload.settings.reviewBeforePosting, false);
  assert.equal(disabledPayload.settings.skipReviewRequired, true);
});

test('legacy V7 inverted field remains compatible but cannot disable the safety gate', async () => {
  const cookie = await signUp('automation-legacy@deenclipped.test');
  const checked = await update(cookie, { skipReviewRequired: false });
  assert.equal(checked.status, 200);
  let payload = await checked.json();
  assert.equal(payload.settings.reviewBeforePosting, true);
  assert.equal(payload.settings.skipReviewRequired, true);

  const unchecked = await update(cookie, { skipReviewRequired: true });
  assert.equal(unchecked.status, 200);
  payload = await unchecked.json();
  assert.equal(payload.settings.reviewBeforePosting, false);
  assert.equal(payload.settings.skipReviewRequired, true);
});
