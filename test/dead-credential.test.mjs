import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// A dead credential is recorded where it is discovered (v3.144.5).
//
// MEASURED ON THE LIVE ACCOUNT, 7 Sept 2026: 24 TikTok targets had failed, 22
// of them "Refresh token is invalid or expired". `lastTestError` — the one
// field `needsReconnect` reads for TikTok and Meta — was set ONLY by
// testConnection, and `needsReconnect(c)` asks for an expired token with NO
// refresh token, which was false here because the refresh token existed and
// was simply rejected. So the flag was up only because somebody had pressed
// Test; without that, the app would have gone on scheduling into a channel it
// already knew was dead, one red row at a time.

const social = fs.readFileSync(new URL('../src/social.js', import.meta.url), 'utf8');

function fn(name) {
  const at = social.indexOf(`async function ${name}(`);
  assert.ok(at > -1, `${name} exists`);
  return social.slice(at, social.indexOf('\n}', at));
}

test('a rejected refresh marks the connection, on both providers that refresh', () => {
  for (const [name, provider] of [['youtubeToken', 'youtube'], ['tiktokToken', 'tiktok']]) {
    const body = fn(name);
    assert.match(body, /catch \(error\)/, `${name} catches a failed refresh`);
    assert.match(body, new RegExp(`markCredentialDead\\(userId, '${provider}'`),
      `${name} records it against the connection`);
  }
});

test('a rejected refresh is never retried', () => {
  // No number of attempts turns a rejected refresh token into a live one —
  // the same reasoning the decrypt failure already carries. Retrying it burns
  // five attempts per clip against a credential that cannot come back.
  for (const name of ['youtubeToken', 'tiktokToken']) {
    assert.match(fn(name), /retryable: false/, `${name} refuses finally`);
  }
});

test('the refusal tells the person what to do', () => {
  for (const name of ['youtubeToken', 'tiktokToken']) {
    assert.match(fn(name), /Reconnect the (channel|account) in Connections/,
      `${name} names the screen`);
  }
});

test('recording it can never fail the publish that is already failing', () => {
  const at = social.indexOf('function markCredentialDead(');
  const body = social.slice(at, social.indexOf('\n}', at));
  assert.match(body, /try \{/);
  assert.match(body, /catch \{/, 'bookkeeping is swallowed');
  assert.match(body, /lastTestError/, 'it sets the field needsReconnect reads');
});

test('needsReconnect still reads that field for the providers that matter', () => {
  // The flag has to be READ from it, or recording it changes nothing on screen.
  for (const provider of ['tiktok', 'instagram', 'facebook', 'youtube']) {
    const at = social.indexOf(`${provider}: { configured:`);
    assert.ok(at > -1, `${provider} has a status row`);
    const row = social.slice(at, social.indexOf('\n', at));
    assert.match(row, /needsReconnect:.*lastTestError/,
      `${provider}'s needsReconnect reads lastTestError`);
  }
});
