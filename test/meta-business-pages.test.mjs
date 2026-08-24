import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// A Page owned by a business portfolio is missing from /me/accounts even when
// the creator holds Full access and every permission is granted. These pin the
// fallback that finds it anyway.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-meta-pages-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_TOKEN_KEY = 'social-test-key-that-is-definitely-long-enough';
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.META_APP_ID = 'meta-app';
process.env.META_APP_SECRET = 'meta-secret';
process.env.META_GRAPH_BASE = 'https://meta.test';
process.env.META_DIALOG_BASE = 'https://facebook.test';

const social = await import('../src/social.js');
const USER = 'user_meta_pages';

function json(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

const PAGE = {
  id: '811031118760993',
  name: 'DeenClipped',
  access_token: 'page-token',
  instagram_business_account: { id: '17841476792310976', username: 'eurotrimau' },
};

function install(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.includes('/oauth/access_token')) return json({ access_token: 'user-token', expires_in: 5184000 });
    const answer = handler(url, init);
    if (answer) return answer;
    throw new Error(`Unexpected fetch ${url}`);
  };
}

async function connect() {
  const start = social.oauthStartUrl('meta', USER);
  const state = new URL(start).searchParams.get('state');
  await social.completeOAuth('meta', new URL(`https://app.test/auth/meta/callback?code=c&state=${encodeURIComponent(state)}`));
}

test('a business-owned Page missing from /me/accounts is still found', async () => {
  const seen = [];
  install((url) => {
    seen.push(url);
    if (url.includes('/me/accounts')) return json({ data: [] });
    if (url.includes('/me/businesses')) return json({ data: [{ id: '1142434914404032' }] });
    if (url.includes('/owned_pages')) return json({ data: [PAGE] });
    if (url.includes('/client_pages')) return json({ data: [] });
    return null;
  });

  await connect();
  const { providers } = social.connectionStatus({ id: USER });
  assert.equal(providers.facebook.accounts[0].id, '811031118760993');
  assert.equal(providers.instagram.accounts[0].id, '17841476792310976');

  // The businesses are only consulted because /me/accounts was empty.
  assert.ok(seen.some(u => u.includes('/me/accounts')));
  assert.ok(seen.some(u => u.includes('/me/businesses')));
});

test('a Page in both owned_pages and client_pages is not duplicated', async () => {
  install((url) => {
    if (url.includes('/me/accounts')) return json({ data: [] });
    if (url.includes('/me/businesses')) return json({ data: [{ id: 'b1' }, { id: 'b2' }] });
    if (url.includes('/owned_pages') || url.includes('/client_pages')) return json({ data: [PAGE] });
    return null;
  });

  await connect();
  const { providers } = social.connectionStatus({ id: USER });
  assert.equal(providers.facebook.accounts.length, 1);
});

test('the business lookup is skipped entirely when /me/accounts answers', async () => {
  const seen = [];
  install((url) => {
    seen.push(url);
    if (url.includes('/me/accounts')) return json({ data: [PAGE] });
    return null;
  });

  await connect();
  assert.ok(!seen.some(u => u.includes('/me/businesses')), 'must not spend calls when the plain edge works');
});

test('a refused business lookup reports no Pages rather than throwing', async () => {
  install((url) => {
    if (url.includes('/me/accounts')) return json({ data: [] });
    if (url.includes('/me/businesses')) return json({ error: { message: '(#100) Missing Permission', type: 'OAuthException', code: 100 } });
    return null;
  });

  await assert.rejects(connect(), /no Page was shared/);
});
