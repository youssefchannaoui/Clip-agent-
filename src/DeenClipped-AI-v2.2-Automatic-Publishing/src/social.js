import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { state, save, log, publishingSettings } from './store.js';

const PROVIDERS = ['youtube', 'instagram', 'facebook', 'tiktok'];
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
  const decipher = crypto.createDecipheriv('aes-256-gcm', requireTokenKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8'));
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
function signState(provider) {
  pruneOauthStates();
  const nonce = crypto.randomBytes(18).toString('base64url');
  const exp = Date.now() + 10 * 60_000;
  state.oauthStates[nonce] = { provider, exp };
  save();
  const payload = Buffer.from(JSON.stringify({ provider, nonce, exp })).toString('base64url');
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
  return decoded;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { data, text };
}
async function jsonRequest(url, options = {}, provider = '') {
  let res;
  try { res = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(120_000) }); }
  catch (error) { throw new SocialError(`${provider || 'Platform'} could not be reached: ${error.message}`, { retryable: true, provider }); }
  const { data, text } = await parseResponse(res);
  if (!res.ok) {
    const detail = data?.error?.message || data?.error_description || data?.message || data?.error?.code || text || res.statusText;
    throw new SocialError(`${provider || 'Platform'} returned ${res.status}: ${String(detail).slice(0, 500)}`, {
      retryable: RETRYABLE_STATUS.has(res.status), status: res.status, provider,
    });
  }
  if (data?.error && data.error.code && data.error.code !== 'ok') {
    throw new SocialError(`${provider || 'Platform'} error: ${data.error.message || data.error.code}`, { provider });
  }
  return data;
}

export function oauthStartUrl(provider) {
  if (!['youtube', 'meta', 'tiktok'].includes(provider)) throw new SocialError('Unknown social provider.');
  if (!providerConfigured(provider)) throw new SocialError(`${provider} OAuth is not configured in the deployment environment.`);
  const stateText = signState(provider);
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
    const query = new URLSearchParams({
      client_id: config.metaAppId,
      redirect_uri: redirectUri('meta'),
      response_type: 'code',
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish',
      state: stateText,
    });
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

async function connectYouTube(code) {
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
  state.socialConnections.youtube = {
    provider: 'youtube', accountId: channel.id, name: channel.snippet?.title || 'YouTube channel',
    avatar: channel.snippet?.thumbnails?.default?.url || '', scopes: token.scope || '',
    token: encrypt({ ...token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 }), connectedAt: Date.now(),
  };
  save(); log(`Connected YouTube channel "${state.socialConnections.youtube.name}".`);
}

async function connectMeta(code) {
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
  const fields = 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}';
  const pages = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/me/accounts?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(userToken)}`, {}, 'Meta');
  const accounts = (pages?.data || []).filter(page => page.id && page.access_token).map(page => ({
    pageId: String(page.id), pageName: page.name || 'Facebook Page',
    instagramId: page.instagram_business_account?.id ? String(page.instagram_business_account.id) : '',
    instagramName: page.instagram_business_account?.username || page.instagram_business_account?.name || '',
    instagramAvatar: page.instagram_business_account?.profile_picture_url || '',
    token: encrypt({ access_token: page.access_token }),
  }));
  if (!accounts.length) throw new SocialError('Meta did not return a Facebook Page you manage. Instagram publishing also requires a professional Instagram account connected to a Page.');
  state.socialConnections.meta = { provider: 'meta', accounts, connectedAt: Date.now() };
  save(); log(`Connected ${accounts.length} Meta Page${accounts.length === 1 ? '' : 's'} for Facebook/Instagram publishing.`);
}

async function connectTikTok(code) {
  const token = await jsonRequest(`${config.tiktokApiBase}/v2/oauth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri('tiktok') }),
  }, 'TikTok');
  const profile = await jsonRequest(`${config.tiktokApiBase}/v2/user/info/?fields=open_id,union_id,avatar_url,display_name`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  }, 'TikTok');
  const user = profile?.data?.user || {};
  state.socialConnections.tiktok = {
    provider: 'tiktok', accountId: token.open_id || user.open_id || '', name: user.display_name || 'TikTok account', avatar: user.avatar_url || '',
    scopes: token.scope || '', token: encrypt({ ...token, expiresAt: Date.now() + Number(token.expires_in || 86400) * 1000 }), connectedAt: Date.now(), creatorInfo: null,
  };
  save(); log(`Connected TikTok account "${state.socialConnections.tiktok.name}".`);
}

