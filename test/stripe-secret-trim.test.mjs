import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// A signing secret pasted into Render's variable field picks up a trailing
// newline more often than anyone admits, and the failure is indistinguishable
// from having copied the wrong endpoint's secret: every delivery is refused
// with "Invalid Stripe signature", Stripe keeps the money, and the customer
// gets no tokens. Whitespace around a credential is never meaningful, so the
// config trims it -- and this pins that over HTTP, on the real route, because
// a trim that the route does not reach protects nothing.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-secret-trim-'));
const port = 39900 + Math.floor(Math.random() * 90);
const SECRET = 'whsec_padded_secret_for_this_test';

process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.APP_SESSION_SECRET = 'secret-trim-test-secret-long-enough';
// The whole point: stored WITH the whitespace a paste leaves behind.
process.env.STRIPE_WEBHOOK_SECRET = `  ${SECRET}  \n`;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('api.stripe.com') || href.includes('ntfy.sh')) {
    return new Response('{}', { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');

for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await realFetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  globalThis.fetch = realFetch;
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function signed(body, secret) {
  const stamp = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac('sha256', secret).update(`${stamp}.${body}`).digest('hex');
  return `t=${stamp},v1=${mac}`;
}

async function post(body, signature) {
  return realFetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  });
}

test('a webhook signed with the untrimmed secret is accepted', async () => {
  // Stripe signs with the secret as its dashboard shows it -- no whitespace.
  // Before the trim this was refused, because the app hashed with the padding.
  const body = JSON.stringify({ id: 'evt_trim_1', type: 'ping', data: { object: {} } });
  const res = await post(body, signed(body, SECRET));
  assert.equal(res.status, 200, 'stray whitespace in the variable must not refuse real deliveries');
});

test('a genuinely wrong secret is still refused', async () => {
  // The trim must not become "accept anything".
  const body = JSON.stringify({ id: 'evt_trim_2', type: 'ping', data: { object: {} } });
  const res = await post(body, signed(body, 'whsec_a_different_endpoints_secret'));
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.match(payload.error, /Invalid Stripe signature/);
});

test('the alert says what shape the configured secret is, without printing it', async () => {
  const billing = await import('../src/billing.js');
  const note = billing.webhookSecretNote();
  assert.match(note, /had stray whitespace/, 'the operator must be told whitespace was the fault');
  assert.match(note, new RegExp(`${SECRET.length} characters`));
  assert.ok(!note.includes(SECRET), 'an alert mail is not a secure channel; never print the secret');
  assert.ok(!note.includes('padded_secret'), 'no fragment of the secret body either');
});
