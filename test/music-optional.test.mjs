import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Music is mandatory by default and stays that way. A job may now decline it,
// and the distinction that matters is between "the user asked for no nasheed"
// and "the upload went missing" -- those two must never render the same.

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-music-'));
const { musicSatisfied } = await import('../src/store.js');

test('a clip with no opinion recorded still requires music', () => {
  // Every clip from before this existed. Absence must not become exemption.
  assert.equal(musicSatisfied({ musicVerified: false }), false);
  assert.equal(musicSatisfied({ musicVerified: true }), true);
  assert.equal(musicSatisfied({}), false);
  assert.equal(musicSatisfied(null), false);
});

test('a clip that asked for no nasheed passes without one', () => {
  assert.equal(musicSatisfied({ musicEnabled: false, musicVerified: false }), true);
});

test('musicEnabled true is not a waiver on its own', () => {
  // Asking for music and not getting it is still a failure.
  assert.equal(musicSatisfied({ musicEnabled: true, musicVerified: false }), false);
});

test('every gate goes through the helper rather than reading the flag', () => {
  // There were eight of these. One missed gate would let an unverified clip
  // publish, which is the failure this whole check exists to prevent.
  for (const file of ['src/agent.js', 'src/local-engine.js']) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const raw = source.match(/!\w+[?.]*\.musicVerified/g) || [];
    assert.deepEqual(raw, [], `${file} still tests musicVerified directly: ${raw.join(', ')}`);
    assert.match(source, /musicSatisfied/, `${file} uses the shared gate`);
  }
});

test('a missing nasheed still fails loudly when music was wanted', () => {
  const source = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');
  assert.match(source, /options\.musicEnabled !== false\) \{\n\s*throw new Error\('Music is required/);
});

test('the worker is told explicitly, not left to infer it from an empty list', () => {
  // An empty musicTracks alone is ambiguous between a choice and a lost upload.
  const engine = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');
  assert.match(engine, /musicEnabled: options\.musicEnabled !== false/);
  const worker = fs.readFileSync(new URL('../worker/clip_worker.py', import.meta.url), 'utf8');
  assert.match(worker, /music_wanted = job\.get\("settings", \{\}\)\.get\("musicEnabled", True\) is not False/);
  assert.match(worker, /if not tracks and music_wanted:/);
});

test('the render drops the music input rather than mixing silence', () => {
  const worker = fs.readFileSync(new URL('../worker/clip_worker.py', import.meta.url), 'utf8');
  // No second input, and no sidechain against a track that is not there.
  assert.match(worker, /if track is None else \["-stream_loop"/);
  assert.match(worker, /if track is None:\n\s+filter_complex = \(/);
  // The voice is still levelled: a bare export is far quieter than a mixed one.
  // The music-free branch levels the voice but has nothing to duck against.
  const solo = /if track is None:\n([\s\S]*?)\n    else:/.exec(worker)[1];
  assert.match(solo, /loudnorm=I=-16/, 'a bare export is far quieter than a mixed one');
  assert.doesNotMatch(solo, /sidechaincompress/);
  assert.doesNotMatch(solo, /\[1:a\]/, 'there is no second input to reference');
});

test('the result records what happened instead of asserting music', () => {
  const worker = fs.readFileSync(new URL('../worker/clip_worker.py', import.meta.url), 'utf8');
  assert.match(worker, /"musicVerified": bool\(track\)/, 'nothing mixed means nothing verified');
  assert.match(worker, /"musicEnabled": bool\(track\)/);
});

test('the panel only sends the flag when it is off', () => {
  // The server reads a missing field as the default, which is on. Sending it
  // always would make a stale client able to waive the requirement.
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /if\(opts&&opts\.musicEnabled===false\)body\.musicEnabled=false;/);
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /musicEnabled: body\.musicEnabled !== false/);
});
