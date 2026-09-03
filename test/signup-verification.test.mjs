import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The six-digit code, and the robot box.
 *
 * Youssef, 3 Sept 2026: "when signing up to an account firstfly add cloudflare
 * are you a robot box, also see how this pops up after email log in add
 * verifcation so this doesnt pop up so we send them a 6 digit code to their
 * email."
 *
 * The dialog he photographed — "your email address is not confirmed yet, so
 * imports are blocked" — arrived at the worst possible moment: after signing
 * up, after picking a lecture, after seven steps of a wizard, at the press of
 * Start. Nothing was broken; the confirmation simply happened nowhere until it
 * happened in the way.
 *
 * What is asserted here is the part that fails SILENTLY: a code with no attempt
 * limit is a million guesses that a script gets for free, and a challenge that
 * fails open is a challenge that is not there.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-signupverify-'));
process.env.DATA_DIR = dataDir;
process.env.AUTH_REQUIRED = 'true';

const auth = await import('../src/auth.js');
const store = await import('../src/store.js');
const { config } = await import('../src/config.js');

let seq = 0;
function account() {
  seq += 1;
  const user = { id: `user_code_${seq}`, email: `person${seq}@deenclipped.test`, providers: {}, createdAt: Date.now() };
  if (!Array.isArray(store.state.authUsers)) store.state.authUsers = [];
  store.state.authUsers.push(user);
  return user;
}

test('a code is six digits, and is not the link', () => {
  const user = account();
  const { raw, code } = auth.createVerification(user);
  assert.match(code, /^[0-9]{6}$/, 'six digits, zero-padded');
  assert.notEqual(code, raw, 'the code and the link token are different secrets');
  // Stored as hashes, like sessions: the state file is not a list of live keys.
  const record = store.state.authVerifications.find(item => item.userId === user.id);
  assert.ok(record.codeHash && record.codeHash !== code, 'the code is stored hashed');
  assert.equal(JSON.stringify(store.state.authVerifications).includes(code), false,
    'the code itself is never written to disk');
});

test('the right code confirms the address, once', () => {
  const user = account();
  const { code } = auth.createVerification(user);
  const first = auth.consumeVerificationCode(user.id, code);
  assert.equal(first.ok, true);
  assert.ok(user.emailVerifiedAt, 'the account is marked confirmed');
  const again = auth.consumeVerificationCode(user.id, code);
  assert.equal(again.ok, false, 'a code cannot be replayed');
});

test('spaces and stray characters in a pasted code are forgiven', () => {
  const user = account();
  const { code } = auth.createVerification(user);
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  assert.equal(auth.consumeVerificationCode(user.id, spaced).ok, true,
    'a code copied out of an email brings spaces with it');
});

test('six wrong guesses spend the code', () => {
  // A six-digit code is a million guesses and an online guesser gets as many as
  // this allows. Without a limit the code is not a secret, it is a formality.
  const user = account();
  const { code } = auth.createVerification(user);
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  for (let i = 0; i < 5; i += 1) {
    assert.equal(auth.consumeVerificationCode(user.id, wrong).reason, 'wrong');
  }
  assert.equal(auth.consumeVerificationCode(user.id, wrong).reason, 'spent', 'the sixth spends it');
  assert.equal(auth.consumeVerificationCode(user.id, code).ok, false,
    'and the REAL code stops working too, or the limit means nothing');
  assert.ok(!user.emailVerifiedAt);
});

test('a code belongs to one account', () => {
  // The lookup is scoped to a user on purpose. Searching every pending record
  // for a matching six digits would let one guesser hit every sign-up at once
  // instead of one account's six attempts.
  const a = account();
  const b = account();
  const { code } = auth.createVerification(a);
  auth.createVerification(b);
  assert.equal(auth.consumeVerificationCode(b.id, code).ok, false,
    "one account's code cannot confirm another");
  assert.equal(auth.consumeVerificationCode(a.id, code).ok, true);
});

test('resending retires the previous code', () => {
  const user = account();
  const first = auth.createVerification(user).code;
  const second = auth.createVerification(user).code;
  assert.equal(auth.consumeVerificationCode(user.id, first).ok, false, 'the old one is dead');
  assert.equal(auth.consumeVerificationCode(user.id, second).ok, true, 'the newest one works');
});

test('the email leads with the code and still carries the link', async () => {
  const mailer = await import('../src/mailer.js');
  const message = mailer.verificationMessage('https://deenclipped.online/auth/verify?token=abc', '048213');
  assert.match(message.subject, /048213/, 'the code is in the subject, where a phone shows it');
  assert.ok(message.text.includes('048213') && message.text.includes('token=abc'),
    'both roads are in the mail');
  assert.ok(message.html.includes('048213'));
  // A caller that has no code (an older record) must still send a usable mail.
  const linkOnly = mailer.verificationMessage('https://deenclipped.online/auth/verify?token=abc');
  assert.ok(linkOnly.text.includes('token=abc'));
  assert.doesNotMatch(linkOnly.subject, /\d{6}/);
});

