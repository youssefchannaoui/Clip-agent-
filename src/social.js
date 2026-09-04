import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { state, save, log, publishingSettings, setPublishingSettings, ownerOfRecord } from './store.js';
import { connectionFor, connectionListFor, connectionByAccount, addConnection, setConnection, removeConnection, ownerOf } from './tenancy.js';
import * as billing from './billing.js';
import { codeFor as referralCodeForUser } from './referrals.js';

const referralCodeFor = user => referralCodeForUser(state, user);

const PROVIDERS = ['youtube', 'instagram', 'facebook', 'tiktok'];
const META_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management';
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class SocialError extends Error {
  constructor(message, { retryable = false, status = 0, provider = '' } = {}) {
    super(message);
    this.name = 'SocialError';
    this.retryable = retryable;
    this.status = status;
    this.provider = provider;
  }
}

function requireTokenKey() {
  if (!config.socialTokenKey || config.socialTokenKey.length < 32) {
    throw new SocialError('Set SOCIAL_TOKEN_KEY to a random secret of at least 32 characters before connecting social accounts.');
  }
  return crypto.createHash('sha256').update(config.socialTokenKey).digest();
}

function encrypt(value) {
  const key = requireTokenKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decrypt(payload) {
  if (!payload) return null;
  const [version, ivText, tagText, dataText] = String(payload).split('.');
  if (version !== 'v1' || !ivText || !tagText || !dataText) throw new SocialError('Stored social credentials could not be read. Reconnect the account.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', requireTokenKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8'));
  } catch (error) {
    // Almost always SOCIAL_TOKEN_KEY having been rotated: the tokens were
    // sealed with the old one and cannot be opened with the new one. Rotating
    // that key is a documented, deliberate act that forces every account to
    // reconnect, so say that -- raw GCM failures read as a crash, and every
    // caller here is either a publish or a connection test, where "unable to
    // authenticate data" tells the person nothing they can act on.
    // Not retryable: no number of attempts turns the old key into the new one.
    throw new SocialError('Stored social credentials could not be read -- this account needs to be reconnected.', { retryable: false });
  }
}

function baseUrl() {
  if (!config.publicBaseUrl) throw new SocialError('PUBLIC_BASE_URL or RENDER_EXTERNAL_URL is required for OAuth callbacks and Instagram publishing.');
  return config.publicBaseUrl;
}
function redirectUri(provider) {
  const explicit = {
    youtube: config.googleRedirectUri,
    meta: config.metaRedirectUri,
    tiktok: config.tiktokRedirectUri,
  }[provider];
  return explicit || `${baseUrl()}/auth/${provider}/callback`;
}
function providerConfigured(provider) {
  if (!config.socialTokenKey || config.socialTokenKey.length < 32 || !config.publicBaseUrl) return false;
  if (provider === 'youtube') return Boolean(config.googleClientId && config.googleClientSecret);
  if (provider === 'meta') return Boolean(config.metaAppId && config.metaAppSecret);
  if (provider === 'tiktok') return Boolean(config.tiktokClientKey && config.tiktokClientSecret);
  return false;
}

function pruneOauthStates() {
  const now = Date.now();
  state.oauthStates ||= {};
  for (const [nonce, item] of Object.entries(state.oauthStates)) {
    if (!item || Number(item.exp || 0) < now) delete state.oauthStates[nonce];
  }
}
/**
 * The signed OAuth state carries the account that began the connection.
 *
 * This matters more than it looks. The callback arrives as a fresh browser
 * request minutes later, and reading "whoever is signed in now" would attach
 * the channel to the wrong account if the session changed, expired, or the
 * link were finished in a different browser. The account is decided when the
 * flow starts, signed, and read back on return.
 */
function signState(provider, userId) {
  if (!userId) throw new SocialError('Sign in before connecting a social account.');
  pruneOauthStates();
  const nonce = crypto.randomBytes(18).toString('base64url');
  const exp = Date.now() + 10 * 60_000;
  state.oauthStates[nonce] = { provider, exp, userId };
  save();
  const payload = Buffer.from(JSON.stringify({ provider, nonce, exp, userId })).toString('base64url');
  const signature = crypto.createHmac('sha256', requireTokenKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifyState(stateText, provider) {
  const [payload, signature] = String(stateText || '').split('.');
  if (!payload || !signature) throw new SocialError('The OAuth state was missing or invalid. Start the connection again.');
  const expected = crypto.createHmac('sha256', requireTokenKey()).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new SocialError('The OAuth state did not match. Start the connection again.');
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { throw new SocialError('The OAuth state could not be decoded. Start the connection again.'); }
  pruneOauthStates();
  const remembered = state.oauthStates?.[decoded.nonce];
  delete state.oauthStates?.[decoded.nonce];
  save();
  if (!remembered || remembered.provider !== provider || decoded.provider !== provider || Number(decoded.exp) < Date.now()) {
    throw new SocialError('The OAuth connection request expired or was already used. Start it again.');
  }
  // The account is taken from the server-side record, not from the signed
  // payload alone, so a replayed or hand-crafted state cannot name a different
  // account than the one that actually started the flow.
  const userId = remembered.userId || decoded.userId || '';
  if (!userId) throw new SocialError('That connection request is no longer linked to an account. Start it again.');
  if (remembered.userId && decoded.userId && remembered.userId !== decoded.userId) {
    throw new SocialError('The connection request did not match the account that started it. Start it again.');
  }
  return { ...decoded, userId };
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { data, text };
}
// TikTok refuses in two parts: a machine-readable `code` that says what to do,
// and a `message` that is frequently nothing but a link to the guidelines. The
// message won the || chain below, so a refusal arrived as
//   "TikTok returned 403: Please review our integration guidelines at ..."
// -- a sentence with no fault and no fix in it. The code is what carries both,
// so it is kept, and the ones with a real answer are answered here.
const TIKTOK_GUIDANCE = {
  unaudited_client_can_only_post_to_private_accounts:
    'TikTok has not finished reviewing this app yet, and an unreviewed app may only post to a TikTok account that is set to private. '
    + 'Switch the account to private to keep posting now, or complete the app review to post from a public one.',
  privacy_level_option_mismatch:
    'The audience chosen for TikTok is not one this account currently allows. Run Test connection in Channels, then pick from the audiences it offers.',
  reached_active_user_cap:
    'TikTok limits how many people an unreviewed app may post for. Completing the app review lifts the cap.',
  spam_risk_too_many_posts: 'TikTok has capped posting on this account for today. It clears on its own — try again tomorrow.',
  spam_risk_user_banned_from_posting: 'TikTok has blocked posting on this account. Only TikTok can lift that.',
  spam_risk: 'TikTok is rate-limiting this account. Leave a longer gap between posts.',
  access_token_invalid: 'The TikTok connection has expired. Disconnect and reconnect TikTok in Channels.',
  scope_not_authorized: 'This TikTok connection was granted without the posting permission. Disconnect and reconnect it, accepting every permission asked for.',
  file_format_check_failed: 'TikTok rejected the video file format.',
  duration_check_failed: 'The clip is longer than TikTok accepts for this account.',
  frame_rate_check_failed: 'TikTok rejected the video frame rate.',
  picture_size_check_failed: 'TikTok rejected the video dimensions.',
};

// The refusal in plain English where there is one, and always the code -- an
// unmapped code is still the only searchable thing in the message.
export function platformDetail(data, provider, fallback) {
  const code = String(data?.error?.code || '').trim();
  const known = provider === 'TikTok' && code ? TIKTOK_GUIDANCE[code] : '';
  const base = known || data?.error?.message || data?.error_description || data?.message || code || fallback;
  const detail = String(base ?? '');
  return code && code !== 'ok' && !detail.includes(code) ? `${detail} [${code}]` : detail;
}

async function jsonRequest(url, options = {}, provider = '') {
  let res;
  try { res = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(120_000) }); }
  catch (error) { throw new SocialError(`${provider || 'Platform'} could not be reached: ${error.message}`, { retryable: true, provider }); }
  const { data, text } = await parseResponse(res);
  if (!res.ok) {
    const detail = platformDetail(data, provider, text || res.statusText);
    throw new SocialError(`${provider || 'Platform'} returned ${res.status}: ${String(detail).slice(0, 500)}`, {
      retryable: RETRYABLE_STATUS.has(res.status), status: res.status, provider,
    });
  }
  if (data?.error && data.error.code && data.error.code !== 'ok') {
    // TikTok also refuses with HTTP 200 and the code in the body, so this path
    // needs the same translation as the one above.
    throw new SocialError(`${provider || 'Platform'} error: ${platformDetail(data, provider, data.error.code).slice(0, 500)}`, { provider });
  }
  // OAuth2 endpoints answer 200 with {"error":"invalid_client","error_description":...},
  // where `error` is a STRING and has no .code -- so the check above sails past
  // it, the caller reads access_token off a failure payload, gets undefined, and
  // sends `Bearer undefined` to the next call. What the operator then sees is
  // "the access token is invalid or not found in the request", which is true and
  // useless: the real answer was invalid_client, one request earlier.
  if (typeof data?.error === 'string' && data.error && data.error !== 'ok') {
    throw new SocialError(`${provider || 'Platform'} error: ${data.error_description || data.error}`, { provider });
  }
  return data;
}

export function oauthStartUrl(provider, userId) {
  if (!['youtube', 'meta', 'tiktok'].includes(provider)) throw new SocialError('Unknown social provider.');
  if (!providerConfigured(provider)) throw new SocialError(`${provider} OAuth is not configured in the deployment environment.`);
  const stateText = signState(provider, userId);
  if (provider === 'youtube') {
    const query = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: redirectUri('youtube'),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      state: stateText,
    });
    return `${config.googleAuthBase}/o/oauth2/v2/auth?${query}`;
  }
  if (provider === 'meta') {
    // Facebook Login for Business names its permissions in a saved CONFIGURATION
    // and takes its id here, where classic Login took a scope list.
    //
    // This is not a preference. On a Login-for-Business app the app-level "Valid
    // OAuth Redirect URIs" field silently refuses to save -- it answers "Changes
    // saved" and is empty again on reload, three times running -- so a
    // scope-based dialog has no registered redirect_uri and Facebook rejects it
    // with "Can't load URL: the domain of this URL isn't included in the app's
    // domains". That message sends you to App Domains, which was correct all
    // along; the redirect URI was the missing half, and it cannot be supplied
    // except through a configuration.
    //
    // The scope fallback stays for an app that still has classic Login (and so
    // has no configuration to point at), which is the shape the sandbox took.
    const query = new URLSearchParams({
      client_id: config.metaAppId,
      redirect_uri: redirectUri('meta'),
      response_type: 'code',
      state: stateText,
    });
    if (config.metaLoginConfigId) query.set('config_id', config.metaLoginConfigId);
    else query.set('scope', META_SCOPES);
    return `${config.metaDialogBase}/${config.metaGraphVersion}/dialog/oauth?${query}`;
  }
  const query = new URLSearchParams({
    client_key: config.tiktokClientKey,
    redirect_uri: redirectUri('tiktok'),
    response_type: 'code',
    scope: 'user.info.basic,video.publish',
    state: stateText,
  });
  return `${config.tiktokAuthBase}/v2/auth/authorize/?${query}`;
}

