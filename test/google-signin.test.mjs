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

test('an account with no password still has a way back in', () => {
  /*
   * This is what made the lockout total rather than inconvenient, and it is
   * worth pinning whichever way sign-in is configured: a provider-only account
   * cannot sign in with a password it never set, and cannot reset one either.
   * If Google sign-in is ever switched off again, THIS is the thing that has
   * to be built first.
   */
  const auth = withoutComments(read('src/auth.js'));
  assert.match(
    auth,
    /if \(!user \|\| !user\.passwordHash\) return \{ sent: false \}/,
    'reset still declines silently for a provider-only account',
  );
  assert.match(
    auth,
    /already connected with Google or Apple/,
    'and the password form still points at the provider button',
  );
  // So the provider button must exist. That is the assertion above; this test
  // records WHY it matters rather than adding a second copy of it.
});
