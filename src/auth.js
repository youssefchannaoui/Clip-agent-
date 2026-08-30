import crypto from 'node:crypto';
import * as ownerFeed from './owner-feed.js';
import * as mailer from './mailer.js';
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
const SESSIONS_PER_USER = 25;
const OAUTH_STATE_LIMIT = 500;
const cleanEmail = value => String(value || '').trim().toLowerCase();
export const safeReturn = value => {
  const fallback = '/';
  const raw = String(value || fallback).trim() || fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\r\n]/.test(raw)) return fallback;
  if (raw.startsWith('/auth/') || raw.startsWith('/login')) return fallback;
  return raw;
};

function ensureAuthState() {
  if (!Array.isArray(state.authUsers)) state.authUsers = [];
  if (!Array.isArray(state.authSessions)) state.authSessions = [];
  if (!Array.isArray(state.authResets)) state.authResets = [];
  if (!state.authOAuthStates || typeof state.authOAuthStates !== 'object') state.authOAuthStates = {};
  if (!state.authSettings || typeof state.authSettings !== 'object') state.authSettings = { onboardingComplete: false };
  ensureBootstrapUser();
  elevateOperators();
}

/**
 * Accounts in config.operatorEmails become admins, retroactively included.
 *
 * Production disables the admin-password fallback, so the bootstrap owner
 * exists but cannot sign in -- which quietly meant no account that could
 * actually log in held operator access, and every operator page 404'd for
 * everyone forever. Elevation runs here rather than only at sign-up so an
 * account created before its email was listed is fixed by the next deploy,
 * not by deleting and re-creating it.
 *
 * Only ever upward, and never touching 'owner': the bootstrap owner keeps
 * its role, and removing an email from the list is not a demotion -- taking
 * access away is an explicit human decision, not a config diff side effect.
 */
// An email address only counts as an identity when a provider vouched for it.
// Email/password sign-up takes any address unverified, so a listed operator
// address typed into that form must not be enough to become an operator.
const verifiedIdentity = user => Boolean(user?.providers?.google?.sub || user?.providers?.apple?.sub);

function elevateOperators() {
  const listed = new Set((config.operatorEmails || []).map(cleanEmail).filter(Boolean));
  if (!listed.size) return;
  let changed = false;
  for (const user of state.authUsers) {
    if (!verifiedIdentity(user)) continue;
    if (listed.has(cleanEmail(user.email)) && !['owner', 'admin'].includes(String(user.role || '').toLowerCase())) {
      user.role = 'admin';
      user.updatedAt = now();
      changed = true;
    }
  }
  if (changed) save();
}

