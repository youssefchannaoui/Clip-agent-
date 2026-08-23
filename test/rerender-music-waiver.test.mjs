import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// A clip deliberately made without a nasheed could not be re-rendered.
//
// The app-side refusal was fixed once already ("Music is mandatory") so that
// editing such a clip would start. It still told the worker music was wanted
// while sending no tracks, so the worker refused instead and the job failed one
// step later with "No worker-accessible nasheed track was supplied" -- the same
// dead end, reached more slowly and with a message pointing at the wrong thing.
//
// This pins the contract between the two: whatever the account setting says,
// a payload that carries no tracks must not claim music is wanted.

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-waiver-'));

const source = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');

test('the re-render payload tells the worker when music was waived', () => {
  // Both re-render payloads -- the remote worker's and the local renderer's --
  // are built from the same waivesMusic flag a few lines above them.
  const passed = source.match(/sharedSettings\(owner, \{ musicEnabled: !waivesMusic \}\)/g) || [];
  assert.equal(passed.length, 2,
    'both re-render payloads must pass the clip\'s waiver');

  // And neither may go back to sending the account default alongside a
  // renderQuality, which is what produced the failure.
  const bare = source.match(/\.\.\.sharedSettings\(owner\), renderQuality/g) || [];
  assert.equal(bare.length, 0,
    'a re-render must never claim music is wanted while sending no tracks');
});

test('sharedSettings reports music wanted unless it is explicitly waived', async () => {
  // The default has to stay "wanted": every other caller relies on it, and a
  // default of false would silently drop the nasheed from ordinary renders.
  const engine = await import('../src/local-engine.js');
  assert.ok(engine, 'the module loads');
  assert.match(source, /musicEnabled: options\.musicEnabled !== false/,
    'only an explicit false waives it');
});
