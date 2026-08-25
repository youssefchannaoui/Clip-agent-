import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-token-'));
process.env.SOCIAL_TOKEN_KEY = 'social-test-key-that-is-definitely-long-enough';
process.env.PUBLIC_BASE_URL = 'https://app.test';

const social = await import('../src/social.js');
const { mergeRefreshedToken } = social.__test;

const STALE = { access_token: 'old-and-expired', refresh_token: 'r1', expiresAt: Date.now() - 60_000 };

test('a refresh that carries no token is refused, not cached', () => {
  // The bug: `{ ...token, ...refreshed }` left the OLD access_token in place
  // while expiresAt was stamped an hour into the future and saved. Every
  // publish for that hour then failed with 401 and the refresh was never
  // retried, because the expiry it was judged against had just been invented.
  for (const answer of [{}, { expires_in: 3600 }, { access_token: '' }, { access_token: '   ' }, null]) {
    assert.throws(
      () => mergeRefreshedToken(STALE, answer, 'YouTube', 3600),
      /did not return a new access token/,
      `an answer of ${JSON.stringify(answer)} must not be trusted`,
    );
  }
});

test('a real refresh replaces the token and moves the expiry forward', () => {
  const merged = mergeRefreshedToken(STALE, { access_token: 'fresh', expires_in: 3600 }, 'YouTube', 3600);
  assert.equal(merged.access_token, 'fresh');
  assert.ok(merged.expiresAt > Date.now() + 3_000_000);
});

test('a rotated refresh token is taken, and a missing one keeps the old', () => {
  // Providers rotate them. Losing the old one when none comes back is what
  // stops the NEXT refresh from working at all.
  const rotated = mergeRefreshedToken(STALE, { access_token: 'a', refresh_token: 'r2' }, 'TikTok', 86400);
  assert.equal(rotated.refresh_token, 'r2');

  const kept = mergeRefreshedToken(STALE, { access_token: 'a' }, 'TikTok', 86400);
  assert.equal(kept.refresh_token, 'r1');
});

test('the provider default lifetime is used when none is given', () => {
  const merged = mergeRefreshedToken(STALE, { access_token: 'a' }, 'TikTok', 86400);
  assert.ok(merged.expiresAt > Date.now() + 86_000_000, 'TikTok tokens last a day, not an hour');
});

test('the error names the provider and says what to do', () => {
  assert.throws(() => mergeRefreshedToken(STALE, {}, 'TikTok', 86400), /TikTok/);
  assert.throws(() => mergeRefreshedToken(STALE, {}, 'TikTok', 86400), /Reconnect/);
});