function ensureBootstrapUser() {
  if (state.authUsers.length) return;
  const email = cleanEmail(config.adminEmail);
  const user = {
    id: 'user_admin', email, name: config.adminName || 'DeenClipped Admin', role: 'owner', picture: '',
    providers: {}, createdAt: now(), updatedAt: now(), lastLoginAt: null,
  };
  if (config.password) user.passwordHash = hashPasswordSync(config.password);
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
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
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
  // Drop expired sessions, and keep only the newest few per account. A global
  // cap would let one account's sign-ins evict everyone else's sessions.
  const perUser = new Map();
  state.authSessions = state.authSessions.filter(item => {
    if (Number(item.expiresAt || 0) <= now()) return false;
    const count = (perUser.get(item.userId) || 0) + 1;
    perUser.set(item.userId, count);
    return count <= SESSIONS_PER_USER;
  });
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

/**
 * Sign out every device this account is signed in on.
 *
 * Sessions last 30 days and 25 may exist at once, so a laptop left on a train
 * stayed signed in for a month with nothing the owner could do about it.
 */
export function destroyAllSessions(user) {
  ensureAuthState();
  if (!user) return 0;
  const before = (state.authSessions || []).length;
  state.authSessions = (state.authSessions || []).filter(item => item.userId !== user.id);
  save();
  const removed = before - state.authSessions.length;
  log(`${user.email || user.id} signed out of ${removed} device(s).`, 'info', user.id);
  return removed;
}

/**
 * Erase an account and everything belonging to it.
 *
 * The Privacy Policy already promises this within 30 days by email -- a
 * promise resting on one person's inbox. Deleting the user row alone would
 * leave the OAuth refresh tokens behind, which is the part that actually
 * matters: those keep working against YouTube and Meta long after the account
 * that authorised them is gone.
 */
export function deleteAccount(user) {
  ensureAuthState();
  if (!user) throw new Error('Sign in to continue.');
  if (String(user.role || '').toLowerCase() === 'owner') {
    throw Object.assign(new Error('The owner account cannot be deleted from here.'), { statusCode: 400 });
  }
  const id = user.id;
  const email = user.email || id;
  const scrub = key => {
    if (!Array.isArray(state[key])) return;
    state[key] = state[key].filter(item => (item?.userId || item?.ownerId) !== id);
  };
  // Everything keyed to the person, including the credentials that outlive
  // them if forgotten.
  ['projects', 'clips', 'tracks', 'backgrounds', 'templates', 'publishJobs',
    'authSessions', 'authVerifications', 'authResets',
    'billingEvents', 'revenueEvents'].forEach(scrub);
  // These two are keyed by user id rather than being arrays of records, so the
  // filter above skips them silently -- and socialConnections is precisely the
  // one that must not be missed.
  if (state.socialConnections && typeof state.socialConnections === 'object') delete state.socialConnections[id];
  if (state.userSettings && typeof state.userSettings === 'object') delete state.userSettings[id];
  state.authUsers = (state.authUsers || []).filter(item => item.id !== id);
  save();
  log(`Account deleted at the owner's request: ${email}. All records, sessions and connected accounts removed.`, 'warn', id);
  return true;
}

// 220,000 was below current guidance for PBKDF2-SHA256. Stored hashes carry
// their own iteration count, so every existing password still verifies at the
// number it was made with and is quietly re-hashed at the new one on the next
// successful sign-in.
const PBKDF2_ITERATIONS = 600_000;

/**
 * Off the event loop.
 *
 * pbkdf2Sync blocked the entire process for the whole derivation -- measured at
 * 26ms here and worse on the production instance -- and it ran BEFORE any
 * authentication, on a route anyone can post to. A few dozen sign-in attempts a
 * second from one laptop stalled the dashboard, clip playback, Stripe webhooks
 * and worker callbacks for every customer at once. The async form runs on the
 * thread pool, so the server keeps answering while it works.
 */
function derive(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), salt, iterations, 32, 'sha256', (error, key) => {
      if (error) reject(error); else resolve(key.toString('base64url'));
    });
  });
}