/**
 * Connecting a destination switches it on.
 *
 * Linking an account and then having to find a second toggle to say "yes,
 * really" is a step that exists only because the two things were built
 * separately. Turning it off afterwards stays a deliberate act, which is the
 * part that matters.
 *
 * Two things this deliberately does NOT do:
 *
 * It never touches the master automatic-publishing switch. That one starts
 * posting on a schedule, and connecting an account is not consent to that.
 *
 * And it cannot switch TikTok on before an audience is chosen -- not a
 * preference, a rule: TikTok's guidelines forbid a default privacy status, and
 * an enabled destination with no audience would queue posts that fail at the
 * API. So it is marked instead, and the settings route switches it on the
 * moment an audience is saved.
 */
/**
 * Connecting a channel is asking to publish to it.
 *
 * There are TWO switches: each platform's own, and the account's master
 * automatic-publishing switch -- and the master DEFAULTS TO FALSE. This
 * function only ever set the platform one, so out of the box a customer could
 * connect TikTok, see "successfully linked", pick an audience, watch the dot
 * go green, and never have a single clip post: setTargets gives a clip no
 * destinations at all while the master is off, so clips scheduled "for local
 * export" and Post now published to nowhere.
 *
 * Youssef, 3 Sept 2026: "as soon as I have my thing connected ... it should
 * work normally ... I shouldn't be doing extra steps."
 *
 * So enabling a destination enables publishing. This runs on the CONNECT path
 * only, where there is no form and no competing choice being expressed -- a
 * save that deliberately sends `enabled: false` is still honoured, and the
 * switch is still there to turn off. Nothing posts unapproved either way.
 */
function enableOnConnect(userId, keys) {
  const current = publishingSettings(userId);
  const next = { ...current };
  let changed = false;
  for (const key of keys) {
    const setting = { ...(next[key] || {}) };
    if (setting.enabled) continue;
    if (key === 'tiktok' && !String(setting.privacy || '')) {
      if (setting.enableWhenReady) continue;
      setting.enableWhenReady = true;
      next[key] = setting;
      changed = true;
      continue;
    }
    setting.enabled = true;
    setting.enableWhenReady = false;
    next[key] = setting;
    // Kept after the master switch was retired (store.publishingSettings), so
    // the record this writes says on disk what the reader reports. Cheap, and
    // it means a record written here needs no read-time correction.
    next.enabled = true;
    changed = true;
  }
  if (changed) setPublishingSettings(userId, next);
}

/**
 * The connect-time enable, reachable by test.
 *
 * Exported rather than the test reading the source, because "which switches
 * does connecting turn on" is a behaviour and the whole bug was that the
 * answer was one switch when it needed to be two. The real OAuth path cannot
 * be driven without a live TikTok.
 */
export const enableOnConnectForTests = enableOnConnect;

async function connectYouTube(code, userId) {
  const token = await jsonRequest(config.googleTokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: redirectUri('youtube'), grant_type: 'authorization_code' }),
  }, 'YouTube');
  if (!token.refresh_token) throw new SocialError('Google did not return a refresh token. Remove the app from your Google account permissions, then reconnect and approve access.');
  const profile = await jsonRequest(`${config.youtubeApiBase}/youtube/v3/channels?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  }, 'YouTube');
  const channel = profile?.items?.[0];
  if (!channel?.id) throw new SocialError('No YouTube channel was found for this Google account.');
  const connection = {
    provider: 'youtube', accountId: channel.id, name: channel.snippet?.title || 'YouTube channel',
    avatar: channel.snippet?.thumbnails?.default?.url || '', scopes: token.scope || '',
      // Dates the channel title and avatar read from the Data API, for the
      // 30-day retention sweep in youtube-retention.js (policy III.E.4).
      youtubeDataAt: Date.now(),
    token: encrypt({ ...token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 }), connectedAt: Date.now(),
  };
  // Added alongside, not over the top. A straight assignment here destroyed the
  // previous channel's refresh token, which is why multi-account could not be a
  // settings flag. Reconnecting the SAME channel still replaces it in place.
  addConnection(state.socialConnections, userId, 'youtube', connection,
    { max: billing.accountsPerPlatform(userById(userId), 'youtube') });
  enableOnConnect(userId, ['youtube']);
  save(); log(`Connected YouTube channel "${connection.name}" and switched it on.`, 'info', userId);
}

const META_PAGE_FIELDS = 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}';

/**
 * Every Page the creator can publish to, which is NOT the same as
 * `/me/accounts`.
 *
 * A Page owned by a business portfolio is absent from `/me/accounts` even when
 * the creator holds Full access on it and every permission is granted -- the
 * edge answers `{"data":[]}` with no error, so it looks exactly like an account
 * that manages nothing. The Page node itself answers fine and hands back a Page
 * access token, which is what proved the access was there all along; only the
 * enumeration is missing. Relying on that one edge is what made connecting
 * Facebook impossible for an owner who plainly owned a Page.
 *
 * So: ask the businesses too. `owned_pages` is the portfolio's own Pages and
 * `client_pages` is Pages another portfolio has shared with it, and a Page can
 * legitimately appear in both, hence the dedupe.
 */
async function metaPages(userToken) {
  const get = async (path) => jsonRequest(
    `${config.metaGraphBase}/${config.metaGraphVersion}/${path}?fields=${encodeURIComponent(META_PAGE_FIELDS)}&limit=100&access_token=${encodeURIComponent(userToken)}`,
    {}, 'Meta',
  );

  const byId = new Map();
  const add = (list) => { for (const page of list || []) if (page?.id && !byId.has(String(page.id))) byId.set(String(page.id), page); };

  add((await get('me/accounts'))?.data);
  if (byId.size) return [...byId.values()];

  // Only reached when /me/accounts came back empty, so the extra calls are not
  // on the common path. business_management is what makes them possible; when
  // it was not granted this throws and the caller reports the empty result,
  // which is the honest answer rather than a silent partial list.
  let businesses = [];
  try {
    businesses = (await jsonRequest(
      `${config.metaGraphBase}/${config.metaGraphVersion}/me/businesses?limit=100&access_token=${encodeURIComponent(userToken)}`,
      {}, 'Meta',
    ))?.data || [];
  } catch (error) {
    log(`Meta business lookup was refused, so only personally owned Pages are visible. ${error.message}`, 'warn');
    return [];
  }

  for (const business of businesses) {
    if (!business?.id) continue;
    for (const edge of ['owned_pages', 'client_pages']) {
      try { add((await get(`${encodeURIComponent(business.id)}/${edge}`))?.data); }
      catch (error) { log(`Meta ${edge} lookup failed for business ${business.id}. ${error.message}`, 'warn'); }
    }
  }
  return [...byId.values()];
}

async function connectMeta(code, userId) {
  const query = new URLSearchParams({ client_id: config.metaAppId, client_secret: config.metaAppSecret, redirect_uri: redirectUri('meta'), code });
  const short = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/oauth/access_token?${query}`, {}, 'Meta');
  let userToken = short.access_token;
  try {
    const longQuery = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: config.metaAppId, client_secret: config.metaAppSecret, fb_exchange_token: userToken });
    const long = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/oauth/access_token?${longQuery}`, {}, 'Meta');
    userToken = long.access_token || userToken;
  } catch (error) {
    log(`Meta long-lived token exchange was not available; using the returned token. ${error.message}`, 'warn');
  }
  const pageList = await metaPages(userToken);
  const accounts = pageList.filter(page => page.id && page.access_token).map(page => ({
    pageId: String(page.id), pageName: page.name || 'Facebook Page',
    instagramId: page.instagram_business_account?.id ? String(page.instagram_business_account.id) : '',
    instagramName: page.instagram_business_account?.username || page.instagram_business_account?.name || '',
    instagramAvatar: page.instagram_business_account?.profile_picture_url || '',
    token: encrypt({ access_token: page.access_token }),
  }));
  // Empty here almost never means "you have no Page". Facebook Login for
  // Business grants the permissions and the Pages SEPARATELY: you can approve
  // every permission and still share no Page, and then /me/accounts is empty
  // while the app looks fully authorised. Say which half is missing, because
  // the obvious reading -- that the account manages no Page -- sends someone to
  // go and create a second one.
  if (!accounts.length) throw new SocialError('Facebook connected, but no Page was shared with DeenClipped. Reconnect, and on the "What do you want to allow?" step pick your Page (and its Instagram account) before continuing -- approving the permissions alone does not share the Page. Instagram publishing also needs a professional Instagram account linked to that Page.', { provider: 'meta' });
  setConnection(state.socialConnections, userId, 'meta', { provider: 'meta', accounts, connectedAt: Date.now() });
  enableOnConnect(userId, ['instagram', 'facebook']);
  save(); log(`Connected ${accounts.length} Meta Page${accounts.length === 1 ? '' : 's'} for Facebook/Instagram publishing, and switched them on.`, 'info', userId);
}

/**
 * What the configured TikTok credentials LOOK like -- never what they are.
 *
 * The same device as billing's webhookSecretNote(), and for the same reason: a
 * pair TikTok rejects produces "Client key or secret is incorrect" and nothing
 * else, which is unactionable. Three different mistakes make that one message
 * -- the production key where the sandbox one belongs, only one of the two
 * updated, or a value pasted with whitespace -- and none can be told from
 * another without knowing the shape of what was sent.
 *
 * The client KEY is safe to name in full: it travels in the OAuth URL, so it
 * is already on screen in the address bar every time anyone presses Connect.
 * The SECRET is never described beyond its length.
 *
 * TikTok issues SANDBOX keys with an `sbaw` prefix and production keys with
 * `aw`. That is a convention rather than a documented guarantee, so this
 * REPORTS the prefix and never refuses on it.
 */
export function tiktokCredentialNote() {
  const rawKey = String(process.env.TIKTOK_CLIENT_KEY || '');
  const rawSecret = String(process.env.TIKTOK_CLIENT_SECRET || '');
  const key = rawKey.trim();
  const secret = rawSecret.trim();
  if (!key || !secret) {
    return `TIKTOK_CLIENT_KEY is ${key ? 'set' : 'NOT SET'} and TIKTOK_CLIENT_SECRET is ${secret ? 'set' : 'NOT SET'} on this deployment.`;
  }
  const notes = [`the client key in use is "${key}"`, `the secret is ${secret.length} characters`];
  if (key.startsWith('sbaw')) notes.push('the key looks like a SANDBOX key, so the secret must be the sandbox one too');
  else if (key.startsWith('aw')) notes.push('the key looks like a PRODUCTION key -- if you meant to use the sandbox, this is the wrong one');
  if (rawKey !== key || rawSecret !== secret) notes.push('one of them was pasted with stray whitespace, which this build trims');
  return `Check the pair: ${notes.join('; ')}.`;
}

async function connectTikTok(code, userId) {
  const token = await jsonRequest(`${config.tiktokApiBase}/v2/oauth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri('tiktok') }),
  }, 'TikTok').catch(error => {
    // Only when TikTok has actually blamed the credentials. Appending the note
    // to an unrelated failure -- a network blip, a used code -- would send
    // somebody to the Render dashboard for a problem that is not there.
    if (/client key or secret|invalid_client|client_key/i.test(String(error?.message || ''))) {
      throw new SocialError(`${error.message} ${tiktokCredentialNote()}`, { provider: 'tiktok' });
    }
    throw error;
  });
  // Never carry an absent token into the next call. Without this the failure
  // surfaces one request later as a 401 about the token, which sends you looking
  // at the wrong thing entirely.
  if (!token?.access_token) {
    throw new SocialError('TikTok did not return an access token. This usually means the client key and client secret belong to different apps -- check that both are the sandbox pair, or both the production pair.', { provider: 'tiktok' });
  }
  const profile = await jsonRequest(`${config.tiktokApiBase}/v2/user/info/?fields=open_id,union_id,avatar_url,display_name`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  }, 'TikTok');
  const user = profile?.data?.user || {};
  // Named `entry`, not `connection`: the module-level connection() lookup is
  // needed a few lines below, and a local of the same name shadows it.
  const entry = {
    provider: 'tiktok', accountId: token.open_id || user.open_id || '', name: user.display_name || 'TikTok account', avatar: user.avatar_url || '',
    scopes: token.scope || '', token: encrypt({ ...token, expiresAt: Date.now() + Number(token.expires_in || 86400) * 1000 }), connectedAt: Date.now(), creatorInfo: null,
  };
  addConnection(state.socialConnections, userId, 'tiktok', entry,
    { max: billing.accountsPerPlatform(userById(userId), 'tiktok') });
  save();

  /*
   * Fetch the creator's options as part of connecting, not as a chore afterwards.
   *
   * Publishing settings refuse to enable TikTok without a recent creator_info --
   * TikTok requires the current privacy and interaction options to be shown, and
   * a stale copy is worse than none. But connecting used to store creatorInfo as
   * null, so a freshly linked account landed in a state the validator rejects,
   * and the only way out was pressing "Test connection" by hand. Linking an
   * account and immediately being told to go and test it is not a step anyone
   * should have to be taught.
   *
   * Deliberately not fatal. If this call fails -- a scope the creator declined,
   * a sandbox account that is not a target user -- the connection itself is
   * still real and worth keeping, and the existing gate will ask for a manual
   * test. The reason is recorded so it is visible rather than mysterious.
   */
  try {
    await queryTikTokCreator(token.access_token, userId, entry.accountId);
    const fresh = connectionFo(userId, 'tiktok', entry.accountId);
    if (fresh) { fresh.lastTestAt = Date.now(); fresh.lastTestError = null; save(); }
    enableOnConnect(userId, ['tiktok']);
    log(`Connected TikTok account "${entry.name}" and loaded its posting options.`, 'info', userId);
  } catch (error) {
    const fresh = connectionFo(userId, 'tiktok', entry.accountId);
    if (fresh) { fresh.lastTestError = error.message; save(); }
    log(`Connected TikTok account "${entry.name}", but its posting options could not be read: ${error.message}`, 'warn', userId);
  }
}

