import { config } from './config.js';
import * as storage from './object-storage.js';
import * as secretBox from './secret-box.js';
import { state, log } from './store.js';
import * as alerts from './alerts.js';

/**
 * Off-box backups of state.json.
 *
 * state.json IS the database: every account, session, token balance, billing
 * record, sealed social connection, project, clip and schedule. Writes are
 * atomic, so corruption was never the risk -- losing the disk was, and nothing
 * anywhere held a second copy. A lost volume, a bad delete or a restore like
 * the one in August took everything with it and there was nothing to restore
 * from.
 *
 * Two rings of fixed keys, so this never has to list or delete: a recent ring
 * that covers the last day at the backup interval, and a daily ring that keeps
 * a month. Each slot is overwritten when its turn comes round again, which
 * bounds what is stored without any bookkeeping to get wrong.
 *
 * Always encrypted, never optional: the bucket also serves finished clips over
 * a public URL, so an unencrypted state.json sitting at a predictable key would
 * be the whole customer database available to anyone who guessed it. Without a
 * key to seal with, this refuses to run rather than write plaintext.
 */

const RECENT_SLOTS = 6;
const DAILY_SLOTS = 30;
const DAY_MS = 86_400_000;

let timer = null;
let last = { at: 0, ok: null, detail: 'No backup has run yet.' };

export function lastResult() { return { ...last }; }

export function intervalMs() {
  return Math.max(1, Math.min(24, config.backupIntervalHours)) * 3_600_000;
}

/** Why this deployment cannot back up, or '' when it can. */
export function blockedReason() {
  if (!config.backupEnabled) return 'Backups are switched off (BACKUP_ENABLED).';
  if (!storage.configured()) return 'Object storage is not configured, so there is nowhere to put a backup.';
  if (!secretBox.canSeal()) return 'SOCIAL_TOKEN_KEY is not set, and a backup is never written unencrypted.';
  return '';
}

export function keysForNow(now = Date.now()) {
  return {
    recent: `backups/recent-${Math.floor(now / intervalMs()) % RECENT_SLOTS}.enc`,
    daily: `backups/daily-${Math.floor(now / DAY_MS) % DAILY_SLOTS}.enc`,
  };
}

async function put(key, body) {
  const url = storage.presign({ method: 'PUT', key, expiresSec: 900 });
  const response = await fetch(url, { method: 'PUT', body, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`storage answered HTTP ${response.status} writing ${key}`);
}

async function get(key) {
  const url = storage.presign({ method: 'GET', key, expiresSec: 900 });
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`storage answered HTTP ${response.status} reading ${key}`);
  return response.text();
}

/**
 * Write both rings, then read one back and decrypt it.
 *
 * The read-back is the point. A backup that was never opened is a guess, and
 * the failure it hides -- a wrong key, a truncated write, a bucket that accepts
 * writes and serves something else -- only ever shows up on the day it is
 * needed.
 */
export async function runBackup() {
  const blocked = blockedReason();
  if (blocked) { last = { at: Date.now(), ok: false, detail: blocked }; return last; }

  try {
    const payload = secretBox.seal({ savedAt: Date.now(), state });
    const keys = keysForNow();
    await put(keys.recent, payload);
    await put(keys.daily, payload);

    const opened = secretBox.open(await get(keys.recent));
    const clips = Array.isArray(opened?.state?.clips) ? opened.state.clips.length : -1;
    const accounts = Array.isArray(opened?.state?.authUsers) ? opened.state.authUsers.length : -1;
    if (clips < 0 || accounts < 0) throw new Error('the backup read back did not contain a usable state');

    last = {
      at: Date.now(), ok: true,
      detail: `${accounts} account(s), ${clips} clip(s), ${(payload.length / 1024).toFixed(0)}KB, verified by reading it back`,
      keys,
    };
    await alerts.report('backups', false);
    return last;
  } catch (error) {
    last = { at: Date.now(), ok: false, detail: error.message };
    // Loud, because a silent backup failure is the same as no backup at all.
    // Backups fail quietly by nature: nothing about the running product looks
    // different until the day someone needs one.
    await alerts.report('backups', true, `Backups have stopped working: ${error.message}`);
    return last;
  }
}

export function start() {
  const blocked = blockedReason();
  if (blocked) { log(`Backups are not running. ${blocked}`, 'warn'); return; }
  if (timer) clearInterval(timer);
  timer = setInterval(() => { runBackup().catch(() => {}); }, intervalMs());
  timer.unref?.();
  runBackup().catch(() => {});
}

export function stop() { if (timer) clearInterval(timer); timer = null; }
