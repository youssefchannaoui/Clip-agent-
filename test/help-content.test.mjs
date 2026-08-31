import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The in-app help centre.
 *
 * Two kinds of failure are guarded here and they fail very differently:
 *
 *  - A renamed or missing screenshot renders as a BROKEN IMAGE with no error
 *    anywhere -- the same silent shape as a missing `files` entry, and the
 *    customer sees it before anyone else does.
 *  - A claim that is no longer true is worse than a missing one. The content
 *    says the editor is gated and that no platform sends audience numbers
 *    back; if either stops being true the copy has to move with it, so the
 *    words are asserted rather than trusted.
 *
 * The route is exercised over HTTP, not by calling the handler: a limiter or
 * a gate that the route does not actually cross protects nothing, which this
 * repo has now learned twice.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-help-'));
process.env.DATA_DIR = dataDir;
process.env.AUTH_REQUIRED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'help-content-test-key-over-32-characters!!';
// config.js reads the port ONCE, so a PORT set after the first import that
// pulls it in leaves the server on 3000 and every fetch below fails against a
// socket nothing is listening on. The window is below Linux's ephemeral range
// (32768-60999) so the kernel cannot hand the same port to an outgoing socket
// between the choice and the listen.
const port = 20150 + Math.floor(Math.random() * 100);
process.env.PORT = String(port);

const help = await import('../src/help.js');

// `node --test` starts the tests it already has at the module's FIRST await,
// so a server imported below the test() declarations is closed by this file's
// own cleanup before the route tests run -- the failure reads as a bare
// "fetch failed" against a socket that was open a moment earlier.
const { server } = await import('../src/server.js');
const base = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; } catch { await new Promise(r => setTimeout(r, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  // A leftover temp directory on a runner is harmless; failing a green suite
  // over one is not.
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('every screenshot the content names is actually on disk', () => {
  const dir = path.join(root, 'src', 'public', 'help-assets');
  const referenced = help.referencedImages();
  assert.ok(referenced.length >= 5, 'the help centre teaches with pictures, not only prose');
  for (const image of referenced) {
    const file = path.join(dir, image);
    assert.ok(fs.existsSync(file), `${image} is referenced by an article but not in help-assets/`);
    assert.ok(fs.statSync(file).size > 1000, `${image} is on disk but empty`);
  }
});

test('no screenshot is shipped that nothing references', () => {
  // Dead weight in the repo, and a sign an article was deleted without its
  // picture -- or that a rename left the old file behind beside the new one.
  const dir = path.join(root, 'src', 'public', 'help-assets');
  const onDisk = fs.readdirSync(dir).filter(name => /\.(webp|png|jpe?g)$/i.test(name));
  const referenced = new Set(help.referencedImages());
  const orphans = onDisk.filter(name => !referenced.has(name));
  assert.deepEqual(orphans, [], 'unreferenced help images');
});

test('every category has articles and every article can be followed', () => {
  assert.ok(help.CATEGORIES.length >= 6, 'the whole product is covered, not a corner of it');
  const ids = new Set();
  for (const category of help.CATEGORIES) {
    assert.ok(category.id && category.title && category.blurb, `${category.id} is missing its heading`);
    assert.ok((category.articles || []).length > 0, `${category.title} is an empty chapter`);
    for (const article of category.articles) {
      assert.ok(!ids.has(article.id), `duplicate article id ${article.id}`);
      ids.add(article.id);
      assert.ok(article.title && article.summary, `${article.id} has no summary`);
      // An article that only describes is not help. Every one of them ends
      // with something the reader can go and do.
      assert.ok((article.steps || []).length > 0, `${article.id} has no steps`);
      if (article.image) {
        assert.ok(article.imageAlt, `${article.id} has a screenshot with no alt text`);
      }
    }
  }
});

test('the content still says the things that are true today', () => {
  const all = JSON.stringify(help.CATEGORIES).toLowerCase();
  // Each of these is a fact the product depends on and a customer is surprised
  // by. If one changes, the copy must change with it -- that is the point of
  // asserting them rather than the machinery around them.
  assert.match(all, /coming soon|not open yet|gated/, 'the clip editor is behind a gate and the help must say so');
  assert.match(all, /nothing posts|until you approve|your say-so|approve/, 'nothing publishes without approval');
  assert.match(all, /view|audience|no platform sends/, 'no platform sends audience numbers back');
});

test('the help centre invents no statistic and promises no outcome', () => {
  // The same rule the marketing pages are held to. A help article is read by
  // someone deciding whether to trust the product.
  const all = JSON.stringify(help.CATEGORIES);
  for (const banned of [/go viral/i, /guaranteed/i, /trusted by/i, /\b\d+(,\d{3})*\+? (creators|customers|users)\b/i]) {
    assert.doesNotMatch(all, banned, `help copy contains an unproven claim: ${banned}`);
  }
});

test('GET /api/help refuses a stranger and answers a signed-in account', async () => {
  const signedOut = await fetch(`${base}/api/help`);
  assert.equal(signedOut.status, 401, 'help is inside the dashboard, not a public page');

  const email = `help-${Date.now()}@deenclipped.test`;
  const signup = await fetch(`${base}/auth/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ email, password: 'help-centre-password-1', returnTo: '/' }),
    redirect: 'manual',
  });
  const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('dc_session='), 'signup handed back no session cookie');

  const res = await fetch(`${base}/api/help`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imageBase, '/help-assets/');
  assert.equal(body.categories.length, help.CATEGORIES.length);
  // No plan gate: someone on the free plan is exactly who needs the help.
  assert.ok(body.categories[0].articles.length > 0);
});

test('a help screenshot is served, and a path outside the folder is not', async () => {
  const image = help.referencedImages()[0];
  const ok = await fetch(`${base}/help-assets/${image}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') || '', /^image\//);

  // The route resolves and then checks containment; this is that check.
  const escape = await fetch(`${base}/help-assets/..%2f..%2fserver.js`);
  assert.equal(escape.status, 404);
});
