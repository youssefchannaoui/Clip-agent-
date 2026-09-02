/**
 * Web Push — notifications that arrive with the app CLOSED.
 *
 * The existing desktop notification (index.html's fireClipNotifs) needs a tab
 * open, because it is a `new Notification()` from the page. This is the other
 * thing: the server hands an encrypted message to the browser vendor's push
 * service, which wakes a service worker on the device whether or not
 * DeenClipped is open, or the browser is.
 *
 * WHY THIS IS HAND-WRITTEN. `web-push` is the obvious dependency, and this
 * repo deliberately has NO npm dependencies -- that is what lets a clean
 * checkout run the whole suite on a phone, on CI, anywhere (see CLAUDE.md,
 * "Working from a phone"). Adding one to send a notification would take that
 * away. Everything below is RFC 8291 (message encryption) and RFC 8292 (VAPID)
 * on top of node:crypto, which has every primitive both need.
 *
 * It is not "roughly right": `encryptPayload` reproduces the worked example in
 * RFC 8291 §5 byte for byte, from the RFC's own keys and salt, and the test
 * asserts the whole ciphertext. That is the only way to be sure of a crypto
 * implementation without a push service to try it against, and a wrong one
 * fails SILENTLY -- the push service accepts the request and the device shows
 * nothing, which is indistinguishable from the feature not existing.
 */
import crypto from 'node:crypto';
import { config } from './config.js';
import { state, save } from './store.js';

const CURVE = 'prime256v1';
// Every push service accepts 4096; going larger buys nothing for one line of
// text and some services cap below it.
const RECORD_SIZE = 4096;
// RFC 8292 caps the JWT lifetime at 24h. Twelve keeps a clock-skewed server
// inside it from both directions.
const JWT_TTL_SECONDS = 12 * 60 * 60;
// A subscription is dropped the moment its push service says it is gone. This
// only counts the failures that are NOT a definite "gone" -- a push service
// having a bad day must not silently unsubscribe a real device.
const MAX_SOFT_FAILURES = 8;
const MAX_SUBS_PER_USER = 20;

const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = str => Buffer.from(String(str || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ── HKDF, the one primitive both halves of RFC 8291 are built from ──────────
// node:crypto has hkdfSync, but it wants a Web Crypto-shaped call and the
// two-step form below is what the RFC is written in, so the code reads like
// the spec it implements.
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
function hkdf(salt, ikm, info, length) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/**
 * RFC 8291 §3.1 -- the aes128gcm body a push service forwards untouched.
 *
 * `salt` and `serverKeys` are parameters rather than generated inside, ONLY so
 * the RFC's worked example can be reproduced exactly. Production never passes
 * them: a reused salt or a reused ephemeral key would leak the plaintext.
 */
export function encryptPayload({ payload, p256dh, auth, salt, serverKeys }) {
  const uaPublic = Buffer.isBuffer(p256dh) ? p256dh : unb64url(p256dh);
  const authSecret = Buffer.isBuffer(auth) ? auth : unb64url(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) {
    throw new Error('push subscription key is not an uncompressed P-256 point');
  }
  if (authSecret.length !== 16) throw new Error('push subscription auth secret must be 16 bytes');

  const useSalt = salt ? Buffer.from(salt) : crypto.randomBytes(16);
  const ecdh = crypto.createECDH(CURVE);
  if (serverKeys) ecdh.setPrivateKey(Buffer.from(serverKeys.privateKey));
  else ecdh.generateKeys();
  const asPublic = serverKeys ? Buffer.from(serverKeys.publicKey) : ecdh.getPublicKey();

  // The shared secret is stretched with the subscription's auth secret FIRST,
  // so a push service that could observe both public keys still cannot derive
  // the key -- the auth secret never leaves the browser and this server.
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(
    authSecret,
    sharedSecret,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]),
    32,
  );
  const cek = hkdf(useSalt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(useSalt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // 0x02 is the last-record delimiter. One record is always enough here: the
  // longest thing sent is a clip title inside a sentence.
  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(5);
  header.writeUInt32BE(RECORD_SIZE, 0);
  header.writeUInt8(asPublic.length, 4);
  return Buffer.concat([useSalt, header, asPublic, body]);
}

// ── VAPID (RFC 8292): proving to the push service who is sending ───────────
function privateKeyObject(rawPrivate, rawPublic) {
  const priv = unb64url(rawPrivate);
  const pub = unb64url(rawPublic);
  return crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      d: b64url(priv),
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
  });
}

/**
 * The `Authorization: vapid ...` header for one endpoint.
 *
 * `aud` is the endpoint's ORIGIN, never the full URL -- a token minted for the
 * whole path would still be accepted, but the endpoint path is the secret part
 * of a subscription and it does not belong in a token this code logs on error.
 */
