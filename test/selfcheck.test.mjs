import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checks, run } from '../src/selfcheck.js';

/**
 * The break detector.
 *
 * Youssef, 4 Sept 2026: "can you make a automated code break detector or issue
 * dector that fixes alone when something happens or notfiys".
 *
 * Every check is driven with a BROKEN input and a healthy one, because a
 * detector that cannot come back red detects nothing -- which is the rule this
 * repo restates more often than any other. Executed output only: `checks()` is
 * called and its answers are read, never grepped for.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('base64');
const one = (results, key) => results.find(r => r.key === key);

/** A deps object where everything is healthy; each test breaks exactly one. */
function healthy(over = {}) {
  return Object.assign({
    assets: { '/a.css': '/tmp/a.css' },
    readSize: () => 42,
    page: '<script>boot()</script>',
    allowed: [`'sha256-${sha256('boot()')}'`],
    sha256,
    mediaPublicBase: 'https://media.deenclipped.online',
    storedSample: [],
    remote: true,
    workerRelease: '3.128.0',
    workerVersion: '3.128.0',
  }, over);
}

test('everything healthy reports nothing failing', () => {
  for (const r of checks(healthy())) assert.equal(r.ok, true, `${r.key} should pass: ${r.detail}`);
});

test('an asset that is routed but not on disk is caught', () => {
  // A missing stylesheet 404s with nothing in any log: the theme dies and the
  // app looks merely wrong.
  const missing = one(checks(healthy({ readSize: () => { throw new Error('ENOENT'); } })), 'assets');
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /\/a\.css \(missing\)/);
  // An EMPTY file is the same fault wearing a different hat -- it resolves,
  // returns 200, and delivers nothing.
  const empty = one(checks(healthy({ readSize: () => 0 })), 'assets');
  assert.equal(empty.ok, false);
  assert.match(empty.detail, /\/a\.css \(empty\)/);
});

test('an inline script the CSP does not cover is caught', () => {
  // The one that kills the whole app: the browser refuses the block with NO
  // page error, so the shell renders and boot never runs.
  const r = one(checks(healthy({ allowed: [] })), 'inline-script');
  assert.equal(r.ok, false);
  assert.match(r.detail, /1 of 1 inline <script>/);
  assert.match(r.detail, /never boots/);
  // A block with a src is the browser's business, not the policy's.
  const withSrc = one(checks(healthy({ page: '<script src="/x.js"></script>', allowed: [] })), 'inline-script');
  assert.equal(withSrc.ok, true, 'an external script must not be counted as uncovered');
});

test('r2.dev with no MEDIA_PUBLIC_BASE is caught, and with one is not', () => {
  const bad = one(checks(healthy({ mediaPublicBase: '', storedSample: ['https://pub-x.r2.dev/a.mp4'] })), 'media-domain');
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /rate-limited/);
  // The exits rewrite stored URLs, so a stored r2.dev URL is harmless WHILE
  // the base is set. Alerting on it then would be a false alarm on every clip
  // rendered before the custom domain was bound.
  const fine = one(checks(healthy({ storedSample: ['https://pub-x.r2.dev/a.mp4'] })), 'media-domain');
  assert.equal(fine.ok, true);
});

test('behind is measured against worker/RELEASE, never against the app version', () => {
  const behind = one(checks(healthy({ workerVersion: '3.100.0' })), 'worker-version');
  assert.equal(behind.ok, false);
  assert.match(behind.detail, /3\.100\.0/);

  // THE CASE THAT MADE THIS ALERT LIE. The web service ships several times a
  // day without touching worker/, so the box routinely reports a version LATER
  // than the worker release -- and against appVersion that read as behind on
  // nearly every deploy. It is current.
  const ahead = one(checks(healthy({ workerVersion: '3.129.9' })), 'worker-version');
  assert.equal(ahead.ok, true, 'a box past the worker release is current, not behind');

  const silent = one(checks(healthy({ workerVersion: '' })), 'worker-version');
  assert.equal(silent.ok, false, 'a worker too old to report a version reads as behind');

  // No stamp, no verdict: inventing one from the app's own version is the bug.
  const unstamped = one(checks(healthy({ workerRelease: '', workerVersion: '3.1.0' })), 'worker-version');
  assert.equal(unstamped.ok, true);

  // `remote: false` is how the server says the worker did not answer at all --
  // that is checkWorker's condition, and alerting twice for one fault is the
  // duplication this repo keeps paying for.
  const unreachable = one(checks(healthy({ remote: false, workerVersion: '' })), 'worker-version');
  assert.equal(unreachable.ok, true);
});

