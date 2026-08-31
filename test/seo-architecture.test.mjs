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
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
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

/*
 * REMOVED: "no two pages may lead with the same phrase."
 *
 * That rule was SEO folklore, not a search-engine requirement. Google does not
 * penalise two pages for sharing an opening word, and enforcing it pushed
 * titles away from the words people actually type -- which costs more than the
 * imagined duplication ever did. Distinct TITLES are still asserted above,
 * because two identical titles genuinely do tell Google the pages are the same.
 *
 * What replaces it is the check that was actually needed: whether two pages
 * make the same ARGUMENT. Titles can differ while both pages say "you pick the
 * minutes, cuts land on a complete thought, nothing publishes until you
 * approve" -- and that, not a shared first word, is what a doorway page is.
 */
test('no two pages make the same argument in different words', async () => {
  const copy = (await import('../src/seo-copy.js')).SEO_COPY;
  // A page's argument is the set of claims its section headings make. Compare
  // them semantically-ish: strip filler, keep the load-bearing words, and see
  // how much two pages' arguments overlap.
  const STOP = new Set(['the','a','an','and','or','but','is','are','was','were','it','its','you','your','yours',
    'that','this','not','no','of','to','in','on','for','with','from','into','at','by','as','be','been','do','does',
    'did','can','will','would','they','them','their','what','when','where','which','who','why','how','before','after',
    'until','while','than','then','so','if','all','any','more','most','one','two','up','out','off','over','under']);
  const argumentOf = page => new Set(
    (copy[page]?.sections || [])
      .flatMap(section => `${section.heading}`.toLowerCase().split(/[^a-z]+/))
      .filter(word => word.length > 2 && !STOP.has(word)));

  // Compared WITHIN a kind, not across all pages. /about restating what the
  // product does is not a doorway page -- it serves a brand query and there is
  // one of it. Two commercial pages chasing two different queries with the
  // same five points is the thing this catches, and it is what four of these
  // pages were doing before they were rewritten: /tools/long-video-to-shorts
  // shared 44% of its argument with /tools/youtube-to-shorts, and
  // /tools/ai-video-clipper 41% with /tools/lecture-clip-generator.
  const kindOf = path => (seo.pageFor(path) || {}).kind;
  const COMMERCIAL = new Set([seo.KIND.TOOL, seo.KIND.AUDIENCE, seo.KIND.USE_CASE]);
  const pages = Object.keys(copy).filter(path => COMMERCIAL.has(kindOf(path)));
  const clashes = [];
  for (let i = 0; i < pages.length; i += 1) {
    for (let j = i + 1; j < pages.length; j += 1) {
      const a = argumentOf(pages[i]);
      const b = argumentOf(pages[j]);
      if (a.size < 4 || b.size < 4) continue;
      let shared = 0;
      for (const word of a) if (b.has(word)) shared += 1;
      const overlap = shared / Math.min(a.size, b.size);
      // 32%: measured. The four pages that had to be merged or rewritten sat
      // at 33-44%; everything that legitimately survives sits at 29% or below.
      if (overlap > 0.32) clashes.push(`${pages[i]} and ${pages[j]} share ${Math.round(overlap * 100)}% of their argument`);
    }
  }
  assert.deepEqual(clashes, [],
    `these pages say the same things and should be merged or genuinely differentiated:\n  ${clashes.join('\n  ')}`);
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
  // Blocked from crawling: routes nothing public links to, where refusing the
  // fetch saves crawl budget and costs nothing.
  for (const guarded of ['/owner', '/api/', '/auth/', '/plans']) {
    assert.ok(body.includes(`Disallow: ${guarded}`), `${guarded} must not be crawled`);
  }
  // NOT blocked, deliberately: /login and /reset are linked from the header of
  // every public page, so Google will meet them. robots.txt is not an indexing
  // control -- a page it blocks can still be LISTED as a bare URL, because
  // Google never fetched it and never saw a noindex. Letting it fetch and
  // answering with noindex is the combination that actually keeps them out.
  for (const noindexed of ['/login', '/reset']) {
    assert.ok(!body.includes(`Disallow: ${noindexed}`),
      `${noindexed} must be crawlable so its noindex header can be seen`);
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

test('pages that must stay out of search say so in a header, not in robots', async () => {
  // The header is the indexing control. This is the assertion that replaced
  // "must not be crawled", which was the wrong thing to check.
  for (const path of ['/login', '/reset']) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    const tag = res.headers.get('x-robots-tag') || '';
    assert.match(tag, /noindex/, `${path} must answer with noindex`);
    // follow, so the links on the page are still worth something.
    assert.match(tag, /follow/, `${path} should still pass link value`);
  }
  // And a page that SHOULD rank must never carry it.
  for (const page of seo.indexablePages().slice(0, 8)) {
    const res = await fetch(`${base}${page.path}`);
    assert.ok(!/noindex/.test(res.headers.get('x-robots-tag') || ''),
      `${page.path} must not be noindexed`);
  }
});

test('a trailing slash keeps the visitor instead of 404ing', async () => {
  // Somebody else's link, typed or pasted with a slash. A 404 avoids the
  // duplicate URL and loses the person; a 301 avoids the duplicate and keeps
  // them.
  const res = await fetch(`${base}/pricing/`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/pricing');
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

test('every image reserves its space before it loads', async () => {
  // An <img> with no width/height reserves NO space, so the page jumps when
  // the file arrives -- Cumulative Layout Shift, on every page, worst on the
  // slow connections where it matters most. All 62 images were served this
  // way. Measured in a real browser afterwards: with the attributes stripped,
  // 9 of 11 markers moved and the worst shift was 114px; with them, zero.
  //
  // The sizes are read from the image files at import, so this cannot drift
  // when an asset is re-exported.
  for (const page of seo.SEO_PAGES) {
    const { body } = await get(page.path);
    for (const [tag] of body.matchAll(/<img\b[^>]*>/g)) {
      const src = (tag.match(/src="([^"]*)"/) || [, ''])[1];
      if (!src.startsWith('/marketing-assets/')) continue;
      assert.match(tag, /\swidth="\d+"/, `${page.path}: ${src} has no width`);
      assert.match(tag, /\sheight="\d+"/, `${page.path}: ${src} has no height`);
    }
  }
});

test('the largest image is fetched first and never lazily', async () => {
  // Lazy-loading the element the browser paints for LCP is the classic way to
  // make a fast page score badly: the loader defers the one image the metric
  // is measuring.
  const { body } = await get('/');
  const first = body.match(/<img\b[^>]*src="\/marketing-assets\/[^"]*"[^>]*>/);
  assert.ok(first, 'the homepage should have a marketing image');
  assert.match(first[0], /fetchpriority="high"/, 'the LCP image must be high priority');
  assert.ok(!/loading="lazy"/.test(first[0]), 'the LCP image must not be lazy');
});

test('the phone rules that fix tap targets and small text are served', async () => {
  // A weak test, and deliberately labelled as one: CI has no browser (this
  // repo has no npm dependencies on purpose, which is what lets a phone
  // session run the suite), so the real verification was measuring a rendered
  // page -- 21 tap targets under 24px and 63 strings under 12px before, zero
  // of each after, across all 21 pages. This only catches the block being
  // deleted wholesale.
  const css = await fetch(`${base}/marketing.css`).then(r => r.text());
  assert.match(css, /\.footer-col a\s*\{[^}]*min-height:\s*30px/,
    'the footer tap-target rule is gone');
  assert.match(css, /\.faq-item > summary\s*\{[^}]*padding-top:\s*14px/,
    'the FAQ tap-target rule is gone');
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

test('a retired page redirects permanently and leaves the index', async () => {
  // Two pages were merged away for making the same argument as a stronger
  // page. 301 rather than 404: they are in the sitemap Google read on
  // 30 Aug 2026, so they will be crawled, and a permanent redirect passes
  // their value to the page that absorbed them.
  for (const [from, to] of Object.entries(seo.RETIRED_PAGES)) {
    const res = await fetch(`${base}${from}`, { redirect: 'manual' });
    assert.equal(res.status, 301, `${from} should redirect permanently`);
    assert.equal(res.headers.get('location'), to);
    assert.ok(seo.pageFor(to), `${from} must point at a page that exists`);
  }
  const sitemap = await fetch(`${base}/sitemap.xml`).then(r => r.text());
  for (const from of Object.keys(seo.RETIRED_PAGES)) {
    assert.ok(!sitemap.includes(`${from}<`), `${from} must not still be advertised`);
  }
});

test('nothing still links to a page that was merged away', async () => {
  // A 301 works, but an internal link to a redirect wastes the hop and reads
  // as an unmaintained site. Internal links should point at the destination.
  for (const page of seo.SEO_PAGES) {
    const { body } = await get(page.path);
    for (const from of Object.keys(seo.RETIRED_PAGES)) {
      assert.ok(!body.includes(`href="${from}"`),
        `${page.path} still links to the retired ${from}`);
    }
  }
});

test('every page carries contextual links inside its prose', async () => {
  // Before this, every internal link on the site was navigation, footer or a
  // card at the bottom: 22 of 28 pages had no link from inside another page's
  // body text. A link in a sentence carries more weight than a footer link and
  // a reader mid-paragraph will actually follow it.
  const bodyLinks = html => {
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    const prose = main.replace(/<section class="related-links[\s\S]*?<\/section>/g, '')
      .replace(/<nav class="breadcrumbs[\s\S]*?<\/nav>/g, '');
    return [...prose.matchAll(/<p>[\s\S]*?<a href="(\/[^"]*)"/g)].map(m => m[1]);
  };
  const copy = (await import('../src/seo-copy.js')).SEO_COPY;
  const withLinks = [];
  for (const path of Object.keys(copy)) {
    const { body } = await get(path);
    if (bodyLinks(body).length) withLinks.push(path);
  }
  // Not every page — a link is added only where the sentence already points
  // at another page, and forcing one onto every page is how link blocks turn
  // into spam. Most of them is the bar.
  assert.ok(withLinks.length >= Object.keys(copy).length * 0.6,
    `only ${withLinks.length} of ${Object.keys(copy).length} pages have a link in their prose`);
});

test('no page repeats one contextual anchor down the page', async () => {
  // The same anchor used repeatedly within one page is the shape of
  // manipulation rather than of helpfulness.
  const copy = (await import('../src/seo-copy.js')).SEO_COPY;
  for (const path of Object.keys(copy)) {
    const { body } = await get(path);
    const main = body.slice(body.indexOf('<main'), body.indexOf('</main>'));
    const prose = main.replace(/<section class="related-links[\s\S]*?<\/section>/g, '');
    const targets = [...prose.matchAll(/<p>[\s\S]*?<a href="(\/[^"]*)"/g)].map(m => m[1]);
    const seen = new Set();
    for (const t of targets) {
      assert.ok(!seen.has(t), `${path} links to ${t} more than once in its prose`);
      seen.add(t);
    }
  }
});

test('the free tools ask only after they have delivered', async () => {
  // A free tool that interrupts itself to ask for an email is not a free tool.
  // The offer must come after the widget, never in front of it.
  for (const path of ['/tools/safe-zone-checker', '/tools/clip-calculator']) {
    const { body } = await get(path);
    const widget = body.indexOf('class="tool-widget"');
    const followUp = body.indexOf('class="tool-followup"');
    assert.ok(widget > 0, `${path} should have its widget`);
    assert.ok(followUp > widget, `${path} asks before it delivers`);
  }
});

test('a missing page is still a 404 and is never in the sitemap', async () => {
  const { status } = await get('/tools/this-does-not-exist');
  assert.equal(status, 404, 'an unregistered path under a real section must not resolve');
  const sitemap = await fetch(`${base}/sitemap.xml`).then(r => r.text());
  assert.ok(!sitemap.includes('this-does-not-exist'));
});
