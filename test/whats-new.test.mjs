import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * WHAT'S NEW — the release notes raised over the dashboard.
 *
 * Driven rather than read wherever it can be. The thing that matters is not
 * that the module has the right shape but that the SERVER decides when the
 * dialog appears and that marking it read is a write to the account: a
 * localStorage guard travels with the browser rather than with the person,
 * which is exactly how the "one all the way through" dialog came to greet
 * every established account on every new device.
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-news-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.APP_SESSION_SECRET = 'whats-new-test-secret-long-enough';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';

const whatsNew = await import('../src/whats-new.js');
const store = await import('../src/store.js');
const { server } = await import('../src/server.js');
await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* a leftover temp dir must never fail a green suite */ }
});

// ONE sign-up: the throttle is three per connection per day, and a file that
// spends it reports a broken route when the route is fine.
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({ email: 'reader@deenclipped.test', password: 'correct horse battery staple', returnTo: '/app' }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
const userId = store.state.authUsers.find(u => u.email === 'reader@deenclipped.test').id;

const state = async () => (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json();

/** An account that has imported something and predates the newest release. */
function establish() {
  const newest = whatsNew.latest();
  const user = store.state.authUsers.find(u => u.id === userId);
  user.createdAt = whatsNew.releasedAt(newest) - 30 * 86400000;
  store.state.projects = [{ id: 'p1', userId, title: 'A lecture', status: 'done' }];
  store.state.userSettings[userId] = Object.assign({}, store.state.userSettings[userId], { whatsNewSeen: '' });
  store.save();
  return newest;
}

// ── the content ───────────────────────────────────────────────────────────

test('every capture an entry names is on disk, and nothing on disk is orphaned', () => {
  const dir = new URL('../src/public/whats-new-assets/', import.meta.url);
  const named = new Set(whatsNew.RELEASES.map(r => r.image).filter(Boolean));
  for (const name of named) {
    assert.ok(fs.existsSync(new URL(name, dir)), `${name} is on disk — a broken picture in front of a customer errors nowhere`);
  }
  for (const file of fs.readdirSync(dir)) {
    assert.ok(named.has(file), `${file} is referenced by an entry — an orphan rots quietly in the directory`);
  }
});

test('every action reaches a screen the studio can actually reach', () => {
  // Read from goToStep itself, the ONE destination map, rather than a list
  // typed here: a second list is how "the Platforms page" came to be printed
  // as guidance for a screen that has never existed.
  const adapter = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  const from = adapter.slice(adapter.indexOf('goToStep: function'));
  const body = from.slice(0, from.indexOf("}[String(action || '')]"));
  const screens = new Set([...body.matchAll(/^\s{8}(\w+): function \(\) \{/gm)].map(m => m[1]));
  assert.ok(screens.size >= 6, 'the destination map was found and read');
  for (const rel of whatsNew.RELEASES) {
    if (!rel.action) continue;
    assert.ok(screens.has(rel.action), `"${rel.title}" points at a real screen (${rel.action})`);
    assert.ok(rel.actionLabel, `"${rel.title}" names its button — an action with no label draws nothing`);
  }
});

test('the entries are unique, dated, newest first, and within the cap', () => {
  const ids = whatsNew.RELEASES.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique — the id IS the seen marker');
  assert.ok(whatsNew.RELEASES.length <= whatsNew.MAX_SHOWN, 'the list is trimmed rather than kept as a changelog');
  let previous = Infinity;
  for (const rel of whatsNew.RELEASES) {
    const at = whatsNew.releasedAt(rel);
    assert.ok(at > 0, `${rel.id} has a date that parses`);
    assert.ok(at <= previous, `${rel.id} is in newest-first order — the first entry is the one that raises the dialog`);
    previous = at;
    assert.ok(rel.title && rel.summary, `${rel.id} says what changed`);
    assert.ok(rel.items.length > 0, `${rel.id} has something to list`);
  }
  assert.equal(whatsNew.latest().id, whatsNew.RELEASES[0].id);
});

// ── who is interrupted, and who is not ────────────────────────────────────

test('showFor withholds the dialog from an account that has seen it, is new, or has never imported', () => {
  const newest = whatsNew.latest();
  const born = whatsNew.releasedAt(newest) - 86400000;
  assert.equal(whatsNew.showFor({ createdAt: born, seen: '', imported: true }), newest.id, 'an established account is shown the newest');
  assert.equal(whatsNew.showFor({ createdAt: born, seen: newest.id, imported: true }), '', 'having seen it is the end of it');
  assert.equal(whatsNew.showFor({ createdAt: born, seen: '', imported: false }), '', 'a beginner is not interrupted over the first-run panel');
  assert.equal(
    whatsNew.showFor({ createdAt: whatsNew.releasedAt(newest) + 86400000, seen: '', imported: true }), '',
    'an account created after the release has never used the version it describes',
  );
  assert.equal(whatsNew.showFor({ createdAt: 0, seen: '', imported: true }), newest.id, 'an unknown creation date fails towards showing it once');
});

// ── the server decides, and the browser cannot ────────────────────────────

test('/api/state raises it for an established account and stops once it is read', async () => {
  const newest = establish();
  assert.equal((await state()).whatsNew.show, newest.id, 'the payload names the release to raise');

  const seen = await fetch(`${base}/api/whats-new/seen`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}',
  });
  assert.equal(seen.status, 200);
  assert.equal((await seen.json()).seen, newest.id);
  // Stamped on the ACCOUNT, so the next device is not shown it again.
  assert.equal(store.state.userSettings[userId].whatsNewSeen, newest.id);
  assert.equal((await state()).whatsNew.show, '', 'and the payload stops asking');
});

test('the seen route takes no id from the body — there is nothing a client could usefully send', async () => {
  establish();
  const res = await fetch(`${base}/api/whats-new/seen`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ id: 'something-a-client-made-up' }),
  });
  assert.equal((await res.json()).seen, whatsNew.latest().id);
  assert.equal(store.state.userSettings[userId].whatsNewSeen, whatsNew.latest().id, 'the newest id is stamped, never the caller\'s');
});

