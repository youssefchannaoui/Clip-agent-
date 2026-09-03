import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Anyone could create unlimited accounts against addresses they did not own,
// each arriving with free tokens that cost real worker time. There was no way
// to ask whether they owned the address, because the product sent no email.
//
// The riskiest thing about adding this is the deployment that has no email
// provider: if verification were required there, every account would be
// blocked forever with no way to unblock it. That case is tested first.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-verify-'));
process.env.DATA_DIR = dataDir;
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.APP_SESSION_SECRET = 'verification-test-secret-long-enough-here';
delete process.env.EMAIL_API_KEY;
delete process.env.EMAIL_FROM;

const auth = await import('../src/auth.js');
const mailer = await import('../src/mailer.js');
const { config } = await import('../src/config.js');

test('with no provider configured, nothing is required and nothing is blocked', async () => {
  assert.equal(mailer.configured(), false);
  assert.equal(auth.verificationRequired(), false);
  const user = await auth.emailLogin('nobody@example.com', 'a-good-password', 'Nobody');
  assert.equal(auth.isVerified(user), true,
    'an unconfigured deployment must keep working exactly as it did');
});

test('with a provider configured, a password account starts unverified', async () => {
  config.emailApiKey = 'test-key';
  config.emailFrom = 'DeenClipped <hello@deenclipped.online>';
  assert.equal(auth.verificationRequired(), true);

  const user = await auth.emailLogin('unconfirmed@example.com', 'a-good-password', 'Unconfirmed');
  assert.equal(auth.isVerified(user), false, 'a typed address proves nothing');
});

test('a provider sign-in counts as proof without any email', () => {
  // Google and Apple have already verified the address; asking the owner to
  // confirm it again would be friction for nothing.
  const viaGoogle = auth.upsertUser('google', 'sub-verified-1', {
    email: 'through-google@example.com', email_verified: true, name: 'Via Google',
  }, null);
  assert.equal(auth.isVerified(viaGoogle), true);
});

test('the link confirms the address, once', async () => {
  const user = await auth.emailLogin('confirms@example.com', 'a-good-password', 'Confirms');
  assert.equal(auth.isVerified(user), false);

  const { raw } = auth.createVerification(user);
  assert.ok(raw && raw.length > 20, 'a real token, not a guessable id');

  const confirmed = auth.consumeVerification(raw);
  assert.ok(confirmed, 'the link works');
  assert.equal(confirmed.id, user.id);
  assert.equal(auth.isVerified(confirmed), true);

  assert.equal(auth.consumeVerification(raw), null, 'and it works only once');
});

test('a wrong or expired token confirms nothing', () => {
  assert.equal(auth.consumeVerification('not-a-real-token'), null);
  assert.equal(auth.consumeVerification(''), null);
});

test('issuing a new link invalidates the previous one', async () => {
  const user = await auth.emailLogin('reissued@example.com', 'a-good-password', 'Reissued');
  const first = auth.createVerification(user).raw;
  const second = auth.createVerification(user).raw;
  assert.notEqual(first, second);
  assert.equal(auth.consumeVerification(first), null, 'the superseded link is dead');
  assert.ok(auth.consumeVerification(second), 'the newest one works');
});

test('one account\'s link cannot confirm another account', async () => {
  const a = await auth.emailLogin('person-a@example.com', 'a-good-password', 'A');
  const b = await auth.emailLogin('person-b@example.com', 'a-good-password', 'B');
  const forA = auth.createVerification(a).raw;
  const confirmed = auth.consumeVerification(forA);
  assert.equal(confirmed.id, a.id);
  assert.equal(auth.isVerified(b), false, 'B is untouched');
});

test('sending is attempted only when it can succeed, and never throws', async () => {
  config.emailApiKey = '';
  config.emailFrom = '';
  const user = await auth.emailLogin('quiet@example.com', 'a-good-password', 'Quiet');
  // No provider: returns false rather than throwing into the sign-in that
  // triggered it.
  assert.equal(await auth.sendVerification(user, 'https://deenclipped.online'), false);
});