export async function completeOAuth(provider, callbackUrl) {
  const url = callbackUrl instanceof URL ? callbackUrl : new URL(callbackUrl);
  const error = url.searchParams.get('error');
  if (error) throw new SocialError(url.searchParams.get('error_description') || `${provider} authorization was denied.`);
  verifyState(url.searchParams.get('state'), provider);
  const code = url.searchParams.get('code');
  if (!code) throw new SocialError('The authorization provider did not return a code.');
  if (provider === 'youtube') await connectYouTube(code);
  else if (provider === 'meta') await connectMeta(code);
  else if (provider === 'tiktok') await connectTikTok(code);
  else throw new SocialError('Unknown OAuth provider.');
}

export function disconnect(provider) {
  if (provider === 'youtube') {
    delete state.socialConnections.youtube;
    if (state.publishingSettings?.youtube) state.publishingSettings.youtube.enabled = false;
  } else if (provider === 'meta') {
    delete state.socialConnections.meta;
    if (state.publishingSettings?.instagram) state.publishingSettings.instagram.enabled = false;
    if (state.publishingSettings?.facebook) state.publishingSettings.facebook.enabled = false;
  } else if (provider === 'tiktok') {
    delete state.socialConnections.tiktok;
    if (state.publishingSettings?.tiktok) state.publishingSettings.tiktok.enabled = false;
  } else throw new SocialError('Unknown provider.');
  const anyEnabled = ['youtube', 'instagram', 'facebook', 'tiktok'].some(name => state.publishingSettings?.[name]?.enabled);
  if (!anyEnabled && state.publishingSettings) state.publishingSettings.enabled = false;
  save(); log(`Disconnected ${provider}. New uploads to it were disabled; existing platform posts were not deleted.`);
}

function youtubeSummary() {
  const c = state.socialConnections.youtube;
  return c ? [{ id: c.accountId, name: c.name, avatar: c.avatar || '' }] : [];
}
function metaSummaries(kind) {
  return (state.socialConnections.meta?.accounts || []).filter(item => kind === 'facebook' ? item.pageId : item.instagramId).map(item => kind === 'facebook'
    ? { id: item.pageId, name: item.pageName, avatar: '' }
    : { id: item.instagramId, name: item.instagramName || `${item.pageName} Instagram`, avatar: item.instagramAvatar || '', pageId: item.pageId });
}
function tiktokSummary() {
  const c = state.socialConnections.tiktok;
  return c ? [{ id: c.accountId, name: c.name, avatar: c.avatar || '', creatorInfo: c.creatorInfo || null }] : [];
}

export function connectionStatus() {
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
      youtube: { configured: providerConfigured('youtube'), connected: youtubeSummary().length > 0, accounts: youtubeSummary(), lastTestAt: state.socialConnections.youtube?.lastTestAt || null, lastTestError: state.socialConnections.youtube?.lastTestError || null },
      instagram: { configured: providerConfigured('meta'), connected: metaSummaries('instagram').length > 0, accounts: metaSummaries('instagram'), lastTestAt: state.socialConnections.meta?.lastTestAt || null, lastTestError: state.socialConnections.meta?.lastTestError || null },
      facebook: { configured: providerConfigured('meta'), connected: metaSummaries('facebook').length > 0, accounts: metaSummaries('facebook'), lastTestAt: state.socialConnections.meta?.lastTestAt || null, lastTestError: state.socialConnections.meta?.lastTestError || null },
      tiktok: { configured: providerConfigured('tiktok'), connected: tiktokSummary().length > 0, accounts: tiktokSummary(), requiresManualApproval: true, lastTestAt: state.socialConnections.tiktok?.lastTestAt || null, lastTestError: state.socialConnections.tiktok?.lastTestError || null },
    },
  };
}

