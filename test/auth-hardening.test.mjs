import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-auth-hardening-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'auth-hardening-test-secret-long-enough';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.OPERATOR_EMAILS = 'operator@deenclipped.test';
process.env.GOOGLE_SIGNIN_CLIENT_ID = 'test-client';
process.env.GOOGLE_SIGNIN_CLIENT_SECRET = 'test-secret';

const store = await import('../src/store.js');
const auth = await import('../src/auth.js');
const { state } = store;

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

test('typing a listed operator address into the password form does not make an operator', async () => {
  auth.ownerUser();
  const user = await auth.emailLogin('operator@deenclipped.test', 'correct horse battery', 'Imposter');
  auth.ownerUser(); // runs elevateOperators
  assert.equal(state.authUsers.find(item => item.id === user.id).role, 'creator');
});

test('the same address proved by Google is elevated, and the unverified password stops working', async () => {
  const before = state.authUsers.find(item => item.email === 'operator@deenclipped.test');
  assert.ok(before.passwordHash, 'precondition: the imposter account has a password');
  const user = auth.upsertUser('google', { sub: 'real-operator', email: 'operator@deenclipped.test', email_verified: true, name: 'Operator' });
  assert.equal(user.id, before.id, 'the workspace is kept, not duplicated');
  assert.equal(user.passwordHash, undefined, 'the unverified password no longer opens the account');
  assert.equal(user.providers.email, undefined);
  auth.ownerUser();
  assert.equal(state.authUsers.find(item => item.id === user.id).role, 'admin');
  assert.rejects(() => auth.emailLogin('operator@deenclipped.test', 'correct horse battery'), /Google or Apple/);
});

test('an unverified Google address is never linked to an existing account', async () => {
  const victim = await auth.emailLogin('victim@deenclipped.test', 'victims password 1');
  const other = auth.upsertUser('google', { sub: 'stranger', email: 'victim@deenclipped.test', email_verified: false });
  assert.notEqual(other.id, victim.id);
  assert.ok(state.authUsers.find(item => item.id === victim.id).passwordHash, 'the victim still has their password');
});

test('a return path cannot be scheme-relative through a backslash', async () => {
  assert.equal(auth.safeReturn('/\\evil.com/x'), '/');
  assert.equal(auth.safeReturn('//evil.com/x'), '/');
  assert.equal(auth.safeReturn('https://evil.com/'), '/');
  assert.equal(auth.safeReturn('/app?tab=clips'), '/app?tab=clips');
});

test('a malformed cookie does not turn every request into a 500', async () => {
  const cookies = auth.parseCookies({ headers: { cookie: 'foo=100%; dc_session=abc' } });
  assert.equal(cookies.foo, '100%');
  assert.equal(cookies.dc_session, 'abc');
});

test('one account signing in many times cannot evict everyone else', async () => {
  const alice = await auth.emailLogin('alice@deenclipped.test', 'alices password 1');
  const bob = await auth.emailLogin('bob@deenclipped.test', 'bobs password 12');
  auth.createSession(bob);
  for (let i = 0; i < 300; i++) auth.createSession(alice);
  assert.equal(state.authSessions.filter(item => item.userId === bob.id).length, 1);
  assert.equal(state.authSessions.filter(item => item.userId === alice.id).length, 25);
});

test('abandoned sign-in starts do not pile up in state', async () => {
  const req = { headers: { host: 'localhost' } };
  let last = '';
  for (let i = 0; i < 600; i++) last = auth.oauthStart('google', req, '/');
  assert.equal(Object.keys(state.authOAuthStates).length, 500);
  // The newest start is the one kept, so the sign-in that is actually in flight still completes.
  const stateId = new URL(last).searchParams.get('state');
  assert.ok(state.authOAuthStates[stateId]);
});
