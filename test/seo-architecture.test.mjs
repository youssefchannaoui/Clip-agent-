/*
 * The public search surface, tested as a whole.
 *
 * Before this, three lists described the public site and none knew about the
 * others: the route table in server.js, PUBLIC_PAGES for the sitemap, and
 * TRACKED_PATHS for analytics. Adding a page meant three edits, and missing one
 * failed silently — a page that served fine, never appeared in the sitemap, and
 * recorded no visits. Nothing goes red when that happens, which is why it needs
 * a test rather than care.
 *
 * These assert the contract the registry now guarantees: every registered page
 * resolves, is in the sitemap, is crawlable, is counted, and says something
 * different from its siblings.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-seo-'));
const port = 43100 + Math.floor(Math.random() * 400);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.APP_SESSION_SECRET = 'seo-architecture-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const seo = await import('../src/seo-pages.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/**
 * Does a robots.txt Disallow rule match this path?
 *
 * Rules are LITERAL prefixes. "$" anchors the end and "*" is the only
 * wildcard; every other character, "?" included, matches itself. Treating "?"
 * as a wildcard is what made an earlier version of this test call a correct
 * rule a bug.
 */
const blocks = (rule, target) => {
  if (rule.endsWith('$')) return target === rule.slice(0, -1);
  if (rule.includes('*')) {
    const pattern = rule.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}`).test(target);
  }
  return target.startsWith(rule);
};

const get = async (p) => {
  const res = await fetch(`${base}${p}`, { headers: { accept: 'text/html' } });
  return { status: res.status, body: await res.text() };
};

// ── every registered page actually exists ───────────────────────────────────

test('every page in the registry answers with real HTML', async () => {
  for (const page of seo.SEO_PAGES) {
    const { status, body } = await get(page.path);
    assert.equal(status, 200, `${page.path} returned ${status} — registered but not routed`);
    assert.match(body, /<html/i, `${page.path} served something that is not a page`);
    // Server-rendered, not a JS shell: a crawler must see the words.
    assert.ok(body.length > 2000, `${page.path} is only ${body.length} bytes — too thin to rank or to be useful`);
  }
});

test('every page carries its own title, description and canonical', async () => {
  for (const page of seo.SEO_PAGES) {
    const { body } = await get(page.path);
    assert.ok(body.includes(`<title>`), `${page.path} has no title`);
    assert.match(body, /<meta name="description" content="[^"]{50,}"/,
      `${page.path} has no usable meta description`);
    const canonical = `https://deenclipped.online${page.path === '/' ? '' : page.path}`;
    assert.ok(body.includes(`<link rel="canonical" href="${canonical}">`),
      `${page.path} canonical is wrong or missing`);
  }
});

test('no two pages compete with the same title', async () => {
  // Duplicate titles are Google being told two pages are the same page, and
  // then choosing one of them for you.
  const seen = new Map();
  for (const page of seo.SEO_PAGES) {
    const previous = seen.get(page.title);
    assert.equal(previous, undefined,
      `${page.path} and ${previous} share the title "${page.title}"`);
    seen.set(page.title, page.path);
  }
});

test('no two pages lead with the same phrase', async () => {
  // Distinct full titles are not enough. Two pages both OPENING with
  // "AI Video Clipper" are one search term split across two pages, and Google
  // then picks one of them for you -- usually the weaker one. The homepage
  // led with the same phrase as /tools/ai-video-clipper until this caught it.
  const lead = title => String(title).split(/[—|:]/)[0].trim().toLowerCase();
  const seen = new Map();
  for (const page of seo.indexablePages()) {
    const key = lead(page.title);
    const previous = seen.get(key);
    assert.equal(previous, undefined,
      `${page.path} and ${previous} both lead with "${key}" and will compete`);
    seen.set(key, page.path);
  }
});

test('every page has exactly one H1', async () => {
  for (const page of seo.SEO_PAGES) {
    const { body } = await get(page.path);
    const count = (body.match(/<h1[\s>]/gi) || []).length;
    assert.equal(count, 1, `${page.path} has ${count} H1 tags; it should have exactly one`);
  }
});

