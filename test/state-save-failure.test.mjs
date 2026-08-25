import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-save-'));
process.env.DATA_DIR = dir;

const store = await import('../src/store.js');

const stateFile = path.join(dir, 'state.json');
const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

test('a normal save reaches disk atomically', async () => {
  store.state.log = [{ at: Date.now(), level: 'info', message: 'hello', userId: null }];
  store.save();
  await settle(120);
  assert.ok(fs.existsSync(stateFile), 'state.json is written');
  assert.ok(!fs.existsSync(`${stateFile}.tmp`), 'the scratch file is renamed, not left');
});

test('a failed write is reported and does not leave a scratch file', async () => {
  // The bug: the error was swallowed entirely. The rename was skipped, nothing
  // was logged, nothing retried, and the in-memory state carried changes that
  // were never on disk -- lost silently at the next restart.
  const realWriteFile = fs.writeFile;
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  fs.writeFile = (file, data, cb) => cb(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }));
  try {
    store.state.log.push({ at: Date.now(), level: 'info', message: 'doomed', userId: null });
    store.save();
    await settle(120);
  } finally {
    fs.writeFile = realWriteFile;
    console.error = realError;
  }
  assert.ok(errors.some(line => /Saving state failed/.test(line)), 'the failure is said out loud');
  assert.ok(errors.some(line => /ENOSPC/.test(line)), 'and names the cause');
  assert.ok(!fs.existsSync(`${stateFile}.tmp`), 'no half-written scratch file survives');
});

test('the change is retried once writing works again', async () => {
  store.state.log.push({ at: Date.now(), level: 'info', message: 'eventually-saved', userId: null });
  store.save();
  await settle(200);
  const onDisk = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(
    onDisk.log.some(entry => entry.message === 'eventually-saved'),
    'the state that failed to write is not abandoned',
  );
});