test('a brand-new account is never interrupted, however many releases there are', async () => {
  const user = store.state.authUsers.find(u => u.id === userId);
  user.createdAt = Date.now();
  store.state.userSettings[userId].whatsNewSeen = '';
  store.save();
  assert.equal((await state()).whatsNew.show, '');
});

// ── the notes themselves, and the captures ────────────────────────────────

test('the notes are fetched from their own route, behind sign-in', async () => {
  const out = await fetch(`${base}/api/whats-new`);
  assert.equal(out.status, 401, 'release notes are not public');
  /*
   * The 401 above is served by the app-wide gate, so it cannot tell whether
   * THIS route carries its own check -- deleting the line left the test green.
   * The route's own guard is asserted where it lives.
   */
  const routes = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const at = routes.indexOf("pathname === '/api/whats-new'");
  const route = routes.slice(at, routes.indexOf('}', routes.indexOf('return json', at)));
  assert.match(route, /!currentUser/, 'and the route refuses on its own rather than relying on the gate above it');
  const res = await fetch(`${base}/api/whats-new`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.latest, whatsNew.latest().id);
  assert.equal(body.releases.length, whatsNew.RELEASES.length);
  assert.equal(body.imageBase, '/whats-new-assets/');
});

test('the captures are served, and the route cannot be walked out of', async () => {
  const img = await fetch(`${base}/whats-new-assets/${whatsNew.latest().image}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  for (const bad of ['/whats-new-assets/../../package.json', '/whats-new-assets/nothing-here.webp']) {
    assert.equal((await fetch(`${base}${bad}`)).status, 404, `${bad} is refused`);
  }
});

// ── the wiring the browser needs, which CI has no browser to drive ────────

test('the dialog is painted from paintStudio and reachable again from Help', () => {
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const paint = html.slice(html.indexOf('function paintStudio()'));
  const painter = paint.slice(0, paint.indexOf('\n}'));
  assert.match(painter, /paintWhatsNew\(\)/, 'raised from paintStudio, never a MutationObserver');
  assert.match(html, /id="dcNews"/, 'the dialog exists');
  assert.match(html, /#dcNews \{ display: none; \}|#dcNews\.hide/, 'and shares the one dialog positioning rule');
  // The BUTTON on the Help screen, not merely the string: the click handler
  // names the same attribute, so a bare match here passed with the entry
  // point deleted.
  assert.match(html, /class="dcnw-open" data-news-open/, 'a dialog shown once is not the only way to read it');
  assert.match(html, /window\.openWhatsNew\s*=/, 'pinned on window: the phone shell reaches it across script scopes');
});

test('the phone opens the same dialog rather than a second copy of it', () => {
  const mobile = fs.readFileSync(new URL('../src/public/studio-mobile.js', import.meta.url), 'utf8');
  assert.match(mobile, /global\.openWhatsNew/, 'the More sheet opens the host dialog');
  assert.doesNotMatch(mobile, /whats-new-assets/, 'and does not draw the notes itself');
});
