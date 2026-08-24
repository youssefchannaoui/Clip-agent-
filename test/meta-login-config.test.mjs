import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Facebook Login for Business names its permissions in a saved configuration
// rather than a scope list. This file pins the config_id branch; the scope
// fallback is covered by social.test.mjs, which sets no META_LOGIN_CONFIG_ID.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-meta-config-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_TOKEN_KEY = 'social-test-key-that-is-definitely-long-enough';
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.META_APP_ID = 'meta-app';
process.env.META_APP_SECRET = 'meta-secret';
process.env.META_DIALOG_BASE = 'https://facebook.test';
process.env.META_LOGIN_CONFIG_ID = '1086882974287802';

const social = await import('../src/social.js');
const USER = 'user_meta_config';

test('a configured Login for Business app sends config_id and not scope', () => {
  const url = new URL(social.oauthStartUrl('meta', USER));
  assert.equal(url.searchParams.get('config_id'), '1086882974287802');

  // Sending both is what the docs warn against, and the reason the permissions
  // live in one place: the configuration is then the only thing to keep in step.
  assert.equal(url.searchParams.get('scope'), null);

  // The half that was actually missing when Facebook blamed App Domains.
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.test/auth/meta/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.ok(url.searchParams.get('state'));
});

test('the dialog is still the versioned oauth endpoint', () => {
  const url = new URL(social.oauthStartUrl('meta', USER));
  assert.equal(url.origin, 'https://facebook.test');
  assert.match(url.pathname, /^\/v\d+\.\d+\/dialog\/oauth$/);
});
