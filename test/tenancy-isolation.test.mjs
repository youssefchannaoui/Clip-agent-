import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The integration test the migration guide calls for: two accounts, each with
 * their own clip, and a check that neither can see, fetch, edit, delete or
 * publish the other's — through the real HTTP routes, not by calling internal
 * functions directly. This is what makes it safe to open sign-ups.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-isolation-'));
const port = 34000 + Math.floor(Math.random() * 4000);

process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.SOCIAL_TOKEN_KEY = 'isolation-test-social-key-over-32-characters';

const base = `http://127.0.0.1:${port}`;

// Importing server.js starts it listening as a side effect.
const { server } = await import('../src/server.js');
const store = await import('../src/store.js');
const auth = await import('../src/auth.js');

test.after(() => new Promise(resolve => server.close(() => resolve())));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

async function signUp(email, password) {
  const res = await fetch(`${base}/auth/email`, {
    method: 'POST',
    // Sign-in refuses a post that did not come from the site, so this has to
    // carry the Origin a browser form post always carries.
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ email, password, returnTo: '/' }),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  assert.ok(cookie.startsWith('dc_session='), `expected a session cookie, got: ${setCookie}`);
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  const meBody = await me.json();
  return { cookie, id: meBody.user.id };
}

function seedClip(userId, clipId, projectId) {
  store.state.projects.push({ id: projectId, userId, title: `Lecture for ${userId}`, status: 'done', clipCount: 1 });
  store.state.clips.push({
    id: clipId, userId, projectId, title: `Clip for ${userId}`, description: '', hashtags: '',
    status: 'waiting', targets: [], addedAt: Date.now(), musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold',
  });
}

test('two accounts cannot see, fetch, edit, delete or publish each other\'s clips', async () => {
  const alice = await signUp('alice@deenclipped.test', 'correct horse battery staple');
  const bob = await signUp('bob@deenclipped.test', 'another very good password');
  assert.notEqual(alice.id, bob.id);

  seedClip(alice.id, 'clip-alice', 'project-alice');
  seedClip(bob.id, 'clip-bob', 'project-bob');

  // Neither account's dashboard state lists the other's clips or projects.
  const aliceState = await (await fetch(`${base}/api/state`, { headers: { Cookie: alice.cookie } })).json();
  const bobState = await (await fetch(`${base}/api/state`, { headers: { Cookie: bob.cookie } })).json();
  assert.ok(aliceState.clips.some(c => c.id === 'clip-alice'));
  assert.ok(!aliceState.clips.some(c => c.id === 'clip-bob'));
  assert.ok(bobState.clips.some(c => c.id === 'clip-bob'));
  assert.ok(!bobState.clips.some(c => c.id === 'clip-alice'));
  assert.ok(!aliceState.projects.some(p => p.id === 'project-bob'));
  assert.ok(!bobState.projects.some(p => p.id === 'project-alice'));

  // Fetching another account's clip by id 404s, and does not distinguish
  // "belongs to someone else" from "does not exist".
  const fetchBobsClip = await fetch(`${base}/api/clips/clip-bob/thumb`, { headers: { Cookie: alice.cookie } });
  assert.equal(fetchBobsClip.status, 404);

  // Editing another account's clip is refused.
  const editBobsClip = await fetch(`${base}/api/clips/clip-bob`, {
    method: 'PATCH', headers: { Cookie: alice.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Hijacked title' }),
  });
  assert.notEqual(editBobsClip.status, 200);
  assert.equal(store.state.clips.find(c => c.id === 'clip-bob').title, 'Clip for ' + bob.id);

  // Deleting another account's clip is refused, and the clip survives.
  const deleteBobsClip = await fetch(`${base}/api/clips/clip-bob`, { method: 'DELETE', headers: { Cookie: alice.cookie } });
  assert.notEqual(deleteBobsClip.status, 200);
  assert.ok(store.state.clips.some(c => c.id === 'clip-bob'));

  // Deleting another account's project is refused, and the project survives.
  const deleteBobsProject = await fetch(`${base}/api/projects/project-bob`, { method: 'DELETE', headers: { Cookie: alice.cookie } });
  assert.notEqual(deleteBobsProject.status, 200);
  assert.ok(store.state.projects.some(p => p.id === 'project-bob'));

  // Attempting to publish another account's clip is refused.
  const publishBobsClip = await fetch(`${base}/api/clips/clip-bob/publish`, { method: 'POST', headers: { Cookie: alice.cookie } });
  assert.notEqual(publishBobsClip.status, 200);

  // Each account only sees its own activity log entries.
  store.log("A message about Alice's lecture", 'info', alice.id);
  store.log("A message about Bob's lecture", 'info', bob.id);
  const aliceState2 = await (await fetch(`${base}/api/state`, { headers: { Cookie: alice.cookie } })).json();
  assert.ok(aliceState2.log.some(entry => entry.message.includes('Alice')));
  assert.ok(!aliceState2.log.some(entry => entry.message.includes('Bob')));

  // Neither account can act at all without a session.
  const noSession = await fetch(`${base}/api/state`);
  assert.equal(noSession.status, 401);
});

test('a signed-in account can fully manage its own clip', async () => {
  const carol = await signUp('carol@deenclipped.test', 'yet another good password');
  seedClip(carol.id, 'clip-carol', 'project-carol');

  const edit = await fetch(`${base}/api/clips/clip-carol`, {
    method: 'PATCH', headers: { Cookie: carol.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'My own new title' }),
  });
  assert.equal(edit.status, 200);
  assert.equal(store.state.clips.find(c => c.id === 'clip-carol').title, 'My own new title');

  const del = await fetch(`${base}/api/clips/clip-carol`, { method: 'DELETE', headers: { Cookie: carol.cookie } });
  assert.equal(del.status, 200);
});

test('the activity log reaches only the account that owns each entry', async () => {
  // logFor() had an unfiltered `owner` branch. The owner is not a separate admin
  // console — it is the first registered account using the same dashboard — so
  // that put other customers' sign-in emails, token charges and lecture titles
  // into its notification bell, contradicting the policy in tenancy.js.
  const owner = auth.ownerUser();
  const ownerCookie = (() => {
    const token = auth.createSession(owner, { provider: 'test' });
    return auth.cookieHeaders(token)[0].split(';');
  })()[0];

  store.log('Signed in someone-else@example.com with Google.', 'info', 'someone-else');
  store.log('Charged 12 tokens to someone-else@example.com for a lecture.', 'info', 'someone-else');
  store.log('A system line with no owner at all', 'info', null);

  const ownerState = await (await fetch(`${base}/api/state`, { headers: { Cookie: ownerCookie } })).json();
  const messages = (ownerState.log || []).map(e => e.message).join(' | ');

  assert.ok(!messages.includes('someone-else@example.com'),
    'the owner must not see another account\'s sign-ins or charges');
  assert.ok(!messages.includes('A system line with no owner'),
    'unowned system lines belong in the server console, not a customer feed');
  assert.ok((ownerState.log || []).every(e => e.userId === owner.id),
    'every entry delivered belongs to the account asking');
});