export async function completeOAuth(provider, callbackUrl) {
  const url = callbackUrl instanceof URL ? callbackUrl : new URL(callbackUrl);
  const error = url.searchParams.get('error');
  if (error) throw new SocialError(url.searchParams.get('error_description') || `${provider} authorization was denied.`);
  const { userId } = verifyState(url.searchParams.get('state'), provider);
  const code = url.searchParams.get('code');
  if (!code) throw new SocialError('The authorization provider did not return a code.');
  /*
   * A FAILED connection has to leave a trace, and it did not.
   *
   * The callback redirects to /app?social=error&message=..., the page shows
   * that message as a toast and then wipes the URL with replaceState -- so the
   * platform's own reason flashes past once and is gone, with nothing in the
   * activity feed and nothing to scroll back to. The only surviving copy was a
   * console.error in the server log, which a customer cannot open.
   *
   * Logged HERE rather than in the route, because this is the last place the
   * userId is known: verifyState has run, and `log` with a null user is
   * filtered out of every bell by logFor. The error is re-thrown untouched, so
   * the redirect and its message are unchanged.
   */
  try {
    if (provider === 'youtube') await connectYouTube(code, userId);
    else if (provider === 'meta') await connectMeta(code, userId);
    else if (provider === 'tiktok') await connectTikTok(code, userId);
    else throw new SocialError('Unknown OAuth provider.');
  } catch (error) {
    log(`Could not connect ${provider}: ${error.message}`, 'error', userId);
    throw error;
  }
  return { userId };
}

/**
 * Disconnect one account, or the whole platform when none is named.
 *
 * Naming one matters now: with three YouTube channels linked, Disconnect on the
 * third must not take the other two with it -- and the Google grant revoked
 * must be that channel's, not whichever was stored first.
 */
export async function disconnect(provider, user, accountId = '') {
  const userId = user?.id || user;
  if (!userId) throw new SocialError('Sign in to disconnect an account.');
  const affected = provider === 'meta' ? ['instagram', 'facebook'] : [provider];
  if (!['youtube', 'meta', 'tiktok'].includes(provider)) throw new SocialError('Unknown provider.');
  // Meta is one login carrying its Pages inside it, so there is no per-account
  // credential to remove -- disconnecting it is all or nothing, and an account
  // id here would silently match nothing and remove nothing.
  if (provider === 'meta') accountId = '';

  // Remove the local credential first so a slow or unavailable provider can
  // never prevent the customer taking access away from DeenClipped. For
  // YouTube we also revoke the Google grant remotely on a best-effort basis.
  let googleCredential = '';
  if (provider === 'youtube') {
    try {
      const token = decrypt(connectionFo(userId, 'youtube', accountId)?.token);
      googleCredential = token?.refresh_token || token?.access_token || '';
    } catch (error) {
      log(`The stored YouTube grant could not be read during disconnect; the local credential will still be removed. ${error.message}`, 'warn', userId);
    }
  }
  removeConnection(state.socialConnections, userId, provider, accountId);

  // Only this account's publishing settings are touched. Disconnecting used to
  // switch off the single global publishing config for everybody.
  const settings = publishingSettings(user);
  const next = { ...settings };
  // Only drop the destination that went, and only switch the platform off when
  // nothing is left connected on it. Disconnecting one of three channels used
  // to switch YouTube off entirely for the other two.
  for (const name of affected) {
    const item = settings[name] || {};
    const left = (item.accountIds || []).filter(id => accountId ? String(id) !== String(accountId) : false);
    const stillConnected = connectionListFor(state.socialConnections, userId, provider).length > 0;
    next[name] = {
      ...item,
      accountIds: left, accountId: left[0] || '',
      enabled: Boolean(accountId && left.length && stillConnected),
    };
  }
  const anyEnabled = ['youtube', 'instagram', 'facebook', 'tiktok'].some(name => next[name]?.enabled);
  if (!anyEnabled) next.enabled = false;
  setPublishingSettings(user, next);

  save();

  if (googleCredential) {
    try {
      const response = await fetch(config.googleRevokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: googleCredential }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) log(`Google returned ${response.status} while revoking the disconnected YouTube grant. The local credential was removed.`, 'warn', userId);
    } catch (error) {
      log(`Google could not be reached while revoking the disconnected YouTube grant. The local credential was removed. ${error.message}`, 'warn', userId);
    }
  }

  log(`Disconnected ${provider}. Stored credentials were removed and new uploads to it were disabled; existing platform posts were not deleted.`, 'info', userId);
}

/** One account's connection for a provider, or null. */
/**
 * The account record, for a tier question.
 *
 * Falls back to a bare id rather than throwing: an unknown user resolves to the
 * free tier, which is one connection -- the safe answer, not a crash in the
 * middle of an OAuth callback.
 */
function userById(userId) {
  return (state.authUsers || []).find(item => item.id === userId) || { id: userId };
}

function connection(userId, provider) {
  return connectionFor(state.socialConnections, userId, provider);
}
/** Every connection on a platform -- what the summaries and the sweep need. */
function connections(userId, provider) {
  return connectionListFor(state.socialConnections, userId, provider);
}
/**
 * The connection that owns ONE account.
 *
 * Everything that publishes, refreshes a token, or reads creator options must
 * go through this. Reading "the user's YouTube" instead posts a clip aimed at
 * the second channel with the first channel's credentials, which is the exact
 * failure multi-account exists to avoid and would be invisible until someone
 * noticed the video on the wrong channel.
 */
function connectionFo(userId, provider, accountId) {
  return connectionByAccount(state.socialConnections, userId, provider, accountId);
}

function youtubeSummary(userId) {
  return connections(userId, 'youtube').flatMap(c => youtubeEntry(c));
}
function youtubeEntry(c) {
  return c ? [{ id: c.accountId, name: c.name, avatar: c.avatar || '' }] : [];
}
function metaSummaries(kind, userId) {
  return (connection(userId, 'meta')?.accounts || []).filter(item => kind === 'facebook' ? item.pageId : item.instagramId).map(item => kind === 'facebook'
    ? { id: item.pageId, name: item.pageName, avatar: '' }
    : { id: item.instagramId, name: item.instagramName || `${item.pageName} Instagram`, avatar: item.instagramAvatar || '', pageId: item.pageId });
}
function tiktokSummary(userId) {
  return connections(userId, 'tiktok').map(c => ({
    id: c.accountId, name: c.name, avatar: c.avatar || '', creatorInfo: c.creatorInfo || null,
  }));
}

