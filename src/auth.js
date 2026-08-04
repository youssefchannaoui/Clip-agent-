import crypto from 'node:crypto';
import { config } from './config.js';
import { state, save, log } from './store.js';

const SESSION_COOKIE = 'dc_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

let googleJwksCache = { at: 0, keys: [] };
let appleJwksCache = { at: 0, keys: [] };

const now = () => Date.now();
const b64url = value => Buffer.from(value).toString('base64url');
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanEmail = value => String(value || '').trim().toLowerCase();
const safeReturn = value => {
  const fallback = '/';
  const raw = String(value || fallback).trim() || fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\r\n]/.test(raw)) return fallback;
  if (raw.startsWith('/auth/') || raw.startsWith('/login')) return fallback;
  return raw;
};

function ensureAuthState() {
  if (!Array.isArray(state.authUsers)) state.authUsers = [];
  if (!Array.isArray(state.authSessions)) state.authSessions = [];
  if (!state.authOAuthStates || typeof state.authOAuthStates !== 'object') state.authOAuthStates = {};
  if (!state.authSettings || typeof state.authSettings !== 'object') state.authSettings = { onboardingComplete: false };
  ensureBootstrapUser();
  migrateOwners();
}

function ensureBootstrapUser() {
  if (state.authUsers.length) return;
  const email = cleanEmail(config.adminEmail);
  const user = {
    id: 'user_admin', email, name: config.adminName || 'DeenClipped Admin', role: 'owner', picture: '',
    providers: {}, createdAt: now(), updatedAt: now(), lastLoginAt: null,
  };
  if (config.password) user.passwordHash = hashPassword(config.password);
  state.authUsers.push(user);
  save();
}

function migrateOwners() {
  const owner = state.authUsers[0]?.id || 'user_admin';
  for (const project of state.projects || []) project.ownerId ||= owner;
  for (const clip of state.clips || []) clip.ownerId ||= state.projects?.find(project => project.id === clip.projectId)?.ownerId || owner;
  save();
}

export function enabled() { ensureAuthState(); return Boolean(config.authRequired); }
export function ownerUser() { ensureAuthState(); return state.authUsers.find(user => user.role === 'owner') || state.authUsers[0] || null; }
export function defaultOwnerId() { return ownerUser()?.id || 'user_admin'; }

export function publicConfig() {
  ensureAuthState();
  return {
    required: enabled(),
    google: configured('google'),
    apple: configured('apple'),
    password: Boolean(config.password),
  };
}

function configured(provider) {
  if (provider === 'google') return Boolean(config.googleSigninClientId && config.googleSigninClientSecret);
  if (provider === 'apple') return Boolean(config.appleSigninClientId && config.appleSigninTeamId && config.appleSigninKeyId && config.appleSigninPrivateKey);
  return false;
}

export function userPublic(user) {
  if (!user) return null;
  return {
    id: user.id, email: user.email, name: user.name || user.email, picture: user.picture || '', role: user.role || 'creator',
    providers: Object.keys(user.providers || {}), createdAt: user.createdAt, lastLoginAt: user.lastLoginAt || null,
  };
}

export function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const cookies = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function cookieHeaders(sessionToken = '', { clear = false } = {}) {
  const secure = config.publicBaseUrl.startsWith('https://') ? '; Secure' : '';
  const value = clear ? '' : encodeURIComponent(sessionToken);
  const age = clear ? 0 : Math.round(SESSION_TTL_MS / 1000);
  return [`${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`];
}

export function currentUser(req) {
  ensureAuthState();
  if (!enabled()) return ownerUser();
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const sessionHash = sha256(raw);
  const session = state.authSessions.find(item => item.hash === sessionHash && Number(item.expiresAt || 0) > now());
  if (!session) return null;
  const user = state.authUsers.find(item => item.id === session.userId) || null;
  if (!user) return null;
  session.lastSeenAt = now();
  return user;
}

