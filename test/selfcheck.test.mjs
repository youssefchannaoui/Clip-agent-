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
    appVersion: '3.128.0',
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

test('a worker behind the app is caught; an unreachable one is left to its own alert', () => {
  const behind = one(checks(healthy({ workerVersion: '3.100.0' })), 'worker-version');
  assert.equal(behind.ok, false);
  assert.match(behind.detail, /3\.100\.0/);
  const silent = one(checks(healthy({ workerVersion: '' })), 'worker-version');
  assert.equal(silent.ok, false, 'a worker too old to report a version reads as behind');
  // `remote: false` is how the server says the worker did not answer at all --
  // that is checkWorker's condition, and alerting twice for one fault is the
  // duplication this repo keeps paying for.
  const unreachable = one(checks(healthy({ remote: false, workerVersion: '' })), 'worker-version');
  assert.equal(unreachable.ok, true);
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