/* The stamp is only worth anything if it moves. scripts/check-version-bump.mjs
   fails a commit that touches worker/ without updating it -- without that, a
   stamp nobody maintains reports a current box for ever, which is strictly
   worse than the alert this replaced. */
test('a worker/ change must restamp worker/RELEASE', () => {
  const guard = fs.readFileSync(fileURLToPath(new URL('../scripts/check-version-bump.mjs', import.meta.url)), 'utf8');
  assert.match(guard, /worker\/RELEASE/);
  assert.match(guard, /startsWith\('worker\/'\)/);

  const stamp = fs.readFileSync(fileURLToPath(new URL('../worker/RELEASE', import.meta.url)), 'utf8').trim();
  assert.match(stamp, /^\d+\.\d+\.\d+$/, 'worker/RELEASE must hold a bare version');
});

test('every check reports on recovery too, not only on failure', async () => {
  // alerts.report is called on EVERY check by design: knowing something
  // recovered is half the value, and it is what lets the next failure alert
  // at all.
  const seen = [];
  await run(healthy(), async (key, failing, detail) => seen.push({ key, failing, detail }));
  assert.equal(seen.length, checks(healthy()).length);
  assert.ok(seen.every(s => s.failing === false), 'a healthy run must still report each key as not failing');
  assert.ok(seen.every(s => s.key.startsWith('selfcheck:')), 'keys must be namespaced so they cannot collide with the billing alerts');
});

test('a check that throws is reported as failing, never as passing', async () => {
  // A monitor that goes quiet when it breaks is worse than no monitor.
  const seen = [];
  await run({ get assets() { throw new Error('boom'); } }, async (key, failing, detail) => seen.push({ key, failing, detail }));
  assert.deepEqual(seen.map(s => s.key), ['selfcheck']);
  assert.equal(seen[0].failing, true);
  assert.match(seen[0].detail, /boom/);
});

test('an alert that cannot go out never stalls the sweep', async () => {
  // The sweep must survive a failing mailer: a nudge that cannot go out is a
  // warning, not a stalled monitor.
  const seen = [];
  const results = await run(healthy(), async key => {
    seen.push(key);
    if (seen.length === 1) throw new Error('mailer down');
  });
  assert.equal(seen.length, results.length, 'the sweep stopped at the first failing report');
});

test('the module is pure — it imports nothing', () => {
  // Same arrangement as help.js beside its machinery: the server, the tests
  // and anything added later can read it with no import cycle.
  const src = fs.readFileSync(path.join(root, 'src/selfcheck.js'), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m, 'selfcheck.js has grown an import');
});

