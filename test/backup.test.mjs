import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// state.json is the whole database and nothing held a second copy of it. These
// pin the two properties that decide whether a backup is worth having: it can
// be read back and decrypted into the same records, and it is never written in
// a form someone could read out of the bucket.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-backup-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_TOKEN_KEY = 'a-backup-key-that-is-long-enough-to-seal-with';
process.env.OBJECT_STORAGE_ENDPOINT = 'https://example-account.r2.cloudflarestorage.com';
process.env.OBJECT_STORAGE_BUCKET = 'deenclipped-test';
process.env.OBJECT_STORAGE_ACCESS_KEY = 'test-access-key';
process.env.OBJECT_STORAGE_SECRET_KEY = 'test-secret-key';

const backup = await import('../src/backup.js');
const secretBox = await import('../src/secret-box.js');
const { state, save } = await import('../src/store.js');

// A bucket that lives in memory, so the round trip is real without a network.
const bucket = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));
  if ((options.method || 'GET') === 'PUT') { bucket.set(key, String(options.body)); return new Response('', { status: 200 }); }
  if (!bucket.has(key)) return new Response('', { status: 404 });
  return new Response(bucket.get(key), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

test('a backup can be read back and decrypted into the same records', async () => {
  state.authUsers = [{ id: 'user-1', email: 'someone@example.com' }];
  state.clips = [{ id: 'clip-1', title: 'A clip' }, { id: 'clip-2', title: 'Another' }];
  save();

  const result = await backup.runBackup();
  assert.equal(result.ok, true, result.detail);

  // Both rings are written, so losing today's slot does not lose the month.
  const keys = backup.keysForNow();
  assert.ok(bucket.has(keys.recent), 'the recent ring was written');
  assert.ok(bucket.has(keys.daily), 'the daily ring was written');

  const restored = secretBox.open(bucket.get(keys.daily));
  assert.equal(restored.state.authUsers.length, 1);
  assert.equal(restored.state.clips.length, 2);
  assert.equal(restored.state.clips[1].title, 'Another', 'the records survive the round trip intact');
});

test('nothing readable is ever written to the bucket', () => {
  // The same bucket serves finished clips over a public URL. A plaintext
  // state.json at a predictable key would be the customer database, published.
  for (const body of bucket.values()) {
    assert.doesNotMatch(body, /someone@example\.com/, 'an address is legible in the stored backup');
    assert.doesNotMatch(body, /Another/, 'record content is legible in the stored backup');
    assert.match(body, /^v1\./, 'the stored body is sealed');
  }
});

test('slots rotate and come back round, so storage stays bounded', () => {
  const hour = 3_600_000;
  const now = 1_800_000_000_000;
  const slotAt = at => backup.keysForNow(at).recent;
  assert.notEqual(slotAt(now), slotAt(now + 4 * hour), 'the next run takes the next slot');
  assert.equal(slotAt(now), slotAt(now + 24 * hour), 'a day later the first slot is reused');

  const daily = at => backup.keysForNow(at).daily;
  assert.notEqual(daily(now), daily(now + 24 * hour));
  assert.equal(daily(now), daily(now + 30 * 24 * hour), 'the daily ring holds a month');
});

test('a failed write is reported, not swallowed', async () => {
  globalThis.fetch = async () => new Response('', { status: 403 });
  const result = await backup.runBackup();
  assert.equal(result.ok, false, 'a refused write is a failed backup');
  assert.match(result.detail, /403/);
});

test('with no key to seal with, it refuses rather than writing plaintext', async () => {
  const { config } = await import('../src/config.js');
  const original = config.socialTokenKey;
  try {
    config.socialTokenKey = '';
    assert.match(backup.blockedReason(), /SOCIAL_TOKEN_KEY/);
    const result = await backup.runBackup();
    assert.equal(result.ok, false);
    assert.equal(bucket.has('backups/plaintext'), false);
  } finally { config.socialTokenKey = original; }
});
