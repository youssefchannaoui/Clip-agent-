#!/usr/bin/env node
/**
 * Probe the live site from outside it.
 *
 * `src/selfcheck.js` runs INSIDE the app, so it cannot notice the app being
 * down -- it is in the process that would be gone. This is that half.
 *
 * Every check here is a thing a customer would hit, and each one has broken
 * this product before:
 *   - the homepage and the app shell answering at all;
 *   - HEAD, which every route matched on `method === 'GET'` until v3.44.0 --
 *     `HEAD /` answered 404 on the live site and link validators, uptime
 *     monitors and social-card scrapers were all being told the site did not
 *     exist, with nothing in the suite asking that way;
 *   - the studio's own stylesheets and scripts, any one of which 404s in
 *     silence and takes the theme or the boot with it;
 *   - the CSP actually carrying a script-src hash, because a policy that
 *     lost it renders the shell and never boots.
 *
 * A push takes the site down for 35-40 seconds (the service mounts a disk, so
 * Render stops one instance before starting the other). That is not a fault
 * and must not be reported as one, so every check retries through it.
 *
 * Reports and fixes nothing. A failed run is the notification.
 */

const BASE = (process.env.BASE || 'https://deenclipped.online').replace(/\/+$/, '');
const TRIES = 4;
const GAP_MS = 20_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One request, retried through a deploy swap rather than failing on it. */
async function probe(path, { method = 'GET' } = {}) {
  let last = { status: 0, error: 'never attempted', headers: new Headers(), body: '' };
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const res = await fetch(BASE + path, { method, redirect: 'manual' });
      const body = method === 'GET' ? await res.text() : '';
      last = { status: res.status, headers: res.headers, body, error: '' };
      // 2xx and 3xx are both fine: /app redirects to /login when signed out.
      if (res.status < 400) return last;
    } catch (error) {
      last = { status: 0, error: error.message, headers: new Headers(), body: '' };
    }
    if (attempt < TRIES) await sleep(GAP_MS);
  }
  return last;
}

const failures = [];
const note = (ok, label, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(`${label}: ${detail}`);
};

console.log(`Probing ${BASE}\n`);

// 1. The site answers.
const home = await probe('/');
note(home.status >= 200 && home.status < 400, 'GET /',
  home.status ? `HTTP ${home.status}` : home.error);

/* THE SITE BEING DOWN IS ONE FINDING, NOT FORTY-FIVE.
   Every check retries four times twenty seconds apart, so probing on past a
   dead origin would take the best part of an hour to say the same thing forty
   times over -- and the run that reports an outage is the one that most needs
   to finish quickly. Stop here. */
if (!(home.status >= 200 && home.status < 400)) {
  console.error(`\n${BASE} is not answering (${home.status ? 'HTTP ' + home.status : home.error}) `
    + `after ${TRIES} attempts over ${Math.round((TRIES - 1) * GAP_MS / 1000)}s, `
    + 'which is well past the 35-40s a deploy takes. Nothing else was probed: if the origin is '
    + 'down, every other check would report the same one fault.');
  process.exit(1);
}

// 2. HEAD answers. Routed on GET alone, every HEAD 404'd -- v3.44.0.
const head = await probe('/', { method: 'HEAD' });
note(head.status >= 200 && head.status < 400, 'HEAD /',
  head.status ? `HTTP ${head.status}` : head.error);

// 3. The app shell. Signed out this redirects, which is a pass.
const app = await probe('/app');
note(app.status >= 200 && app.status < 400, 'GET /app',
  app.status ? `HTTP ${app.status}` : app.error);

// 4. A script-src hash in the policy. Without one the page renders and the
//    app never boots, with no error anywhere -- five recorded occurrences.
const csp = app.headers.get('content-security-policy') || '';
note(/script-src[^;]*sha256-/.test(csp), 'CSP carries a script-src hash',
  csp ? 'script-src has no sha256- in it' : 'no Content-Security-Policy header at all');

// 5. The studio's own assets. Each 404s in silence.
for (const asset of [
  '/studio-styles.generated.css', '/studio-tokens.css', '/studio-light.generated.css',
  '/studio-theme.generated.css', '/studio-runtime.js', '/studio-adapter.js',
  '/studio-template.generated.js', '/studio-mobile.js', '/sw.js', '/manifest.webmanifest',
]) {
  const res = await probe(asset);
  note(res.status >= 200 && res.status < 400, `GET ${asset}`,
    res.status ? `HTTP ${res.status}` : res.error);
}

// 6. The crawlable surface, from the site's own sitemap rather than a list
//    typed here -- a list would go stale the first time a page is added.
const sitemap = await probe('/sitemap.xml');
note(sitemap.status >= 200 && sitemap.status < 400, 'GET /sitemap.xml',
  sitemap.status ? `HTTP ${sitemap.status}` : sitemap.error);
const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
note(urls.length > 0, 'the sitemap lists pages', `${urls.length} <loc> entries`);
for (const url of urls.slice(0, 30)) {
  const path = url.replace(/^https?:\/\/[^/]+/, '') || '/';
  const res = await probe(path);
  note(res.status >= 200 && res.status < 400, `GET ${path}`,
    res.status ? `HTTP ${res.status}` : res.error);
}

console.log('');
if (failures.length) {
  console.error(`${failures.length} check(s) failed:`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('Every check passed.');
