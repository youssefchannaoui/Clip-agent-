import crypto from 'node:crypto';
import fs from 'node:fs';
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
    email: Boolean(config.emailSigninEnabled),
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


export function emailLogin(email, password, name = '') {
  ensureAuthState();
  if (!config.emailSigninEnabled) throw new Error('Email sign-in is not enabled.');
  const clean = cleanEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email address.');
  const pass = String(password || '');
  if (pass.length < 8) throw new Error('Use at least 8 characters for email sign-in.');
  let user = state.authUsers.find(item => cleanEmail(item.email) === clean);
  if (!user) {
    user = {
      id: `user_${now().toString(36)}_${token(5)}`,
      email: clean,
      name: String(name || '').trim() || clean.split('@')[0] || 'Creator',
      picture: '',
      role: state.authUsers.length ? 'creator' : 'owner',
      providers: {},
      createdAt: now(),
      updatedAt: now(),
    };
    user.passwordHash = hashPassword(pass);
    state.authUsers.push(user);
  } else {
    if (!user.passwordHash) throw new Error('This email is already connected with Google or Apple. Use that sign-in method.');
    if (!verifyPassword(pass, user.passwordHash)) throw new Error('Email or password is wrong.');
  }
  user.providers = { ...(user.providers || {}), email: { email: clean, linkedAt: user.providers?.email?.linkedAt || now(), providerKey: `email:${clean}` } };
  user.updatedAt = now();
  save();
  log(`Signed in ${user.email || user.id} with email.`);
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


function shortText(value, max = 46) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function fileToDataUrl(file) {
  const path = String(file || '');
  if (!path || !fs.existsSync(path)) return '';
  try {
    const stat = fs.statSync(path);
    if (!stat.isFile() || stat.size > 650_000) return '';
    const lower = path.toLowerCase();
    const mime = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(path).toString('base64')}`;
  } catch {
    return '';
  }
}

function loginPreviewClips() {
  ensureAuthState();
  const clips = Array.isArray(state.clips) ? state.clips : [];
  const preferred = new Set(['posted', 'scheduled', 'approved', 'ready', 'waiting']);
  return clips
    .filter(clip => clip && clip.thumbFile && fs.existsSync(String(clip.thumbFile)) && preferred.has(String(clip.status || '').toLowerCase()))
    .sort((a, b) => {
      const statusScore = clip => (String(clip.status || '').toLowerCase() === 'posted' ? 5 : String(clip.status || '').toLowerCase() === 'scheduled' ? 4 : String(clip.status || '').toLowerCase() === 'approved' ? 3 : 1);
      return statusScore(b) - statusScore(a) || Number(b.score || 0) - Number(a.score || 0) || Number(b.addedAt || b.readyAt || 0) - Number(a.addedAt || a.readyAt || 0);
    })
    .slice(0, 3)
    .map(clip => ({
      title: shortText(clip.title || 'Clean lecture clip', 38),
      score: Math.round(Number(clip.score || clip.quality || 0)) || 96,
      status: String(clip.status || 'ready'),
      image: fileToDataUrl(clip.thumbFile),
    }))
    .filter(clip => clip.image);
}

export function loginPage({ error = '', returnTo = '/', info = '' } = {}) {
  const providers = publicConfig();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const googleDisabled = providers.google ? '' : 'disabled aria-disabled="true"';
  const appleDisabled = providers.apple ? '' : 'disabled aria-disabled="true"';
  const previews = loginPreviewClips();
  const fallbackTitles = ['Clean reminder clip', 'Hook detected', 'Ready to publish'];
  const phoneMarkup = [0, 1, 2].map(index => {
    const clip = previews[index];
    const cls = index === 0 ? 'left' : index === 1 ? 'main' : 'right';
    const caption = clip?.title || fallbackTitles[index];
    const score = clip?.score || [96, 99, 97][index];
    const image = clip?.image ? `<img src="${clip.image}" alt="${esc(caption)} thumbnail">` : '';
    return `<div class="dc-phone ${cls} ${image ? 'has-thumb' : ''}">${image}<span class="phone-shade"></span><span class="phone-score">${score}</span><span class="phone-caption">${esc(caption)}</span><span class="wm">@DEENCLIPPED</span></div>`;
  }).join('');
  const passwordBlock = providers.password ? `
    <form method="post" action="/auth/password" class="dc-auth-form">
      <input type="hidden" name="returnTo" value="${esc(returnTo)}">
      <label>Admin password</label>
      <input name="password" type="password" autocomplete="current-password" placeholder="Enter secure admin password" required>
      <button class="dc-auth-primary" type="submit">Continue to dashboard</button>
    </form>` : `<div class="dc-auth-note">Password login is disabled. Configure Google or Apple sign-in in Render.</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Sign in · DeenClipped</title><style>
  :root{color-scheme:dark;--bg:#08080a;--panel:#111114;--panel2:#19191d;--line:#2c2c33;--text:#f8f7f4;--muted:#a5a3aa;--gold:#d9b478;--gold2:#f0d29e;--green:#53c78b;--blue:#55b7ff;--red:#ef6b7a}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 5%,rgba(217,180,120,.18),transparent 30%),radial-gradient(circle at 78% 16%,rgba(85,183,255,.10),transparent 34%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);display:grid;place-items:center;padding:24px}.dc-auth-shell{width:min(1120px,100%);display:grid;grid-template-columns:1.08fr .92fr;gap:22px;align-items:stretch}.dc-auth-hero,.dc-auth-card{border:1px solid rgba(255,255,255,.09);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));border-radius:28px;box-shadow:0 24px 80px rgba(0,0,0,.32)}.dc-auth-hero{padding:34px;min-height:640px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;position:relative}.dc-auth-hero:before{content:'';position:absolute;inset:-1px;background:radial-gradient(circle at 78% 18%,rgba(217,180,120,.17),transparent 30%),radial-gradient(circle at 35% 88%,rgba(85,183,255,.10),transparent 28%);pointer-events:none}.dc-auth-hero:after{content:'';position:absolute;right:-118px;bottom:-96px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(217,180,120,.16),transparent 66%)}.dc-hero-top,.dc-preview,.dc-feature-rows,.dc-trust-pills{position:relative;z-index:1}.dc-logo{width:54px;height:54px;border-radius:17px;display:grid;place-items:center;border:1px solid rgba(217,180,120,.28);background:rgba(217,180,120,.1);color:var(--gold);font-weight:900;box-shadow:0 14px 40px rgba(217,180,120,.08)}.dc-auth-hero h1{font-size:52px;line-height:.96;letter-spacing:-.06em;margin:26px 0 12px}.dc-auth-hero p{max-width:540px;color:var(--muted);font-size:15px;line-height:1.7}.dc-hero-actions{display:flex;align-items:center;gap:10px;margin-top:18px}.dc-learn-btn{min-height:38px;padding:0 15px;border-radius:999px;border:1px solid rgba(217,180,120,.26);background:rgba(217,180,120,.10);color:var(--gold2);font:inherit;font-size:12px;font-weight:800;cursor:pointer}.dc-learn-btn.secondary{background:rgba(255,255,255,.035);border-color:rgba(255,255,255,.10);color:var(--text)}.dc-learn-btn:hover{border-color:rgba(217,180,120,.48);background:rgba(217,180,120,.16)}.dc-preview{height:250px;margin:18px 0 20px;display:grid;place-items:center}.dc-product-stage{position:relative;width:100%;height:100%;border:1px solid rgba(255,255,255,.075);border-radius:24px;background:linear-gradient(135deg,rgba(217,180,120,.08),rgba(255,255,255,.025) 45%,rgba(85,183,255,.055));overflow:hidden}.dc-product-stage:before{content:'';position:absolute;inset:18px;border-radius:18px;border:1px solid rgba(255,255,255,.055)}.dc-phone{position:absolute;bottom:18px;width:116px;aspect-ratio:9/16;border-radius:24px;background:#f7f7f4;box-shadow:0 22px 55px rgba(0,0,0,.48);overflow:hidden;border:1px solid rgba(255,255,255,.55);transform-origin:bottom center}.dc-phone.main{left:50%;transform:translateX(-50%) rotate(-1.5deg);z-index:3}.dc-phone.left{left:24%;transform:rotate(-9deg) scale(.82);opacity:.82;z-index:2}.dc-phone.right{right:20%;transform:rotate(8deg) scale(.88);opacity:.88;z-index:2}.dc-phone:before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,#fff 0 52%,#153c32 52% 78%,#121214 78%)}.dc-phone.has-thumb:before{display:none}.dc-phone img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.phone-shade{position:absolute;inset:auto 0 0;height:48%;background:linear-gradient(0deg,rgba(0,0,0,.74),transparent)}.phone-caption{position:absolute;left:10px;right:10px;bottom:44px;font-size:8px;line-height:1.05;text-align:center;font-weight:900;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.65);-webkit-text-stroke:.45px #111}.phone-score{position:absolute;left:8px;bottom:28px;min-width:22px;height:20px;padding:0 5px;border-radius:999px;background:#0a0a0dcc;color:#b9ff69;display:grid;place-items:center;font-size:8px;font-weight:900}.dc-phone .wm{position:absolute;left:50%;bottom:15px;transform:translateX(-50%);font-size:5px;letter-spacing:.12em;color:#d9b478;font-weight:900}.dc-product-label{position:absolute;left:18px;top:18px;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px}.dc-product-label i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(83,199,139,.08)}.dc-product-chip{position:absolute;right:18px;top:18px;padding:7px 10px;border-radius:999px;background:rgba(217,180,120,.10);border:1px solid rgba(217,180,120,.22);color:var(--gold2);font-size:11px;font-weight:700}.dc-feature-rows{display:grid;gap:9px}.dc-feature-row{display:flex;align-items:center;gap:12px;padding:12px 13px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.034);border-radius:16px}.dc-feature-icon{width:34px;height:34px;flex:0 0 34px;display:grid;place-items:center;border-radius:12px;background:rgba(217,180,120,.11);color:var(--gold2);font-weight:900}.dc-feature-copy b,.dc-feature-copy span{display:block}.dc-feature-copy b{font-size:13px}.dc-feature-copy span{color:var(--muted);font-size:11px;margin-top:3px}.dc-trust-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.dc-trust-pills span{min-height:28px;display:inline-flex;align-items:center;padding:0 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);color:var(--muted);font-size:11px}.dc-auth-card{padding:30px;background:rgba(13,13,16,.78);backdrop-filter:blur(16px)}.dc-auth-card h2{font-size:28px;letter-spacing:-.04em;margin:0 0 7px}.dc-auth-card>p{margin:0 0 20px;color:var(--muted);line-height:1.55}.dc-auth-oauth{display:grid;gap:10px}.dc-oauth-btn,.dc-auth-primary{height:50px;border:0;border-radius:999px;font-size:14px;font-weight:750;cursor:pointer}.dc-oauth-btn{display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#111}.dc-oauth-btn.apple{background:#050507;color:#fff;border:1px solid #333}.dc-oauth-btn:disabled{opacity:.45;cursor:not-allowed}.dc-auth-divider{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:12px;margin:20px 0}.dc-auth-divider:before,.dc-auth-divider:after{content:'';height:1px;background:var(--line);flex:1}.dc-auth-form{display:grid;gap:10px}.dc-auth-form label{font-size:12px;color:var(--muted)}.dc-auth-form input{height:48px;border:1px solid var(--line);background:#08080a;color:var(--text);border-radius:14px;padding:0 14px;font-size:16px}.dc-auth-primary{background:linear-gradient(135deg,var(--gold),var(--gold2));color:#1a1207}.dc-alert{padding:12px 14px;border-radius:14px;margin-bottom:14px;font-size:13px;line-height:1.45}.dc-alert.bad{background:rgba(239,107,122,.1);border:1px solid rgba(239,107,122,.24);color:#ffb7bf}.dc-alert.good{background:rgba(83,199,139,.1);border:1px solid rgba(83,199,139,.24);color:#b7ffd3}.dc-auth-note{border:1px dashed var(--line);border-radius:14px;padding:14px;color:var(--muted);font-size:13px;line-height:1.55}.dc-email-form{padding:14px;border:1px solid rgba(217,180,120,.16);border-radius:20px;background:rgba(217,180,120,.045);margin-bottom:16px}.dc-email-hint{color:var(--muted);font-size:11px;line-height:1.45}.dc-admin-login{margin-top:16px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.025);padding:0 14px}.dc-admin-login summary{min-height:42px;display:flex;align-items:center;cursor:pointer;color:var(--muted);font-size:12px}.dc-admin-login .dc-auth-form{padding:0 0 14px}.dc-oauth-btn b{width:19px;height:19px;border-radius:50%;display:grid;place-items:center;background:#111;color:#fff;font-size:12px}.dc-foot{margin-top:18px;color:var(--muted);font-size:11px;line-height:1.55}.dc-foot code{color:var(--gold2)}.dc-demo{position:fixed;inset:0;z-index:30;display:none;place-items:center;padding:20px;background:rgba(0,0,0,.72);backdrop-filter:blur(14px)}.dc-demo.show{display:grid}.dc-demo-card{width:min(780px,100%);border:1px solid rgba(255,255,255,.10);border-radius:26px;background:linear-gradient(180deg,#141417,#0c0c0f);box-shadow:0 28px 90px rgba(0,0,0,.58);overflow:hidden}.dc-demo-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:20px 22px;border-bottom:1px solid rgba(255,255,255,.08)}.dc-demo-head strong{font-size:20px}.dc-demo-close{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:#0a0a0c;color:#fff;font-size:20px;cursor:pointer}.dc-demo-body{padding:22px;display:grid;grid-template-columns:1fr 1fr;gap:14px}.dc-demo-step{padding:16px;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(255,255,255,.035)}.dc-demo-step b,.dc-demo-step span{display:block}.dc-demo-step b{font-size:14px}.dc-demo-step span{margin-top:6px;color:var(--muted);font-size:12px;line-height:1.55}.dc-demo-num{width:30px;height:30px;border-radius:11px;background:rgba(217,180,120,.12);color:var(--gold2);display:grid;place-items:center;font-weight:900;margin-bottom:11px}.dc-demo-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;border-top:1px solid rgba(255,255,255,.08);color:var(--muted);font-size:12px}.dc-demo-foot .dc-learn-btn{min-width:150px}@media(max-width:920px){body{padding:14px}.dc-auth-shell{grid-template-columns:1fr}.dc-auth-hero{min-height:auto}.dc-auth-hero h1{font-size:38px}.dc-preview{height:220px}.dc-phone.left{left:16%}.dc-phone.right{right:12%}}@media(max-width:560px){.dc-auth-hero,.dc-auth-card{padding:22px;border-radius:22px}.dc-preview{height:188px}.dc-phone{width:90px;border-radius:19px}.dc-phone.left{left:9%}.dc-phone.right{right:6%}.dc-feature-row{padding:10px}.dc-trust-pills span{font-size:10px}.dc-demo-body{grid-template-columns:1fr}.dc-demo-foot{align-items:stretch;flex-direction:column}.dc-demo-foot .dc-learn-btn{width:100%}}
  </style></head><body><main class="dc-auth-shell"><section class="dc-auth-hero"><div class="dc-hero-top"><div class="dc-logo">DC</div><h1>DeenClipped Studio</h1><p>Secure creator access for importing lectures, reviewing AI clips, editing templates and publishing approved shorts to connected platforms.</p><div class="dc-hero-actions"><button class="dc-learn-btn" type="button" id="dcLearnMore">Learn more</button><button class="dc-learn-btn secondary" type="button" id="dcSeeDemo">See the workflow</button></div></div><div class="dc-preview"><div class="dc-product-stage" aria-label="DeenClipped vertical clip preview"><div class="dc-product-label"><i></i><span>${previews.length ? 'Recent rendered clips' : 'AI clip workspace'}</span></div><div class="dc-product-chip">Ready to publish</div>${phoneMarkup}</div></div><div class="dc-feature-rows"><div class="dc-feature-row"><div class="dc-feature-icon">1</div><div class="dc-feature-copy"><b>Import lectures</b><span>Paste a YouTube link or upload a lecture directly.</span></div></div><div class="dc-feature-row"><div class="dc-feature-icon">2</div><div class="dc-feature-copy"><b>Review the best moments</b><span>Approve clips with AI scoring, hooks and title suggestions.</span></div></div><div class="dc-feature-row"><div class="dc-feature-icon">3</div><div class="dc-feature-copy"><b>Publish safely</b><span>Each creator keeps their own projects, templates and platform accounts.</span></div></div></div><div class="dc-trust-pills"><span>Private dashboard</span><span>Per-user projects</span><span>Email, Google & Apple sign-in</span></div></section><section class="dc-auth-card"><h2>Sign in</h2><p>Choose email, Google or Apple to access your private dashboard.</p>${error ? `<div class="dc-alert bad">${esc(error)}</div>` : ''}${info ? `<div class="dc-alert good">${esc(info)}</div>` : ''}<form method="post" action="/auth/email" class="dc-auth-form dc-email-form"><input type="hidden" name="returnTo" value="${esc(returnTo)}"><label>Email address</label><input name="email" type="email" autocomplete="email" placeholder="you@example.com" required><label>Password</label><input name="password" type="password" autocomplete="current-password" placeholder="Create or enter your password" minlength="8" required><button class="dc-auth-primary" type="submit">Continue with email</button><span class="dc-email-hint">New here? Enter your email and a password to create your creator account.</span></form><div class="dc-auth-divider">or continue with</div><div class="dc-auth-oauth"><button class="dc-oauth-btn" ${googleDisabled} onclick="location.href='/auth/google/start?returnTo=${encodeURIComponent(safeReturn(returnTo))}'"><b>G</b> Continue with Google</button><button class="dc-oauth-btn apple" ${appleDisabled} onclick="location.href='/auth/apple/start?returnTo=${encodeURIComponent(safeReturn(returnTo))}'"> Continue with Apple</button></div><details class="dc-admin-login"><summary>Admin password fallback</summary>${passwordBlock}</details><div class="dc-foot">After sign-in, new creators choose a free trial or token plan before entering the dashboard.</div></section></main><section class="dc-demo" id="dcDemo" aria-hidden="true"><div class="dc-demo-card" role="dialog" aria-modal="true" aria-labelledby="dcDemoTitle"><div class="dc-demo-head"><strong id="dcDemoTitle">How DeenClipped works</strong><button class="dc-demo-close" type="button" id="dcDemoClose" aria-label="Close">×</button></div><div class="dc-demo-body"><div class="dc-demo-step"><div class="dc-demo-num">1</div><b>Import a lecture</b><span>Paste a YouTube link or upload a video. DeenClipped stores it inside your private workspace.</span></div><div class="dc-demo-step"><div class="dc-demo-num">2</div><b>AI finds strong moments</b><span>The worker transcribes the lecture, detects hooks and suggests clips worth reviewing.</span></div><div class="dc-demo-step"><div class="dc-demo-num">3</div><b>Review and polish</b><span>Approve only the best clips, update titles, adjust captions, and keep your Modern Minimal template consistent.</span></div><div class="dc-demo-step"><div class="dc-demo-num">4</div><b>Publish safely</b><span>Connect platforms, schedule clips, and keep each creator’s projects and accounts separated.</span></div></div><div class="dc-demo-foot"><span>Sign in first, then use the Guided Demo button inside the dashboard for the full product tour.</span><button class="dc-learn-btn" type="button" id="dcDemoDone">Got it</button></div></div></section><script>(()=>{const demo=document.getElementById('dcDemo');const open=()=>{demo?.classList.add('show');demo?.setAttribute('aria-hidden','false')};const close=()=>{demo?.classList.remove('show');demo?.setAttribute('aria-hidden','true')};document.getElementById('dcLearnMore')?.addEventListener('click',open);document.getElementById('dcSeeDemo')?.addEventListener('click',open);document.getElementById('dcDemoClose')?.addEventListener('click',close);document.getElementById('dcDemoDone')?.addEventListener('click',close);demo?.addEventListener('click',event=>{if(event.target===demo)close()});document.addEventListener('keydown',event=>{if(event.key==='Escape')close()})})();</script></body></html>`;
}