export async function hashPassword(password) {
  const salt = token(18);
  const derived = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt}$${derived}`;
}

/** First boot only, before the server is answering anything. */
export function hashPasswordSync(password) {
  const salt = token(18);
  const derived = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt}$${derived}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algorithm, iterationsText, salt, expected] = String(stored).split('$');
  if (algorithm !== 'pbkdf2_sha256' || !salt || !expected) return false;
  const derived = await derive(password, salt, Number(iterationsText) || PBKDF2_ITERATIONS);
  const a = Buffer.from(derived), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** True when a stored hash was made with fewer rounds than we now use. */
function needsRehash(stored) {
  const rounds = Number(String(stored || '').split('$')[1] || 0);
  return rounds > 0 && rounds < PBKDF2_ITERATIONS;
}

export async function passwordLogin(password) {
  ensureAuthState();
  const user = ownerUser();
  if (!user || !config.password || !(await verifyPassword(password, user.passwordHash))) throw new Error('Wrong password.');
  return user;
}


const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Address verification.
 *
 * Only meaningful where email can actually be sent: `required()` is false on a
 * deployment with no provider configured, and every account there counts as
 * verified, exactly as before. A provider signing in through Google or Apple
 * is already proof of the address, so those accounts are verified on arrival.
 */
export function verificationRequired() {
  return mailer.configured();
}

export function isVerified(user) {
  if (!user) return false;
  if (!verificationRequired()) return true;
  if (user.emailVerifiedAt) return true;
  // A provider that verified the address counts; a password does not.
  return Object.keys(user.providers || {}).some(key => key === 'google' || key === 'apple');
}

/** A fresh single-use token. Stored as a hash, like sessions. */
export function createVerification(user) {
  ensureAuthState();
  if (!Array.isArray(state.authVerifications)) state.authVerifications = [];
  const raw = token(24);
  state.authVerifications = state.authVerifications
    .filter(item => item.userId !== user.id && Number(item.expiresAt || 0) > now());
  state.authVerifications.push({
    userId: user.id, hash: sha256(raw), createdAt: now(), expiresAt: now() + VERIFY_TTL_MS,
  });
  save();
  return raw;
}

/** Consume a token. Returns the user, or null. Single use by deletion. */
export function consumeVerification(raw) {
  ensureAuthState();
  const hash = sha256(String(raw || ''));
  const found = (state.authVerifications || []).find(item => item.hash === hash && Number(item.expiresAt || 0) > now());
  if (!found) return null;
  state.authVerifications = (state.authVerifications || []).filter(item => item.hash !== hash);
  const user = (state.authUsers || []).find(item => item.id === found.userId);
  if (!user) { save(); return null; }
  user.emailVerifiedAt = now();
  user.updatedAt = now();
  save();
  log(`${user.email || user.id} confirmed their email address.`, 'info', user.id);
  return user;
}

/** Send (or re-send) the confirmation. Never throws at the caller. */
export async function sendVerification(user, baseUrlValue) {
  if (!verificationRequired() || !user?.email || isVerified(user)) return false;
  const raw = createVerification(user);
  const link = `${String(baseUrlValue || config.publicBaseUrl || '').replace(/\/+$/, '')}/auth/verify?token=${encodeURIComponent(raw)}`;
  const message = mailer.verificationMessage(link);
  return mailer.send({ to: user.email, ...message });
}

// An hour, not a day: a reset link is a live key to the account, and the
// person asking for it is by definition sitting at their inbox right now.
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Start a password reset.
 *
 * Always resolves the same way, whether or not the address has an account.
 * Answering "no such user" turns the form into a free tool for discovering who
 * has an account here, and the reset flow is not worth an enumeration oracle.
 */
export async function requestPasswordReset(email, baseUrlValue) {
  ensureAuthState();
  const clean = cleanEmail(email);
  const user = (state.authUsers || []).find(item => cleanEmail(item.email) === clean);
  // A Google or Apple account has no password to reset. Sending a link that
  // sets one would quietly add a second way into an account whose owner chose
  // single sign-on, so those are left alone -- silently, for the same reason.
  if (!user || !user.passwordHash) return { sent: false };
  if (!Array.isArray(state.authResets)) state.authResets = [];
  const raw = token(24);
  state.authResets = state.authResets
    .filter(item => item.userId !== user.id && Number(item.expiresAt || 0) > now());
  state.authResets.push({ userId: user.id, hash: sha256(raw), createdAt: now(), expiresAt: now() + RESET_TTL_MS });
  save();
  const link = `${String(baseUrlValue || config.publicBaseUrl || '').replace(/\/+$/, '')}/reset?token=${encodeURIComponent(raw)}`;
  const message = mailer.passwordResetMessage(link);
  const sent = await mailer.send({ to: user.email, ...message });
  log(`Password reset requested for ${user.email || user.id}.`, 'info', user.id);
  return { sent };
}

/** The user a reset token belongs to, without spending it. */
export function peekPasswordReset(raw) {
  ensureAuthState();
  const hash = sha256(String(raw || ''));
  const found = (state.authResets || []).find(item => item.hash === hash && Number(item.expiresAt || 0) > now());
  if (!found) return null;
  return (state.authUsers || []).find(item => item.id === found.userId) || null;
}

/**
 * Spend a reset token and set the new password.
 *
 * Every other session is destroyed on the way through. Whoever forced the
 * reset -- including someone who already had the old password -- must not keep
 * a live session afterwards, which is the whole point of resetting.
 */
export async function completePasswordReset(raw, password) {
  ensureAuthState();
  const hash = sha256(String(raw || ''));
  const found = (state.authResets || []).find(item => item.hash === hash && Number(item.expiresAt || 0) > now());
  if (!found) throw new Error('That reset link has expired or has already been used. Ask for a new one.');
  const user = (state.authUsers || []).find(item => item.id === found.userId);
  if (!user) throw new Error('That account no longer exists.');
  const clean = String(password || '');
  if (clean.length < 8) throw new Error('Use at least 8 characters.');
  user.passwordHash = await hashPassword(clean);
  user.updatedAt = now();
  // Single use, and any other outstanding link for this account dies with it.
  state.authResets = (state.authResets || []).filter(item => item.userId !== user.id);
  state.authSessions = (state.authSessions || []).filter(item => item.userId !== user.id);
  save();
  log(`Password reset completed for ${user.email || user.id}; all sessions signed out.`, 'info', user.id);
  return user;
}

/** Whether this address already has an account, without creating one. */
export function accountExists(email) {
  ensureAuthState();
  const clean = cleanEmail(email);
  if (!clean) return false;
  return (state.authUsers || []).some(item => cleanEmail(item.email) === clean);
}

export async function emailLogin(email, password, name = '') {
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
    user.passwordHash = await hashPassword(pass);
    state.authUsers.push(user);
    ownerFeed.signedUp(user, 'email').catch(() => {});
  } else {
    if (!user.passwordHash) throw new Error('This email is already connected with Google or Apple. Use that sign-in method.');
    if (!(await verifyPassword(pass, user.passwordHash))) throw new Error('Email or password is wrong.');
    // Correct password, weaker hash than we now make: upgrade it here, where
    // the plaintext is in hand and only this once.
    if (needsRehash(user.passwordHash)) user.passwordHash = await hashPassword(pass);
  }
  user.providers = { ...(user.providers || {}), email: { email: clean, linkedAt: user.providers?.email?.linkedAt || now(), providerKey: `email:${clean}` } };
  user.updatedAt = now();
  save();
  log(`Signed in ${user.email || user.id} with email.`, 'info', user.id);
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
  // Prune here too, not only on callback: a loop of start requests must not
  // grow state.json without bound, and it is rewritten in full on every save.
  const entries = Object.entries(state.authOAuthStates).filter(([, value]) => Number(value.expiresAt || 0) > now());
  entries.sort((a, b) => Number(b[1].createdAt || 0) - Number(a[1].createdAt || 0));
  state.authOAuthStates = Object.fromEntries(entries.slice(0, OAUTH_STATE_LIMIT - 1));
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

export function upsertUser(provider, claims, rawUser = null) {
  ensureAuthState();
  const subject = String(claims.sub || '');
  const email = cleanEmail(claims.email || rawUser?.email || '');
  const providerKey = `${provider}:${subject}`;
  // Google says explicitly when an address is unverified; Apple only issues
  // addresses it has verified. Never attach an unverified address to an account
  // that already exists.
  const emailVerified = !(claims.email_verified === false || claims.email_verified === 'false');
  let user = state.authUsers.find(item => item.providers?.[provider]?.sub === subject)
    || (email && emailVerified ? state.authUsers.find(item => cleanEmail(item.email) === email) : null);
  if (user && !user.providers?.[provider] && user.passwordHash && !verifiedIdentity(user)) {
    // The account was created by typing this address into the password form,
    // which proves nothing. The provider has now proved who owns the address,
    // so the password stops being a way in -- otherwise anyone could register
    // a victim's address first and keep a key to the workspace they sign into.
    delete user.passwordHash;
    if (user.providers?.email) { const { email: _dropped, ...rest } = user.providers; user.providers = rest; }
    // And every session that password already minted. Revoking the credential
    // while leaving its sessions alive revoked nothing: whoever registered the
    // address first kept a working session pointing at this same account for
    // up to thirty days -- the clips, the transcripts, the token balance and
    // the connected publishing accounts -- and if the address happened to be
    // an operator's, elevateOperators handed that session the admin role the
    // moment the real owner signed in. The legitimate session is minted by the
    // caller after this, so the person actually signing in is unaffected.
    const revoked = (state.authSessions || []).filter(item => item.userId === user.id).length;
    state.authSessions = (state.authSessions || []).filter(item => item.userId !== user.id);
    log(`Password sign-in for ${email} was replaced by ${provider} sign-in, which verified the address.${revoked ? ` ${revoked} session(s) from the password account were revoked.` : ''}`, 'warn', user.id);
  }
  if (!user) {
    user = { id: `user_${now().toString(36)}_${token(5)}`, email, name: '', picture: '', role: state.authUsers.length ? 'creator' : 'owner', providers: {}, createdAt: now() };
    state.authUsers.push(user);
    ownerFeed.signedUp(user, provider).catch(() => {});
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
  log(`Signed in ${user.email || user.name} with Google.`, 'info', user.id);
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
  log(`Signed in ${user.email || user.name} with Apple.`, 'info', user.id);
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
    </form>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Sign in · DeenClipped</title><style>
  :root{color-scheme:dark;--bg:#070708;--panel:#101013;--panel2:#151519;--text:#f7f4ef;--muted:#aaa59e;--muted2:#76726d;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.16);--gold:#d9b66f;--gold2:#f1d18e;--green:#70d1a0;--red:#ef6b7a;--shadow:0 32px 100px rgba(0,0,0,.5)}*{box-sizing:border-box}html{min-width:320px}body{margin:0;min-height:100vh;background:radial-gradient(circle at 27% 4%,rgba(217,182,111,.10),transparent 29%),radial-gradient(circle at 77% 54%,rgba(66,108,104,.08),transparent 28%),var(--bg);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);-webkit-font-smoothing:antialiased}body:before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.18;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:58px 58px;mask-image:linear-gradient(to bottom,black,transparent 82%)}a{color:inherit}.dc-auth-nav{position:relative;z-index:3;height:76px;border-bottom:1px solid rgba(255,255,255,.065);background:rgba(7,7,8,.82);backdrop-filter:blur(24px)}.dc-auth-nav-inner{width:min(calc(100% - 56px),1340px);height:100%;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:24px}.dc-brand{display:inline-flex;align-items:center;gap:11px;text-decoration:none}.dc-brand-mark{width:38px;height:38px;display:grid;place-items:center;color:var(--gold2);border:1px solid rgba(217,182,111,.32);border-radius:12px;background:linear-gradient(145deg,rgba(217,182,111,.18),rgba(217,182,111,.045));box-shadow:0 12px 35px rgba(0,0,0,.3),inset 0 0 0 1px rgba(255,255,255,.025)}.dc-brand-mark svg{width:24px;height:24px;stroke:currentColor;stroke-width:1.8}.dc-brand-copy strong,.dc-brand-copy small{display:block;white-space:nowrap}.dc-brand-copy strong{font-size:15px;letter-spacing:-.02em}.dc-brand-copy small{margin-top:2px;color:var(--muted2);font-size:10px;letter-spacing:.035em}.dc-back-link{min-height:42px;display:inline-flex;align-items:center;gap:8px;padding:0 14px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.025);color:#c8c3bc;text-decoration:none;font-size:12px;font-weight:750;transition:.18s ease}.dc-back-link:hover{background:rgba(255,255,255,.06);border-color:var(--line2);color:#fff}.dc-back-link svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}.dc-auth-shell{position:relative;z-index:1;width:min(calc(100% - 56px),1340px);min-height:calc(100vh - 76px);margin:auto;padding:34px 0 38px;display:grid;grid-template-columns:minmax(0,1.14fr) minmax(400px,.86fr);gap:58px;align-items:center}.dc-auth-story{min-width:0}.dc-eyebrow{display:inline-flex;align-items:center;gap:9px;color:var(--gold2);font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase}.dc-eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(112,209,160,.09)}.dc-auth-story h1{max-width:760px;margin:17px 0 15px;font-size:clamp(46px,5vw,68px);line-height:.98;letter-spacing:-.066em;font-weight:850}.dc-auth-story h1 span{background:linear-gradient(90deg,#fff 4%,var(--gold2) 58%,#fff 96%);-webkit-background-clip:text;background-clip:text;color:transparent}.dc-story-copy{max-width:690px;margin:0;color:#b6b1aa;font-size:16px;line-height:1.64}.dc-capabilities{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-top:19px;color:#9d9891}.dc-capabilities span{display:inline-flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap}.dc-capabilities b{width:21px;height:21px;display:grid;place-items:center;border-radius:7px;background:rgba(217,182,111,.09);color:var(--gold2);font-size:10px}.dc-capabilities i{width:3px;height:3px;border-radius:50%;background:#4e4b47}.dc-product-stage{position:relative;max-width:760px;height:280px;margin-top:28px;padding:7px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:linear-gradient(145deg,#131316,#09090b);box-shadow:var(--shadow)}.dc-product-stage:before{content:'';position:absolute;z-index:-1;inset:-15% 2% -12%;border-radius:50%;background:radial-gradient(circle,rgba(217,182,111,.18),rgba(65,119,126,.06) 43%,transparent 72%);filter:blur(24px)}.dc-product-stage>img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center;border-radius:17px;border:1px solid rgba(255,255,255,.055);background:#070708}.dc-reel{position:absolute;z-index:3;width:80px;padding:4px;border:1px solid rgba(255,255,255,.15);border-radius:17px;background:#111114;box-shadow:0 22px 60px rgba(0,0,0,.58)}.dc-reel img{display:block;width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:12px}.dc-reel.one{left:-27px;bottom:-20px;transform:rotate(-7deg)}.dc-reel.two{right:-25px;top:-17px;transform:rotate(7deg)}.dc-status{position:absolute;z-index:4;display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid rgba(255,255,255,.13);border-radius:13px;background:rgba(15,15,18,.91);backdrop-filter:blur(16px);box-shadow:0 18px 48px rgba(0,0,0,.48)}.dc-status strong,.dc-status small{display:block}.dc-status strong{font-size:11px}.dc-status small{margin-top:2px;color:var(--muted2);font-size:10px}.dc-status-icon{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:rgba(217,182,111,.11);color:var(--gold2);font-size:11px}.dc-status.found{left:62px;top:-13px}.dc-status.ready{right:45px;bottom:-16px}.dc-auth-card{width:100%;max-width:490px;justify-self:end;padding:31px;border:1px solid rgba(255,255,255,.105);border-radius:26px;background:linear-gradient(155deg,rgba(20,20,23,.97),rgba(10,10,12,.95));box-shadow:0 32px 100px rgba(0,0,0,.45),inset 0 0 0 1px rgba(217,182,111,.025);backdrop-filter:blur(20px)}.dc-auth-card h2{margin:0;font-size:34px;line-height:1.02;letter-spacing:-.05em}.dc-auth-card>p{margin:9px 0 24px;color:var(--muted);font-size:14px;line-height:1.55}.dc-alert{padding:11px 13px;border-radius:13px;margin-bottom:13px;font-size:12px;line-height:1.45}.dc-alert.bad{background:rgba(239,107,122,.1);border:1px solid rgba(239,107,122,.24);color:#ffb7bf}.dc-alert.good{background:rgba(112,209,160,.1);border:1px solid rgba(112,209,160,.24);color:#c5ffdd}.dc-auth-form{display:grid;gap:8px}.dc-auth-form label{font-size:12px;font-weight:600;color:#bdb8b1}.dc-auth-form input{width:100%;box-sizing:border-box;height:48px;border:1px solid var(--line);outline:0;background:#09090b;color:var(--text);border-radius:13px;padding:0 14px;font-size:15px;transition:border-color .18s ease,box-shadow .18s ease}.dc-auth-form input::placeholder{color:#65615c}.dc-auth-form input:focus{border-color:rgba(217,182,111,.5);box-shadow:0 0 0 3px rgba(217,182,111,.08)}.dc-email-form{padding:0;border:0;background:none}.dc-oauth-btn.is-disabled{pointer-events:none;opacity:.45}.dc-auth-primary,.dc-oauth-btn{width:100%;height:52px;border-radius:14px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}.dc-auth-primary{margin-top:2px;border:0;font-weight:800;background:linear-gradient(180deg,var(--gold2),var(--gold));color:#171109;box-shadow:0 13px 30px rgba(217,182,111,.18)}.dc-auth-primary:hover{background:#f4d99f}.dc-auth-primary.compact{height:43px}.dc-email-hint{color:var(--muted2);font-size:11px;line-height:1.5}.dc-auth-divider{display:flex;align-items:center;gap:12px;color:var(--muted2);font-size:11px;margin:22px 0}.dc-auth-divider:before,.dc-auth-divider:after{content:'';height:1px;background:var(--line);flex:1}.dc-auth-oauth{display:flex;flex-direction:column;gap:10px}.dc-oauth-btn{display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;border:1px solid transparent;background:#fff;color:#14120e;box-shadow:0 10px 26px rgba(0,0,0,.35)}.dc-oauth-btn:hover{background:#f2efe9}.dc-oauth-btn.apple{background:rgba(255,255,255,.03);color:var(--text);border-color:var(--line2);box-shadow:none}.dc-oauth-btn.apple:hover{background:rgba(255,255,255,.07)}.dc-oauth-btn svg{width:19px;height:19px;flex:none}.dc-oauth-btn:disabled{opacity:.36;cursor:not-allowed;filter:saturate(.25)}.dc-admin-login{margin-top:12px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.018);padding:0 13px}.dc-admin-login summary{min-height:44px;display:flex;align-items:center;cursor:pointer;color:var(--muted);font-size:12px}.dc-admin-login .dc-auth-form{padding:0 0 13px}.dc-foot{display:flex;align-items:flex-start;gap:8px;margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06);color:var(--muted2);font-size:11px;line-height:1.5}.dc-foot svg{width:12px;height:12px;flex:none;margin-top:1px;fill:none;stroke:var(--green);stroke-width:2}@media(max-width:1040px){.dc-auth-shell{grid-template-columns:minmax(0,1fr) minmax(380px,.84fr);gap:35px}.dc-auth-story h1{font-size:52px}.dc-product-stage{height:245px}.dc-status.found{left:36px}.dc-status.ready{right:28px}}@media(max-width:820px){.dc-auth-nav-inner,.dc-auth-shell{width:min(calc(100% - 32px),680px)}.dc-auth-shell{min-height:auto;padding:28px 0 50px;grid-template-columns:1fr;gap:38px}.dc-auth-card{order:1;max-width:none;justify-self:stretch}.dc-auth-story{order:2}.dc-auth-story h1{font-size:48px;max-width:650px}.dc-product-stage{max-width:none;height:300px}}@media(max-width:540px){.dc-auth-nav{height:68px}.dc-auth-nav-inner{width:calc(100% - 28px)}.dc-brand-mark{width:34px;height:34px}.dc-brand-copy small{display:none}.dc-back-link{min-height:38px;padding:0 11px;font-size:11px}.dc-auth-shell{width:calc(100% - 28px);padding:18px 0 42px;gap:36px}.dc-auth-card{padding:23px;border-radius:21px}.dc-auth-card h2{font-size:30px}.dc-auth-oauth{grid-template-columns:1fr}.dc-auth-story h1{font-size:41px}.dc-story-copy{font-size:14px}.dc-capabilities i{display:none}.dc-capabilities{gap:8px}.dc-product-stage{height:226px;margin-top:24px;border-radius:19px}.dc-product-stage>img{border-radius:13px}.dc-reel{width:62px}.dc-reel.one{left:-9px;bottom:-15px}.dc-reel.two{right:-8px;top:-13px}.dc-status.found{left:18px}.dc-status.ready{right:12px}.dc-status{padding:7px 8px}.dc-status-icon{width:24px;height:24px}.dc-status small{display:none}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  .dc-skip{position:absolute;left:-9999px;top:0;z-index:99;padding:11px 16px;border-radius:0 0 12px 0;background:var(--gold2);color:#171109;font-size:13px;font-weight:800;text-decoration:none}.dc-skip:focus{left:0}</style></head><body><a class="dc-skip" href="#dc-signin">Skip to sign in</a><header class="dc-auth-nav"><div class="dc-auth-nav-inner"><a class="dc-brand" href="/" aria-label="DeenClipped home"><span class="dc-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 3.5c-5.8 0-10.5 4.7-10.5 10.5v14.5h21V14c0-5.8-4.7-10.5-10.5-10.5Z"/></svg></span><span class="dc-brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a><a class="dc-back-link" href="/"><svg viewBox="0 0 24 24"><path d="m9 18-6-6 6-6M3 12h18"/></svg>Back to website</a></div></header><main class="dc-auth-shell"><section class="dc-auth-story"><span class="dc-eyebrow"><i></i>Review-first clipping for Islamic creators</span><h1>Turn long lectures into <span>review-ready short clips.</span></h1><p class="dc-story-copy">Find complete moments, render English, Arabic or Quran-aware captions, then approve what is ready for your connected channels.</p><div class="dc-capabilities"><span><b>1</b>Choose a range</span><i></i><span><b>2</b>Review real renders</span><i></i><span><b>3</b>Publish or schedule</span></div><div class="dc-product-stage" aria-label="DeenClipped creator workspace preview"><img src="/marketing-assets/hero-premium.webp" alt="DeenClipped lecture-to-clip workspace"><figure class="dc-reel one"><img src="/marketing-assets/reel-beneficial.webp" alt="Photographic vertical Islamic reminder clip"></figure><figure class="dc-reel two"><img src="/marketing-assets/reel-dua.webp" alt="Photographic vertical dua clip"></figure><div class="dc-status found"><span class="dc-status-icon">✦</span><span><strong>Strong moments found</strong><small>Full-quality clips ready to review</small></span></div><div class="dc-status ready"><span class="dc-status-icon">✓</span><span><strong>Human approval first</strong><small>Nothing posts without a decision</small></span></div></div></section><section class="dc-auth-card" id="dc-signin"><h2>Welcome back.</h2><p>Sign in to your creator workspace.</p>${error ? `<div class="dc-alert bad">${esc(error)}</div>` : ''}${info ? `<div class="dc-alert good">${esc(info)}</div>` : ''}<div class="dc-auth-oauth"><a class="dc-oauth-btn${googleDisabled ? ' is-disabled' : ''}" href="/auth/google/start?returnTo=${encodeURIComponent(safeReturn(returnTo))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6Z"/><path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3Z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.6 11.6 0 0 0 1.8 7.1l3.8 3c.9-2.8 3.4-4.7 6.4-4.7Z"/></svg>Continue with Google</a><a class="dc-oauth-btn apple${appleDisabled ? ' is-disabled' : ''}" href="/auth/apple/start?returnTo=${encodeURIComponent(safeReturn(returnTo))}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none"><path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8c-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.7 1.1 8.9.8 1.1 1.7 2.3 2.9 2.2 1.2 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.8-2.2c.9-1.2 1.2-2.4 1.2-2.5 0 0-2.4-.9-2.4-3.5ZM14.2 5.9c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 0 2.1-.5 2.7-1.3Z"/></svg>Continue with Apple</a></div><div class="dc-auth-divider">or use email</div><form method="post" action="/auth/email" class="dc-auth-form dc-email-form"><input type="hidden" name="returnTo" value="${esc(returnTo)}"><label for="creator-email">Email address</label><input id="creator-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><label for="creator-password">Password</label><input id="creator-password" name="password" type="password" autocomplete="current-password" placeholder="At least 8 characters" minlength="8" required><button class="dc-auth-primary" type="submit">Continue with email</button><span class="dc-email-hint">New to DeenClipped? Your account is created securely when you continue. <a href="/reset" style="color:var(--gold2);text-decoration:none;font-weight:700;">Forgot your password?</a></span></form>${providers.password ? `<details class="dc-admin-login"><summary>Admin password fallback</summary>${passwordBlock}</details>` : ''}<div class="dc-foot"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7"/></svg><span>Your projects, clips and connected accounts stay private to your workspace.</span></div></section></main><script src="/auth-enhance.js" defer></script></body></html>`;
}