test('the robot box is inert until it is configured', async () => {
  // This is what keeps a deployment with no keys signing people up exactly as
  // before — and what lets the suite create dozens of accounts without solving
  // a challenge. It is also the reason the check must FAIL CLOSED once the
  // keys ARE set: see below.
  assert.equal(auth.turnstileEnabled(), false, 'no keys in this environment');
  assert.equal(await auth.verifyTurnstile('', '1.2.3.4'), true, 'unconfigured means unchanged');
});

test('once configured, a missing or uncheckable answer is a refusal', async () => {
  const site = config.turnstileSiteKey;
  const secret = config.turnstileSecret;
  config.turnstileSiteKey = 'site-key';
  config.turnstileSecret = 'secret-key';
  try {
    assert.equal(auth.turnstileEnabled(), true);
    assert.equal(await auth.verifyTurnstile('', '1.2.3.4'), false, 'no answer is not a pass');
    // Cloudflare unreachable. A challenge that cannot be checked has not been
    // passed: an outage is a bad hour, an open door is worse.
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('network down'));
    try {
      assert.equal(await auth.verifyTurnstile('some-answer', '1.2.3.4'), false, 'fails closed');
      globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 200 }));
      assert.equal(await auth.verifyTurnstile('some-answer', '1.2.3.4'), false);
      globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      assert.equal(await auth.verifyTurnstile('some-answer', '1.2.3.4'), true);
    } finally { globalThis.fetch = realFetch; }
  } finally {
    config.turnstileSiteKey = site;
    config.turnstileSecret = secret;
  }
});

test('the sign-up page shows the box only when it is configured, and the CSP follows it', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8');
  assert.ok(source.includes('class="cf-turnstile"'), 'the widget exists');
  assert.ok(/turnstileEnabled\(\) \? `<div class="cf-turnstile"/.test(source),
    'and is drawn only when the keys are set — a box that cannot load blocks the door');
  // A blocked third-party script fails silently: the widget renders nothing,
  // the form has no answer to send, and every sign-up is refused.
  assert.ok(/challenge \? ' https:\/\/challenges\.cloudflare\.com' : ''/.test(server),
    'script-src admits the challenge');
  assert.ok(server.includes("const challenge = auth.turnstileEnabled() && pathname === '/login'"),
    'and only on the page that carries it');
});

test('a new account is sent to the code screen, not into the app', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(/if \(!known && !auth\.isVerified\(user\)\) \{[^}]*\/verify\?returnTo=/s.test(server),
    'the whole point: confirm while they are still thinking about their address');
  // An existing account signing in must not be diverted, and a deployment that
  // cannot send mail must not divert anyone at all.
  assert.ok(server.includes('!known &&'), 'only a new account');
  assert.ok(server.includes('!auth.isVerified(user)'), 'and only one that needs it');
});

/**
 * Switching email on must not lock out the people already here.
 *
 * Setting EMAIL_API_KEY flips `verificationRequired()` from false to true for
 * the whole deployment. Without a grandfather rule that does something nobody
 * would intend: every account that ever signed up with an email and password
 * is retroactively blocked from importing, because none of them was ever asked
 * to confirm. They signed up under different rules, and they have already paid
 * tokens for work they would suddenly be refused.
 */
test('an account that predates confirmation is not blocked by it', async () => {
  const mailer = await import('../src/mailer.js');
  const before = { id: 'user_old', email: 'old@deenclipped.test', providers: {}, createdAt: 1000 };
  store.state.authUsers.push(before);

  // With no mail configured everybody counts as verified, exactly as before.
  assert.equal(auth.isVerified(before), true);

  const key = config.emailApiKey;
  const from = config.emailFrom;
  config.emailApiKey = 'test-key';
  config.emailFrom = 'DeenClipped <hello@deenclipped.test>';
  delete store.state.authSettings?.verificationSince;
  try {
    assert.equal(mailer.configured(), true, 'the deployment can now send');
    // The stamp lands on the first read, so this account is on the old side.
    assert.equal(auth.isVerified(before), true, 'an existing account keeps working');
    const since = Number(store.state.authSettings.verificationSince);
    assert.ok(since > 0, 'the day confirmation started is recorded');

    // Someone who signs up AFTER it is on must still confirm.
    const after = { id: 'user_new', email: 'new@deenclipped.test', providers: {}, createdAt: since + 1000 };
    store.state.authUsers.push(after);
    assert.equal(auth.isVerified(after), false, 'a new account is asked');
    const { code } = auth.createVerification(after);
    assert.equal(auth.consumeVerificationCode(after.id, code).ok, true);
    assert.equal(auth.isVerified(after), true, 'and is done once it answers');

    // A Google account is proof of the address on arrival, whenever it arrived.
    const google = { id: 'user_g', email: 'g@deenclipped.test', providers: { google: { sub: '1' } }, createdAt: since + 2000 };
    assert.equal(auth.isVerified(google), true);
  } finally {
    config.emailApiKey = key;
    config.emailFrom = from;
  }
});
