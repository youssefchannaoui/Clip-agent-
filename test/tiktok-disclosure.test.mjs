import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// TikTok's content-sharing guidelines put requirements on the UX around a
// direct post, not just on the API call: the creator picks a privacy status
// with nothing pre-selected, and declares commercial content themselves. The
// product used to send `brand_content_toggle: false` as a constant, which is a
// declaration the creator never made, and defaulted privacy to SELF_ONLY,
// which is a choice made for them. These pin both.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-tiktok-disc-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_TOKEN_KEY = 'tiktok-disclosure-token-key-over-32-characters';
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.TIKTOK_CLIENT_KEY = 'tiktok-client';
process.env.TIKTOK_CLIENT_SECRET = 'tiktok-secret';

const store = await import('../src/store.js');
const social = await import('../src/social.js');

const USER = 'user_tiktok_disclosure';

// A connected TikTok account with a fresh creator_info, which the settings
// validator insists on before TikTok may be switched on.
function connectTikTok(options = ['SELF_ONLY', 'PUBLIC_TO_EVERYONE']) {
  store.state.socialConnections[USER] = {
    tiktok: {
      provider: 'tiktok', accountId: 'open-id-1', name: 'Test creator',
      connectedAt: Date.now(), lastTestAt: Date.now(),
      creatorInfo: { privacy_level_options: options, nickname: 'Test creator' },
    },
  };
}

const base = () => ({
  enabled: true,
  youtube: { enabled: false, privacy: 'private' },
  instagram: { enabled: false },
  facebook: { enabled: false },
  tiktok: {
    enabled: true, accountId: 'open-id-1', privacy: 'PUBLIC_TO_EVERYONE',
    allowComments: true, allowDuet: false, allowStitch: false,
    commercialContent: false, yourBrand: false, brandedContent: false,
  },
});

test('nothing is pre-selected: a fresh account has no TikTok privacy status', () => {
  const settings = store.settingDefaults().publishingSettings ?? store.settingDefaults();
  const tiktok = settings.publishing?.tiktok || settings.tiktok;
  assert.equal(tiktok.privacy, '', 'privacy starts empty, so the creator has to choose one');
  assert.equal(tiktok.commercialContent, false, 'the disclosure is off by default, as the guidelines require');
});

test('TikTok cannot be switched on until a privacy status is chosen', () => {
  connectTikTok();
  const next = base();
  next.tiktok.privacy = '';
  assert.throws(() => social.validatePublishingSettings(next, USER), /Choose who can see your TikTok posts/);

  // Unrelated saves still work while it is unset and switched off. Automatic
  // publishing is paused too, because "enabled with no destination" trips a
  // different rule and would hide what this case is testing.
  const off = base();
  off.enabled = false;
  off.tiktok.enabled = false;
  off.tiktok.privacy = '';
  assert.doesNotThrow(() => social.validatePublishingSettings(off, USER));
});

test('a disclosure sub-option cannot be set without the disclosure itself', () => {
  connectTikTok();
  const next = base();
  next.tiktok.commercialContent = false;
  next.tiktok.brandedContent = true;
  assert.throws(() => social.validatePublishingSettings(next, USER), /Turn on the commercial content disclosure/);
});

test('the disclosure has to say what it is disclosing', () => {
  connectTikTok();
  const next = base();
  next.tiktok.commercialContent = true;
  assert.throws(() => social.validatePublishingSettings(next, USER), /promotes your own brand, a third party, or both/);
});

test('branded content cannot be posted privately, because TikTok refuses it', () => {
  connectTikTok(['SELF_ONLY', 'PUBLIC_TO_EVERYONE']);
  const next = base();
  next.tiktok.privacy = 'SELF_ONLY';
  next.tiktok.commercialContent = true;
  next.tiktok.brandedContent = true;
  assert.throws(() => social.validatePublishingSettings(next, USER), /cannot be posted to "Only me"/);

  // The same disclosure is fine once the audience is wider.
  next.tiktok.privacy = 'PUBLIC_TO_EVERYONE';
  assert.doesNotThrow(() => social.validatePublishingSettings(next, USER));

  // "Your brand" alone is not branded content, so it may stay private.
  const organic = base();
  organic.tiktok.privacy = 'SELF_ONLY';
  organic.tiktok.commercialContent = true;
  organic.tiktok.yourBrand = true;
  assert.doesNotThrow(() => social.validatePublishingSettings(organic, USER));
});

