import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * INSTAGRAM LOGIN -- the second road into Instagram, and the one most people
 * can actually use.
 *
 * Youssef, 8 Sept 2026: "whenever I log in to Instagram, it gives me Meta, and
 * some people don't have Meta connected with Facebook ... make it a bit easier
 * so people can log in with either one."
 *
 * He is describing a real requirement of the path this app has always used:
 * Facebook Login plus `instagram_content_publish` reaches an Instagram account
 * ONLY through a Facebook Page it is linked to, so a creator with a
 * professional Instagram and no Page cannot connect however many times they
 * try. Meta's "Instagram API with Instagram Login" authorises the account
 * directly and publishes through graph.instagram.com with no Page in the
 * chain.
 *
 * WHAT THIS FILE CANNOT DO, said plainly: no token has ever been exchanged
 * with Instagram from this codebase. The endpoints and scopes below are
 * asserted against Meta's own documentation, and the first real connect is the
 * proof. What IS tested is everything that would be wrong on OUR side --
 * mixing the two roads' hosts, ids or tokens, which is how a Reel goes to the
 * wrong account or half-publishes.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SOCIAL = read('src/social.js');
const code = strip(SOCIAL);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-iglogin-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'k'.repeat(48);
process.env.PUBLIC_BASE_URL = 'https://example.test';
process.env.INSTAGRAM_CLIENT_ID = 'ig-app-id';
process.env.INSTAGRAM_CLIENT_SECRET = 'ig-app-secret';
const { state } = await import('../src/store.js');
const social = await import('../src/social.js');

// ── the flow, against Meta's documented endpoints ──────────────────────────

test('the authorization dialog is Instagram’s own, with the publishing scope', () => {
  // THREE HOSTS IN THIS FLOW AND THEY ARE NOT INTERCHANGEABLE: the dialog is
  // on www.instagram.com, the code exchange on api.instagram.com, everything
  // afterwards on graph.instagram.com. Sending the dialog to graph, or to
  // facebook.com, is an opaque redirect failure.
  const url = new URL(social.oauthStartUrl('instagram', 'u1'));
  assert.equal(url.origin + url.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'ig-app-id');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/auth/instagram/callback');
  assert.ok(url.searchParams.get('state'), 'the signed state travels');
  const scopes = String(url.searchParams.get('scope')).split(',');
  // instagram_business_basic is REQUIRED alongside the publishing scope;
  // asking for the publish one alone is refused.
  assert.ok(scopes.includes('instagram_business_basic'));
  assert.ok(scopes.includes('instagram_business_content_publish'));
  // The deprecated bare names are refused by Meta, so they must not appear.
  for (const dead of ['business_basic', 'business_content_publish']) {
    assert.ok(!scopes.includes(dead), `${dead} was deprecated and is refused`);
  }
  // Nothing about comments or messages: this app reads neither, and a
  // permission asked for and unused is one more thing app review asks about.
  for (const extra of scopes) assert.match(extra, /^instagram_business_(basic|content_publish)$/);
});

test('the token exchange is a form POST to api.instagram.com', () => {
  // Meta's own exchange takes its parameters in the QUERY STRING; Instagram's
  // is a form POST, and sending it as a query string returns an opaque refusal
  // rather than a useful error.
  const fn = code.slice(code.indexOf('async function connectInstagram('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /instagramApiBase\}\/oauth\/access_token/);
  assert.match(body, /method: 'POST'/);
  assert.match(body, /grant_type: 'authorization_code'/);
  // Then the long-lived exchange and the identity read, both on graph.
  assert.match(body, /instagramGraphBase\}\/access_token\?/);
  assert.match(body, /grant_type: 'ig_exchange_token'/);
  assert.match(body, /instagramGraphBase\}\/me\?fields=/);
});

