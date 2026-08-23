import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The attack this file exists to close.
//
// Sign-up is open and unverified, so anyone can register a victim's email
// address before the victim does. The code already knew that: when the real
// owner later signs in with Google, it deletes the squatter's password because
// the provider has now proved who owns the address.
//
// But it deleted only the credential. The session that credential had already
// minted stayed valid for thirty days and resolved to the same account -- so
// revoking the password revoked nothing the attacker was actually using: the
// lectures, clips, transcripts, token balance and connected publishing
// accounts all stayed reachable. Worse, if the squatted address was an
// operator address, elevateOperators promoted that stale session to admin at
// the moment the real owner signed in.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-takeover-'));
process.env.DATA_DIR = dataDir;
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.APP_SESSION_SECRET = 'takeover-test-secret-long-enough-to-pass-validation';

const auth = await import('../src/auth.js');
const { state } = await import('../src/store.js');

const VICTIM = 'victim@example.com';

function requestWith(token) {
  return { headers: { cookie: `dc_session=${token}` }, socket: {} };
}

test('a squatter\'s session dies when the real owner proves the address', async () => {
  // 1. The attacker gets there first with a password nobody verified.
  const squatter = await auth.emailLogin(VICTIM, 'squatter-password-1', 'Not The Owner');
  const squatterToken = auth.createSession(squatter, { provider: 'email' });
  assert.ok(auth.sessionUser(requestWith(squatterToken)), 'the squatter is signed in');
  const accountId = squatter.id;

  // 2. The real owner signs in with a provider that verified the address.
  //    upsertUser is the merge path both OAuth callbacks funnel through.
  const merged = auth.upsertUser('google', 'google-subject-for-victim', {
    email: VICTIM, email_verified: true, name: 'The Real Owner',
  }, null);
  assert.equal(merged.id, accountId, 'it is the same account, not a second one');
  assert.ok(!merged.passwordHash, 'the unverified password is revoked');

  // 3. The squatter's session must be dead. This is the whole point.
  assert.equal(auth.sessionUser(requestWith(squatterToken)), null,
    'the session the revoked password minted must not still open the account');
});

test('the person actually signing in is not logged out by the revocation', async () => {
  const owner = state.authUsers.find(u => u.email === VICTIM);
  // The caller mints the legitimate session after the merge, exactly as the
  // OAuth routes do; it has to survive.
  const goodToken = auth.createSession(owner, { provider: 'google' });
  const seen = auth.sessionUser(requestWith(goodToken));
  assert.ok(seen, 'the real owner stays signed in');
  assert.equal(seen.id, owner.id);
});

test('an unrelated account keeps its sessions through someone else\'s merge', async () => {
  const other = await auth.emailLogin('someone-else@example.com', 'their-own-password', 'Other');
  const otherToken = auth.createSession(other, { provider: 'email' });

  auth.upsertUser('google', 'google-subject-2', {
    email: 'third-party@example.com', email_verified: true, name: 'Third',
  }, null);

  assert.ok(auth.sessionUser(requestWith(otherToken)),
    'revocation is scoped to the account being merged, not everyone');
});

test('an unverified provider address never merges into an existing account', async () => {
  const held = await auth.emailLogin('held@example.com', 'a-real-password', 'Holder');
  const heldToken = auth.createSession(held, { provider: 'email' });

  // Google saying the address is NOT verified proves nothing, so it must not
  // be allowed to take over the account or revoke its credential.
  const result = auth.upsertUser('google', 'google-subject-3', {
    email: 'held@example.com', email_verified: false, name: 'Imposter',
  }, null);

  assert.notEqual(result.id, held.id, 'an unverified address must not attach to the existing account');
  assert.ok(auth.sessionUser(heldToken ? requestWith(heldToken) : null),
    'and the real holder is not signed out by an unverified claim');
});
