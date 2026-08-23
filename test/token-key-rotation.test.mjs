import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Rotating SOCIAL_TOKEN_KEY is a documented, deliberate step: it makes every
// stored OAuth token undecryptable and forces every account to reconnect.
// What it must NOT do is look like a crash. The raw GCM failure reads as
// "unable to authenticate data", which reaches the operator through a publish
// or a connection test and tells them nothing they can act on.

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-rotate-'));
process.env.SOCIAL_TOKEN_KEY = 'the-original-key-long-enough-to-be-accepted';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const social = await import('../src/social.js');
const { state, save } = await import('../src/store.js');
const { config } = await import('../src/config.js');

test('after the key is rotated, a stale token asks for a reconnect', async () => {
  // Connect an account under the old key.
  state.socialConnections = {};
  const secretBox = await import('../src/secret-box.js');
  const sealed = secretBox.seal({ access_token: 'ya29.original' });
  state.socialConnections['user-1'] = {
    youtube: { token: sealed, accountId: 'chan-1', name: 'A channel' },
  };
  save();

  // The operator rotates the key, exactly as the runbook says to.
  config.socialTokenKey = 'a-completely-different-key-also-long-enough';

  await assert.rejects(
    () => social.testConnection('youtube', 'chan-1', { id: 'user-1' }),
    error => {
      assert.match(error.message, /reconnect/i,
        'the message must tell the person what to do about it');
      assert.doesNotMatch(error.message, /authenticate data|unsupported state/i,
        'never the raw crypto failure');
      assert.equal(error.retryable, false,
        'no number of retries turns the old key into the new one');
      return true;
    });
});

test('the dashboard still loads with tokens it cannot read', () => {
  // connectionStatus is on the path that renders the app for every request. If
  // rotating the key took this down, the operator would have no way back in to
  // reconnect anything.
  config.socialTokenKey = 'a-completely-different-key-also-long-enough';
  const status = social.connectionStatus({ id: 'user-1' });
  assert.ok(status, 'the account page still renders');
});
