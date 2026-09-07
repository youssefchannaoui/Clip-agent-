import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

/**
 * A SIGN-IN BUTTON THAT CANNOT WORK IS NOT DRAWN (v3.146.2).
 *
 * Found live on production, 7 Sept 2026, by pressing it the way a customer
 * would: "Continue with Apple" on deenclipped.online/login sent the browser to
 * Apple's own error page —
 *
 *     invalid_client — Invalid client.
 *
 * All four APPLE_SIGNIN_* variables were set on Render, so `configured('apple')`
 * was true and the button rendered live. The value in APPLE_SIGNIN_CLIENT_ID
 * was the 32-character hex string this file uses as its fixture: not a Services
 * ID at all, and it looks like a placeholder pasted in to fill the field —
 * filling the field being exactly what switched the button on.
 *
 * Two things are pinned here, and each is silent without the other: the shape
 * check that stops a placeholder counting as configuration, and the rendering
 * rule that omits an unusable provider instead of grrying it out. The greyed
 * state (`pointer-events:none; opacity:.45`) was inert but still a dead control
 * on the first screen a customer sees — invariant 9 applies to the sign-in page
 * as much as to the studio.
 */
const source = fs.readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8');

// The exact value that was live in production.
const PLACEHOLDER = '606128db8e3a1c6f5e7977f930b6f2ff';
const REAL = 'online.deenclipped.signin';

/*
 * EACH CASE RUNS IN ITS OWN PROCESS, and that is not belt-and-braces.
 *
 * config.js reads the environment ONCE, at first import. A `?case=` query on
 * the auth.js specifier gives a fresh auth module and the SAME cached config,
 * so every case after the first was answered from the first case's environment
 * — two tests passed for the wrong reason and two failed against correct code.
 * The same trap this repo already records for PORT, one import deeper.
 */
function page(env) {
  const script = `
    const auth = await import(${JSON.stringify(new URL('../src/auth.js', import.meta.url).href)});
    process.stdout.write(JSON.stringify({
      html: auth.loginPage({ returnTo: '/app' }),
      providers: auth.publicConfig(),
    }));`;
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) {
    if (key.startsWith('APPLE_SIGNIN_') || key.startsWith('GOOGLE_SIGNIN_')) delete clean[key];
  }
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...clean, APP_SESSION_SECRET: 'x'.repeat(40), ...env },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out);
}

const APPLE_FULL = {
  APPLE_SIGNIN_TEAM_ID: 'TEAM', APPLE_SIGNIN_KEY_ID: 'KEY', APPLE_SIGNIN_PRIVATE_KEY: 'pk',
};

test('the placeholder that was live in production does not count as configured', () => {
  const { providers, html } = page({ ...APPLE_FULL, APPLE_SIGNIN_CLIENT_ID: PLACEHOLDER });
  assert.equal(providers.apple, false, 'a bare hex id is not a Services ID');
  assert.ok(!html.includes('Continue with Apple'), 'and the button is not drawn');
});

test('a real Services ID switches it back on by itself', async () => {
  // Self-healing is the point of checking the shape rather than deleting the
  // button: the day real credentials are set, nobody has to remember this.
  const { providers, html } = await page({ ...APPLE_FULL, APPLE_SIGNIN_CLIENT_ID: REAL });
  assert.equal(providers.apple, true);
  assert.ok(html.includes('Continue with Apple'));
  assert.match(html, /href="\/auth\/apple\/start\?returnTo=%2Fapp"/);
});

test('every other field is still required', () => {
  for (const missing of ['APPLE_SIGNIN_TEAM_ID', 'APPLE_SIGNIN_KEY_ID', 'APPLE_SIGNIN_PRIVATE_KEY']) {
    const env = { ...APPLE_FULL, APPLE_SIGNIN_CLIENT_ID: REAL };
    delete env[missing];
    const { providers } = page(env);
    assert.equal(providers.apple, false, `${missing} is still required`);
  }
});

test('an unusable provider is OMITTED, never greyed', () => {
  const { html } = page({ ...APPLE_FULL, APPLE_SIGNIN_CLIENT_ID: PLACEHOLDER });
  assert.ok(!html.includes('is-disabled'), 'the dead-control state is gone from the page');
  assert.ok(!source.includes('is-disabled'), 'and its CSS rule went with it');
  assert.ok(!/pointer-events:none;opacity:\.45/.test(source));
});

test('the divider and the row go with the last button', async () => {
  // A divider under nothing is a line across the top of a form, and "or use
  // email" promises an alternative that is not there.
  const { html } = await page({});
  const body = html.slice(html.indexOf('</style>'));
  assert.ok(!body.includes('<div class="dc-auth-oauth">'), 'no empty row');
  assert.ok(!body.includes('or use email'), 'no divider under nothing');
  assert.ok(html.includes('Continue with email'), 'but signing in by email still works');
});

test('Google is unaffected and is drawn on its own', () => {
  const { html } = page({ GOOGLE_SIGNIN_CLIENT_ID: 'g', GOOGLE_SIGNIN_CLIENT_SECRET: 's' });
  assert.ok(html.includes('Continue with Google'));
  assert.ok(!html.includes('Continue with Apple'));
  assert.ok(html.includes('or use email'), 'one provider still earns the divider');
});

test('the shape check claims only what it can prove', () => {
  // Only Apple can say whether a well-formed Services ID is live. This catches
  // the shape that was actually shipping a broken button; a comment that
  // claimed more would be the stale claim this repo keeps paying for.
  const at = source.indexOf('function looksLikeAppleServiceId');
  assert.ok(at > 0);
  const note = source.slice(Math.max(0, at - 1400), at);
  assert.match(note, /invalid_client/, 'the failure that produced it is written down');
  assert.match(note, /does NOT claim to validate the credential/i);
});
