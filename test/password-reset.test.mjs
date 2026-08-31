import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// There was no password reset anywhere in the codebase: no route, no token, no
// link on the login page. One forgotten password was a permanent lockout, and
// the only way back in was emailing the founder.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-reset-'));
// Ports 32768-60999 are Linux's EPHEMERAL range: the kernel hands them out
// to outgoing sockets, so a port chosen there can be taken between the
// choice and the listen. The file then dies with EADDRINUSE and the run
// reports FEWER TESTS rather than a failure anyone can read -- measured at
// 1 abort in 6 full runs. This window is below the range, and every test
// file gets its own so two cannot collide with each other either.
const port = 18950 + Math.floor(Math.random() * 100);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.APP_SESSION_SECRET = 'password-reset-test-secret-long';
process.env.EMAIL_API_KEY = 'test-key';
process.env.EMAIL_FROM = 'hello@deenclipped.online';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('api.stripe.com')) return new Response('{}', { status: 200 });
  let body = {};
  try { body = JSON.parse(options.body); } catch {}
  sent.push({ to: body.to?.[0] ?? body.To, subject: body.subject ?? body.Subject, text: body.text ?? body.TextBody ?? '' });
  return new Response(JSON.stringify({ id: 'mail' }), { status: 200 });
};

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const auth = await import('../src/auth.js');
const { state } = await import('../src/store.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await realFetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  globalThis.fetch = realFetch;
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

// Origin included deliberately: /auth/* POSTs are CSRF-guarded, so a request
// without it is refused with 403. Posting like a real browser is part of what
// these tests are checking.
const form = (path, fields, headers = {}) => realFetch(`${base}${path}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: process.env.PUBLIC_BASE_URL,
    ...headers,
  },
  body: new URLSearchParams(fields).toString(),
  redirect: 'manual',
});

test('the reset routes refuse a cross-site post', async () => {
  const res = await realFetch(`${base}/auth/forgot`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
    body: new URLSearchParams({ email: 'someone@test' }).toString(),
    redirect: 'manual',
  });
  assert.equal(res.status, 403, 'a reset is a live key to an account; it must not be triggerable from another site');
});

async function makePasswordUser(email) {
  const user = {
    id: `user_${email}`, email, name: email, role: 'creator', providers: {},
    createdAt: Date.now(), passwordHash: await auth.hashPassword('oldpassword123'),
  };
  state.authUsers.push(user);
  return user;
}

test('the sign-in page offers a way out of a forgotten password', async () => {
  const page = await realFetch(`${base}/login`).then(r => r.text());
  assert.match(page, /Forgot your password\?/i);
  assert.match(page, /href="\/reset"/);
});

test('asking for a reset emails a working link', async () => {
  await makePasswordUser('forgetful@test');
  sent.length = 0;
  const res = await form('/auth/forgot', { email: 'forgetful@test' });
  assert.equal(res.status, 302);
  assert.equal(sent.length, 1, 'a reset email must actually be sent');
  assert.match(sent[0].subject, /reset/i);
  const link = (sent[0].text.match(/https:\/\/\S+\/reset\?token=\S+/) || [])[0];
  assert.ok(link, `the email must carry a link, got: ${sent[0].text}`);

  const token = new URL(link).searchParams.get('token');
  const page = await realFetch(`${base}/reset?token=${encodeURIComponent(token)}`).then(r => r.text());
  assert.match(page, /Choose a new password/i, 'a live token must open the new-password form');
});

test('the new password works, and the link cannot be used twice', async () => {
  await makePasswordUser('resetter@test');
  sent.length = 0;
  await form('/auth/forgot', { email: 'resetter@test' });
  const token = new URL((sent[0].text.match(/https:\/\/\S+\/reset\?token=\S+/) || [])[0]).searchParams.get('token');

  const done = await form('/auth/reset', { token, password: 'a-much-better-one' });
  assert.equal(done.status, 302, 'a successful reset signs you straight in');
  assert.match(done.headers.get('set-cookie') || '', /dc_session=/);

  const user = state.authUsers.find(u => u.email === 'resetter@test');
  assert.ok(await auth.verifyPassword('a-much-better-one', user.passwordHash), 'the new password must work');
  assert.ok(!(await auth.verifyPassword('oldpassword123', user.passwordHash)), 'the old one must not');

  const replay = await form('/auth/reset', { token, password: 'attacker-choice' });
  assert.equal(replay.status, 200);
  assert.match(await replay.text(), /expired or has already been used/i, 'a reset link is single use');
});

test('resetting signs every other device out', async () => {
  const user = await makePasswordUser('everywhere@test');
  auth.createSession(user, { provider: 'password' });
  auth.createSession(user, { provider: 'password' });
  assert.ok(state.authSessions.filter(s => s.userId === user.id).length >= 2);

  sent.length = 0;
  await form('/auth/forgot', { email: 'everywhere@test' });
  const token = new URL((sent[0].text.match(/https:\/\/\S+\/reset\?token=\S+/) || [])[0]).searchParams.get('token');
  await form('/auth/reset', { token, password: 'brand-new-secret' });

  const left = state.authSessions.filter(s => s.userId === user.id);
  assert.equal(left.length, 1,
    'only the session minted by the reset itself survives — whoever forced it must not keep one');
});

test('an unknown address is answered exactly like a known one', async () => {
  sent.length = 0;
  const unknown = await form('/auth/forgot', { email: 'nobody-here@test' });
  assert.equal(unknown.status, 302);
  assert.equal(unknown.headers.get('location'), '/reset?sent=1');
  assert.equal(sent.length, 0, 'nothing is sent, but the answer must not reveal that');
});

test('a Google account is not given a password by the back door', async () => {
  state.authUsers.push({
    id: 'user_sso', email: 'sso@test', name: 'sso', role: 'creator',
    providers: { google: { sub: 'g1' } }, createdAt: Date.now(),
  });
  sent.length = 0;
  const res = await form('/auth/forgot', { email: 'sso@test' });
  assert.equal(res.headers.get('location'), '/reset?sent=1', 'same answer as always');
  assert.equal(sent.length, 0,
    'an SSO account has no password to reset; sending a link would quietly add a second way in');
});

test('a dead link says so on arrival, not after retyping a password', async () => {
  const page = await realFetch(`${base}/reset?token=not-a-real-token`).then(r => r.text());
  assert.match(page, /expired or has already been used/i);
  assert.match(page, /Reset your password/i, 'and it offers to send a fresh one');
});

test('the reset form is throttled so it cannot bomb an inbox', async () => {
  await makePasswordUser('flooded@test');
  sent.length = 0;
  for (let i = 0; i < 6; i += 1) await form('/auth/forgot', { email: 'flooded@test' });
  assert.ok(sent.length <= 3, `expected at most 3 emails, sent ${sent.length}`);
});