test('every page is reachable by a plain link, not only by JavaScript', async () => {
  // A crawler starting at / must be able to walk to everything. Orphan pages
  // get indexed late or never, whatever the sitemap says.
  const reachable = new Set(['/']);
  const frontier = ['/'];
  while (frontier.length) {
    const current = frontier.pop();
    const { body } = await get(current);
    for (const [, href] of body.matchAll(/<a[^>]+href="(\/[^"#?]*)"/g)) {
      const clean = href.replace(/\/$/, '') || '/';
      if (reachable.has(clean) || !seo.pageFor(clean)) continue;
      reachable.add(clean);
      frontier.push(clean);
    }
  }
  const orphans = seo.indexablePages().map(p => p.path).filter(p => !reachable.has(p));
  assert.deepEqual(orphans, [], `unreachable from the homepage by link: ${orphans.join(', ')}`);
});

// ── sitemap ─────────────────────────────────────────────────────────────────

test('the sitemap lists every indexable page and nothing private', async () => {
  const res = await fetch(`${base}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /xml/);
  const body = await res.text();

  for (const page of seo.indexablePages()) {
    const loc = `https://deenclipped.online${page.path === '/' ? '/' : page.path}`;
    assert.ok(body.includes(`<loc>${loc}</loc>`), `${page.path} is missing from the sitemap`);
  }
  for (const secret of ['/app', '/owner', '/login', '/reset', '/plans', '/api/']) {
    assert.ok(!body.includes(`>https://deenclipped.online${secret}<`), `${secret} must never be advertised`);
  }
});

test('the sitemap carries lastmod and not changefreq or priority', async () => {
  // Google ignores changefreq and priority and has said so for years. lastmod
  // is the one field it reads, and only while it stays honest.
  const body = await fetch(`${base}/sitemap.xml`).then(r => r.text());
  assert.ok(!body.includes('<changefreq>'), 'changefreq is noise Google discards');
  assert.ok(!body.includes('<priority>'), 'priority is noise Google discards');
  assert.match(body, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, 'lastmod should be present and a real date');
});

test('lastmod is a written date, never the deploy date', async () => {
  // A sitemap claiming every page changed today teaches Google to ignore the
  // field entirely, which throws away the one signal it does read.
  const today = new Date().toISOString().slice(0, 10);
  const stamped = seo.SEO_PAGES.filter(page => page.lastmod === today);
  assert.ok(stamped.length < seo.SEO_PAGES.length,
    'every page claims it changed today, which is what a generated lastmod looks like');
});

// ── robots ──────────────────────────────────────────────────────────────────

test('robots keeps the app private without blocking the public site', async () => {
  const body = await fetch(`${base}/robots.txt`).then(r => r.text());
  assert.match(body, /Sitemap: https:\/\/deenclipped\.online\/sitemap\.xml/);
  for (const guarded of ['/owner', '/api/', '/auth/', '/login', '/reset', '/plans']) {
    assert.ok(body.includes(`Disallow: ${guarded}`), `${guarded} must not be crawled`);
  }
  // Every public SEO page must survive the Disallow list.
  const rules = body.split('\n').filter(line => line.startsWith('Disallow: '))
    .map(line => line.slice('Disallow: '.length).trim()).filter(Boolean);
  for (const page of seo.indexablePages()) {
    for (const rule of rules) {
      assert.ok(!blocks(rule, page.path) || page.path === '/',
        `"Disallow: ${rule}" also blocks the public page ${page.path}`);
    }
  }
});

test('a prefix rule for the app does not also block the favicon', async () => {
  // "Disallow: /app" is a PREFIX, so it matched /apple-touch-icon.png too and
  // hid the site's icon from every crawler. Found by reading the rules rather
  // than by anything going red.
  const body = await fetch(`${base}/robots.txt`).then(r => r.text());
  const rules = body.split('\n').filter(l => l.startsWith('Disallow: '))
    .map(l => l.slice(10).trim());
  for (const asset of ['/apple-touch-icon.png', '/marketing.css', '/og-image.jpg', '/favicon.svg']) {
    for (const rule of rules) {
      assert.ok(!blocks(rule, asset),
        `"Disallow: ${rule}" blocks ${asset}, which crawlers need to render the page`);
    }
  }
});

// ── analytics ───────────────────────────────────────────────────────────────

test('analytics counts registered pages and refuses invented ones', async () => {
  const tracked = seo.trackedPaths();
  for (const page of seo.SEO_PAGES) {
    assert.ok(tracked.includes(page.path), `${page.path} would be served but never counted`);
  }
  // A scanner spraying paths must not be able to mint unbounded state keys.
  for (const junk of ['/wp-admin', '/.env', '/tools/../etc/passwd', '/tools/made-up-page']) {
    assert.ok(!tracked.includes(junk), `${junk} must never be tracked`);
  }
});

// ── structured data ─────────────────────────────────────────────────────────

test('every schema block parses and none of it is invented', async () => {
  for (const page of seo.SEO_PAGES) {
    const { body } = await get(page.path);
    for (const [, raw] of body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(raw.replace(/\\u003c/g, '<')); },
        `${page.path} has JSON-LD that does not parse`);
      const text = JSON.stringify(parsed);
      // Ratings, reviews and counts would all have to be fabricated: nothing in
      // this product records them.
      for (const forbidden of ['aggregateRating', 'ratingValue', 'reviewCount', '"@type":"Review"']) {
        assert.ok(!text.includes(forbidden),
          `${page.path} claims ${forbidden} in schema, which would be invented`);
      }
    }
  }
});

