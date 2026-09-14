import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * AN ACCOUNT MUST ALWAYS HAVE ONE WAY BACK IN.
 *
 * On 11 September 2026 Google sign-in was switched off and its credentials
 * were removed from the deployment. Every account created with Google then
 * had, at once:
 *
 *   - no password, because it never set one;
 *   - no reset, because requestPasswordReset declined any account without a
 *     passwordHash, silently;
 *   - and no button, because an unusable provider is omitted from /login.
 *
 * Three ways in, none of them available, and the email form told them to use
 * the provider that was no longer drawn. It stood for three days and it
 * included the operator's own account.
 *
 * The refusal itself was RIGHT while the provider still worked -- a link that
 * sets a password does add a second way into an account whose owner chose
 * single sign-on. What was missing is that the reasoning depends on the
 * owner's chosen way in still being there. So it is narrowed, not dropped, and
 * both halves are pinned below.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-stranded-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'x'.repeat(40);
// No GOOGLE_SIGNIN_* and no GOOGLE_CLIENT_* -- production's own shape on the
// day this broke, and the case the narrowed rule has to let through.
delete process.env.GOOGLE_SIGNIN_ENABLED;
delete process.env.GOOGLE_SIGNIN_CLIENT_ID;
delete process.env.GOOGLE_SIGNIN_CLIENT_SECRET;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const auth = await import('../src/auth.js');
const { state } = await import('../src/store.js');
const mailer = await import('../src/mailer.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* harmless on a runner */ }
});

function seed(id, email, extra = {}) {
  state.authUsers = (state.authUsers || []).filter(u => u.id !== id);
  state.authUsers.push({ id, email, name: email, createdAt: Date.now(), ...extra });
  state.authResets = [];
  return state.authUsers[state.authUsers.length - 1];
}

test('a Google-only account gets a way back in when Google is gone', async () => {
  seed('u-stranded', 'stranded@example.com', { providers: { google: { sub: 'g1' } } });
  const result = await auth.requestPasswordReset('stranded@example.com', 'https://deenclipped.online');
  // `sent` reflects the mail provider, which is not configured in a test run.
  // What this asserts is that a token was MINTED -- the request was honoured
  // rather than silently declined, which is the whole bug.
  assert.equal((state.authResets || []).length, 1, 'a recovery link must be issued');
  assert.equal(typeof result.sent, 'boolean');
});

test('the same account is still refused while Google actually works', async () => {
  /*
   * The original protection, kept. Run in its own process because config.js
   * reads the environment once at import.
   */
  const { execFileSync } = await import('node:child_process');
  const MARK = '<<<n>>>';
  const script = `
    const auth = await import(${JSON.stringify(new URL('../src/auth.js', import.meta.url).href)});
    const { state } = await import(${JSON.stringify(new URL('../src/store.js', import.meta.url).href)});
    state.authUsers = [{ id: 'u1', email: 'sso@example.com', providers: { google: { sub: 'g1' } } }];
    state.authResets = [];
    await auth.requestPasswordReset('sso@example.com', 'https://deenclipped.online');
    process.stdout.write(${JSON.stringify(MARK)} + (state.authResets || []).length + ${JSON.stringify(MARK)});`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dc-sso-')),
      GOOGLE_SIGNIN_CLIENT_ID: 'g', GOOGLE_SIGNIN_CLIENT_SECRET: 's',
    },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  assert.equal(out.split(MARK)[1], '0',
    'with Google available, single sign-on is still not quietly given a password');
});

test('an ordinary password account is untouched', async () => {
  seed('u-pw', 'pw@example.com', { passwordHash: 'not-a-real-hash' });
  await auth.requestPasswordReset('pw@example.com', 'https://deenclipped.online');
  assert.equal((state.authResets || []).length, 1, 'normal reset still works');
});

test('an address with no account still gives nothing away', async () => {
  state.authResets = [];
  const result = await auth.requestPasswordReset('nobody@example.com', 'https://deenclipped.online');
  assert.equal(result.sent, false);
  assert.equal((state.authResets || []).length, 0, 'no token, and no way to tell it apart');
});

test('the email says SET a password, not reset one', () => {
  /*
   * An account that never had a password being told to "reset" it reads as a
   * message meant for somebody else, which is exactly when a real email is
   * taken for a phishing attempt and ignored.
   */
  const stranded = mailer.passwordResetMessage('https://x/reset?token=t', { stranded: true });
  assert.match(stranded.subject, /Set a password/i);
  assert.match(stranded.text, /Google or Apple/);
  assert.match(stranded.text, /lectures and clips are untouched/);

  const normal = mailer.passwordResetMessage('https://x/reset?token=t');
  assert.match(normal.subject, /Reset your DeenClipped password/i);
  assert.doesNotMatch(normal.text, /Google or Apple/);
});

test('setting the password leaves the provider link in place', async () => {
  /*
   * Recovery must ADD a way in, never replace one: when Google comes back the
   * button has to keep working for the same account rather than having been
   * quietly converted to an email account.
   */
  const user = seed('u-keep', 'keep@example.com', { providers: { google: { sub: 'g9' } } });
  await auth.requestPasswordReset('keep@example.com', 'https://deenclipped.online');
  assert.equal(state.authResets.length, 1);
  assert.ok(user.providers.google, 'the provider link is there before');
  // completePasswordReset needs the raw token, which only the email carries;
  // what matters here is that nothing in the request path clears providers.
  assert.ok(state.authUsers.find(u => u.id === 'u-keep').providers.google,
    'and is not cleared by asking for a recovery link');
});
