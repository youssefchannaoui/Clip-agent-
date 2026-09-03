import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * Connecting TikTok failed with a bare API error, 3 Sept 2026.
 *
 * Youssef, mid-way through recording the TikTok app-review demo: "when i
 * connect to tiktok i then ask for perimission when i come back to my
 * dashboard it says a an error api but the api is the sandbox."
 *
 * Two faults, and the second is why the first was so hard to see.
 *
 *   1. TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET were not trimmed. This repo
 *      has already paid for that lesson twice -- Stripe's keys (v3.27.0) and
 *      Turnstile's (v3.100.0) are both trimmed, with comments explaining that
 *      a credential pasted into Render's variable field picks up a trailing
 *      newline routinely. The OAuth credentials were missed. A key with a
 *      newline on it fails the token exchange as a TikTok API error that looks
 *      exactly like the wrong secret -- right after a deliberate swap, which
 *      is precisely when you would believe it.
 *
 *   2. A failed connection left NOTHING to read. The callback redirects to
 *      /app?social=error&message=..., the page toasts that message and then
 *      wipes the URL with replaceState. One flash, then gone: no activity
 *      entry, nothing to scroll back to, and the only surviving copy in a
 *      server log the customer cannot open.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-oauth-creds-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'oauth-credential-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.SOCIAL_TOKEN_KEY = 'social-token-key-at-least-thirty-two-chars';
// The exact shape of the bug: Render's variable field keeps the newline you
// pasted. Set BEFORE the first config import, because config reads env once.
process.env.TIKTOK_CLIENT_KEY = 'sandbox-key-123\n';
process.env.TIKTOK_CLIENT_SECRET = '  sandbox-secret-456  ';

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

test('every OAuth credential is trimmed on the way in', () => {
  const source = fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  // Read the DECLARATION for each one rather than grepping for ".trim()"
  // anywhere in the file -- the neighbouring Stripe block is full of them.
  const secrets = [
    'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
    'META_APP_ID', 'META_APP_SECRET', 'META_LOGIN_CONFIG_ID',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GOOGLE_SIGNIN_CLIENT_ID', 'GOOGLE_SIGNIN_CLIENT_SECRET',
    'APPLE_SIGNIN_CLIENT_ID',
  ];
  for (const name of secrets) {
    const line = source.split('\n').find(row => row.includes(`process.env.${name}`) && row.includes(':'));
    assert.ok(line, `${name} is read somewhere in config.js`);
    assert.match(line, /\.trim\(\)/,
      `${name} must be trimmed — whitespace around a credential is never meaningful, `
      + 'and the failure it causes is indistinguishable from the wrong value entirely');
  }
});

test('a pasted credential with a newline still works', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(config.tiktokClientKey, 'sandbox-key-123');
  assert.equal(config.tiktokClientSecret, 'sandbox-secret-456');
});

test('a failed connection is written to the activity feed, against the account', async () => {
  const { state } = await import('../src/store.js');
  const social = await import('../src/social.js');

  state.authUsers.push({
    id: 'owner-1', email: 'owner@test', name: 'Owner', role: 'owner', providers: {},
    createdAt: Date.now(), billing: { plan: 'free', status: 'free' },
  });
  const before = state.log.length;

  // A real signed state, so the callback gets past verifyState and fails where
  // a wrong secret actually fails: the token exchange.
  const startUrl = new URL(social.oauthStartUrl('tiktok', 'owner-1'));
  const returned = new URL('https://app.test/auth/tiktok/callback');
  returned.searchParams.set('state', startUrl.searchParams.get('state'));
  returned.searchParams.set('code', 'a-code');

  const realFetch = global.fetch;
  global.fetch = async () => new Response(
    JSON.stringify({ error: 'invalid_client', error_description: 'Client key or secret is incorrect.' }),
    { status: 400, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => social.completeOAuth('tiktok', returned));
  } finally { global.fetch = realFetch; }

  const written = state.log.slice(0, state.log.length - before);
  const entry = written.find(row => /Could not connect tiktok/i.test(row.message));
  assert.ok(entry, 'the failure reaches the activity feed at all');
  assert.equal(entry.level, 'error');
  assert.equal(entry.userId, 'owner-1',
    'against the account — logFor filters by user, so a null userId is invisible in every bell');
  assert.match(entry.message, /Client key or secret is incorrect|invalid_client/,
    'carrying the platform’s own reason, not a generic "connection failed"');
});