function selectedAccount(provider, accountId) {
  if (provider === 'youtube') {
    const c = state.socialConnections.youtube;
    return c && (!accountId || c.accountId === accountId) ? c : null;
  }
  if (provider === 'facebook') return (state.socialConnections.meta?.accounts || []).find(item => item.pageId === accountId) || null;
  if (provider === 'instagram') return (state.socialConnections.meta?.accounts || []).find(item => item.instagramId === accountId) || null;
  if (provider === 'tiktok') {
    const c = state.socialConnections.tiktok;
    return c && (!accountId || c.accountId === accountId) ? c : null;
  }
  return null;
}

export function validatePublishingSettings(next = publishingSettings()) {
  const status = connectionStatus();
  if (next.enabled && !config.socialPublishEnabled) throw new SocialError('Automatic social publishing is disabled by SOCIAL_PUBLISH_ENABLED.');
  const enabledProviders = PROVIDERS.filter(provider => next[provider]?.enabled);
  if (next.enabled && !enabledProviders.length) throw new SocialError('Enable at least one connected publishing destination.');
  for (const provider of enabledProviders) {
    const item = next[provider] || {};
    if (!status.providers[provider].configured) throw new SocialError(`${provider} developer credentials are not configured.`);
    if (!selectedAccount(provider, item.accountId)) throw new SocialError(`Choose a connected ${provider} account.`);
  }
  if (!['private', 'unlisted', 'public'].includes(next.youtube?.privacy)) throw new SocialError('Choose a valid YouTube privacy setting.');
  if (!['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'].includes(next.tiktok?.privacy)) throw new SocialError('Choose a valid TikTok privacy setting.');
  const creatorInfo = state.socialConnections.tiktok?.creatorInfo;
  const creatorOptions = creatorInfo?.privacy_level_options;
  if (next.tiktok?.enabled && (!creatorInfo || Date.now() - Number(state.socialConnections.tiktok?.lastTestAt || 0) > 24 * 60 * 60_000)) {
    throw new SocialError('Run TikTok Test connection before enabling it. TikTok requires the latest creator privacy and interaction options to be displayed.');
  }
  if (next.tiktok?.enabled && Array.isArray(creatorOptions) && creatorOptions.length && !creatorOptions.includes(next.tiktok.privacy)) {
    throw new SocialError(`The connected TikTok account does not currently allow ${next.tiktok.privacy}. Run Test connection and choose one of the available privacy options.`);
  }
  return next;
}

export function enabledTargetsForClip(clip) {
  const settings = validatePublishingSettings(publishingSettings());
  if (!settings.enabled) return [];
  const targets = [];
  for (const provider of PROVIDERS) {
    const item = settings[provider];
    if (!item?.enabled) continue;
    if (provider === 'tiktok' && (clip.approvedBy !== 'manual' || !clip.tiktokConsentAt)) continue; // TikTok requires explicit consent for each post.
    const account = selectedAccount(provider, item.accountId);
    if (!account) continue;
    targets.push({
      provider, accountId: item.accountId, accountName: provider === 'facebook' ? account.pageName : provider === 'instagram' ? account.instagramName : account.name,
      status: 'scheduled', attempts: 0, nextTryAt: clip.scheduledAt || Date.now(), settings: structuredClone(item), createdAt: Date.now(), updatedAt: Date.now(),
    });
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

async function youtubeToken() {
  const connection = state.socialConnections.youtube;
  if (!connection?.token) throw new SocialError('YouTube is not connected.');
  let token = decrypt(connection.token);
  if (Number(token.expiresAt || 0) > Date.now() + 5 * 60_000) return token.access_token;
  const refreshed = await jsonRequest(config.googleTokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, refresh_token: token.refresh_token, grant_type: 'refresh_token' }),
  }, 'YouTube');
  token = { ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token, expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000 };
  connection.token = encrypt(token); save();
  return token.access_token;
}