export function vapidHeader({ endpoint, keys, subject, now = Date.now() }) {
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(now / 1000) + JWT_TTL_SECONDS,
    sub: subject,
  }));
  const signing = `${header}.${claims}`;
  // ieee-p1363 is the raw r||s pair JWS wants. Node's default is DER, which
  // every push service rejects -- and rejects with a bare 401, so it reads as
  // a wrong key rather than a wrong encoding.
  const signature = crypto.sign('sha256', Buffer.from(signing), {
    key: privateKeyObject(keys.privateKey, keys.publicKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${signing}.${b64url(signature)}, k=${keys.publicKey}`;
}

export function generateVapidKeys() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/**
 * The server's identity to the push services.
 *
 * Env wins, so the keys can be pinned somewhere durable. With nothing set they
 * are generated ONCE and kept in state.json beside everything else this
 * product persists -- which means push works on a fresh deployment with no
 * setup at all, and nobody has to be told to run a key generator before their
 * notifications will arrive. They must never be regenerated casually: every
 * subscription in the wild is bound to the public key it was created with, and
 * a new pair silently invalidates all of them.
 */
export function serverKeys() {
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  }
  if (!state.pushKeys?.publicKey || !state.pushKeys?.privateKey) {
    state.pushKeys = { ...generateVapidKeys(), createdAt: Date.now() };
    save();
  }
  return { publicKey: state.pushKeys.publicKey, privateKey: state.pushKeys.privateKey };
}

/** What the browser needs to subscribe. Null when push is switched off. */
export function publicKey() {
  if (!config.pushNotifsEnabled) return null;
  try { return serverKeys().publicKey; } catch { return null; }
}

// ── subscriptions ──────────────────────────────────────────────────────────
function bucket(userId) {
  if (!state.pushSubs || typeof state.pushSubs !== 'object') state.pushSubs = {};
  const key = String(userId || '');
  if (!Array.isArray(state.pushSubs[key])) state.pushSubs[key] = [];
  return state.pushSubs[key];
}

export function subscriptionsFor(userId) {
  return bucket(userId).slice();
}

/**
 * One row per BROWSER, keyed on the endpoint the push service issued.
 *
 * Re-subscribing from the same browser returns the same endpoint, so this is
 * an upsert -- otherwise a person who toggles the switch twice gets every
 * notification twice.
 */
export function subscribe(userId, subscription, meta = {}) {
  const endpoint = String(subscription?.endpoint || '');
  const p256dh = String(subscription?.keys?.p256dh || '');
  const auth = String(subscription?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint)) throw new Error('A push endpoint must be an https URL');
  if (unb64url(p256dh).length !== 65) throw new Error('That subscription is missing its encryption key');
  if (unb64url(auth).length !== 16) throw new Error('That subscription is missing its auth secret');

  const rows = bucket(userId);
  const existing = rows.findIndex(row => row.endpoint === endpoint);
  const row = {
    endpoint, p256dh, auth,
    // Kept so a person can recognise a device in a list later, and so a stale
    // row is identifiable. Never an IP, never a full user agent string.
    device: String(meta.device || '').slice(0, 60),
    createdAt: existing >= 0 ? rows[existing].createdAt : Date.now(),
    lastOkAt: null, failures: 0,
  };
  if (existing >= 0) rows[existing] = row;
  else rows.push(row);
  // A browser that clears site data leaves its row behind, so the oldest go
  // first rather than letting one account accumulate for ever.
  while (rows.length > MAX_SUBS_PER_USER) rows.shift();
  save();
  return row;
}

export function unsubscribe(userId, endpoint) {
  const rows = bucket(userId);
  const before = rows.length;
  const kept = rows.filter(row => row.endpoint !== String(endpoint || ''));
  state.pushSubs[String(userId || '')] = kept;
  if (kept.length !== before) save();
  return before - kept.length;
}

// ── sending ────────────────────────────────────────────────────────────────
/**
 * One message to one browser. Resolves to what happened rather than throwing:
 * a failing push service must never take down the job that triggered it.
 */
export async function sendOne(row, payload, { fetchImpl = fetch, now = Date.now() } = {}) {
  const keys = serverKeys();
  let response;
  try {
    const body = encryptPayload({ payload, p256dh: row.p256dh, auth: row.auth });
    response = await fetchImpl(row.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidHeader({ endpoint: row.endpoint, keys, subject: config.vapidSubject, now }),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body,
    });
  } catch (error) {
    return { ok: false, gone: false, error: String(error?.message || error) };
  }
  // 404/410 is the push service saying this subscription no longer exists --
  // the browser was uninstalled, or site data cleared. That is the ONLY signal
  // that a row should go; anything else may be a bad ten minutes.
  const gone = response.status === 404 || response.status === 410;
  return { ok: response.status >= 200 && response.status < 300, gone, status: response.status };
}

/**
 * Notify every browser an account has registered.
 *
 * Returns counts rather than throwing, and is called with `.catch(() => {})`
 * at every site anyway: a notification is the least important thing happening
 * at the moment a lecture finishes.
 */
export async function notify(userId, message, options = {}) {
  if (!config.pushNotifsEnabled) return { sent: 0, removed: 0, skipped: 'disabled' };
  const rows = bucket(userId);
  if (!rows.length) return { sent: 0, removed: 0 };
  const payload = JSON.stringify({
    title: String(message?.title || 'DeenClipped'),
    body: String(message?.body || ''),
    url: String(message?.url || '/app'),
    // The tag collapses a repeat rather than stacking it: a lecture that
    // finishes while an earlier notification is still on screen replaces it.
    tag: String(message?.tag || 'deenclipped'),
  });

  let sent = 0;
  const dead = [];
  for (const row of rows) {
    const result = await sendOne(row, payload, options);
    if (result.ok) { row.lastOkAt = Date.now(); row.failures = 0; sent += 1; continue; }
    if (result.gone) { dead.push(row.endpoint); continue; }
    row.failures = Number(row.failures || 0) + 1;
    if (row.failures >= MAX_SOFT_FAILURES) dead.push(row.endpoint);
  }
  for (const endpoint of dead) unsubscribe(userId, endpoint);
  if (sent || dead.length) save();
  return { sent, removed: dead.length };
}

/** Whether an account has anywhere to push to at all. */
export function hasSubscriptions(userId) {
  return config.pushNotifsEnabled && bucket(userId).length > 0;
}
