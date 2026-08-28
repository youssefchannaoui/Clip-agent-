import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// A refused webhook used to return 400 and tell nobody. If STRIPE_WEBHOOK_SECRET
// is ever wrong, Stripe keeps the money, the app never hears about it, and the
// customer sits with no tokens until they complain. These pin the alarm -- and
// pin that ordinary internet noise does not set it off.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-wh-alert-'));
const port = 39000 + Math.floor(Math.random() * 900);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.APP_SESSION_SECRET = 'webhook-alert-test-secret-long-enough';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_the_right_one';
process.env.OPERATOR_EMAILS = 'owner@example.com';
process.env.EMAIL_API_KEY = 'test-key';
process.env.EMAIL_FROM = 'alerts@example.com';

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('ntfy.sh')) {
    sent.push({ title: options.headers?.Title || '', body: String(options.body || '') });
    return new Response('{}', { status: 200 });
  }
  if (href.includes('api.stripe.com')) return new Response('{}', { status: 200 });
  let body = {};
  try { body = JSON.parse(options.body); } catch {}
  sent.push({ title: body.subject ?? body.Subject ?? '', body: body.text ?? body.TextBody ?? '' });
  return new Response(JSON.stringify({ id: 'test' }), { status: 200 });
};

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const alerts = await import('../src/alerts.js');

for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await realFetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  globalThis.fetch = realFetch;
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const settle = () => new Promise(resolve => setTimeout(resolve, 60));

async function post(headers, body = '{}') {
  return realFetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

test('an unsigned request is refused quietly -- a public endpoint is scanned all day', async () => {
  alerts.reset();
  sent.length = 0;
  const res = await post({});
  assert.equal(res.status, 400);
  await settle();
  assert.equal(sent.length, 0, 'internet noise must not read as a billing outage');
});

test('a request that carries a signature and fails verification raises the alarm', async () => {
  alerts.reset();
  sent.length = 0;
  const stamp = Math.floor(Date.now() / 1000);
  const res = await post({ 'stripe-signature': `t=${stamp},v1=${'0'.repeat(64)}` });
  assert.equal(res.status, 400);
  await settle();
  assert.ok(sent.length >= 1, 'a signed-but-invalid delivery is Stripe with the wrong secret');
  const alert = sent.find(item => /billing/i.test(item.title));
  assert.ok(alert, `expected a billing alert, got ${JSON.stringify(sent.map(s => s.title))}`);
  assert.match(alert.body, /without the customer receiving tokens/,
    'the alert must say what it costs, not just that something failed');
  assert.match(alert.body, /STRIPE_WEBHOOK_SECRET/,
    'the playbook must name the fix');
});

test('the alarm is raised once, not on every retry Stripe sends', async () => {
  alerts.reset();
  sent.length = 0;
  const stamp = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 3; i += 1) {
    await post({ 'stripe-signature': `t=${stamp},v1=${'0'.repeat(64)}` });
  }
  await settle();
  const billingAlerts = sent.filter(item => /billing/i.test(item.title));
  assert.equal(billingAlerts.length, 1, 'Stripe retries for days; one alert is the useful number');
});
