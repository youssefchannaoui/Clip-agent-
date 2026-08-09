import crypto from 'node:crypto';
import { config } from './config.js';
import { state, save, log } from './store.js';
import { canAccess as ownsRecord } from './tenancy.js';

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

/*
 * Ownership migration used to live here and wrote a second `ownerId` field.
 * There is now one canonical field, `userId`, migrated once on boot in
 * store.js. Two names for one concept is how scoping bugs get written.
 */

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
    registration: Boolean(config.emailRegistrationEnabled),
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

export function sessionUser(req) {
  ensureAuthState();
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

export function currentUser(req) {
  const signedInUser = sessionUser(req);
  if (signedInUser) return signedInUser;
  return enabled() ? null : ownerUser();
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
    if (!config.emailRegistrationEnabled) throw new Error('No account exists for that email. Use Google sign-in or contact support.');
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

/**
 * Access decisions defer to tenancy.js so there is exactly one rule.
 *
 * The old version returned true for everybody whenever authentication was
 * switched off, which would have leaked every account's data to any visitor if
 * AUTH_REQUIRED were ever unset in production.
 */
export function canAccess(user, record) {
  return ownsRecord(record, user);
}


function shortText(value, max = 46) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

export function loginPage({ error = '', returnTo = '/', info = '' } = {}) {
  const providers = publicConfig();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const googleDisabled = providers.google ? '' : 'disabled aria-disabled="true"';
  const appleDisabled = providers.apple ? '' : 'disabled aria-disabled="true"';
  const passwordBlock = providers.password ? `
    <form method="post" action="/auth/password" class="dc-auth-form">
      <input type="hidden" name="returnTo" value="${esc(returnTo)}">
      <label for="admin-password">Admin password</label>
      <input id="admin-password" name="password" type="password" autocomplete="current-password" placeholder="Enter secure admin password" required>
      <button class="dc-auth-primary compact" type="submit">Continue to dashboard</button>
    </form>` : `<div class="dc-auth-note">Password fallback is disabled. Use your creator account above.</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Sign in · DeenClipped</title><style>
  :root{color-scheme:dark;--bg:#070708;--panel:#101013;--panel2:#151519;--text:#f7f4ef;--muted:#aaa59e;--muted2:#76726d;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.16);--gold:#d9b66f;--gold2:#f1d18e;--green:#70d1a0;--red:#ef6b7a;--shadow:0 32px 100px rgba(0,0,0,.5)}*{box-sizing:border-box}html{min-width:320px}body{margin:0;min-height:100vh;background:radial-gradient(circle at 27% 4%,rgba(217,182,111,.10),transparent 29%),radial-gradient(circle at 77% 54%,rgba(66,108,104,.08),transparent 28%),var(--bg);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);-webkit-font-smoothing:antialiased}body:before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.18;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:58px 58px;mask-image:linear-gradient(to bottom,black,transparent 82%)}a{color:inherit}.dc-auth-nav{position:relative;z-index:3;height:76px;border-bottom:1px solid rgba(255,255,255,.065);background:rgba(7,7,8,.82);backdrop-filter:blur(24px)}.dc-auth-nav-inner{width:min(calc(100% - 56px),1340px);height:100%;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:24px}.dc-brand{display:inline-flex;align-items:center;gap:11px;text-decoration:none}.dc-brand-mark{width:38px;height:38px;display:grid;place-items:center;color:var(--gold2);border:1px solid rgba(217,182,111,.32);border-radius:12px;background:linear-gradient(145deg,rgba(217,182,111,.18),rgba(217,182,111,.045));box-shadow:0 12px 35px rgba(0,0,0,.3),inset 0 0 0 1px rgba(255,255,255,.025)}.dc-brand-mark svg{width:24px;height:24px;stroke:currentColor;stroke-width:1.8}.dc-brand-copy strong,.dc-brand-copy small{display:block;white-space:nowrap}.dc-brand-copy strong{font-size:15px;letter-spacing:-.02em}.dc-brand-copy small{margin-top:2px;color:var(--muted2);font-size:9px;letter-spacing:.035em}.dc-back-link{min-height:42px;display:inline-flex;align-items:center;gap:8px;padding:0 14px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.025);color:#c8c3bc;text-decoration:none;font-size:12px;font-weight:750;transition:.18s ease}.dc-back-link:hover{background:rgba(255,255,255,.06);border-color:var(--line2);color:#fff}.dc-back-link svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}.dc-auth-shell{position:relative;z-index:1;width:min(calc(100% - 56px),1340px);min-height:calc(100vh - 76px);margin:auto;padding:34px 0 38px;display:grid;grid-template-columns:minmax(0,1.14fr) minmax(400px,.86fr);gap:58px;align-items:center}.dc-auth-story{min-width:0}.dc-eyebrow{display:inline-flex;align-items:center;gap:9px;color:var(--gold2);font-size:10px;font-weight:850;letter-spacing:.15em;text-transform:uppercase}.dc-eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(112,209,160,.09)}.dc-auth-story h1{max-width:760px;margin:17px 0 15px;font-size:clamp(46px,5vw,68px);line-height:.98;letter-spacing:-.066em;font-weight:850}.dc-auth-story h1 span{background:linear-gradient(90deg,#fff 4%,var(--gold2) 58%,#fff 96%);-webkit-background-clip:text;background-clip:text;color:transparent}.dc-story-copy{max-width:690px;margin:0;color:#b6b1aa;font-size:16px;line-height:1.64}.dc-capabilities{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-top:19px;color:#9d9891}.dc-capabilities span{display:inline-flex;align-items:center;gap:7px;font-size:11px;white-space:nowrap}.dc-capabilities b{width:20px;height:20px;display:grid;place-items:center;border-radius:7px;background:rgba(217,182,111,.09);color:var(--gold2);font-size:9px}.dc-capabilities i{width:3px;height:3px;border-radius:50%;background:#4e4b47}.dc-product-stage{position:relative;max-width:760px;height:280px;margin-top:28px;padding:7px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:linear-gradient(145deg,#131316,#09090b);box-shadow:var(--shadow)}.dc-product-stage:before{content:'';position:absolute;z-index:-1;inset:-15% 2% -12%;border-radius:50%;background:radial-gradient(circle,rgba(217,182,111,.18),rgba(65,119,126,.06) 43%,transparent 72%);filter:blur(24px)}.dc-product-stage>img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center;border-radius:17px;border:1px solid rgba(255,255,255,.055);background:#070708}.dc-reel{position:absolute;z-index:3;width:80px;padding:4px;border:1px solid rgba(255,255,255,.15);border-radius:17px;background:#111114;box-shadow:0 22px 60px rgba(0,0,0,.58)}.dc-reel img{display:block;width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:12px}.dc-reel.one{left:-27px;bottom:-20px;transform:rotate(-7deg)}.dc-reel.two{right:-25px;top:-17px;transform:rotate(7deg)}.dc-status{position:absolute;z-index:4;display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid rgba(255,255,255,.13);border-radius:13px;background:rgba(15,15,18,.91);backdrop-filter:blur(16px);box-shadow:0 18px 48px rgba(0,0,0,.48)}.dc-status strong,.dc-status small{display:block}.dc-status strong{font-size:9px}.dc-status small{margin-top:2px;color:var(--muted2);font-size:7px}.dc-status-icon{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:rgba(217,182,111,.11);color:var(--gold2);font-size:11px}.dc-status.found{left:62px;top:-13px}.dc-status.ready{right:45px;bottom:-16px}.dc-auth-card{width:100%;max-width:490px;justify-self:end;padding:31px;border:1px solid rgba(255,255,255,.105);border-radius:26px;background:linear-gradient(155deg,rgba(20,20,23,.97),rgba(10,10,12,.95));box-shadow:0 32px 100px rgba(0,0,0,.45),inset 0 0 0 1px rgba(217,182,111,.025);backdrop-filter:blur(20px)}.dc-card-kicker{display:flex;align-items:center;gap:10px;margin-bottom:17px}.dc-lock{width:36px;height:36px;display:grid;place-items:center;border:1px solid rgba(217,182,111,.22);border-radius:12px;background:rgba(217,182,111,.08);color:var(--gold2)}.dc-lock svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8}.dc-card-kicker strong,.dc-card-kicker span{display:block}.dc-card-kicker strong{font-size:12px}.dc-card-kicker span{margin-top:2px;color:var(--muted2);font-size:9px}.dc-auth-card h2{margin:0;font-size:34px;line-height:1.02;letter-spacing:-.05em}.dc-auth-card>p{margin:8px 0 19px;color:var(--muted);font-size:13px;line-height:1.55}.dc-alert{padding:11px 13px;border-radius:13px;margin-bottom:13px;font-size:12px;line-height:1.45}.dc-alert.bad{background:rgba(239,107,122,.1);border:1px solid rgba(239,107,122,.24);color:#ffb7bf}.dc-alert.good{background:rgba(112,209,160,.1);border:1px solid rgba(112,209,160,.24);color:#c5ffdd}.dc-auth-form{display:grid;gap:8px}.dc-auth-form label{font-size:10px;font-weight:700;color:#bdb8b1}.dc-auth-form input{height:48px;border:1px solid var(--line);outline:0;background:#09090b;color:var(--text);border-radius:13px;padding:0 14px;font-size:15px;transition:border-color .18s ease,box-shadow .18s ease}.dc-auth-form input::placeholder{color:#65615c}.dc-auth-form input:focus{border-color:rgba(217,182,111,.5);box-shadow:0 0 0 3px rgba(217,182,111,.08)}.dc-email-form{padding:14px;border:1px solid rgba(217,182,111,.14);border-radius:18px;background:rgba(217,182,111,.035)}.dc-auth-primary,.dc-oauth-btn{height:48px;border-radius:13px;font:inherit;font-size:12px;font-weight:850;cursor:pointer}.dc-auth-primary{margin-top:2px;border:0;background:linear-gradient(180deg,var(--gold2),var(--gold));color:#171109;box-shadow:0 13px 30px rgba(217,182,111,.13)}.dc-auth-primary:hover{background:#f4d99f}.dc-auth-primary.compact{height:43px}.dc-email-hint{color:var(--muted2);font-size:9px;line-height:1.45}.dc-auth-divider{display:flex;align-items:center;gap:11px;color:var(--muted2);font-size:9px;margin:15px 0}.dc-auth-divider:before,.dc-auth-divider:after{content:'';height:1px;background:var(--line);flex:1}.dc-auth-oauth{display:grid;grid-template-columns:1fr 1fr;gap:9px}.dc-oauth-btn{display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line2);background:#f6f4ef;color:#111}.dc-oauth-btn.apple{background:#09090b;color:#fff;border-color:var(--line2)}.dc-oauth-btn b{width:18px;height:18px;display:grid;place-items:center;border-radius:50%;background:#171717;color:#fff;font-size:10px}.dc-oauth-btn:disabled{opacity:.36;cursor:not-allowed;filter:saturate(.25)}.dc-admin-login{margin-top:12px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.018);padding:0 13px}.dc-admin-login summary{min-height:39px;display:flex;align-items:center;cursor:pointer;color:var(--muted);font-size:10px}.dc-admin-login .dc-auth-form{padding:0 0 13px}.dc-auth-note{border:1px dashed var(--line);border-radius:12px;padding:12px;color:var(--muted);font-size:10px;line-height:1.5}.dc-foot{display:flex;align-items:flex-start;gap:7px;margin-top:14px;color:var(--muted2);font-size:9px;line-height:1.5}.dc-foot svg{width:12px;height:12px;flex:none;margin-top:1px;fill:none;stroke:var(--green);stroke-width:2}@media(max-width:1040px){.dc-auth-shell{grid-template-columns:minmax(0,1fr) minmax(380px,.84fr);gap:35px}.dc-auth-story h1{font-size:52px}.dc-product-stage{height:245px}.dc-status.found{left:36px}.dc-status.ready{right:28px}}@media(max-width:820px){.dc-auth-nav-inner,.dc-auth-shell{width:min(calc(100% - 32px),680px)}.dc-auth-shell{min-height:auto;padding:28px 0 50px;grid-template-columns:1fr;gap:38px}.dc-auth-card{order:1;max-width:none;justify-self:stretch}.dc-auth-story{order:2}.dc-auth-story h1{font-size:48px;max-width:650px}.dc-product-stage{max-width:none;height:300px}}@media(max-width:540px){.dc-auth-nav{height:68px}.dc-auth-nav-inner{width:calc(100% - 28px)}.dc-brand-mark{width:34px;height:34px}.dc-brand-copy small{display:none}.dc-back-link{min-height:38px;padding:0 11px;font-size:10px}.dc-auth-shell{width:calc(100% - 28px);padding:18px 0 42px;gap:36px}.dc-auth-card{padding:23px;border-radius:21px}.dc-auth-card h2{font-size:30px}.dc-auth-oauth{grid-template-columns:1fr}.dc-auth-story h1{font-size:41px}.dc-story-copy{font-size:14px}.dc-capabilities i{display:none}.dc-capabilities{gap:8px}.dc-product-stage{height:226px;margin-top:24px;border-radius:19px}.dc-product-stage>img{border-radius:13px}.dc-reel{width:62px}.dc-reel.one{left:-9px;bottom:-15px}.dc-reel.two{right:-8px;top:-13px}.dc-status.found{left:18px}.dc-status.ready{right:12px}.dc-status{padding:7px 8px}.dc-status-icon{width:24px;height:24px}.dc-status small{display:none}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style></head><body><header class="dc-auth-nav"><div class="dc-auth-nav-inner"><a class="dc-brand" href="/" aria-label="DeenClipped home"><span class="dc-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="4" y="4" width="24" height="24" rx="8"/><path d="M13 11.5 21 16l-8 4.5Z" fill="currentColor" stroke="none"/><path d="M9.5 7.5h13" opacity=".45"/></svg></span><span class="dc-brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a><a class="dc-back-link" href="/"><svg viewBox="0 0 24 24"><path d="m9 18-6-6 6-6M3 12h18"/></svg>Back to website</a></div></header><main class="dc-auth-shell"><section class="dc-auth-story"><span class="dc-eyebrow"><i></i>Built for lecture-to-short workflows</span><h1>Turn long lectures into <span>powerful short clips.</span></h1><p class="dc-story-copy">Find strong moments, create vertical clips, add captions, refine every detail and publish from one focused creator workspace.</p><div class="dc-capabilities"><span><b>1</b>Import</span><i></i><span><b>2</b>AI clip discovery</span><i></i><span><b>3</b>Edit & publish</span></div><div class="dc-product-stage" aria-label="DeenClipped creator dashboard preview"><img src="/marketing-assets/hero-premium.webp" alt="DeenClipped creator dashboard showing lecture-to-clip workflow"><figure class="dc-reel one"><img src="/marketing-assets/reel-beneficial.webp" alt="Vertical reminder clip preview"></figure><figure class="dc-reel two"><img src="/marketing-assets/reel-dua.webp" alt="Vertical dua clip preview"></figure><div class="dc-status found"><span class="dc-status-icon">✦</span><span><strong>Strong moments found</strong><small>AI-scored and ready to review</small></span></div><div class="dc-status ready"><span class="dc-status-icon">✓</span><span><strong>One connected workflow</strong><small>Captions, editor and publishing</small></span></div></div></section><section class="dc-auth-card"><div class="dc-card-kicker"><span class="dc-lock"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><span><strong>Creator access</strong><span>Your private DeenClipped workspace</span></span></div><h2>Welcome back.</h2><p>Sign in or create an account to start turning lectures into clips.</p>${error ? `<div class="dc-alert bad">${esc(error)}</div>` : ''}${info ? `<div class="dc-alert good">${esc(info)}</div>` : ''}<form method="post" action="/auth/email" class="dc-auth-form dc-email-form"><input type="hidden" name="returnTo" value="${esc(returnTo)}"><label for="creator-email">Email address</label><input id="creator-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><label for="creator-password">Password</label><input id="creator-password" name="password" type="password" autocomplete="current-password" placeholder="Create or enter your password" minlength="8" required><button class="dc-auth-primary" type="submit">Continue with email</button><span class="dc-email-hint">New to DeenClipped? Your account is created securely when you continue.</span></form><div class="dc-auth-divider">or continue with</div><div class="dc-auth-oauth"><button class="dc-oauth-btn" type="button" ${googleDisabled} onclick="location.href='/auth/google/start?returnTo=${encodeURIComponent(safeReturn(returnTo))}'"><b>G</b> Google</button><button class="dc-oauth-btn apple" type="button" ${appleDisabled} onclick="location.href='/auth/apple/start?returnTo=${encodeURIComponent(safeReturn(returnTo))}'"> Apple</button></div><details class="dc-admin-login"><summary>Admin password fallback</summary>${passwordBlock}</details><div class="dc-foot"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7"/></svg><span>Your projects, clips and connected accounts stay private to your workspace.</span></div></section></main></body></html>`;
}