export function connectionStatus(user) {
  const userId = user?.id || user || '';
  const youtube = connection(userId, 'youtube');
  const meta = connection(userId, 'meta');
  const tiktok = connection(userId, 'tiktok');
  const securityReady = Boolean(config.socialTokenKey && config.socialTokenKey.length >= 32);
  const publicBaseUrlReady = Boolean(config.publicBaseUrl);
  return {
    securityReady, publicBaseUrlReady, globalAvailable: config.socialPublishEnabled,
    issues: [
      ...(!config.socialPublishEnabled ? ['SOCIAL_PUBLISH_ENABLED is false.'] : []),
      ...(!securityReady ? ['SOCIAL_TOKEN_KEY must contain at least 32 characters.'] : []),
      ...(!publicBaseUrlReady ? ['PUBLIC_BASE_URL or RENDER_EXTERNAL_URL is missing.'] : []),
    ],
    providers: {
      youtube: { configured: providerConfigured('youtube'), connected: youtubeSummary(userId).length > 0, accounts: youtubeSummary(userId), lastTestAt: youtube?.lastTestAt || null, lastTestError: youtube?.lastTestError || null },
      instagram: { configured: providerConfigured('meta'), connected: metaSummaries('instagram', userId).length > 0, accounts: metaSummaries('instagram', userId), lastTestAt: meta?.lastTestAt || null, lastTestError: meta?.lastTestError || null },
      facebook: { configured: providerConfigured('meta'), connected: metaSummaries('facebook', userId).length > 0, accounts: metaSummaries('facebook', userId), lastTestAt: meta?.lastTestAt || null, lastTestError: meta?.lastTestError || null },
      tiktok: { configured: providerConfigured('tiktok'), connected: tiktokSummary(userId).length > 0, accounts: tiktokSummary(userId), requiresManualApproval: true, lastTestAt: tiktok?.lastTestAt || null, lastTestError: tiktok?.lastTestError || null },
    },
  };
}

/**
 * Resolve a destination account within one user's own connections.
 *
 * Scoping by user id here is what stops one customer naming another customer's
 * page id in their publishing settings and uploading to it.
 */
/**
 * Resolve one YouTube or TikTok destination.
 *
 * A blank account id used to match unconditionally, which was harmless while
 * only one connection could exist. With several stored it silently resolves to
 * whichever happens to be first -- the post-to-the-wrong-channel failure, and
 * invisible until someone notices the video on the wrong channel.
 *
 * So a blank id is honoured ONLY when there is exactly one connection, which is
 * every account written before this release and must keep publishing untouched.
 * Ambiguous means nothing, not "guess".
 */
function oneOf(provider, accountId, userId) {
  const list = connections(userId, provider);
  if (!accountId) return list.length === 1 ? list[0] : null;
  return list.find(item => String(item?.accountId || '') === String(accountId)) || null;
}

function selectedAccount(provider, accountId, userId) {
  if (!userId) return null;
  if (provider === 'youtube') return oneOf('youtube', accountId, userId);
  if (provider === 'facebook') return (connection(userId, 'meta')?.accounts || []).find(item => item.pageId === accountId) || null;
  if (provider === 'instagram') return (connection(userId, 'meta')?.accounts || []).find(item => item.instagramId === accountId) || null;
  if (provider === 'tiktok') return oneOf('tiktok', accountId, userId);
  return null;
}

export function validatePublishingSettings(next, user) {
  const userId = user?.id || user || '';
  if (!userId) throw new SocialError('Sign in to change publishing settings.');
  const settings = next || publishingSettings(user);
  return validateFor(settings, userId);
}

/**
 * The posting options for ONE TikTok account.
 *
 * TikTok's content-sharing guidelines make the audience a per-POST choice, and
 * one clip going to three TikToks is three posts. A single platform-level
 * privacy therefore carried one creator's choice onto two other accounts --
 * and each account has its own allowed options anyway, so the shared value
 * could be one the second account does not even offer.
 *
 * Per-account values win; the platform-level fields remain the fallback,
 * because every record written before this release holds its choice there and
 * must keep posting exactly as it does today.
 */
const TIKTOK_OPTION_KEYS = ['privacy', 'allowComments', 'allowDuet', 'allowStitch',
  'commercialContent', 'yourBrand', 'brandedContent'];

export function tiktokOptionsFor(tiktok = {}, accountId = '') {
  const base = {};
  for (const key of TIKTOK_OPTION_KEYS) base[key] = tiktok[key];
  const per = (tiktok.accountOptions || {})[String(accountId || '')] || {};
  for (const key of TIKTOK_OPTION_KEYS) {
    if (per[key] !== undefined) base[key] = per[key];
  }
  return base;
}

function validateFor(next, userId) {
  const status = connectionStatus(userId);
  if (next.enabled && !config.socialPublishEnabled) throw new SocialError('Automatic social publishing is disabled by SOCIAL_PUBLISH_ENABLED.');
  const enabledProviders = PROVIDERS.filter(provider => next[provider]?.enabled);
  // There used to be a refusal here when nothing was switched on: "Enable at
  // least one connected publishing destination." It guarded the master switch
  // -- turning publishing ON with nowhere to send anything is an incoherent
  // ask -- and it was only ever reachable while that switch could be false.
  //
  // Retiring the switch (store.publishingSettings) made `next.enabled` always
  // true, which turned this into a refusal of EVERY save by an account with no
  // destination on. A new account could not have saved its publishing settings
  // at all, and neither could anyone unticking their last platform. Caught by
  // the suite before it shipped; there is nothing incoherent about saving with
  // nothing switched on, and the schedule already says "No account connected".
  // Strict checks apply to what this save is asserting: a provider being
  // switched on, or one whose account is being repointed. A provider that was
  // already on and is untouched must not block the save -- Instagram and
  // Facebook both sat enabled-without-accounts, and every attempt to switch
  // one of them OFF was rejected because the validator re-tried the other.
  // The publish path skips unpostable providers itself.
  const current = publishingSettings(userId);
  for (const provider of enabledProviders) {
    const item = next[provider] || {};
    const was = current[provider] || {};
    const asserting = !was.enabled || String(item.accountId || '') !== String(was.accountId || '');
    if (!asserting) continue;
    if (!status.providers[provider].configured) throw new SocialError(`${provider} developer credentials are not configured.`);
    if (!selectedAccount(provider, item.accountId, userId)) throw new SocialError(`Choose a connected ${provider} account.`);
  }
  // YouTube uploads are public, full stop, so there is nothing here to accept
  // or refuse -- an old stored value is simply corrected on the way through.
  if (next.youtube) next.youtube.privacy = 'public';
  // Required only once TikTok is switched on. Demanding it unconditionally
  // would make every unrelated save fail, because nothing is pre-selected.
  //
  // Checked per ACCOUNT: each TikTok has its own audience choice and its own
  // allowed options, so one shared answer could be an option the second
  // account does not offer.
  if (next.tiktok?.enabled) {
    const chosen = next.tiktok.accountIds?.length
      ? next.tiktok.accountIds
      : [next.tiktok.accountId || ''];
    for (const accountId of chosen) {
      const options = tiktokOptionsFor(next.tiktok, accountId);
      const conn = connectionFo(userId, 'tiktok', accountId);
      // Named only when there is more than one, so a single-account account
      // reads exactly as it always did.
      const whose = chosen.length > 1 ? ` for ${conn?.name || accountId || 'this account'}` : '';
      const privacy = String(options.privacy || '');
      if (privacy && !['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'].includes(privacy)) {
        throw new SocialError(`Choose a valid TikTok privacy setting${whose}.`);
      }
      if (!privacy) throw new SocialError(`Choose who can see your TikTok posts${whose} before enabling it.`);
      // A sub-option without the disclosure it belongs to would send a
      // declaration the creator never made.
      if (!options.commercialContent && (options.yourBrand || options.brandedContent)) {
        throw new SocialError(`Turn on the commercial content disclosure${whose} before choosing what it promotes.`);
      }
      if (options.commercialContent && !options.yourBrand && !options.brandedContent) {
        throw new SocialError(`Say whether the content${whose} promotes your own brand, a third party, or both.`);
      }
      // TikTok refuses branded content on a private post, so the two settings
      // cannot be chosen independently.
      if (options.brandedContent && privacy === 'SELF_ONLY') {
        throw new SocialError(`Branded content cannot be posted to "Only me"${whose}. Choose a wider audience, or turn branded content off.`);
      }
      const creatorInfo = conn?.creatorInfo;
      if (!creatorInfo || Date.now() - Number(conn?.lastTestAt || 0) > 24 * 60 * 60_000) {
        throw new SocialError(`Run TikTok Test connection${whose} before enabling it. TikTok requires the latest creator privacy and interaction options to be displayed.`);
      }
      const creatorOptions = creatorInfo?.privacy_level_options;
      if (Array.isArray(creatorOptions) && creatorOptions.length && !creatorOptions.includes(privacy)) {
        throw new SocialError(`That TikTok account does not currently allow ${privacy}${whose}. Run Test connection and choose one of the available privacy options.`);
      }
    }
  } else {
    // Switched off: only the shape of a stored value is worth refusing.
    const privacy = String(next.tiktok?.privacy || '');
    if (privacy && !['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'].includes(privacy)) {
      throw new SocialError('Choose a valid TikTok privacy setting.');
    }
  }
  return next;
}

/**
 * A stable ordinal for one clip within its lecture.
 *
 * Sorted by the clip's own addedAt then id, so it does not move when another
 * lecture is imported or a sibling is deleted -- and it is the same answer
 * every time it is asked, which is what makes the rotation safe to recompute.
 */
function rotationIndex(clip) {
  const siblings = (state.clips || [])
    .filter(item => item.projectId && item.projectId === clip.projectId
      && ownerOf(item) === ownerOf(clip))
    .sort((a, b) => (Number(a.addedAt) || 0) - (Number(b.addedAt) || 0)
      || String(a.id).localeCompare(String(b.id)));
  const at = siblings.findIndex(item => item.id === clip.id);
  // A clip with no lecture (or one not found) still needs an answer that does
  // not change between calls; its id serves.
  if (at >= 0) return at;
  let hash = 0;
  for (const ch of String(clip.id || '')) hash = (hash * 31 + ch.charCodeAt(0)) % 100003;
  return hash;
}