async function tiktokToken() {
  const connection = state.socialConnections.tiktok;
  if (!connection?.token) throw new SocialError('TikTok is not connected.');
  let token = decrypt(connection.token);
  if (Number(token.expiresAt || 0) > Date.now() + 5 * 60_000) return token.access_token;
  const refreshed = await jsonRequest(`${config.tiktokApiBase}/v2/oauth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, grant_type: 'refresh_token', refresh_token: token.refresh_token }),
  }, 'TikTok');
  token = { ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token, expiresAt: Date.now() + Number(refreshed.expires_in || 86400) * 1000 };
  connection.token = encrypt(token); save();
  return token.access_token;
}

export async function testConnection(provider, accountId = '') {
  const testedAt = Date.now();
  try {
    let result;
    if (provider === 'youtube') {
      const accessToken = await youtubeToken();
      const profile = await jsonRequest(`${config.youtubeApiBase}/youtube/v3/channels?part=id,snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } }, 'YouTube');
      const channel = profile?.items?.[0];
      if (!channel?.id) throw new SocialError('YouTube is connected, but no channel is available.');
      result = { provider, accountId: channel.id, name: channel.snippet?.title || 'YouTube channel' };
      Object.assign(state.socialConnections.youtube, { lastTestAt: testedAt, lastTestError: null });
    } else if (provider === 'meta') {
      const accounts = state.socialConnections.meta?.accounts || [];
      if (!accounts.length) throw new SocialError('Meta is not connected.');
      const checks = [];
      for (const account of accounts.filter(item => !accountId || item.pageId === accountId || item.instagramId === accountId)) {
        const accessToken = decrypt(account.token)?.access_token;
        const page = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(account.pageId)}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`, {}, 'Meta');
        checks.push({ pageId: String(page.id || account.pageId), pageName: page.name || account.pageName, instagramId: account.instagramId || '' });
      }
      if (!checks.length) throw new SocialError('The selected Meta Page is no longer connected.');
      result = { provider, accounts: checks };
      Object.assign(state.socialConnections.meta, { lastTestAt: testedAt, lastTestError: null });
    } else if (provider === 'tiktok') {
      const accessToken = await tiktokToken();
      const profile = await jsonRequest(`${config.tiktokApiBase}/v2/user/info/?fields=open_id,avatar_url,display_name`, { headers: { Authorization: `Bearer ${accessToken}` } }, 'TikTok');
      const creator = await queryTikTokCreator(accessToken);
      result = { provider, accountId: profile?.data?.user?.open_id || state.socialConnections.tiktok?.accountId || '', name: profile?.data?.user?.display_name || state.socialConnections.tiktok?.name || 'TikTok account', creatorInfo: creator };
      Object.assign(state.socialConnections.tiktok, { lastTestAt: testedAt, lastTestError: null, creatorInfo: creator });
    } else throw new SocialError('Unknown social provider.');
    save();
    return result;
  } catch (error) {
    const connection = provider === 'meta' ? state.socialConnections.meta : state.socialConnections[provider];
    if (connection) Object.assign(connection, { lastTestAt: testedAt, lastTestError: error.message });
    save();
    throw error;
  }
}

function captionText(clip, max = 2200) {
  return [clip.description, clip.hashtags].filter(Boolean).join('\n\n').trim().slice(0, max);
}

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

async function uploadYouTube(clip, target, file) {
  const accessToken = await youtubeToken();
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
        privacyStatus: target.settings.privacy || 'private',
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

  for (let attempt = 0; attempt < 6; attempt++) {
    if (offset >= stat.size) {
      const status = await youtubeUploadStatus(uploadUrl, accessToken, stat.size);
      if (status.complete && status.data?.id) {
        target.externalId = status.data.id;
        target.providerState = { stage: 'completed', totalSize: stat.size, offset: stat.size };
        save();
        return { postId: status.data.id, postUrl: `https://youtu.be/${status.data.id}` };
      }
      offset = status.offset || 0;
    }
    try {
      const body = bytes.subarray(offset);
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'video/mp4',
          'Content-Length': String(body.length),
          'Content-Range': `bytes ${offset}-${stat.size - 1}/${stat.size}`,
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
        offset = match ? Number(match[1]) + 1 : offset;
        target.providerState.offset = offset;
        save();
        continue;
      }
      const { data, text } = await parseResponse(res);
      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new SocialError(`YouTube upload failed: ${data?.error?.message || text || res.statusText}`, { status: res.status, provider: 'youtube' });
      }
    } catch (error) {
      if (error instanceof SocialError && !error.retryable) throw error;
    }
    await sleep(1500 * (attempt + 1));
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
    target.providerState.offset = offset;
    save();
  }
  throw new SocialError('YouTube upload did not complete after retries.', { retryable: true, provider: 'youtube' });
}

function metaPage(accountId, kind) {
  const account = selectedAccount(kind, accountId);
  if (!account) throw new SocialError(`The selected ${kind} account is no longer connected.`);
  return { account, accessToken: decrypt(account.token)?.access_token };
}