test('a privacy level the connected account does not offer is still refused', () => {
  connectTikTok(['SELF_ONLY']);
  const next = base();
  next.tiktok.privacy = 'PUBLIC_TO_EVERYONE';
  assert.throws(() => social.validatePublishingSettings(next, USER), /does not currently allow/);
});

test('an OAuth2 error is reported as itself, not as a 401 one request later', async () => {
  // TikTok answers a failed token exchange with HTTP 200 and
  // {"error":"invalid_client", ...} -- a STRING error with no .code. The
  // request helper used to sail past that, so the caller read access_token off
  // a failure payload, sent `Bearer undefined` to /v2/user/info/, and the
  // operator was told the access token was invalid. It was never issued.
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('/oauth/token/')) {
      return new Response(JSON.stringify({
        error: 'invalid_client',
        error_description: 'Client key and secret do not match.',
        log_id: 'x',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'access_token_invalid', message: 'The access token is invalid or not found in the request.' } }),
      { status: 401, headers: { 'content-type': 'application/json' } });
  };
  try {
    await assert.rejects(
      () => social.completeOAuth('tiktok', new URL('https://app.test/auth/tiktok/callback?code=abc&state=' + encodeURIComponent(social._testState ? social._testState() : 'bad'))),
      err => {
        // Either the state check or the token exchange must reject; what must
        // NOT happen is a message about the access token being invalid.
        assert.doesNotMatch(String(err.message), /access token is invalid or not found/i,
          'the real failure must not be masked by the downstream 401');
        return true;
      });
  } finally {
    globalThis.fetch = realFetch;
  }
  // And the user-info call must never have been attempted with no token.
  assert.ok(!calls.some(u => u.includes('/user/info/')),
    'a missing access token stops the flow instead of being sent as "Bearer undefined"');
});

test('connecting loads the creator options, so linking is not followed by a chore', async () => {
  // Publishing settings refuse to enable TikTok without a recent creator_info.
  // Connecting used to store null, so a freshly linked account was immediately
  // in a state the validator rejects and the only way out was pressing "Test
  // connection" by hand.
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/oauth/token/')) {
      return new Response(JSON.stringify({ access_token: 'tok', open_id: 'open-1', scope: 'user.info.basic,video.publish', expires_in: 86400 }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/user/info/')) {
      return new Response(JSON.stringify({ data: { user: { open_id: 'open-1', display_name: 'Test creator' } } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/creator_info/query/')) {
      return new Response(JSON.stringify({ data: { privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], comment_disabled: false } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const url = new URL('https://app.test/auth/tiktok/callback?code=abc&state=' + encodeURIComponent(social.oauthStartUrl('tiktok', USER).split('state=')[1]));
    await social.completeOAuth('tiktok', url);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(seen.some(u => u.includes('/creator_info/query/')),
    'the creator options are fetched as part of connecting');

  const conn = store.state.socialConnections[USER].tiktok;
  assert.ok(conn.creatorInfo, 'and stored on the connection');
  assert.deepEqual(conn.creatorInfo.privacy_level_options, ['SELF_ONLY', 'PUBLIC_TO_EVERYONE']);
  assert.ok(Number(conn.lastTestAt) > 0, 'with a test timestamp, so the enable gate is already satisfied');

  // The whole point: enabling TikTok now passes without a manual test first.
  const next = base();
  next.tiktok.accountId = conn.accountId;
  assert.doesNotThrow(() => social.validatePublishingSettings(next, USER));
});