test('the account id stored is the one the publish endpoints take', () => {
  // `user_id` is the Instagram-scoped id. `id` on the same object is the
  // APP-scoped id and is NOT interchangeable -- posting with it is rejected.
  const fn = code.slice(code.indexOf('async function connectInstagram('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /me\?.*user_id/, 'user_id is asked for');
  assert.match(body, /me\?\.user_id \|\| me\?\.id/, 'and preferred over the app-scoped id');
  // With neither there is nothing to post to, and storing a connection that
  // cannot publish is worse than refusing.
  assert.match(body, /did not say which account was connected/);
});

test('the token is stored in the house shape, so needsReconnect can see it', () => {
  // `token`, not `tokens`; `expiresAt`, not `expires_at`. A private spelling
  // would make this the one connection the "needs reconnecting" flag could
  // never report on.
  const fn = code.slice(code.indexOf('async function connectInstagram('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /token: encrypt\(\{/);
  assert.match(body, /expiresAt:/);
  assert.ok(!/tokens: encrypt/.test(body));
  assert.match(strip(SOCIAL.slice(SOCIAL.indexOf('function needsReconnect'))).slice(0, 400), /token\?\.refresh_token/);
});

// ── the two roads must never be mixed ──────────────────────────────────────

test('the host, the id and the token are answered ONCE, together', () => {
  /*
   * The Content Publishing calls are the same two on either road; what differs
   * is the host, the id and the token:
   *
   *   through a Page   graph.facebook.com   Page's IG id   PAGE token
   *   direct           graph.instagram.com  IG user id     USER token
   *
   * Mixing them is refused, and a container created on one host cannot be
   * published on the other -- a half-published Reel is the worst outcome here.
   */
  assert.match(code, /async function instagramTarget\(/);
  for (const fname of ['startInstagram', 'pollInstagram']) {
    const fn = code.slice(code.indexOf(`async function ${fname}(`));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /await instagramTarget\(target\.accountId, userId\)/,
      `${fname} resolves through the one function`);
    assert.ok(!/config\.metaGraphBase/.test(body),
      `${fname} must not hardcode the Facebook graph host`);
    assert.ok(!/account\.instagramId/.test(body),
      `${fname} must not reach for the Page-derived id`);
  }
});

test('a directly connected account is preferred over the same one via a Page', () => {
  /*
   * An account reachable both ways posts with the Instagram Login token, which
   * is the one that survives the Page being unshared. Resolving to the Page's
   * copy while the direct connection exists is how a working connection
   * quietly starts using a token that may not be.
   *
   * Asserted on EXECUTED OUTPUT, not on the source: the first cut sliced from
   * `if (provider === 'instagram') {` and found that string in
   * connectedAccountIds rather than in selectedAccount -- a boundary that is
   * not a boundary, for the third time in this session.
   */
  const userId = 'u_pref';
  state.authUsers = [{ id: userId, email: 'p@example.com', role: 'creator' }];
  state.socialConnections = { [userId]: {
    instagram: [{ provider: 'instagram', accountId: 'ig1', name: '@direct', viaInstagramLogin: true, token: 'x' }],
    meta: { provider: 'meta', accounts: [{ pageId: 'p1', pageName: 'Page', instagramId: 'ig1', instagramName: 'viaPage' }] },
  } };
  state.userSettings = { [userId]: { publishingSettings: {
    enabled: true,
    instagram: { enabled: true, accountId: 'ig1', accountIds: ['ig1'] },
    youtube: { enabled: false }, tiktok: { enabled: false }, facebook: { enabled: false },
  } } };
  state.projects = [{ id: 'pp', userId }];
  const clip = { id: 'cc', userId, projectId: 'pp', title: 'One', addedAt: 1, targets: [], approvedBy: 'manual' };
  state.clips = [clip];
  const targets = social.enabledTargetsForClip(clip).filter(t => t.provider === 'instagram');
  assert.equal(targets.length, 1, 'one account, not one per road');
  assert.equal(targets[0].accountName, '@direct', 'the direct connection wins');
});

test('every Instagram account is listed once, however it was connected', () => {
  const userId = 'u_ig';
  state.authUsers = [{ id: userId, email: 'i@example.com', role: 'creator' }];
  state.socialConnections = { [userId]: {
    instagram: [{ provider: 'instagram', accountId: 'ig1', name: '@deen', viaInstagramLogin: true, token: 'x' }],
    meta: {
      provider: 'meta',
      accounts: [
        // The SAME account, reachable through a Page as well.
        { pageId: 'p1', pageName: 'Page', instagramId: 'ig1', instagramName: 'deen' },
        { pageId: 'p2', pageName: 'Other', instagramId: 'ig2', instagramName: 'other' },
      ],
    },
  } };
  const status = social.connectionStatus({ id: userId });
  const ids = status.providers.instagram.accounts.map(a => a.id);
  // Listed twice would also be POSTED to twice.
  assert.deepEqual(ids, ['ig1', 'ig2']);
  assert.equal(status.providers.instagram.accounts[0].viaInstagramLogin, true,
    'and the direct one is the copy that survives');
});

test('the row says both roads are available, so the button can name one', () => {
  const status = social.connectionStatus({ id: 'u_ig' }).providers.instagram;
  assert.equal(status.instagramLogin, true, 'the direct login is configured here');
  assert.equal(status.configured, true);
  // Facebook is untouched by any of this: it is the Meta login and nothing else.
  assert.ok(!('instagramLogin' in social.connectionStatus({ id: 'u_ig' }).providers.facebook));
});

test('disconnecting one road leaves the other alone', () => {
  // The two credentials are independent. Unlinking Facebook must not unlink an
  // Instagram connected directly, and the reverse.
  const fn = code.slice(code.indexOf('export async function disconnect('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /\['youtube', 'meta', 'tiktok', 'instagram'\]/, 'instagram is a provider you can disconnect');
  assert.match(body, /provider === 'meta' \? \['instagram', 'facebook'\] : \[provider\]/,
    'only meta unlinks both');
});

// ── inert without keys ─────────────────────────────────────────────────────

test('with no Instagram app the row behaves exactly as it did', async () => {
  // The same shape as Turnstile and Stripe: an unconfigured deployment loses
  // nothing and still connects Instagram through Meta.
  const src = read('src/config.js');
  assert.match(src, /instagramClientId: String\(process\.env\.INSTAGRAM_CLIENT_ID \|\| ''\)\.trim\(\)/);
  assert.match(src, /instagramClientSecret: String\(process\.env\.INSTAGRAM_CLIENT_SECRET \|\| ''\)\.trim\(\)/);
  // Trimmed, like Stripe's and Turnstile's: a credential pasted into Render's
  // field picks up a trailing newline routinely and nothing about the failure
  // says so.
  assert.match(code, /instagramConfigured\(\)/, 'the row asks whether EITHER road works');
  assert.match(code, /providerConfigured\('instagram'\) \|\| providerConfigured\('meta'\)/);
});

test('the callback and the connect routes accept instagram', () => {
  const server = read('src/server.js');
  assert.match(server, /\/auth\\\/\(youtube\|meta\|tiktok\|instagram\)\\\/callback/);
  assert.match(server, /api\\\/social\\\/\(youtube\|meta\|tiktok\|instagram\)\\\/connect/);
  assert.match(server, /api\\\/social\\\/\(youtube\|meta\|tiktok\|instagram\)\\\/disconnect/);
});

test('a second Instagram is allowed exactly as far as the allowance goes', () => {
  // addConnection accumulates up to `max` and refuses past it. Passing a
  // literal here would cap Instagram at one for the operator while YouTube and
  // TikTok took three -- one platform quietly behaving differently from the
  // rest, which is the shape nobody notices until they try it.
  const fn = code.slice(code.indexOf('async function connectInstagram('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /max: billing\.accountsPerPlatform\(userById\(userId\), 'instagram'\)/);
  assert.ok(!/max: \d/.test(body), 'never a literal');
});

test('the button names the login it opens', () => {
  // The whole of the complaint: a button reading "Connect" that opens Facebook
  // is what makes somebody with no Facebook think the product is broken.
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /connectWith:/);
  assert.match(adapter, /oauthFor\(key, status\) === 'meta' \? 'Facebook'/);
  // PLATFORM_NAMES, not PLATFORM_TITLES: the titles are the SURFACE a clip
  // lands on, and "Connect with YouTube Shorts" is not a login.
  assert.match(adapter, /connectWith:[\s\S]{0,120}PLATFORM_NAMES\[key\]/);
  assert.ok(!/connectWith:[\s\S]{0,120}PLATFORM_TITLES/.test(adapter));
  const host = read('src/public/index.html');
  assert.match(host, /Connect with \$\{esc\(r\.connectWith/);
  assert.match(host, /no Facebook Page needed/);
});
