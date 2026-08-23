#!/usr/bin/env node
/**
 * List and restore the encrypted state backups.
 *
 * A backup nobody has ever restored from is a guess. This is the other half of
 * src/backup.js: run it with the same OBJECT_STORAGE_* and SOCIAL_TOKEN_KEY the
 * server uses, and it will read the bucket and write a state.json back out.
 *
 *   node scripts/restore-backup.mjs                       # what is in the bucket
 *   node scripts/restore-backup.mjs --key backups/daily-7.enc --out ./state.json
 *
 * It never writes over an existing file and never touches the live data
 * directory. Restoring means stopping the app, putting the file in place
 * yourself, and starting it again -- deliberately manual, because overwriting a
 * live database is not something a script should do on its own.
 */
import fs from 'node:fs';
import * as storage from '../src/object-storage.js';
import * as secretBox from '../src/secret-box.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };

if (!storage.configured()) {
  console.error('Object storage is not configured. Set OBJECT_STORAGE_ENDPOINT, _BUCKET, _ACCESS_KEY and _SECRET_KEY.');
  process.exit(1);
}
if (!secretBox.canSeal()) {
  console.error('SOCIAL_TOKEN_KEY is not set, so the backups cannot be decrypted. It must be the same key the server sealed them with.');
  process.exit(1);
}

async function fetchKey(key) {
  const response = await fetch(storage.presign({ method: 'GET', key, expiresSec: 300 }), { signal: AbortSignal.timeout(60_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const candidates = [
  ...Array.from({ length: 6 }, (_, i) => `backups/recent-${i}.enc`),
  ...Array.from({ length: 30 }, (_, i) => `backups/daily-${i}.enc`),
];

const chosen = flag('--key');
if (!chosen) {
  console.log('Reading the bucket...\n');
  const rows = [];
  for (const key of candidates) {
    try {
      const body = await fetchKey(key);
      if (!body) continue;
      const opened = secretBox.open(body);
      rows.push({
        key,
        savedAt: new Date(opened.savedAt).toISOString(),
        accounts: opened.state?.authUsers?.length ?? 0,
        clips: opened.state?.clips?.length ?? 0,
      });
    } catch (error) { rows.push({ key, savedAt: `unreadable (${error.message})`, accounts: '-', clips: '-' }); }
  }
  if (!rows.length) { console.log('No backups found. If the server has been up for less than the backup interval, none has been written yet.'); process.exit(0); }
  rows.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  for (const row of rows) console.log(`${row.savedAt}  ${String(row.accounts).padStart(4)} account(s)  ${String(row.clips).padStart(5)} clip(s)  ${row.key}`);
  console.log(`\n${rows.length} backup(s). To restore one:\n  node scripts/restore-backup.mjs --key ${rows[0].key} --out ./restored-state.json`);
  process.exit(0);
}

const out = flag('--out') || './restored-state.json';
if (fs.existsSync(out)) { console.error(`${out} already exists. Choose another --out; this never writes over a file.`); process.exit(1); }

const body = await fetchKey(chosen);
if (!body) { console.error(`${chosen} is not in the bucket. Run without --key to see what is.`); process.exit(1); }
const opened = secretBox.open(body);
fs.writeFileSync(out, JSON.stringify(opened.state, null, 2));
console.log(`Wrote ${out} from ${chosen}, saved ${new Date(opened.savedAt).toISOString()}.`);
console.log(`It holds ${opened.state?.authUsers?.length ?? 0} account(s) and ${opened.state?.clips?.length ?? 0} clip(s).`);
console.log('\nTo put it live: stop the service, copy this over state.json in DATA_DIR, start it again.');
