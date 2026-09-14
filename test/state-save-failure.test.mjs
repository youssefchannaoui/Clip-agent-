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

/*
 * WAIT FOR THE CONDITION, NEVER FOR A DURATION.
 *
 * `save()` opens `if (writing) { dirty = true; return; }`, so a save called
 * while another is in flight does not write -- it marks the state dirty and
 * the running write re-saves when it lands. Whether that second pass has
 * finished 120ms later depends on how much else has already saved during
 * import, and the starter-nasheed seed (v3.149.0) made that a real amount.
 *
 * Measured at HEAD, with none of the Buffer removal in the tree: this file
 * failed 2 runs in 5 ALONE, on `a normal save reaches disk atomically`, and it
 * was the only failure in an otherwise green 2080-test suite. A test that fails
 * two times in five is worse than no test -- a phone session cannot trust the
 * tick, which this repo's own working agreement calls the worst shape a red
 * branch can have.
 *
 * The property is unchanged: the file appears and the scratch file does not
 * survive. Only the waiting is honest now.
 */
async function until(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await settle(20);
  }
  return predicate();
}

test('a normal save reaches disk atomically', async () => {
  store.state.log = [{ at: Date.now(), level: 'info', message: 'hello', userId: null }];
  store.save();
  assert.ok(await until(() => fs.existsSync(stateFile)), 'state.json is written');
  assert.ok(await until(() => !fs.existsSync(`${stateFile}.tmp`)),
    'the scratch file is renamed, not left');
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
  const landed = () => {
    try { return /eventually-saved/.test(fs.readFileSync(stateFile, 'utf8')); }
    catch { return false; }   // mid-rename, so not yet
  };
  assert.ok(await until(landed), 'the change reaches disk once writing works again');
  const onDisk = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(
    onDisk.log.some(entry => entry.message === 'eventually-saved'),
    'the state that failed to write is not abandoned',
  );
});