/**
 * Which channels this clip is FOR, without building targets or logging.
 *
 * The scheduler needs to know a clip's lanes before it has picked a time,
 * and building the targets to find out would log every "no account selected"
 * warning twice per clip. Same rules, same order, ids only.
 */
/**
 * Where this clip WILL go once it is approved -- the answer to "how do I know
 * where I'm posting my video?" before the decision rather than after it.
 *
 * Youssef, 4 Sept 2026: "it's not just scheduling ... how do I know where I'm
 * posting my video?" The review queue asked people to approve a clip without
 * ever saying where it would be published; the destinations only appeared on
 * the Schedule, after the choice had been made.
 *
 * Computed HERE and sent down, never re-derived in the browser: where a clip
 * posts is the product of the account's channels, its share-out mode, the
 * lecture's own narrowing and the plan's cap, and a second implementation of
 * those rules would drift from this one. The dashboard renders what this says.
 *
 * Consent is assumed because approving is what grants it -- see the note in
 * enabledTargetsForClip. Never used to publish: this only ever describes.
 */
export function plannedChannelsFor(clip) {
  let targets = [];
  try { targets = enabledTargetsForClip(clip, { quiet: true, assumeConsent: true }); }
  catch { return []; }
  return targets.map(target => ({
    id: target.id,
    provider: target.provider,
    accountId: target.accountId || '',
    accountName: target.accountName || '',
  }));
}

export function laneKeysForClip(clip) {
  try { return enabledTargetsForClip(clip, { quiet: true }).map(target => target.id); }
  catch { return []; }
}

export function enabledTargetsForClip(clip, { quiet = false, assumeConsent = false } = {}) {
  // `quiet` is for callers that only want to know WHERE this clip would go
  // (the scheduler, deciding which lane's slots to avoid). Without it every
  // "no account selected" warning is written twice for every clip.
  const say = (message, level) => { if (!quiet) log(message, level, ownerOf(clip)); };
  // Everything here follows the clip owner: their publishing settings, their
  // connected accounts. The owner is recorded on each target so the upload and
  // polling steps later cannot drift onto a different account's credentials.
  const userId = ownerOf(clip);
  if (!userId) throw new SocialError('This clip has no owner, so it cannot be published.');
  // Read lightly, never through validateFor: that validator throws on the
  // first misconfigured provider, and one Instagram connection missing its
  // account pick silently blocked EVERY approval from scheduling anything --
  // including perfectly healthy YouTube posts. A provider that cannot post
  // is skipped and named in the log; the others carry on.
  const settings = publishingSettings(ownerOfRecord(clip));
  if (!settings.enabled || !config.socialPublishEnabled) return [];
  const owner = ownerOfRecord(clip);
  const targets = [];
  /*
   * A clip may narrow where it goes, never widen it.
   *
   * Youssef, 3 Sept 2026, on the last step of the job panel: "they can
   * deselect or select depending on each video ... always keep it saved from
   * last goal" -- the account's Connections settings are the starting point
   * every time, and a job may turn one off for that lecture's clips.
   *
   * Intersected rather than substituted, deliberately: a destination the
   * account has since disconnected, or one its plan no longer allows, must not
   * come back because a job recorded it days ago. An absent list means the
   * clip predates this and takes the settings whole.
   */
  const project = clip.projectId ? (state.projects || []).find(row => row.id === clip.projectId) : null;
  const chosenList = Array.isArray(clip.publishTo) ? clip.publishTo
    : Array.isArray(project?.publishTo) ? project.publishTo
      : null;
  // Read from the PROJECT rather than stamped onto every clip at creation:
  // clips are minted in five different places (first render, re-cut, import,
  // variants) and a field that has to be remembered in five places is a field
  // that will be forgotten in one. A clip may still carry its own list, which
  // wins.
  const only = chosenList ? chosenList.map(String) : null;
  const spreadMode = settings.spread === 'rotate' ? 'rotate' : 'all';
  for (const provider of PROVIDERS) {
    const item = settings[provider];
    if (!item?.enabled) continue;
    if (only && !only.includes(provider)) continue;
    // TikTok requires explicit consent for each post, and three TikToks is
    // three posts. A clip approved before per-account consent existed carries
    // only the clip-level stamp, which still counts -- refusing those would
    // strand every clip already approved and waiting in the schedule.
    // `assumeConsent` is for the PREVIEW: "where will this clip go once I
    // approve it". Approving is what stamps TikTok consent, so a waiting clip
    // has none -- and answering the preview honestly with the stored value
    // would tell every reviewer their clip is not going to TikTok, right up
    // until the moment they approve it and it does.
    const consented = accountId => assumeConsent || (clip.tiktokConsent
      ? Boolean(clip.tiktokConsent[String(accountId || 'default')] || clip.tiktokConsent.default)
      : Boolean(clip.tiktokConsentAt));
    if (provider === 'tiktok' && !assumeConsent && clip.approvedBy !== 'manual') continue;
    // The cap is applied HERE as well as at the route, deliberately. A settings
    // record can outlive the plan that was allowed to write it -- a Studio
    // account that lapses to Pro still has three ids on disk -- and the render
    // path must not keep posting to all three because a past subscription once
    // permitted it. Truncating at build time means the extra destinations stop
    // the moment the plan does, and come back if it resumes.
    const allowed = billing.accountsPerPlatform(owner, provider);
    let chosen = (item.accountIds?.length ? item.accountIds : [item.accountId]).slice(0, allowed);
    if (item.accountIds?.length > allowed) {
      say(`${provider} has ${item.accountIds.length} accounts selected but this plan allows ${allowed}; posting to the first ${allowed}.`, 'warn');
    }
    /*
     * SHARE OUT, or post everywhere.
     *
     * With three channels on one platform, "everywhere" means the same clip
     * on all three at the same minute -- your own channels competing with
     * each other, which is what paying for three of them should NOT buy.
     * "Share out" gives each clip to ONE of them instead, so three channels
     * carry three different clips.
     *
     * It rotates WITHIN a platform, never across platforms: a clip still goes
     * to YouTube and TikTok both. Rotating across platforms would mean a clip
     * reaching one network and not the other, which nobody asks for.
     *
     * The index is derived from the clip's own position in its lecture, so
     * asking twice gives the same answer -- this function is called at
     * schedule time and again when targets are rebuilt, and a rotation that
     * drifted between the two would move a clip to a different channel after
     * it had been scheduled for the first.
     */
    if (spreadMode === 'rotate' && chosen.length > 1) {
      chosen = [chosen[rotationIndex(clip) % chosen.length]];
    }
    for (const accountId of chosen) {
      if (provider === 'tiktok' && !consented(accountId)) {
        say(`"${clip.title || clip.id}" was not approved for this TikTok account, so it will not post there.`, 'warn');
        continue;
      }
      const account = selectedAccount(provider, accountId, userId);
      if (!account) {
        say(`${provider} is switched on but has no account selected, so "${clip.title || clip.id}" will not post there. Pick the account in Connections.`, 'warn');
        continue;
      }
      targets.push({
        // A stable handle for ONE destination. Targets used to be identified by
        // provider alone, which was fine while a clip could only have one of
        // each -- but with three Facebook Pages on a clip, "Retry facebook"
        // re-armed all three and wiped their error text, and no button could
        // address a single Page. accountId is part of the id because the same
        // provider now repeats; `|| 'default'` covers YouTube and TikTok, whose
        // selectedAccount accepts an empty id and means "the one connection".
        id: `${provider}:${accountId || 'default'}`,
        userId,
        provider, accountId, accountName: provider === 'facebook' ? account.pageName : provider === 'instagram' ? account.instagramName : account.name,
        status: 'scheduled', attempts: 0, nextTryAt: clip.scheduledAt || Date.now(), // A TikTok target carries ITS OWN audience and interaction choices; every
        // other platform has nothing per-account to carry.
        settings: structuredClone(provider === 'tiktok'
          ? { ...item, accountId, ...tiktokOptionsFor(item, accountId) }
          : { ...item, accountId }),
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
  }
  return targets;
}

export function signMedia(clipId, expiresAt = Date.now() + config.socialMediaUrlTtlMs) {
  const exp = Math.floor(expiresAt / 1000);
  const signature = crypto.createHmac('sha256', requireTokenKey()).update(`${clipId}:${exp}`).digest('base64url');
  return { exp, sig: signature };
}
export function verifyMediaSignature(clipId, exp, signature) {
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return false;
  const expected = crypto.createHmac('sha256', requireTokenKey()).update(`${clipId}:${expiry}`).digest();
  const supplied = Buffer.from(String(signature || ''), 'base64url');
  return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
}
export function publicMediaUrl(clipId) {
  const { exp, sig } = signMedia(clipId);
  return `${baseUrl()}/media/social/${encodeURIComponent(clipId)}.mp4?exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

/**
 * Take a refreshed token only if it actually contains one.
 *
 * Both refresh paths did `{ ...token, ...refreshed }` and then set expiresAt to
 * an hour out unconditionally. A 200 that carries no access_token -- an empty
 * body, a shape nobody expected -- therefore left the OLD, expired token in
 * place, stamped it as fresh for another hour, and SAVED it. Every publish for
 * that hour then failed with 401 and the refresh was never retried, because the
 * expiry it was judged against was the one this function had just invented. It
 * healed itself an hour later, which is precisely what makes it read as random.
 */
function mergeRefreshedToken(previous, refreshed, provider, defaultLifetimeSec) {
  const access = String(refreshed?.access_token || '').trim();
  if (!access) {
    throw new SocialError(
      `${provider} did not return a new access token when refreshing. Reconnect the account.`,
      { provider: provider.toLowerCase() },
    );
  }
  return {
    ...previous,
    ...refreshed,
    access_token: access,
    // Providers rotate refresh tokens; keeping the old one when none came back
    // is what lets the next refresh work at all.
    refresh_token: refreshed.refresh_token || previous.refresh_token,
    expiresAt: Date.now() + Number(refreshed.expires_in || defaultLifetimeSec) * 1000,
  };
}

async function youtubeToken(userId, accountId = '') {
  // Per ACCOUNT. Reading the user's first YouTube here would upload a clip
  // aimed at the second channel using the first channel's bearer token -- three
  // targets would all post to one channel, all report success, and hand back
  // three post URLs pointing at the same place.
  const conn = connectionFo(userId, 'youtube', accountId);
  if (!conn?.token) throw new SocialError('YouTube is not connected.');
  let token = decrypt(conn.token);
  if (Number(token.expiresAt || 0) > Date.now() + 5 * 60_000) return token.access_token;
  if (!token.refresh_token) {
    throw new SocialError('This YouTube connection has no refresh token, so it cannot be renewed. Reconnect the channel.', { provider: 'youtube' });
  }
  const refreshed = await jsonRequest(config.googleTokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, refresh_token: token.refresh_token, grant_type: 'refresh_token' }),
  }, 'YouTube');
  token = mergeRefreshedToken(token, refreshed, 'YouTube', 3600);
  conn.token = encrypt(token); save();
  return token.access_token;
}

async function tiktokToken(userId, accountId = '') {
  const conn = connectionFo(userId, 'tiktok', accountId);
  if (!conn?.token) throw new SocialError('TikTok is not connected.');
  let token = decrypt(conn.token);
  if (Number(token.expiresAt || 0) > Date.now() + 5 * 60_000) return token.access_token;
  if (!token.refresh_token) {
    throw new SocialError('This TikTok connection has no refresh token, so it cannot be renewed. Reconnect the account.', { provider: 'tiktok' });
  }
  const refreshed = await jsonRequest(`${config.tiktokApiBase}/v2/oauth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, grant_type: 'refresh_token', refresh_token: token.refresh_token }),
  }, 'TikTok');
  token = mergeRefreshedToken(token, refreshed, 'TikTok', 86400);
  conn.token = encrypt(token); save();
  return token.access_token;
}

