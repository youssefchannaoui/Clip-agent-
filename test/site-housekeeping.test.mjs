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
// Ports 32768-60999 are Linux's EPHEMERAL range: the kernel hands them out
// to outgoing sockets, so a port chosen there can be taken between the
// choice and the listen. The file then dies with EADDRINUSE and the run
// reports FEWER TESTS rather than a failure anyone can read -- measured at
// 1 abort in 6 full runs. This window is below the range, and every test
// file gets its own so two cannot collide with each other either.
const port = 19700 + Math.floor(Math.random() * 100);
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
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
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
  // /login is deliberately absent: it is linked from every public page, and a
  // robots.txt block would let Google list it as a bare URL rather than keep
  // it out. It carries `X-Robots-Tag: noindex` instead, which is the actual
  // indexing control -- asserted in test/seo-architecture.test.mjs.
  for (const guarded of ['/app', '/owner', '/api/', '/auth/']) {
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

// ── Structured data ──────────────────────────────────────────────────────────
// The rule for all of it: every schema restates something the page already
// says. Schema that promises more than the page delivers is how rich results
// get revoked, so these tests compare the JSON-LD against the rendered page
// and the live config rather than against copies of the expected values.

function ldBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
    .map(match => JSON.parse(match[1]));
}

test('the landing page carries valid JSON-LD for the org, site, app and FAQ', async () => {
  const home = await fetch(`${base}/`, { headers: { accept: 'text/html' } }).then(r => r.text());
  const types = ldBlocks(home).map(schema => schema['@type']);
  assert.deepEqual(
    [...types].sort(),
    ['FAQPage', 'Organization', 'SoftwareApplication', 'WebSite'],
    'four schemas, each once',
  );
});

test('the offers in the schema are the prices the pricing page shows', async () => {
  const home = await fetch(`${base}/`, { headers: { accept: 'text/html' } }).then(r => r.text());
  const app = ldBlocks(home).find(schema => schema['@type'] === 'SoftwareApplication');
  assert.ok(app.offers?.length >= 2, 'the paid plans are offered');
  // Named by TIER and period since v3.36 -- the grid sells Basic, Pro and
  // Studio, and the schema has to describe the same six paid prices rather
  // than the three the page used to show.
  const monthly = app.offers.find(offer => offer.name === 'Pro monthly plan');
  assert.ok(app.offers.some(offer => offer.name === 'Studio monthly plan'),
    'Studio is on the page, so it belongs in the schema');
  // The config label is the same source the pricing page renders from, so
  // matching it means matching the page.
  const { config } = await import('../src/config.js');
  const label = String(config.planPriceMonthlyLabel || '');
  assert.ok(label.includes(monthly.price), `schema price ${monthly.price} must appear in the label "${label}"`);
  assert.equal(monthly.priceCurrency, 'AUD', 'an A$ label is Australian dollars');
  for (const offer of app.offers) {
    assert.match(String(offer.price), /^[0-9]+(\.[0-9]{1,2})?$/, 'a price is a number, never "A$9"');
  }
});

test('the FAQ schema asks exactly the questions the visitor can see', async () => {
  const home = await fetch(`${base}/`, { headers: { accept: 'text/html' } }).then(r => r.text());
  const faq = ldBlocks(home).find(schema => schema['@type'] === 'FAQPage');
  const schemaQuestions = faq.mainEntity.map(item => item.name);
  const visibleQuestions = [...home.matchAll(/<summary>([^<]+)<\/summary>/g)].map(match => match[1]);
  assert.deepEqual(schemaQuestions, visibleQuestions,
    'marked-up questions must be the visible ones — drift here is a rich-results policy violation');
  for (const item of faq.mainEntity) {
    assert.ok(item.acceptedAnswer?.text?.length > 20, `"${item.name}" carries its answer`);
  }
});

test('pages that are not the product pitch carry the base schemas only', async () => {
  const contact = await fetch(`${base}/contact`, { headers: { accept: 'text/html' } }).then(r => r.text());
  const types = ldBlocks(contact).map(schema => schema['@type']).sort();
  assert.deepEqual(types, ['Organization', 'WebSite'],
    'no FAQ or offers claimed on pages that do not show them');
});

test('the public feature catalogue covers every shipped clip template', async () => {
  const page = await fetch(`${base}/features`, { headers: { accept: 'text/html' } }).then(r => r.text());
  for (const template of ['Clean Line', 'Bold Stack', 'Headline', 'Mono Minimal', 'Quran Recitation']) {
    assert.ok(page.includes(template), `${template} must be visible in the public catalogue`);
  }
  assert.match(page, /Templates, audio and editor preview/);
  assert.match(page, /coming soon/i);
});

test('public imagery stays on the established realistic asset library', async () => {
  const [home, features, css] = await Promise.all([
    fetch(`${base}/`, { headers: { accept: 'text/html' } }).then(r => r.text()),
    fetch(`${base}/features`, { headers: { accept: 'text/html' } }).then(r => r.text()),
    fetch(`${base}/marketing.css`).then(r => r.text()),
  ]);
  for (const draft of ['review-first-v2.png', 'deenai-private-v2.png']) {
    assert.ok(!home.includes(draft), `${draft} was a rejected draft and must not ship`);
    assert.ok(!features.includes(draft), `${draft} was a rejected draft and must not ship`);
  }
  for (const asset of ['reel-halal.webp', 'reel-dua.webp', 'reel-dunya.webp', 'reel-beneficial.webp', 'reel-quran.webp']) {
    assert.ok(home.includes(asset), `${asset} should represent a real template example`);
  }
  assert.match(css, /\.reel-card img\{[^}]*width:100%;height:auto;aspect-ratio:9\/16;/,
    'floating reel images must size their height from the card width instead of their intrinsic pixel height');
});

test('the homepage keeps a labelled source-video entry point', async () => {
  const home = await fetch(`${base}/`, { headers: { accept: 'text/html' } }).then(r => r.text());
  assert.match(home, /<form class="source-bar" data-source-form>/);
  assert.match(home, /<label class="sr-only" for="source-url">Video URL<\/label>/);
  assert.match(home, /<input id="source-url" name="source"/);
});

test('privacy copy names current import and DeenAI processing without stale vendors', async () => {
  const page = await fetch(`${base}/privacy`, { headers: { accept: 'text/html' } }).then(r => r.text());
  assert.match(page, /yt-dlp/);
  assert.match(page, /Webshare/);
  assert.match(page, /Ask DeenAI/);
  assert.doesNotMatch(page, /SocialKit|Vizard/);
});