test('the server runs it on a timer, and not at second zero', () => {
  // Render swaps the instance on every push, so a check at boot measures a
  // service still coming up -- and a monitor that alerts on every deploy is
  // one nobody reads.
  const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
  assert.match(server, /selfcheck\.run\(/, 'the server never calls the self-check');
  assert.match(server, /setInterval\(\(\) => \{ runSelfCheck\(\)/, 'it is not on a timer');
  assert.doesNotMatch(server, /^\s*runSelfCheck\(\)\.catch\(\(\) => \{\}\);\s*$/m,
    'it runs immediately at boot, which reports every deploy as a fault');
  assert.match(server, /setTimeout\(\(\) => \{ runSelfCheck\(\)/, 'the first run is not delayed');
});

test('the external prober exists and fixes nothing', () => {
  // The half a monitor inside the app cannot do. It reports; an external
  // prober that could push or restart on its own judgement is a much bigger
  // idea than the one asked for.
  const probe = fs.readFileSync(path.join(root, 'scripts/watch-live.mjs'), 'utf8');
  assert.match(probe, /HEAD/, 'it does not check HEAD, which 404d on the live site for months');
  assert.match(probe, /script-src\[\^;\]\*sha256-/, 'it does not check the CSP carries a script hash');
  assert.match(probe, /sitemap\.xml/, 'it does not walk the sitemap');
  assert.match(probe, /TRIES/, 'it does not retry through a deploy swap');
  // THE SITE BEING DOWN IS ONE FINDING, NOT FORTY-FIVE. Without this the run
  // that most needs to finish quickly takes the best part of an hour saying
  // the same thing forty times. Measured: 60s and one line, from ~45 x 80s.
  assert.match(probe, /Nothing else was probed/,
    'a dead origin is probed on through every remaining check');
  const code = probe.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /execSync|spawn|git |curl -X (POST|PUT|DELETE)/, 'the prober must not act on anything');
});

/* The sweep and the Owner screen must read the worker's version from ONE
   place. They did not: the sweep read a top-level `version` off /readiness,
   which has never carried one (worker/service.py answers readiness with
   `capabilities`), so `selfcheck:worker-version` alerted "no version at all"
   every fifteen minutes whatever the box was running -- and would have masked
   a genuinely stale worker afterwards. A source test, deliberately: CI has no
   worker to call, and this is exactly the rule that is invisible when it goes
   missing -- the app runs, the suite stays green, the alert just lies. */
test('the worker version is read by one function, from /health', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');

  assert.match(src, /function workerVersionOf\(payload\)\s*{\s*return String\(payload\?\.capabilities\?\.version/,
    'workerVersionOf must read capabilities.version');

  const callers = src.match(/workerVersionOf\(/g) || [];
  assert.ok(callers.length >= 3, 'both callers must go through workerVersionOf');

  assert.ok(!/readiness\(\)\)?\?\.version/.test(src),
    '/readiness carries no top-level version -- reading one alerts for ever');

  const worker = fs.readFileSync(fileURLToPath(new URL('../worker/service.py', import.meta.url)), 'utf8');
  const readiness = worker.slice(worker.indexOf('path == "/readiness"'));
  const block = readiness.slice(0, readiness.indexOf('if self.command == "POST"'));
  assert.ok(!/"version"/.test(block),
    'if /readiness ever grows its own version field, this test is the place to decide which one wins');
});

/* The ROUTE half shipped in v3.129.0 and the SCREEN half did not: /api/owner/health
   has carried `selfChecks` since then and nothing in the browser drew it, so the
   note claiming the detector was "on Owner -> Health" was false for two releases.
   Found by trying to screenshot it.

   A source test, deliberately, and for the same reason as the sibling above:
   CI has no browser, and this is precisely the shape that goes missing without
   a symptom -- the app renders, the suite stays green, and the operator simply
   has no way to see what the detector found when EMAIL_API_KEY is unset. */
test('the detector is on the screen, not only in the payload', () => {
  const page = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');

  assert.match(page, /const paintSelfChecks\s*=/, 'the panel must exist');
  assert.match(page, /selfChecks/, 'it must read the route\'s own field');

  // Every host panel rule this repo has paid for, in one place.
  const fn = page.slice(page.indexOf('const paintSelfChecks'));
  const body = fn.slice(0, fn.indexOf('\n      };'));
  assert.match(body, /data-host-owned/, 'an unmarked host node is patched into a sibling');
  assert.match(body, /dcSetHtml/, 'a panel that rewrites itself every poll steals focus');
  /* The rule is about SELECTORS, never about emitted class attributes: the
     panel deliberately WEARS the export's own classes so it is
     indistinguishable from the sections beside it (the paintLandingTable
     precedent). What it may never do is LOOK ONE UP -- a re-import renumbers
     every hashed name, and the mount would silently stop being found. */
  const selectors = [...body.matchAll(/querySelector(?:All)?\(([^)]*)\)/g)].map(m => m[1]);
  for (const sel of selectors) {
    assert.ok(!/\.s[0-9a-z]{2,3}['"\s]/.test(sel),
      `a hashed class is named in a selector and a re-import will renumber it: ${sel}`);
  }
  assert.ok(selectors.length, 'the panel must resolve its own mount');

  /* In paintStudio's OWN list, or it never appears when somebody switches to
     the Health tab -- that changes no data and triggers no fetch. Asserting the
     call merely EXISTS is not enough: it also exists on the owner fetch, so the
     first cut of this probe came back green with the render call deleted. */
  const paint = page.slice(page.indexOf('\n  paintClipStars(vals);'));
  const list = paint.slice(0, paint.indexOf('\n}'));
  assert.match(list, /dcPaintSelfChecks/,
    'it must be called from paintStudio, not only from the owner fetch');

  // ONE pill, shared with the KPI tiles rather than a second copy of the colours.
  const adapter = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');
  assert.match(adapter, /owPill: owPill,/, 'owPill must be exposed so the panel does not redefine it');
  assert.match(body, /StudioAdapter\.owPill/, 'the panel must use it');
});
