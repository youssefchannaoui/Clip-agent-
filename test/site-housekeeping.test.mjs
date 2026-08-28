import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// A mistyped address, an old link from a message, an expired share — all of
// them were handed {"error":"Not found."} on a white page with no way back
// into the product they were trying to reach. And Google had no robots.txt or
// sitemap to work from.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-house-'));
const port = 40900 + Math.floor(Math.random() * 600);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.APP_SESSION_SECRET = 'housekeeping-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const marketing = await import('../src/marketing.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('a wrong address gets a page, not raw JSON', async () => {
  const res = await fetch(`${base}/this-does-not-exist`, { headers: { accept: 'text/html' } });
  assert.equal(res.status, 404, 'still an honest 404 for crawlers and caches');
  const body = await res.text();
  assert.match(body, /<html/i);
  assert.match(body, /isn’t here|not here|404/i);
  assert.match(body, /href="\/"|href="\/app"/, 'and a way back in');
});

test('an API caller still gets JSON', async () => {
  const res = await fetch(`${base}/nope`, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /json/);
});

test('robots.txt exists and keeps crawlers out of the signed-in product', async () => {
  const res = await fetch(`${base}/robots.txt`);
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const guarded of ['/app', '/owner', '/api/', '/auth/', '/login']) {
    assert.ok(body.includes(`Disallow: ${guarded}`), `${guarded} must not be crawled`);
  }
  assert.match(body, /Sitemap: https:\/\/deenclipped\.online\/sitemap\.xml/);
});

test('the sitemap lists the public pages and nothing private', async () => {
  const res = await fetch(`${base}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /xml/);
  const body = await res.text();
  for (const page of ['/features', '/pricing', '/privacy', '/terms', '/contact']) {
    assert.ok(body.includes(`https://deenclipped.online${page}`), `${page} should be listed`);
  }
  for (const secret of ['/app', '/owner', '/login', '/reset']) {
    assert.ok(!body.includes(`>https://deenclipped.online${secret}<`), `${secret} must not be advertised`);
  }
});

test('every page the sitemap advertises actually answers', async () => {
  for (const page of marketing.PUBLIC_PAGES) {
    const res = await fetch(`${base}${page}`, { headers: { accept: 'text/html' } });
    assert.equal(res.status, 200, `${page} is in the sitemap but returned ${res.status}`);
  }
});

// ── signed-out page basics ──────────────────────────────────────────────────

test('the sign-in page can be skipped straight into, for keyboard and screen readers', async () => {
  const page = await fetch(`${base}/login`).then(r => r.text());
  assert.match(page, /class="dc-skip"/, 'a skip link must be the first thing focus lands on');
  assert.match(page, /href="#dc-signin"/);
  assert.match(page, /id="dc-signin"/, 'and it must point at something that exists');
});

test('the password field can be revealed, from a file rather than an inline block', async () => {
  // The CSP hashes inline scripts from index.html only, so an inline block on
  // the sign-in page would be blocked at runtime while looking correct in source.
  const page = await fetch(`${base}/login`).then(r => r.text());
  assert.match(page, /<script src="\/auth-enhance\.js"/);
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(page.split('</head>')[1] || ''),
    'no inline script may be added to this page');

  const script = await fetch(`${base}/auth-enhance.js`);
  assert.equal(script.status, 200, 'unlisted static files 404');
  assert.match(script.headers.get('content-type') || '', /javascript/);
  const body = await script.text();
  assert.match(body, /input\[type="password"\]/);
  assert.match(body, /aria-pressed/, 'the toggle must say its state, not just look different');
  // The visible label is an icon now, so the accessible name is the only thing
  // carrying the meaning for anyone not looking at it.
  assert.match(body, /aria-label', shown \? 'Show password' : 'Hide password'/,
    'the label has to change with the state');
  assert.match(body, /<svg/, 'an icon, not a word — it takes less room beside the field');
  assert.match(body, /aria-hidden="true"/, 'and the svg itself must not be announced twice');
});

test('the reset page gets the same reveal', async () => {
  const page = await fetch(`${base}/reset`).then(r => r.text());
  assert.match(page, /<script src="\/auth-enhance\.js"/);
});

test('the footer year is computed, not a number that goes stale', async () => {
  const home = await fetch(`${base}/`, { headers: { accept: 'text/html' } }).then(r => r.text());
  assert.ok(home.includes(`© ${new Date().getFullYear()} DeenClipped`),
    'a hardcoded year is a small lie that grows by one every January');
});