async function uploadFacebook(clip, target, file) {
  const duration = Number(clip.durationMs || 0) / 1000;
  if (duration < 4 || duration > 60) throw new SocialError(`Facebook Reels publishing requires a 4–60 second video; this clip is ${Math.ceil(duration)} seconds.`, { provider: 'facebook' });
  const { account, accessToken } = metaPage(target.accountId, 'facebook');
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

async function startInstagram(clip, target) {
  const { account, accessToken } = metaPage(target.accountId, 'instagram');
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

async function pollInstagram(target) {
  const { account, accessToken } = metaPage(target.accountId, 'instagram');
  if (target.providerState?.stage === 'published' && target.providerState?.publishedId) {
    return { postId: target.providerState.publishedId, postUrl: target.providerState.postUrl || '' };
  }
  const containerId = target.externalId;
  const status = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`, {}, 'Instagram');
  if (status?.status_code === 'ERROR' || status?.status_code === 'EXPIRED') throw new SocialError(`Instagram could not prepare the Reel: ${status.status || status.status_code}`, { provider: 'instagram' });
  if (status?.status_code !== 'FINISHED') return { pending: true, externalId: containerId, providerState: { ...target.providerState, platformStatus: status?.status_code || status?.status || 'IN_PROGRESS' } };
  const body = new URLSearchParams({ creation_id: containerId, access_token: accessToken });
  const published = await jsonRequest(`${config.metaGraphBase}/${config.metaGraphVersion}/${encodeURIComponent(account.instagramId)}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, 'Instagram');
  if (!published?.id) throw new SocialError('Instagram did not return a published media ID.', { retryable: true, provider: 'instagram' });
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

async function queryTikTokCreator(accessToken) {
  const result = await jsonRequest(`${config.tiktokApiBase}/v2/post/publish/creator_info/query/`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: '{}',
  }, 'TikTok');
  const info = result?.data || {};
  if (state.socialConnections.tiktok) { state.socialConnections.tiktok.creatorInfo = info; save(); }
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

async function startTikTok(clip, target, file) {
  const accessToken = await tiktokToken();
  const creator = await queryTikTokCreator(accessToken);
  const duration = Number(clip.durationMs || 0) / 1000;
  if (creator.max_video_post_duration_sec && duration > creator.max_video_post_duration_sec) {
    throw new SocialError(`TikTok allows up to ${creator.max_video_post_duration_sec}s for this account, but this clip is ${Math.ceil(duration)}s.`, { provider: 'tiktok' });
  }
  const privacy = target.settings.privacy || 'SELF_ONLY';
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
        brand_content_toggle: false,
        brand_organic_toggle: false,
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
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fd, buffer, 0, length, start);
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

async function pollTikTok(target) {
  const accessToken = await tiktokToken();
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

export async function publishTarget(clip, target, file) {
  if (!file || !fs.existsSync(file)) throw new SocialError('The rendered clip file is missing.', { provider: target.provider });
  if (target.provider === 'youtube') return uploadYouTube(clip, target, file);
  if (target.provider === 'facebook') return uploadFacebook(clip, target, file);
  if (target.provider === 'instagram') return startInstagram(clip, target);
  if (target.provider === 'tiktok') return startTikTok(clip, target, file);
  throw new SocialError('Unknown publishing provider.');
}

export async function pollTarget(_clip, target) {
  if (target.provider === 'instagram') return pollInstagram(target);
  if (target.provider === 'tiktok') return pollTikTok(target);
  return { postId: target.externalId || '', postUrl: target.postUrl || '' };
}

export function retryDelay(attempts) {
  return Math.min(6 * 60 * 60_000, 60_000 * (2 ** Math.max(0, Number(attempts || 1) - 1)));
}

export function targetPublic(target) {
  return {
    provider: target.provider, accountId: target.accountId, accountName: target.accountName,
    status: target.status, stage: target.stage || '', attempts: target.attempts || 0,
    nextTryAt: target.nextTryAt || null, error: target.error || null,
    postId: target.postId || null, postUrl: target.postUrl || null, updatedAt: target.updatedAt || null,
  };
}

export const __test = { tiktokChunks, captionText, selectedAccount };
export { SocialError };