export async function testConnection(provider, accountId = '', user) {
  const userId = user?.id || user || '';
  if (!userId) throw new SocialError('Sign in to test a connection.');
  const testedAt = Date.now();
  try {
    let result;
    if (provider === 'youtube') {
      const accessToken = await youtubeToken(userId, accountId);
      const profile = await jsonRequest(`${config.youtubeApiBase}/youtube/v3/channels?part=id,snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } }, 'YouTube');
      const channel = profile?.items?.[0];
      if (!channel?.id) throw new SocialError('YouTube is connected, but no channel is available.');
      result = { provider, accountId: channel.id, name: channel.snippet?.title || 'YouTube channel' };
      // Recorded on the channel that was tested. Writing it to the platform's
      // first connection would mark a healthy channel tested because a
      // different one answered.
      Object.assign(connectionFo(userId, 'youtube', accountId) || {}, { lastTestAt: testedAt, lastTestError: null });
    } else if (provider === 'meta') {
      const accounts = connection(userId, 'meta')?.accounts || [];
      if (!accounts.length) throw new SocialError('Meta is not connected.');
      const checks = [];
      for (const account of accounts.filter(item => !accountId || item.pageId === accountId || item.instagramId === accountId)) {
        const accessToken = decrypt(account.token)?.access_token;
        const page = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(account.pageId)}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`, {}, 'Meta');
        checks.push({ pageId: String(page.id || account.pageId), pageName: page.name || account.pageName, instagramId: account.instagramId || '' });
      }
      if (!checks.length) throw new SocialError('The selected Meta Page is no longer connected.');
      result = { provider, accounts: checks };
      Object.assign(connection(userId, 'meta'), { lastTestAt: testedAt, lastTestError: null });
    } else if (provider === 'tiktok') {
      const accessToken = await tiktokToken(userId, accountId);
      const profile = await jsonRequest(`${config.tiktokApiBase}/v2/user/info/?fields=open_id,avatar_url,display_name`, { headers: { Authorization: `Bearer ${accessToken}` } }, 'TikTok');
      const creator = await queryTikTokCreator(accessToken, userId, accountId);
      const tiktokConnection = connectionFo(userId, 'tiktok', accountId) || {};
      result = { provider, accountId: profile?.data?.user?.open_id || tiktokConnection?.accountId || '', name: profile?.data?.user?.display_name || tiktokConnection?.name || 'TikTok account', creatorInfo: creator };
      Object.assign(tiktokConnection, { lastTestAt: testedAt, lastTestError: null, creatorInfo: creator });
    } else throw new SocialError('Unknown social provider.');
    save();
    return result;
  } catch (error) {
    const failed = provider === 'meta'
      ? connection(userId, 'meta')
      : connectionFo(userId, provider, accountId);
    if (failed) Object.assign(failed, { lastTestAt: testedAt, lastTestError: error.message });
    save();
    throw error;
  }
}

/**
 * The credit line a free-plan post carries.
 *
 * The same policy as the watermark (Youssef, 1 Sept 2026: on for every Basic
 * account, and Basic cannot turn it off), written in the caption where the
 * platform shows text. It carries the ACCOUNT'S OWN invite link, so the person
 * whose post it is has a reason to want it there -- fifty tokens when someone
 * it brings in subscribes -- and a paid plan never carries it at all. Empty
 * when POST_CREDIT=false, or when referrals are off (a bare brand line with
 * nothing in it for the poster is an advert, and that is a different decision).
 */
export function postCredit(clip) {
  if (!config.postCreditEnabled || !config.referralsEnabled) return '';
  const owner = ownerOfRecord(clip);
  // The credit is the watermark's own feature, read from the FEATURES table
  // the watermark gate reads: whoever may remove the mark carries no credit.
  // One table, so the two cannot drift -- and social.js stays free of any
  // plan gate of its own, which the gate-law test enforces.
  if (!owner || billing.planFeatures(owner).watermark) return '';
  const base = (config.publicBaseUrl || 'https://deenclipped.online').replace(/^https?:\/\//, '');
  return `Clipped with DeenClipped · ${base}/r/${referralCodeFor(owner)}`;
}

function captionText(clip, max = 2200) {
  const body = [clip.description, clip.hashtags].filter(Boolean).join('\n\n').trim();
  const credit = postCredit(clip);
  if (!credit) return body.slice(0, max);
  // The credit is the part that must survive: the description gives way to
  // it, never the other way round, or the platforms with the tightest limit
  // would silently drop the one line the free plan exists to carry.
  const room = Math.max(0, max - credit.length - 2);
  return [body.slice(0, room).trim(), credit].filter(Boolean).join('\n\n').slice(0, max);
}
/** The caption exactly as a platform receives it, for tests. */
export const captionTextFor = captionText;

async function youtubeUploadStatus(uploadUrl, accessToken, totalSize) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Length': '0', 'Content-Range': `bytes */${totalSize}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.ok) {
    const { data } = await parseResponse(res);
    return { complete: Boolean(data?.id), data, offset: totalSize };
  }
  if (res.status === 308) {
    const match = res.headers.get('range')?.match(/bytes=0-(\d+)/i);
    return { complete: false, offset: match ? Number(match[1]) + 1 : 0 };
  }
  if ([404, 410].includes(res.status)) return { expired: true, complete: false, offset: 0 };
  const { data, text } = await parseResponse(res);
  throw new SocialError(`YouTube could not check the upload session: ${data?.error?.message || text || res.statusText}`, {
    retryable: RETRYABLE_STATUS.has(res.status), status: res.status, provider: 'youtube',
  });
}

async function uploadYouTube(clip, target, file, userId) {
  const accessToken = await youtubeToken(userId, target.accountId);
  const stat = fs.statSync(file);
  const bytes = fs.readFileSync(file);
  target.providerState ||= {};
  let uploadUrl = target.providerState.uploadUrl || '';
  let offset = Math.max(0, Number(target.providerState.offset || 0));

  if (uploadUrl) {
    const status = await youtubeUploadStatus(uploadUrl, accessToken, stat.size);
    if (status.complete && status.data?.id) {
      target.externalId = status.data.id;
      target.providerState = { stage: 'completed', totalSize: stat.size, offset: stat.size };
      save();
      return { postId: status.data.id, postUrl: `https://youtu.be/${status.data.id}` };
    }
    if (status.expired) {
      uploadUrl = '';
      offset = 0;
      target.providerState = {};
      save();
    } else {
      offset = status.offset;
      target.providerState.offset = offset;
      save();
    }
  }

  if (!uploadUrl) {
    const hashtags = String(clip.hashtags || '').match(/#[\p{L}\p{N}_]+/gu)?.map(tag => tag.slice(1)).slice(0, 20) || [];
    const metadata = {
      snippet: {
        title: String(clip.title || 'DeenClipped reminder').slice(0, 100),
        description: captionText(clip, 5000),
        categoryId: target.settings.categoryId || '22',
        ...(hashtags.length ? { tags: hashtags } : {}),
      },
      status: {
        // Always public. There is no privacy control in the app and no stored
        // value is consulted: a clip the person approved is a clip they meant
        // to publish. (Google can still hold an upload private on its own,
        // whatever this asks for -- that is Google's gate, not a setting
        // anyone here can change. The compliance review that was forcing it
        // CLOSED on 28 Aug 2026, "no further actions required", so the reason
        // it used to happen is gone; nobody has posted a clip since to confirm
        // uploads now arrive public, so the copy stops short of promising it.)
        privacyStatus: 'public',
        selfDeclaredMadeForKids: Boolean(target.settings.madeForKids),
      },
    };
    const init = await fetch(`${config.youtubeApiBase}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${target.settings.notifySubscribers === false ? 'false' : 'true'}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(stat.size),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(120_000),
    });
    if (!init.ok) {
      const { data, text } = await parseResponse(init);
      throw new SocialError(`YouTube upload could not start: ${data?.error?.message || text || init.statusText}`, { retryable: RETRYABLE_STATUS.has(init.status), status: init.status, provider: 'youtube' });
    }
    uploadUrl = init.headers.get('location') || '';
    if (!uploadUrl) throw new SocialError('YouTube did not return a resumable upload URL.', { retryable: true, provider: 'youtube' });
    offset = 0;
    target.providerState = { stage: 'uploading', uploadUrl, totalSize: stat.size, offset };
    save();
  }

  const chunkSize = 8 * 1024 * 1024; // YouTube resumable chunks; multiple of 256 KiB.
  let failures = 0;
  while (offset < stat.size) {
    const endExclusive = Math.min(stat.size, offset + chunkSize);
    const body = bytes.subarray(offset, endExclusive);
    target.providerState = { ...target.providerState, stage: 'uploading', totalSize: stat.size, offset };
    save();
    try {
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'video/mp4',
          'Content-Length': String(body.length),
          'Content-Range': `bytes ${offset}-${endExclusive - 1}/${stat.size}`,
        },
        body,
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (res.ok) {
        const { data } = await parseResponse(res);
        if (!data?.id) throw new SocialError('YouTube accepted the file but did not return a video ID.', { retryable: true, provider: 'youtube' });
        target.externalId = data.id;
        target.providerState = { stage: 'completed', totalSize: stat.size, offset: stat.size };
        save();
        return { postId: data.id, postUrl: `https://youtu.be/${data.id}` };
      }
      if (res.status === 308) {
        const match = res.headers.get('range')?.match(/bytes=0-(\d+)/i);
        offset = match ? Number(match[1]) + 1 : endExclusive;
        target.providerState = { ...target.providerState, stage: 'uploading', totalSize: stat.size, offset };
        save();
        failures = 0;
        continue;
      }
      const { data, text } = await parseResponse(res);
      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new SocialError(`YouTube upload failed: ${data?.error?.message || text || res.statusText}`, { status: res.status, provider: 'youtube' });
      }
      throw new SocialError(`YouTube upload temporarily failed: ${data?.error?.message || text || res.statusText}`, { retryable: true, status: res.status, provider: 'youtube' });
    } catch (error) {
      if (error instanceof SocialError && !error.retryable) throw error;
      failures += 1;
      if (failures >= 6) throw new SocialError(`YouTube upload was interrupted repeatedly: ${error.message}`, { retryable: true, provider: 'youtube' });
      await sleep(1500 * failures);
      const status = await youtubeUploadStatus(uploadUrl, accessToken, stat.size);
      if (status.complete && status.data?.id) {
        target.externalId = status.data.id;
        target.providerState = { stage: 'completed', totalSize: stat.size, offset: stat.size };
        save();
        return { postId: status.data.id, postUrl: `https://youtu.be/${status.data.id}` };
      }
      if (status.expired) {
        target.providerState = {};
        save();
        throw new SocialError('The YouTube resumable upload session expired and will restart.', { retryable: true, provider: 'youtube' });
      }
      offset = status.offset;
      target.providerState = { ...target.providerState, stage: 'uploading', totalSize: stat.size, offset };
      save();
    }
  }
  throw new SocialError('YouTube upload ended without a video ID.', { retryable: true, provider: 'youtube' });
}