test('breadcrumb schema matches breadcrumbs a person can see', async () => {
  const marketing = await import('../src/marketing.js');
  const nested = seo.SEO_PAGES
    .filter(page => marketing.SEO_COPY[page.path])
    .filter(page => seo.breadcrumbFor(page).length > 1);
  assert.ok(nested.length > 0, 'there should be nested pages by now');
  for (const page of nested.slice(0, 6)) {
    const { body } = await get(page.path);
    assert.match(body, /class="breadcrumbs[ "]/, `${page.path} has no visible breadcrumb trail`);
    assert.ok(body.includes('"BreadcrumbList"'), `${page.path} is missing BreadcrumbList schema`);
  }
});

// ── the claims themselves ───────────────────────────────────────────────────

test('no public page advertises the editor as available', async () => {
  // It is gated behind a "coming soon" notice. Selling it would be selling
  // something a new customer cannot use.
  for (const page of seo.SEO_PAGES) {
    const { body } = await get(page.path);
    const main = body.slice(body.indexOf('<main'), body.indexOf('</main>'));
    assert.ok(!/\beditor is (now )?(available|live|ready)\b/i.test(main),
      `${page.path} advertises the editor as available while it is gated`);
  }
});

test('no public page invents numbers about customers or results', async () => {
  const invented = /\b(\d[\d,]*\+? (creators|users|customers|clips posted))|\b(\d+% (faster|more|increase))|\btrusted by\b|\bgo viral\b|\bguaranteed\b/i;
  for (const page of seo.SEO_PAGES) {
    const { body } = await get(page.path);
    const main = body.slice(body.indexOf('<main'), body.indexOf('</main>'));
    const hit = main.match(invented);
    assert.equal(hit, null, `${page.path} contains an unverifiable claim: "${hit && hit[0]}"`);
  }
});

test('search-console verification renders only when it is configured', async () => {
  // Claiming the property should be a variable on Render and a restart, not a
  // commit and a deploy for a string that is not a secret. An empty variable
  // must emit nothing rather than an empty tag, which reads to a verifier as a
  // wrong token rather than as an absent one.
  const marketing = await import('../src/marketing.js');
  const page = marketing.home({ base: 'https://deenclipped.online' });
  assert.ok(!page.includes('google-site-verification'),
    'nothing should be claimed while the variable is unset');
});

test('HEAD answers like GET, because link checkers ask that way', async () => {
  // Every route matches on `method === 'GET'`, so HEAD fell through all of
  // them to the 404 -- on the HOMEPAGE included. A link validator, an uptime
  // monitor or a social-card scraper asking with HEAD was told the site does
  // not exist, and nothing went red about it because nothing here had ever
  // asked that way.
  for (const target of ['/', '/tools/ai-video-clipper', '/sitemap.xml', '/robots.txt']) {
    const head = await fetch(`${base}${target}`, { method: 'HEAD' });
    const get = await fetch(`${base}${target}`);
    assert.equal(head.status, 200, `HEAD ${target} returned ${head.status}`);
    assert.equal(head.status, get.status, `HEAD and GET disagree about ${target}`);
    // RFC 9110: the same headers GET would send, which is what a checker reads.
    assert.equal(head.headers.get('content-type'), get.headers.get('content-type'));
    assert.equal(await head.text(), '', 'HEAD must send no body');
  }
  // And a real 404 is still a 404, not a 200 with nothing in it.
  const missing = await fetch(`${base}/tools/nope`, { method: 'HEAD' });
  assert.equal(missing.status, 404);
});

test('a missing page is still a 404 and is never in the sitemap', async () => {
  const { status } = await get('/tools/this-does-not-exist');
  assert.equal(status, 404, 'an unregistered path under a real section must not resolve');
  const sitemap = await fetch(`${base}/sitemap.xml`).then(r => r.text());
  assert.ok(!sitemap.includes('this-does-not-exist'));
});
