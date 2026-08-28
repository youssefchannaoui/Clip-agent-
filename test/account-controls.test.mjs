import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The Privacy Policy promised erasure within 30 days by email -- a promise
// resting on one person's inbox -- and sessions lasted 30 days with 25 allowed
// at once, so a lost laptop stayed signed in for a month.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-account-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'account-controls-test-secret-long';

const auth = await import('../src/auth.js');
const { state } = await import('../src/store.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

function seed(id, role = 'creator') {
  const user = { id, email: `${id}@test`, name: id, role, providers: {}, createdAt: Date.now() };
  state.authUsers.push(user);
  state.projects.push({ id: `p-${id}`, userId: id, title: 'A lecture' });
  state.clips.push({ id: `c-${id}`, userId: id, projectId: `p-${id}`, title: 'A clip' });
  state.socialConnections[id] = { youtube: { refreshToken: 'SECRET-REFRESH-' + id, accounts: [{ name: 'ch' }] } };
  state.userSettings[id] = { theme: 'dark' };
  auth.createSession(user, { provider: 'password' });
  auth.createSession(user, { provider: 'password' });
  return user;
}

test('signing out everywhere kills every session for that account only', () => {
  const mine = seed('leaver');
  const other = seed('bystander');
  const removed = auth.destroyAllSessions(mine);
  assert.ok(removed >= 2);
  assert.equal(state.authSessions.filter(s => s.userId === mine.id).length, 0);
  assert.ok(state.authSessions.filter(s => s.userId === other.id).length >= 2,
    'one person signing out must not sign out anyone else');
});

test('deleting an account removes its records', () => {
  const user = seed('erasable');
  auth.deleteAccount(user);
  assert.equal(state.authUsers.filter(u => u.id === user.id).length, 0);
  assert.equal(state.projects.filter(p => p.userId === user.id).length, 0);
  assert.equal(state.clips.filter(c => c.userId === user.id).length, 0);
  assert.equal(state.authSessions.filter(s => s.userId === user.id).length, 0);
  assert.equal(state.userSettings[user.id], undefined);
});

test('deleting an account removes the OAuth tokens, which is the part that matters', () => {
  const user = seed('token-holder');
  assert.ok(state.socialConnections[user.id], 'precondition: the connection exists');
  auth.deleteAccount(user);
  assert.equal(state.socialConnections[user.id], undefined,
    'a refresh token keeps working against YouTube long after the account that authorised it is gone');
  assert.ok(!JSON.stringify(state.socialConnections).includes('SECRET-REFRESH-' + user.id),
    'no trace of the credential may survive anywhere in the connection store');
});

test('one deletion does not take anyone else with it', () => {
  const doomed = seed('doomed');
  const safe = seed('safe');
  auth.deleteAccount(doomed);
  assert.ok(state.authUsers.some(u => u.id === safe.id));
  assert.equal(state.projects.filter(p => p.userId === safe.id).length, 1);
  assert.ok(state.socialConnections[safe.id], 'a neighbour keeps their connected accounts');
});

test('the owner account cannot delete itself out of the product', () => {
  const owner = seed('the-owner', 'owner');
  assert.throws(() => auth.deleteAccount(owner), /owner account cannot be deleted/i);
  assert.ok(state.authUsers.some(u => u.id === owner.id));
});