export function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw Object.assign(new Error('Sign in to continue.'), { statusCode: 401 });
  return user;
}

export function createSession(user, details = {}) {
  ensureAuthState();
  const raw = token(36);
  const session = {
    id: `session_${now().toString(36)}_${token(6)}`, hash: sha256(raw), userId: user.id,
    createdAt: now(), expiresAt: now() + SESSION_TTL_MS, lastSeenAt: now(), provider: details.provider || 'password',
  };
  state.authSessions.unshift(session);
  state.authSessions = state.authSessions.filter(item => Number(item.expiresAt || 0) > now()).slice(0, 200);
  user.lastLoginAt = now();
  save();
  return raw;
}

export function destroySession(req) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return;
  const hash = sha256(raw);
  state.authSessions = (state.authSessions || []).filter(item => item.hash !== hash);
  save();
}

export function hashPassword(password) {
  const salt = token(18);
  const derived = crypto.pbkdf2Sync(String(password), salt, 220000, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$220000$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algorithm, iterationsText, salt, expected] = String(stored).split('$');
  if (algorithm !== 'pbkdf2_sha256' || !salt || !expected) return false;
  const derived = crypto.pbkdf2Sync(String(password), salt, Number(iterationsText) || 220000, 32, 'sha256').toString('base64url');
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(expected));
}

export function passwordLogin(password) {
  ensureAuthState();
  const user = ownerUser();
  if (!user || !config.password || !verifyPassword(password, user.passwordHash)) throw new Error('Wrong password.');
  return user;
}

function baseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host || 'localhost'}`.replace(/\/+$/, '');
}
function callbackUrl(req, provider) {
  if (provider === 'google' && config.googleSigninRedirectUri) return config.googleSigninRedirectUri;
  if (provider === 'apple' && config.appleSigninRedirectUri) return config.appleSigninRedirectUri;
  return `${baseUrl(req)}/auth/${provider}/callback`;
}

export function oauthStart(provider, req, returnTo = '/') {
  ensureAuthState();
  if (!configured(provider)) throw new Error(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in is not configured yet.`);
  const stateId = token(24);
  const nonce = token(24);
  state.authOAuthStates[stateId] = { provider, nonce, returnTo: safeReturn(returnTo), createdAt: now(), expiresAt: now() + OAUTH_TTL_MS };
  save();
  if (provider === 'google') {
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', config.googleSigninClientId);
    url.searchParams.set('redirect_uri', callbackUrl(req, 'google'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', stateId);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }
  const url = new URL(APPLE_AUTH_URL);
  url.searchParams.set('client_id', config.appleSigninClientId);
  url.searchParams.set('redirect_uri', callbackUrl(req, 'apple'));
  url.searchParams.set('response_type', 'code id_token');
  url.searchParams.set('response_mode', 'form_post');
  url.searchParams.set('scope', 'name email');
  url.searchParams.set('state', stateId);
  url.searchParams.set('nonce', nonce);
  return url.toString();
}

function consumeOAuthState(stateId, provider) {
  ensureAuthState();
  const record = state.authOAuthStates[String(stateId || '')];
  delete state.authOAuthStates[String(stateId || '')];
  for (const [key, value] of Object.entries(state.authOAuthStates)) {
    if (Number(value.expiresAt || 0) <= now()) delete state.authOAuthStates[key];
  }
  save();
  if (!record || record.provider !== provider || Number(record.expiresAt || 0) <= now()) throw new Error('The sign-in session expired. Try again.');
  return record;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  if (!response.ok) throw new Error(payload.error_description || payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

async function tokenRequest(url, params) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

function parseJwt(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new Error('The identity token was invalid.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
}

async function jwks(provider) {
  const cache = provider === 'google' ? googleJwksCache : appleJwksCache;
  const url = provider === 'google' ? GOOGLE_JWKS_URL : APPLE_JWKS_URL;
  if (cache.keys.length && now() - cache.at < 6 * 60 * 60 * 1000) return cache.keys;
  const payload = await fetchJson(url);
  cache.at = now(); cache.keys = Array.isArray(payload.keys) ? payload.keys : [];
  return cache.keys;
}

async function verifyIdentityToken(provider, idToken, { audience, nonce }) {
  const parsed = parseJwt(idToken);
  const keys = await jwks(provider);
  const jwk = keys.find(key => key.kid === parsed.header.kid);
  if (!jwk) throw new Error('The identity token could not be verified.');
  const algorithm = parsed.header.alg === 'ES256' ? 'sha256' : 'RSA-SHA256';
  const valid = crypto.verify(algorithm, Buffer.from(parsed.signingInput), crypto.createPublicKey({ key: jwk, format: 'jwk' }), parsed.signature);
  if (!valid) throw new Error('The identity token signature was invalid.');
  const claims = parsed.payload;
  const issuers = provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : ['https://appleid.apple.com'];
  if (!issuers.includes(claims.iss)) throw new Error('The identity token issuer was invalid.');
  if (claims.aud !== audience) throw new Error('The identity token audience was invalid.');
  if (Number(claims.exp || 0) * 1000 <= now()) throw new Error('The identity token expired.');
  if (nonce && claims.nonce && claims.nonce !== nonce) throw new Error('The sign-in nonce did not match.');
  return claims;
}

function appleClientSecret() {
  if (!configured('apple')) throw new Error('Apple sign-in is not configured yet.');
  const header = { alg: 'ES256', kid: config.appleSigninKeyId, typ: 'JWT' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = { iss: config.appleSigninTeamId, iat: issuedAt, exp: issuedAt + 60 * 60 * 24 * 90, aud: 'https://appleid.apple.com', sub: config.appleSigninClientId };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('sha256', Buffer.from(input), crypto.createPrivateKey(config.appleSigninPrivateKey)).toString('base64url');
  return `${input}.${signature}`;
}

function upsertUser(provider, claims, rawUser = null) {
  ensureAuthState();
  const subject = String(claims.sub || '');
  const email = cleanEmail(claims.email || rawUser?.email || '');
  const providerKey = `${provider}:${subject}`;
  let user = state.authUsers.find(item => item.providers?.[provider]?.sub === subject) || (email ? state.authUsers.find(item => item.email === email) : null);
  if (!user) {
    user = { id: `user_${now().toString(36)}_${token(5)}`, email, name: '', picture: '', role: state.authUsers.length ? 'creator' : 'owner', providers: {}, createdAt: now() };
    state.authUsers.push(user);
  }
  const appleName = rawUser?.name ? [rawUser.name.firstName, rawUser.name.lastName].filter(Boolean).join(' ') : '';
  user.email = user.email || email;
  user.name = claims.name || appleName || user.name || email || 'Creator';
  user.picture = claims.picture || user.picture || '';
  user.providers = { ...(user.providers || {}), [provider]: { sub: subject, email, linkedAt: now(), providerKey } };
  user.updatedAt = now();
  save();
  return user;
}

export async function completeGoogle(req, code, stateId) {
  const record = consumeOAuthState(stateId, 'google');
  const tokens = await tokenRequest(GOOGLE_TOKEN_URL, {
    code, client_id: config.googleSigninClientId, client_secret: config.googleSigninClientSecret,
    redirect_uri: callbackUrl(req, 'google'), grant_type: 'authorization_code',
  });
  const claims = await verifyIdentityToken('google', tokens.id_token, { audience: config.googleSigninClientId, nonce: record.nonce });
  const user = upsertUser('google', claims);
  log(`Signed in ${user.email || user.name} with Google.`);
  return { user, returnTo: record.returnTo };
}

export async function completeApple(req, body) {
  const record = consumeOAuthState(body.state, 'apple');
  const tokens = await tokenRequest(APPLE_TOKEN_URL, {
    code: body.code, client_id: config.appleSigninClientId, client_secret: appleClientSecret(),
    redirect_uri: callbackUrl(req, 'apple'), grant_type: 'authorization_code',
  });
  const idToken = tokens.id_token || body.id_token;
  const claims = await verifyIdentityToken('apple', idToken, { audience: config.appleSigninClientId, nonce: record.nonce });
  let rawUser = null;
  try { rawUser = body.user ? JSON.parse(body.user) : null; } catch { rawUser = null; }
  const user = upsertUser('apple', claims, rawUser);
  log(`Signed in ${user.email || user.name} with Apple.`);
  return { user, returnTo: record.returnTo };
}

export function canAccess(user, record) {
  if (!record) return false;
  if (!enabled()) return true;
  if (!user) return false;
  if (user.role === 'owner' && !record.ownerId) return true;
  return record.ownerId === user.id || user.role === 'owner';
}

export function loginPage({ error = '', returnTo = '/', info = '' } = {}) {
  const providers = publicConfig();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const googleDisabled = providers.google ? '' : 'disabled aria-disabled="true"';
  const appleDisabled = providers.apple ? '' : 'disabled aria-disabled="true"';
  const passwordBlock = providers.password ? `
    <form method="post" action="/auth/password" class="dc-auth-form">
      <input type="hidden" name="returnTo" value="${esc(returnTo)}">
      <label>Admin password</label>
      <input name="password" type="password" autocomplete="current-password" placeholder="Enter secure admin password" required>
      <button class="dc-auth-primary" type="submit">Continue to dashboard</button>
    </form>` : `<div class="dc-auth-note">Password login is disabled. Configure Google or Apple sign-in in Render.</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Sign in · DeenClipped</title><style>
  :root{color-scheme:dark;--bg:#08080a;--panel:#111114;--panel2:#19191d;--line:#2c2c33;--text:#f8f7f4;--muted:#a5a3aa;--gold:#d9b478;--gold2:#f0d29e;--green:#53c78b;--blue:#55b7ff;--red:#ef6b7a}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 5%,rgba(217,180,120,.18),transparent 30%),radial-gradient(circle at 78% 16%,rgba(85,183,255,.10),transparent 34%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);display:grid;place-items:center;padding:24px}.dc-auth-shell{width:min(1100px,100%);display:grid;grid-template-columns:1.08fr .92fr;gap:22px;align-items:stretch}.dc-auth-hero,.dc-auth-card{border:1px solid rgba(255,255,255,.09);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));border-radius:28px;box-shadow:0 24px 80px rgba(0,0,0,.32)}.dc-auth-hero{padding:34px;min-height:620px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;position:relative}.dc-auth-hero:before{content:'';position:absolute;inset:-1px;background:radial-gradient(circle at 78% 18%,rgba(217,180,120,.17),transparent 30%),radial-gradient(circle at 35% 88%,rgba(85,183,255,.10),transparent 28%);pointer-events:none}.dc-auth-hero:after{content:'';position:absolute;right:-118px;bottom:-96px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(217,180,120,.16),transparent 66%)}.dc-hero-top,.dc-preview,.dc-feature-rows,.dc-trust-pills{position:relative;z-index:1}.dc-logo{width:54px;height:54px;border-radius:17px;display:grid;place-items:center;border:1px solid rgba(217,180,120,.28);background:rgba(217,180,120,.1);color:var(--gold);font-weight:900;box-shadow:0 14px 40px rgba(217,180,120,.08)}.dc-auth-hero h1{font-size:52px;line-height:.96;letter-spacing:-.06em;margin:26px 0 12px}.dc-auth-hero p{max-width:530px;color:var(--muted);font-size:15px;line-height:1.7}.dc-preview{height:238px;margin:12px 0 20px;display:grid;place-items:center}.dc-product-stage{position:relative;width:100%;height:100%;border:1px solid rgba(255,255,255,.075);border-radius:24px;background:linear-gradient(135deg,rgba(217,180,120,.08),rgba(255,255,255,.025) 45%,rgba(85,183,255,.055));overflow:hidden}.dc-product-stage:before{content:'';position:absolute;inset:18px;border-radius:18px;border:1px solid rgba(255,255,255,.055)}.dc-phone{position:absolute;bottom:18px;width:116px;aspect-ratio:9/16;border-radius:24px;background:#f7f7f4;box-shadow:0 22px 55px rgba(0,0,0,.48);overflow:hidden;border:1px solid rgba(255,255,255,.55);transform-origin:bottom center}.dc-phone.main{left:50%;transform:translateX(-50%) rotate(-1.5deg);z-index:3}.dc-phone.left{left:24%;transform:rotate(-9deg) scale(.82);opacity:.78;z-index:2}.dc-phone.right{right:20%;transform:rotate(8deg) scale(.88);opacity:.86;z-index:2}.dc-phone:before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,#fff 0 52%,#153c32 52% 78%,#121214 78%)}.dc-phone:after{content:'Trust Allah, take the means';position:absolute;left:11px;right:11px;top:50%;transform:translateY(-50%);font-size:9px;line-height:1.05;text-align:center;font-weight:900;color:#fff;-webkit-text-stroke:.55px #111;text-shadow:0 2px 8px rgba(0,0,0,.45)}.dc-phone .cap{position:absolute;left:10px;right:10px;bottom:28px;height:32px;border-radius:7px;background:rgba(0,0,0,.44)}.dc-phone .wm{position:absolute;left:50%;bottom:15px;transform:translateX(-50%);font-size:5px;letter-spacing:.12em;color:#d9b478;font-weight:900}.dc-product-label{position:absolute;left:18px;top:18px;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px}.dc-product-label i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(83,199,139,.08)}.dc-product-chip{position:absolute;right:18px;top:18px;padding:7px 10px;border-radius:999px;background:rgba(217,180,120,.10);border:1px solid rgba(217,180,120,.22);color:var(--gold2);font-size:11px;font-weight:700}.dc-feature-rows{display:grid;gap:9px}.dc-feature-row{display:flex;align-items:center;gap:12px;padding:12px 13px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.034);border-radius:16px}.dc-feature-icon{width:34px;height:34px;flex:0 0 34px;display:grid;place-items:center;border-radius:12px;background:rgba(217,180,120,.11);color:var(--gold2);font-weight:900}.dc-feature-copy b,.dc-feature-copy span{display:block}.dc-feature-copy b{font-size:13px}.dc-feature-copy span{color:var(--muted);font-size:11px;margin-top:3px}.dc-trust-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.dc-trust-pills span{min-height:28px;display:inline-flex;align-items:center;padding:0 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);color:var(--muted);font-size:11px}.dc-auth-card{padding:30px;background:rgba(13,13,16,.78);backdrop-filter:blur(16px)}.dc-auth-card h2{font-size:28px;letter-spacing:-.04em;margin:0 0 7px}.dc-auth-card>p{margin:0 0 20px;color:var(--muted);line-height:1.55}.dc-auth-oauth{display:grid;gap:10px}.dc-oauth-btn,.dc-auth-primary{height:50px;border:0;border-radius:999px;font-size:14px;font-weight:750;cursor:pointer}.dc-oauth-btn{display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#111}.dc-oauth-btn.apple{background:#050507;color:#fff;border:1px solid #333}.dc-oauth-btn:disabled{opacity:.45;cursor:not-allowed}.dc-auth-divider{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:12px;margin:20px 0}.dc-auth-divider:before,.dc-auth-divider:after{content:'';height:1px;background:var(--line);flex:1}.dc-auth-form{display:grid;gap:10px}.dc-auth-form label{font-size:12px;color:var(--muted)}.dc-auth-form input{height:48px;border:1px solid var(--line);background:#08080a;color:var(--text);border-radius:14px;padding:0 14px;font-size:16px}.dc-auth-primary{background:linear-gradient(135deg,var(--gold),var(--gold2));color:#1a1207}.dc-alert{padding:12px 14px;border-radius:14px;margin-bottom:14px;font-size:13px;line-height:1.45}.dc-alert.bad{background:rgba(239,107,122,.1);border:1px solid rgba(239,107,122,.24);color:#ffb7bf}.dc-alert.good{background:rgba(83,199,139,.1);border:1px solid rgba(83,199,139,.24);color:#b7ffd3}.dc-auth-note{border:1px dashed var(--line);border-radius:14px;padding:14px;color:var(--muted);font-size:13px;line-height:1.55}.dc-foot{margin-top:18px;color:var(--muted);font-size:11px;line-height:1.55}.dc-foot code{color:var(--gold2)}@media(max-width:920px){body{padding:14px}.dc-auth-shell{grid-template-columns:1fr}.dc-auth-hero{min-height:auto}.dc-auth-hero h1{font-size:38px}.dc-preview{height:210px}.dc-phone.left{left:16%}.dc-phone.right{right:12%}}@media(max-width:560px){.dc-auth-hero,.dc-auth-card{padding:22px;border-radius:22px}.dc-preview{height:180px}.dc-phone{width:90px;border-radius:19px}.dc-phone.left{left:9%}.dc-phone.right{right:6%}.dc-feature-row{padding:10px}.dc-trust-pills span{font-size:10px}}
  </style></head><body><main class="dc-auth-shell"><section class="dc-auth-hero"><div class="dc-hero-top"><div class="dc-logo">DC</div><h1>DeenClipped Studio</h1><p>Secure creator access for importing lectures, reviewing AI clips, editing templates and publishing approved shorts to connected platforms.</p></div><div class="dc-preview"><div class="dc-product-stage" aria-label="DeenClipped vertical clip preview"><div class="dc-product-label"><i></i><span>AI clip workspace</span></div><div class="dc-product-chip">Ready to publish</div><div class="dc-phone left"><span class="cap"></span><span class="wm">@DEENCLIPPED</span></div><div class="dc-phone main"><span class="cap"></span><span class="wm">@DEENCLIPPED</span></div><div class="dc-phone right"><span class="cap"></span><span class="wm">@DEENCLIPPED</span></div></div></div><div class="dc-feature-rows"><div class="dc-feature-row"><div class="dc-feature-icon">1</div><div class="dc-feature-copy"><b>Import lectures</b><span>Paste a YouTube link or upload a lecture directly.</span></div></div><div class="dc-feature-row"><div class="dc-feature-icon">2</div><div class="dc-feature-copy"><b>Review the best moments</b><span>Approve clips with AI scoring, hooks and title suggestions.</span></div></div><div class="dc-feature-row"><div class="dc-feature-icon">3</div><div class="dc-feature-copy"><b>Publish safely</b><span>Each creator keeps their own projects, templates and platform accounts.</span></div></div></div><div class="dc-trust-pills"><span>Private dashboard</span><span>Per-user projects</span><span>Google & Apple sign-in</span></div></section><section class="dc-auth-card"><h2>Sign in</h2><p>Use an official account to access your private dashboard.</p>${error ? `<div class="dc-alert bad">${esc(error)}</div>` : ''}${info ? `<div class="dc-alert good">${esc(info)}</div>` : ''}<div class="dc-auth-oauth"><button class="dc-oauth-btn" ${googleDisabled} onclick="location.href='/auth/google/start?returnTo=${encodeURIComponent(safeReturn(returnTo))}'">● Continue with Google</button><button class="dc-oauth-btn apple" ${appleDisabled} onclick="location.href='/auth/apple/start?returnTo=${encodeURIComponent(safeReturn(returnTo))}'"> Continue with Apple</button></div><div class="dc-auth-divider">or</div>${passwordBlock}<div class="dc-foot">Before going public, set <code>AUTH_REQUIRED=true</code>, <code>APP_SESSION_SECRET</code>, and your provider credentials in Render.</div></section></main></body></html>`;
}
