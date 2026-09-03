import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * A free account gets one lecture style and one scripture style.
 *
 * Youssef, 3 Sept 2026: "quran recitation should allow basic plans as well so
 * one quran one lecture."
 *
 * Flipping `pro` in the template file is one line; what it collides with is
 * NOT. The scripture template ships with an empty watermark at zero opacity,
 * because nothing is drawn over the top of an ayah — and the watermark paywall
 * refuses exactly that shape from a free account. So the moment Basic could
 * SELECT this template, saving it would have been refused with "Removing the
 * DeenClipped watermark is a Pro feature": a free account handed a template it
 * could not use, and an error blaming it for something it never did.
 *
 * Driven over HTTP with a real free account, because the gate lives inside the
 * request handler and nothing reachable from a unit test crosses it.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-freequran-'));
process.env.DATA_DIR = dataDir;
// The OS picks the port: a randomised one can land in Linux's ephemeral range
// and be taken between the choice and the listen, which reports as FEWER tests
// rather than as a failure anyone can read.
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.APP_SESSION_SECRET = 'free-quran-secret-long-enough-for-the-check';
process.env.SOCIAL_TOKEN_KEY = 'free-quran-test-social-key-over-32-characters';

const { server } = await import('../src/server.js');
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const templates = await import('../src/templates.js');

test.after(() => new Promise(resolve => server.close(() => resolve())));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

// The sign-in throttle is real, and a file that spends it reports a broken
// route when the route is fine. One account, reused.
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({
    email: 'basic@deenclipped.test',
    password: 'correct horse battery staple',
    returnTo: '/',
  }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
assert.ok(cookie.startsWith('dc_session='), 'the free account signed up');

const send = (url, body, method = 'POST') => fetch(`${base}${url}`, {
  method,
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify(body),
});

test('a free account can select the scripture template', async () => {
  const res = await send('/api/template', { id: 'quran-recitation' });
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, `select was refused: ${body.error || res.status}`);
});

test('and can SAVE it, watermark paywall notwithstanding', async () => {
  // This is the collision. The template's own shipped state — no watermark —
  // is what the paywall refuses, so without the exemption the account is
  // blocked from the template it was just given.
  const res = await send('/api/templates/quran-recitation',
    { template: { watermark: '', watermarkOpacity: 0, captionFontSize: 70 } }, 'PUT');
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, `save was refused: ${body.error || res.status}`);
  assert.equal(body.template.captionFontSize, 70, 'and the edit actually saved');
});

test('the paywall still holds everywhere else', async () => {
  // The exemption must be for the scripture template alone. A free account
  // blanking the mark on a lecture style is one of exactly two things this
  // product charges for, and it stays refused.
  const res = await send('/api/templates/clean-line',
    { template: { watermark: '', watermarkOpacity: 0 } }, 'PUT');
  assert.equal(res.status, 400, 'a free account may not remove the mark from a lecture style');
  const body = await res.json();
  assert.match(body.error, /watermark is a Pro feature/i);
});

test('an account cannot mint the exemption by switching caption mode', () => {
  // The exemption reads the SHIPPED file. An override that turns an ordinary
  // template into `quran` caption mode must not carry the exemption with it,
  // or the paywall is one setting away from being off for everyone.
  assert.equal(templates.isScriptureTemplate('quran-recitation'), true);
  assert.equal(templates.isScriptureTemplate('clean-line'), false);
  assert.equal(templates.isScriptureTemplate('../../package'), false,
    'and it cannot be walked out of its own directory');
  assert.equal(templates.isScriptureTemplate(''), false);
});
