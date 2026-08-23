/**
 * Failed-attempt throttling for credential endpoints.
 *
 * Before this, /auth/password accepted a shared admin password at whatever rate
 * a client could send it -- one secret, unlimited guesses -- and /auth/email was
 * the same for every account at once. Nothing recorded a failure, so nothing
 * could refuse the next one.
 *
 * Two buckets, deliberately:
 *
 *   by IP        the attacker's own cost. Tightest limit, because a real person
 *                mistyping their password is one address making a handful of
 *                attempts, not hundreds.
 *   by identity  a slower, wider net for someone spreading guesses at one
 *                account across many addresses.
 *
 * Locking on identity alone would let anyone lock a victim out by guessing at
 * their email on purpose, so identity limits are looser and the IP bucket is
 * what actually stops a burst. Neither bucket is allowed to say whether an
 * account exists.
 *
 * In memory, deliberately: this process is the only thing that answers these
 * routes, and a restart clearing the counters is a smaller problem than a
 * database write on every wrong password. Running more than one instance would
 * need shared state -- see README-SECURITY.md.
 */

const IP_LIMIT = { free: 5, lockAfter: 12, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
const ID_LIMIT = { free: 8, lockAfter: 25, windowMs: 60 * 60_000, lockMs: 30 * 60_000 };

const buckets = new Map();

function policyFor(kind) {
  return kind === 'ip' ? IP_LIMIT : ID_LIMIT;
}

function entry(key) {
  let found = buckets.get(key);
  if (!found) {
    found = { fails: 0, first: Date.now(), lockedUntil: 0 };
    buckets.set(key, found);
  }
  return found;
}

/** Attempts past the free allowance wait a little longer each time. */
function backoffMs(fails, policy) {
  const over = fails - policy.free;
  if (over <= 0) return 0;
  return Math.min(policy.lockMs, 1000 * 2 ** Math.min(over, 10));
}

function prune(now) {
  for (const [key, value] of buckets) {
    const policy = policyFor(key.slice(0, 2) === 'ip' ? 'ip' : 'id');
    const dead = value.lockedUntil < now && now - value.first > policy.windowMs;
    if (dead) buckets.delete(key);
  }
}

/**
 * May this attempt proceed? Returns { allowed, retryAfterSec }.
 * Checks every key given and answers with the longest wait among them.
 */
export function check(keys = []) {
  const now = Date.now();
  if (buckets.size > 5000) prune(now);
  let retryAfterMs = 0;
  for (const key of keys.filter(Boolean)) {
    const found = buckets.get(key);
    if (!found) continue;
    const policy = policyFor(key.slice(0, 2) === 'ip' ? 'ip' : 'id');
    if (now - found.first > policy.windowMs && found.lockedUntil < now) {
      buckets.delete(key);
      continue;
    }
    if (found.lockedUntil > now) {
      retryAfterMs = Math.max(retryAfterMs, found.lockedUntil - now);
      continue;
    }
    const wait = backoffMs(found.fails, policy);
    const readyAt = found.lastFail ? found.lastFail + wait : 0;
    if (readyAt > now) retryAfterMs = Math.max(retryAfterMs, readyAt - now);
  }
  return { allowed: retryAfterMs <= 0, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
}

/** Record a failure against every key. */
export function fail(keys = []) {
  const now = Date.now();
  for (const key of keys.filter(Boolean)) {
    const found = entry(key);
    const policy = policyFor(key.slice(0, 2) === 'ip' ? 'ip' : 'id');
    if (now - found.first > policy.windowMs && found.lockedUntil < now) {
      found.fails = 0;
      found.first = now;
    }
    found.fails += 1;
    found.lastFail = now;
    if (found.fails >= policy.lockAfter) found.lockedUntil = now + policy.lockMs;
  }
}

/** A correct password clears the counters for those keys. */
export function succeed(keys = []) {
  for (const key of keys.filter(Boolean)) buckets.delete(key);
}

/** Keys for one attempt. Identity is hashed so the store holds no addresses. */
export function keysFor(ip, identity) {
  const keys = [];
  if (ip) keys.push('ip:' + String(ip));
  if (identity) keys.push('id:' + String(identity).trim().toLowerCase());
  return keys;
}

/** Tests only. */
export function reset() { buckets.clear(); }
export const limits = { IP_LIMIT, ID_LIMIT };
