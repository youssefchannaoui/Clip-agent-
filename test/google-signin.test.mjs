import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * SIGN-IN IS NOT PUBLISHING.
 *
 * Youssef's goal, 14 Sept 2026: "as long as you can use YouTube, Instagram,
 * Facebook, and TikTok to sign in, and as well as it not giving you that
 * unsafe screen whenever you're trying to sign in ... that's all that matters."
 *
 * Google's unverified-app warning is triggered by SENSITIVE or RESTRICTED
 * scopes, and by nothing else. Publishing asked for `youtube.upload` and
 * `youtube.readonly` -- both sensitive -- and that is what showed the screen.
 * Sign-in asks for `openid email profile`, which Google documents as
 * non-sensitive: no verification, no warning.
 *
 * Retiring the publishing scopes removed the screen. Switching sign-in off as
 * well removed it from nobody and locked out every account that had joined
 * with Google: such an account has no password, `requestPasswordReset` returns
 * `{ sent: false }` for it, and the email form tells it to use the button that
 * is no longer drawn. Three days, including the operator's own account.
 *
 * Two things are pinned here, and each is silent when it breaks.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const withoutComments = text => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the sign-in flow asks for NON-SENSITIVE scopes only', () => {
  /*
   * The guard that keeps the warning gone. A Google API scope added to this
   * request -- youtube, drive, gmail, contacts, anything under
   * googleapis.com/auth -- brings the unverified-app screen straight back to
   * the login page, which is the one place it was never coming from.
   */
  const auth = withoutComments(read('src/auth.js'));
  const line = auth.split('\n').find(l => /scope'?\s*,\s*'openid email profile'/.test(l));
  assert.ok(line, 'the Google sign-in scope must stay openid + email + profile');

  const googleScopes = auth.match(/https:\/\/www\.googleapis\.com\/auth\/[a-z.]+/g) || [];
  assert.deepEqual(googleScopes, [], 'no Google API scope belongs in the sign-in flow');
});

test('sign-in is not left switched off by default, so the lockout cannot repeat', () => {
  /*
   * It defaulted to false with no fallback, so a deployment holding perfectly
   * good Google credentials drew no button and said nothing. Read from the
   * source rather than the loaded config: config.js reads the environment once
   * at import, and this must hold for a deployment that sets neither switch.
   */
  const config = withoutComments(read('src/config.js'));

  const enabled = config.match(/googleSigninEnabled:\s*boolean\([^,]+,\s*(true|false)\)/);
  assert.ok(enabled, 'googleSigninEnabled must be declared');
  assert.equal(enabled[1], 'true', 'off by default is the lockout, shipped');

  for (const key of ['googleSigninClientId', 'googleSigninClientSecret']) {
    const decl = config.split('\n').find(l => l.includes(`${key}:`));
    assert.ok(decl, `${key} must be declared`);
    assert.match(
      decl,
      /GOOGLE_CLIENT_(ID|SECRET)/,
      `${key} must fall back to the project's own credentials rather than to nothing`,
    );
  }
});

test('an account with no password has a way back in, and it is no longer the button', () => {
  /*
   * WRITTEN EARLIER TODAY ASSERTING THE OPPOSITE, and corrected here.
   *
   * It pinned the blanket refusal -- `if (!user || !user.passwordHash) return
   * { sent: false }` -- as the thing that made the lockout total, on the
   * reasoning that restoring the button was the fix. Then Render turned out to
   * hold no Google credentials at all, so the button cannot come back until
   * somebody supplies them, and "the provider button must exist" stopped being
   * a guarantee this code can make.
   *
   * The refusal is now narrowed to accounts whose provider still WORKS, and a
   * stranded one gets a recovery link instead. That is pinned properly in
   * test/stranded-account.test.mjs, driving the real function both ways; what
   * is kept here is the one-line reason the email form alone is not an answer.
   */
  const auth = withoutComments(read('src/auth.js'));
  assert.match(
    auth,
    /already connected with Google or Apple/,
    'the password form still points at the provider, so it cannot be the only way back',
  );
  assert.doesNotMatch(
    auth,
    /if \(!user \|\| !user\.passwordHash\) return \{ sent: false \}/,
    'the blanket refusal is what stranded every Google account; it must not come back',
  );
});
