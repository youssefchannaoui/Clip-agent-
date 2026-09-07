import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * THE NINE STARTER NASHEEDS DEENCLIPPED SHIPS WITH.
 *
 * Youssef, 8 Sept 2026: "add these to the nasheeds, show its uploaded by
 * deenclipped."
 *
 * Music is mandatory on every clip, so an account with no nasheed cannot
 * finish a single render -- "No nasheed uploaded" is one of the three blockers
 * a brand-new account meets on its first screen. These remove it for everyone,
 * on a fresh deployment as much as on this one, which is the whole reason they
 * ship with the product rather than living on one Render disk.
 *
 * Driven against the real module with a real DATA_DIR, never by reading source.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const ASSETS = path.join(ROOT, 'assets', 'nasheeds');

/* ONE directory and ONE import for the whole file. config.js reads the
   environment once, at first import, so a second DATA_DIR would be ignored and
   every later test would silently work in the first directory -- the trap
   test/access-codes.test.mjs already paid for. Isolation comes from resetting
   the library between tests instead. */
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-nasheed-'));
process.env.DATA_DIR = DIR;
process.env.AUTH_REQUIRED = 'false';
// store.js FIRST, because store.js's boot block is what seeds -- importing
// audio.js alone is just a library and seeds nothing, which is correct and is
// exactly the distinction the cycle used to blur.
await import('../src/store.js');
const audio = await import('../src/audio.js');
const MUSIC = path.join(DIR, 'music');

function resetLibrary() {
  fs.rmSync(path.join(MUSIC, 'library.json'), { force: true });
  fs.rmSync(path.join(MUSIC, 'starter-removed.json'), { force: true });
  for (const f of fs.readdirSync(MUSIC)) fs.rmSync(path.join(MUSIC, f), { force: true });
}

test('the manifest names nine tracks and every file is on disk', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));
  assert.equal(manifest.provider, 'DeenClipped');
  assert.equal(manifest.tracks.length, 9);
  for (const track of manifest.tracks) {
    // A manifest entry with no file is a nasheed that silently never appears.
    const file = path.join(ASSETS, track.file);
    assert.ok(fs.existsSync(file), `${track.file} is missing from assets/nasheeds`);
    assert.ok(fs.statSync(file).size > 100_000, `${track.file} is too small to be audio`);
    assert.ok(track.name && track.name.trim(), `${track.file} has no display name`);
    assert.equal(track.file, path.basename(track.file), 'a path would write outside musicDir');
  }
  const names = manifest.tracks.map(t => t.name);
  assert.equal(new Set(names).size, names.length, 'two tracks would be indistinguishable in the list');
});

test('BOOT seeds them: starting the app is enough, nobody has to run anything', () => {
  // This is the WIRING, not the function: store.js's boot block ran on import
  // above, exactly as it does when server.js starts.
  const onBoot = audio.listNasheeds('anyone');
  assert.equal(onBoot.length, 9, 'a fresh DATA_DIR comes up with nine nasheeds');
  assert.ok(onBoot.every(t => t.starter === true && t.shared === true));
});

test('a restart adds none: the id is stable across deploys', () => {
  assert.equal(audio.seedStarterNasheeds('owner-1'), 0);
  assert.equal(audio.seedStarterNasheeds('owner-1'), 0);
  assert.equal(audio.listNasheeds('owner-1').length, 9, 'not eighteen, not twenty-seven');
});

test('every account gets them, credited rather than merely shared', () => {
  const asCustomer = audio.listNasheeds('some-other-account');
  assert.equal(asCustomer.length, 9, 'a customer who has uploaded nothing can still render');
  // `owned` is what the browser reads to know whether Remove can do anything;
  // deriving it here keeps every entry's owner id off the wire.
  assert.ok(asCustomer.every(t => t.owned === false), "a starter track is not a customer's to delete");
  assert.equal(new Set(asCustomer.map(t => t.name)).size, 9);
});

test('the worker is handed a real path inside musicDir for each one', () => {
  const tracks = audio.workerMusicTracks('a-customer');
  // workerMusicTracks filters out anything whose file is missing, so nine
  // means nine were genuinely copied rather than merely listed.
  assert.equal(tracks.length, 9);
  for (const track of tracks) {
    assert.ok(track.path.startsWith(MUSIC), 'copied into musicDir, never read from the repo');
    assert.ok(fs.existsSync(track.path));
  }
  assert.deepEqual(fs.readdirSync(MUSIC).filter(f => f.includes('..')), [], 'nothing escaped musicDir');
});