/**
 * The password reset screen, in both of its states.
 *
 * Deliberately its own small page rather than a branch inside loginPage: that
 * template is one enormous literal carrying the whole marketing panel, and a
 * person who has just been locked out does not need to be sold to.
 */
export function resetPage({ token: resetToken = '', error = '', info = '', done = false } = {}) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const body = done
    ? `<h2>Password changed</h2><p>You can sign in with your new password now. Every other device has been signed out.</p><a class="btn" href="/login">Go to sign in</a>`
    : resetToken
      ? `<h2>Choose a new password</h2><p>This link works once. Pick something at least 8 characters long.</p>
         <form method="post" action="/auth/reset">
           <input type="hidden" name="token" value="${esc(resetToken)}">
           <label for="pw">New password</label>
           <input id="pw" name="password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required autofocus>
           <button class="btn" type="submit">Save new password</button>
         </form>`
      : `<h2>Reset your password</h2><p>Tell us the address you signed up with and we will send a link.</p>
         <form method="post" action="/auth/forgot">
           <label for="em">Email address</label>
           <input id="em" name="email" type="email" autocomplete="email" placeholder="you@example.com" required autofocus>
           <button class="btn" type="submit">Send the reset link</button>
         </form>
         <p class="fine">If the address has an account with a password, the link arrives within a minute. Signed in with Google or Apple? Use that button on the <a href="/login">sign-in page</a> instead — those accounts have no password to reset.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset password · DeenClipped</title><style>
  :root{color-scheme:dark;--bg:#070708;--text:#f7f4ef;--muted:#aaa59e;--line:rgba(255,255,255,.1);--gold:#d9b66f;--gold2:#f1d18e}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 30% 6%,rgba(217,182,111,.10),transparent 30%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,-apple-system,'Segoe UI',sans-serif}
  .card{width:100%;max-width:430px;padding:30px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(155deg,rgba(20,20,23,.97),rgba(10,10,12,.95))}
  h2{margin:0 0 8px;font-size:27px;letter-spacing:-.03em}
  p{margin:0 0 20px;color:var(--muted);font-size:14px;line-height:1.55}
  p.fine{margin:16px 0 0;font-size:12px;line-height:1.5}
  a{color:var(--gold2)}
  form{display:grid;gap:8px}
  label{font-size:12px;font-weight:600;color:#bdb8b1}
  input{height:48px;padding:0 14px;border:1px solid var(--line);border-radius:13px;background:#09090b;color:var(--text);font-size:15px;outline:0}
  input:focus{border-color:rgba(217,182,111,.5);box-shadow:0 0 0 3px rgba(217,182,111,.08)}
  .btn{display:block;width:100%;height:50px;margin-top:6px;border:0;border-radius:14px;background:linear-gradient(180deg,var(--gold2),var(--gold));color:#171109;font:inherit;font-size:14px;font-weight:800;text-align:center;line-height:50px;text-decoration:none;cursor:pointer}
  .alert{margin-bottom:14px;padding:11px 13px;border-radius:12px;font-size:12.5px;line-height:1.45}
  .alert.bad{background:rgba(239,107,122,.1);border:1px solid rgba(239,107,122,.24);color:#ffb7bf}
  .alert.good{background:rgba(112,209,160,.1);border:1px solid rgba(112,209,160,.24);color:#c5ffdd}
  .back{display:block;margin-top:18px;color:#76726d;font-size:12px;text-decoration:none}
  </style></head><body><main class="card">${error ? `<div class="alert bad">${esc(error)}</div>` : ''}${info ? `<div class="alert good">${esc(info)}</div>` : ''}${body}<a class="back" href="/login">← Back to sign in</a></main><script src="/auth-enhance.js" defer></script></body></html>`;
}