function metaPage(accountId, kind, userId) {
  const account = selectedAccount(kind, accountId, userId);
  if (!account) throw new SocialError(`The selected ${kind} account is no longer connected.`);
  return { account, accessToken: decrypt(account.token)?.access_token };
}

async function uploadFacebook(clip, target, file, userId) {
  const duration = Number(clip.durationMs || 0) / 1000;
  if (duration < 4 || duration > 60) throw new SocialError(`Facebook Reels publishing requires a 4–60 second video; this clip is ${Math.ceil(duration)} seconds.`, { provider: 'facebook' });
  const { account, accessToken } = metaPage(target.accountId, 'facebook', userId);
  target.providerState ||= {};
  let videoId = target.externalId || target.providerState.videoId || '';
  let uploadUrl = target.providerState.uploadUrl || '';

  if (!videoId || !uploadUrl) {
    const startParams = new URLSearchParams({ upload_phase: 'start', access_token: accessToken });
    const started = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(account.pageId)}/video_reels?${startParams}`, { method: 'POST' }, 'Facebook');
    if (!started?.video_id || !started?.upload_url) throw new SocialError('Facebook did not return a Reel upload session.', { retryable: true, provider: 'facebook' });
    videoId = String(started.video_id);
    uploadUrl = started.upload_url;
    target.externalId = videoId;
    target.providerState = { stage: 'started', videoId, uploadUrl };
    save();
  }

  if (!['uploaded', 'published'].includes(target.providerState.stage)) {
    const bytes = fs.readFileSync(file);
    const upload = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `OAuth ${accessToken}`, offset: '0', file_size: String(bytes.length), 'Content-Type': 'application/octet-stream' },
      body: bytes,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!upload.ok) {
      const { data, text } = await parseResponse(upload);
      if ([403, 404, 410].includes(upload.status)) {
        target.externalId = '';
        target.providerState = {};
        save();
      }
      throw new SocialError(`Facebook Reel upload failed: ${data?.error?.message || text || upload.statusText}`, { retryable: RETRYABLE_STATUS.has(upload.status) || [403, 404, 410].includes(upload.status), status: upload.status, provider: 'facebook' });
    }
    target.providerState = { ...target.providerState, stage: 'uploaded', videoId, uploadUrl: '' };
    save();
  }

  if (target.providerState.stage !== 'published') {
    const finishParams = new URLSearchParams({
      upload_phase: 'finish', access_token: accessToken, video_id: videoId, video_state: 'PUBLISHED',
      description: captionText(clip, 5000), title: String(clip.title || '').slice(0, 255),
    });
    const finish = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(account.pageId)}/video_reels?${finishParams}`, { method: 'POST' }, 'Facebook');
    if (!finish?.success) throw new SocialError('Facebook did not confirm that the Reel was published.', { retryable: true, provider: 'facebook' });
    target.providerState = { stage: 'published', videoId };
    save();
  }

  let postUrl = '';
  try {
    const details = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(videoId)}?fields=permalink_url&access_token=${encodeURIComponent(accessToken)}`, {}, 'Facebook');
    postUrl = details?.permalink_url || '';
  } catch {}
  return { postId: videoId, postUrl };
}

async function startInstagram(clip, target, userId) {
  const { account, accessToken } = metaPage(target.accountId, 'instagram', userId);
  const body = new URLSearchParams({
    media_type: 'REELS', video_url: publicMediaUrl(clip.id), caption: captionText(clip, 2200),
    share_to_feed: target.settings.shareToFeed === false ? 'false' : 'true', access_token: accessToken,
  });
  const container = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(account.instagramId)}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, 'Instagram');
  if (!container?.id) throw new SocialError('Instagram did not return a media container ID.', { retryable: true, provider: 'instagram' });
  target.externalId = String(container.id); target.providerState = { stage: 'container', instagramId: account.instagramId }; save();
  return { pending: true, externalId: String(container.id), providerState: target.providerState };
}

async function pollInstagram(target, userId) {
  const { account, accessToken } = metaPage(target.accountId, 'instagram', userId);
  if (target.providerState?.stage === 'published' && target.providerState?.publishedId) {
    return { postId: target.providerState.publishedId, postUrl: target.providerState.postUrl || '' };
  }
  const containerId = target.externalId;
  const status = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`, {}, 'Instagram');
  if (status?.status_code === 'ERROR' || status?.status_code === 'EXPIRED') throw new SocialError(`Instagram could not prepare the Reel: ${status.status || status.status_code}`, { provider: 'instagram' });
  if (status?.status_code !== 'FINISHED') return { pending: true, externalId: containerId, providerState: { ...target.providerState, platformStatus: status?.status_code || status?.status || 'IN_PROGRESS' } };
  // media_publish CREATES the post, so the attempt is recorded before it is
  // made rather than after it returns. If the answer is lost on the way back --
  // a timeout, a dropped connection -- the Reel may well be live while this
  // side believes nothing happened, and without this the next attempt has no
  // way to know it is the second one. It does not make the call idempotent; it
  // makes the ambiguity visible instead of silent.
  const alreadyAttempted = Boolean(target.providerState?.publishAttemptedAt);
  target.providerState = { ...target.providerState, stage: 'publishing', publishAttemptedAt: Date.now() };
  save();
  const body = new URLSearchParams({ creation_id: containerId, access_token: accessToken });
  const published = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(account.instagramId)}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, 'Instagram');
  if (!published?.id) {
    throw new SocialError(
      alreadyAttempted
        ? 'Instagram did not return a published media ID, and this clip has been sent to media_publish before. Check the Instagram account for the Reel before retrying, so it is not posted twice.'
        : 'Instagram did not return a published media ID.',
      { retryable: !alreadyAttempted, provider: 'instagram' },
    );
  }
  const publishedId = String(published.id);
  let postUrl = '';
  try {
    const details = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(publishedId)}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`, {}, 'Instagram');
    postUrl = details?.permalink || '';
  } catch {}
  target.providerState = { stage: 'published', publishedId, postUrl };
  save();
  return { postId: publishedId, postUrl };
}

async function queryTikTokCreator(accessToken, userId, accountId = '') {
  /*
   * FIFTEEN seconds, not the 120 jsonRequest defaults to.
   *
   * This call runs inside a request a BROWSER is waiting on -- opening the
   * publish options, and testing a connection. Render's proxy gives up long
   * before two minutes and answers the browser 504, so a slow TikTok could
   * never surface its own error: the gateway killed the request first and the
   * customer saw a bare "504" that says nothing about TikTok at all.
   * Youssef, 3 Sept 2026: "tiktok gives back 504 errors".
   *
   * The long default is right for the UPLOAD path, where a big file genuinely
   * takes minutes and nobody is staring at a spinner. It is wrong for a
   * question the screen is blocked on.
   */
  const result = await jsonRequest(`${config.tiktokApiBase}/v2/post/publish/creator_info/query/`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: '{}',
    signal: AbortSignal.timeout(15_000),
  }, 'TikTok');
  const info = result?.data || {};
  // Cached on the account it describes: each TikTok has its own privacy
  // options and its own maximum post duration, so storing one account's info
  // against the platform would validate account B's post against account A's
  // limits -- refusing a legal post, or sending one and being rejected.
  const conn = connectionFo(userId, 'tiktok', accountId);
  if (conn) { conn.creatorInfo = info; save(); }
  return info;
}

function tiktokChunks(size) {
  const MB = 1024 * 1024;
  if (!Number.isFinite(size) || size <= 0) throw new SocialError('TikTok cannot upload an empty video.', { provider: 'tiktok' });
  if (size <= 64 * MB) return { chunkSize: size, count: 1, lengths: [size] };
  let chunkSize = 64 * MB;
  let count = Math.floor(size / chunkSize);
  if (count < 2) {
    count = 2;
    chunkSize = Math.floor(size / count);
  }
  if (count > 1000) throw new SocialError('This video would require too many TikTok upload chunks.', { provider: 'tiktok' });
  const lengths = Array.from({ length: count }, (_, index) => index === count - 1 ? size - chunkSize * (count - 1) : chunkSize);
  if (lengths.some((length, index) => index < lengths.length - 1 && (length < 5 * MB || length > 64 * MB))) {
    throw new SocialError('TikTok upload chunk sizing could not be satisfied for this file.', { provider: 'tiktok' });
  }
  if (lengths[lengths.length - 1] > 128 * MB) throw new SocialError('The final TikTok upload chunk is too large.', { provider: 'tiktok' });
  return { chunkSize, count, lengths };
}

function chunkBoundaries(lengths) {
  let offset = 0;
  return lengths.map(length => {
    const item = { start: offset, end: offset + length - 1, length };
    offset += length;
    return item;
  });
}

async function startTikTok(clip, target, file, userId) {
  const accessToken = await tiktokToken(userId, target.accountId);
  const creator = await queryTikTokCreator(accessToken, userId, target.accountId);
  const duration = Number(clip.durationMs || 0) / 1000;
  if (creator.max_video_post_duration_sec && duration > creator.max_video_post_duration_sec) {
    throw new SocialError(`TikTok allows up to ${creator.max_video_post_duration_sec}s for this account, but this clip is ${Math.ceil(duration)}s.`, { provider: 'tiktok' });
  }
  // No fallback: posting under a privacy level nobody chose is the thing the
  // guidelines exist to prevent, so an unset one stops the publish instead.
  const privacy = String(target.settings.privacy || '');
  if (!privacy) throw new SocialError('This clip has no TikTok privacy level set. Choose one in Channels before posting.', { provider: 'tiktok' });
  if (Array.isArray(creator.privacy_level_options) && !creator.privacy_level_options.includes(privacy)) {
    throw new SocialError(`TikTok does not currently allow the selected privacy level (${privacy}) for this account.`, { provider: 'tiktok' });
  }
  if (target.providerState?.stage === 'moderation' && target.externalId) {
    return { pending: true, externalId: target.externalId, providerState: target.providerState };
  }

  const stat = fs.statSync(file);
  const chunks = tiktokChunks(stat.size);
  target.providerState ||= {};
  let publishId = target.externalId || '';
  let uploadUrl = target.providerState.uploadUrl || '';
  let offset = Math.max(0, Number(target.providerState.offset || 0));

  if (!publishId || !uploadUrl) {
    const body = {
      post_info: {
        title: [clip.title, captionText(clip, 2100)].filter(Boolean).join('\n\n').slice(0, 2200),
        privacy_level: privacy,
        disable_comment: Boolean(creator.comment_disabled) || target.settings.allowComments === false,
        disable_duet: Boolean(creator.duet_disabled) || target.settings.allowDuet !== true,
        disable_stitch: Boolean(creator.stitch_disabled) || target.settings.allowStitch !== true,
        video_cover_timestamp_ms: Math.min(1000, Math.max(0, Number(clip.durationMs || 0) - 1)),
        // The creator's own disclosure, not a constant. brand_organic_toggle is
        // "promotes your own brand"; brand_content_toggle is "promotes a third
        // party", which TikTok treats as branded content and refuses to post
        // privately.
        brand_content_toggle: Boolean(target.settings.brandedContent),
        brand_organic_toggle: Boolean(target.settings.yourBrand),
        // Not collected: TikTok's content-sharing guidelines do not require an
        // AI-generated declaration through this API, and asserting one either
        // way on the creator's behalf would be worse than omitting it.
        is_aigc: false,
      },
      source_info: { source: 'FILE_UPLOAD', video_size: stat.size, chunk_size: chunks.chunkSize, total_chunk_count: chunks.count },
    };
    const init = await jsonRequest(`${config.tiktokApiBase}/v2/post/publish/video/init/`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body),
    }, 'TikTok');
    publishId = init?.data?.publish_id;
    uploadUrl = init?.data?.upload_url;
    if (!publishId || !uploadUrl) throw new SocialError('TikTok did not return a publish ID and upload URL.', { retryable: true, provider: 'tiktok' });
    target.externalId = String(publishId);
    offset = 0;
    target.providerState = { stage: 'uploading', uploadUrl, offset, totalSize: stat.size, chunkSize: chunks.chunkSize, chunkCount: chunks.count, startedAt: Date.now() };
    save();
  }

  const boundaries = chunkBoundaries(chunks.lengths);
  const fd = fs.openSync(file, 'r');
  try {
    while (offset < stat.size) {
      const boundary = boundaries.find(item => offset >= item.start && offset <= item.end) || boundaries.find(item => item.start >= offset);
      if (!boundary) break;
      const start = Math.max(offset, boundary.start);
      const length = boundary.end - start + 1;
      // allocUnsafe hands back uninitialised heap, which is the right trade for
      // a 64MB chunk ONLY while every byte of it is then overwritten. The
      // return of readSync was being thrown away, so a short read -- the file
      // truncated or replaced under us mid-upload -- left the tail of the
      // buffer as whatever memory happened to be there and PUT it to TikTok as
      // part of the video. Corrupt output at best, and at worst a stranger's
      // bytes leaving this machine.
      const buffer = Buffer.allocUnsafe(length);
      const read = fs.readSync(fd, buffer, 0, length, start);
      if (read !== length) {
        throw new SocialError(
          `The clip file changed while it was uploading: expected ${length} bytes at ${start}, read ${read}.`,
          { retryable: true, provider: 'tiktok' },
        );
      }
      let res;
      try {
        res = await fetch(uploadUrl, {
          method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(length), 'Content-Range': `bytes ${start}-${boundary.end}/${stat.size}` },
          body: buffer, signal: AbortSignal.timeout(10 * 60_000),
        });
      } catch (error) {
        throw new SocialError(`TikTok media transfer was interrupted: ${error.message}`, { retryable: true, provider: 'tiktok' });
      }
      const finalChunk = boundary.end === stat.size - 1;
      if (res.status === 206 || (finalChunk && (res.status === 201 || res.ok))) {
        offset = boundary.end + 1;
        target.providerState.offset = offset;
        save();
        continue;
      }
      if (res.status === 416) {
        const rangeText = res.headers.get('content-range') || res.headers.get('range') || '';
        const match = rangeText.match(/(?:bytes\s+)?0-(\d+)/i);
        if (match) {
          offset = Number(match[1]) + 1;
          target.providerState.offset = offset;
          save();
          continue;
        }
      }
      const { text } = await parseResponse(res);
      if ([403, 404].includes(res.status)) {
        target.externalId = '';
        target.providerState = {};
        save();
      }
      throw new SocialError(`TikTok media upload failed at byte ${start}: ${text || res.statusText}`, { retryable: RETRYABLE_STATUS.has(res.status) || [403, 404, 416].includes(res.status), status: res.status, provider: 'tiktok' });
    }
  } finally { fs.closeSync(fd); }
  if (offset < stat.size) throw new SocialError('TikTok upload stopped before the full file was transferred.', { retryable: true, provider: 'tiktok' });
  target.providerState = { stage: 'moderation', uploadedAt: Date.now(), totalSize: stat.size };
  save();
  return { pending: true, externalId: String(publishId), providerState: target.providerState };
}

async function pollTikTok(target, userId) {
  // The publish_id belongs to the account that started the upload. Polling it
  // with another account's token is a query about somebody else's post: it
  // never reaches PUBLISH_COMPLETE, so the target sits in moderation for ever.
  const accessToken = await tiktokToken(userId, target.accountId);
  const result = await jsonRequest(`${config.tiktokApiBase}/v2/post/publish/status/fetch/`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: target.externalId }),
  }, 'TikTok');
  const data = result?.data || {};
  if (data.status === 'FAILED') throw new SocialError(`TikTok publishing failed: ${data.fail_reason || 'unknown reason'}`, { provider: 'tiktok' });
  if (data.status !== 'PUBLISH_COMPLETE') return { pending: true, externalId: target.externalId, providerState: { ...target.providerState, platformStatus: data.status } };
  const ids = data.publicly_available_post_id || data.publicaly_available_post_id || [];
  const postId = Array.isArray(ids) ? ids[0] : '';
  return { postId: postId || target.externalId, postUrl: '' };
}

/**
 * The account whose credentials a publish or poll must use.
 *
 * This is the clip's owner, always. The target records the same owner when it
 * is created, and a mismatch means the clip changed hands or the target was
 * built for someone else — either way, uploading would send a customer's video
 * to a stranger's channel, so it stops here.
 */
function publishingAccountFor(clip, target) {
  const clipOwner = ownerOf(clip);
  if (!clipOwner) throw new SocialError('This clip has no owner, so it cannot be published.');
  if (target?.userId && target.userId !== clipOwner) {
    throw new SocialError('This publishing destination belongs to a different account and was not used.');
  }
  return clipOwner;
}

export async function publishTarget(clip, target, file) {
  const userId = publishingAccountFor(clip, target);
  if (target.provider === 'instagram') return startInstagram(clip, target, userId);
  if (!file || !fs.existsSync(file)) throw new SocialError('The rendered clip file is missing.', { provider: target.provider });
  if (target.provider === 'youtube') return uploadYouTube(clip, target, file, userId);
  if (target.provider === 'facebook') return uploadFacebook(clip, target, file, userId);
  if (target.provider === 'tiktok') return startTikTok(clip, target, file, userId);
  throw new SocialError('Unknown publishing provider.');
}

export async function pollTarget(clip, target) {
  const userId = publishingAccountFor(clip, target);
  if (target.provider === 'instagram') return pollInstagram(target, userId);
  if (target.provider === 'tiktok') return pollTikTok(target, userId);
  return { postId: target.externalId || '', postUrl: target.postUrl || '' };
}

export function retryDelay(attempts) {
  return Math.min(6 * 60 * 60_000, 60_000 * (2 ** Math.max(0, Number(attempts || 1) - 1)));
}

export function targetPublic(target) {
  return {
    // The destination's own id, `provider:accountId`. It is what the schedule
    // filters a channel lane by, and deriving it in the browser instead means
    // two places building one key -- the shape that put one clip's waveform on
    // another clip's card. Nothing secret: both halves are already here.
    id: target.id || `${target.provider}:${target.accountId || 'default'}`,
    provider: target.provider, accountId: target.accountId, accountName: target.accountName,
    status: target.status, stage: target.stage || '', attempts: target.attempts || 0,
    nextTryAt: target.nextTryAt || null, error: target.error || null,
    postId: target.postId || null, postUrl: target.postUrl || null, updatedAt: target.updatedAt || null,
    createdAt: target.createdAt || null,
    progressPercent: target.providerState?.totalSize
      ? Math.max(0, Math.min(100, Math.round(Number(target.providerState.offset || 0) / Number(target.providerState.totalSize) * 100)))
      : null,
    uploadedBytes: target.providerState?.offset || null, totalBytes: target.providerState?.totalSize || null,
    platformStatus: target.providerState?.platformStatus || target.providerState?.stage || '',
  };
}

export const __test = { tiktokChunks, captionText, selectedAccount, mergeRefreshedToken };
export { SocialError };