test('durations are measured after boot, not in front of it', async () => {
  resetLibrary();
  assert.equal(audio.seedStarterNasheeds('owner-1'), 9);
  // Seeding must not shell out: nine ffprobe processes before the server
  // starts listening, on every restart, for a label.
  assert.ok(audio.listNasheeds('owner-1').every(t => t.durationSec === 0), 'no probing during boot');
  const filled = await audio.fillStarterDurations();
  assert.equal(filled, 9);
  assert.ok(audio.listNasheeds('owner-1').every(t => t.durationSec > 60), 'every bed is over a minute');
  assert.equal(await audio.fillStarterDurations(), 0, 'and it does not re-measure what it has');
});

test("a customer cannot delete one, and the operator's deletion sticks", () => {
  resetLibrary();
  audio.seedStarterNasheeds('owner-1');
  const first = audio.listNasheeds('owner-1')[0];
  assert.equal(audio.deleteNasheed('stranger', first.id), false);
  assert.equal(audio.listNasheeds('owner-1').length, 9, 'and nothing was removed');

  assert.equal(audio.deleteNasheed('owner-1', first.id), true);
  assert.equal(audio.listNasheeds('owner-1').length, 8);
  // THE HALF THAT IS EASY TO MISS: the seeder runs on every boot, so without a
  // record of the removal the track comes straight back and Delete reads as a
  // button that does not work.
  assert.equal(audio.seedStarterNasheeds('owner-1'), 0);
  assert.equal(audio.listNasheeds('owner-1').length, 8);
});

test('the studio credits DeenClipped and refuses a dead Remove', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  const sandbox = { window: {}, document: undefined, setTimeout, clearTimeout, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'studio-adapter.js' });
  const A = sandbox.window.StudioAdapter;
  const removed = [];
  A.onRemoveTrack = id => removed.push(id);
  const STATE = {
    user: { id: 'cust', name: 'A customer' }, projects: [], clips: [],
    tracks: [
      { id: 'dc-starter-asmoo', name: 'Asmoo', shared: true, starter: true, owned: false, durationSec: 268 },
      { id: 'mine', name: 'My own bed', shared: false, owned: true, durationSec: 100 },
    ],
    billing: { current: { plan: 'free', features: {} } },
  };
  // Array.from: the list was built in the vm realm and its prototype is that
  // realm's Array (CLAUDE.md, four times over).
  const rows = Array.from(A.bindings(STATE).nasheedList);
  assert.equal(rows[0].mood, 'Added by DeenClipped', 'the slot says WHO, not merely that it is shared');
  assert.equal(rows[1].mood, 'Yours');
  const noEvent = { preventDefault() {}, stopPropagation() {} };
  rows[0].remove(noEvent);
  assert.deepEqual(removed, [], 'pressing Remove on a starter track asks the server for nothing');
  rows[1].remove(noEvent);
  assert.deepEqual(removed, ['mine'], 'and your own track still removes');
});

test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch {} });

test('audio.js does not import store.js: the cycle failed silently', () => {
  // store.js imports this module for the boot migrations. An import back the
  // other way makes a cycle, and with audio.js evaluated first its own consts
  // are in the temporal dead zone while store.js's boot block runs -- so
  // readStarterManifest's catch swallows a ReferenceError and NINE NASHEEDS
  // are silently not seeded, on an app that cannot render a clip without one.
  // It only worked because server.js happens to import store.js first.
  const source = fs.readFileSync(path.join(ROOT, 'src/audio.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');   // strip comments: this file explains the cycle
  assert.doesNotMatch(source, /from\s+'\.\/store\.js'/, 'audio.js must not import store.js');
  assert.doesNotMatch(source, /export\s*\{[^}]*musicSettings/, 'nor re-export from it');
});

test('a deployment shipping no starter nasheeds says so rather than going quiet', () => {
  // Seeding 0 is normal on every restart after the first. Seeding 0 because
  // assets/nasheeds did not ship is an app on which a new account cannot
  // render, and the boot log has to tell them apart.
  assert.equal(audio.starterNasheedsMissing(), false, 'they ship in this tree');
  const store = fs.readFileSync(path.join(ROOT, 'src/store.js'), 'utf8');
  assert.match(store, /starterNasheedsMissing\(\)/, 'and boot checks it');
});
