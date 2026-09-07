import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * A LENGTH THIS ACCOUNT'S OWN DESTINATION CANNOT TAKE.
 *
 * v3.135.0 stopped building a Facebook target for a clip over 60 seconds, so
 * the wasted upload and the red row are gone. What it left, and named as not
 * built, is the quiet half: choose 60-90s and every clip from that lecture
 * simply never reaches Facebook, with nothing saying why.
 *
 * The hazard in warning about it is a SECOND COPY of 4-60 in the browser,
 * which would go on saying 60 long after the rule moved. So the tests that
 * matter here are "the sentence and the table agree" and "the warning is drawn
 * for a destination this account actually posts to", not "does a string
 * appear".
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-length-limits-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'clip-length-limits-secret-long-enough';

const social = await import('../src/social.js');

test.after(() => {
  // Guarded: the state saver can still be writing into this directory as the
  // file ends, and a leftover temp dir on a runner is harmless.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');
const sandbox = {
  window: {},
  document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const A = sandbox.StudioAdapter;

/** An account with the given platforms connected and switched on. */
function account({ live = [], min = 10, max = 90 } = {}) {
  const providers = {};
  const settings = {};
  for (const key of ['youtube', 'tiktok', 'instagram', 'facebook']) {
    const on = live.includes(key);
    providers[key] = { configured: true, connected: on, accounts: on ? [{ id: key + '-1', name: key }] : [] };
    settings[key] = { enabled: on, accountId: on ? key + '-1' : '' };
  }
  return {
    clips: [], projects: [], tracks: [], templates: [],
    social: { providers, lengthLimits: social.PLATFORM_LENGTH_LIMITS },
    publishingSettings: settings,
    clipSettings: { clipMinSeconds: min, clipMaxSeconds: max },
  };
}
const noteFor = data => A.bindings(data).jobLengthNote || '';

test('the warning and the refusal read one table', () => {
  // The sentence a failed publish would give, parsed for its numbers, must be
  // the numbers the browser is handed. Two copies is how a warning outlives
  // the rule it describes.
  const refusal = social.platformRefusal('facebook', { durationMs: 90_000 }, { assumeKnown: true });
  const found = /a (\d+)–(\d+) second video/.exec(refusal);
  assert.ok(found, `the refusal should state its own range: ${refusal}`);
  const limit = social.PLATFORM_LENGTH_LIMITS.facebook;
  assert.equal(Number(found[1]), limit.minSeconds);
  assert.equal(Number(found[2]), limit.maxSeconds);
});

test('the table reaches the browser through the state payload', () => {
  const status = social.connectionStatus('nobody');
  assert.deepEqual(status.lengthLimits, social.PLATFORM_LENGTH_LIMITS,
    'the payload must carry the same object platformRefusal reads');
});

test('a length Facebook cannot take is named where it is chosen', () => {
  const note = noteFor(account({ live: ['facebook', 'youtube'], max: 90 }));
  assert.match(note, /Facebook Reels/);
  assert.match(note, /60/, 'the note should name the ceiling it is about');
  assert.match(note, /skip/i, 'it must say what happens, not merely that a limit exists');
});

test('a length that fits says nothing', () => {
  assert.equal(noteFor(account({ live: ['facebook'], max: 60 })), '');
  assert.equal(noteFor(account({ live: ['facebook'], max: 45 })), '');
});

test('a destination that is not live is not warned about', () => {
  // Connected and switched OFF, and switched on with nothing connected: the
  // same pair anyOutletLive tests, because a warning about a channel this
  // account does not post to is noise on every job.
  const off = account({ live: ['facebook'], max: 90 });
  off.publishingSettings.facebook.enabled = false;
  assert.equal(noteFor(off), '');

  const gone = account({ live: ['facebook'], max: 90 });
  gone.social.providers.facebook.connected = false;
  assert.equal(noteFor(gone), '');
});

test('platforms with no length rule are never warned about', () => {
  // Shorts and Reels take far longer; a limit invented for them would refuse
  // destinations that work.
  assert.equal(noteFor(account({ live: ['youtube', 'tiktok', 'instagram'], max: 90 })), '');
});

test('a clip shorter than the floor is covered too', () => {
  const note = noteFor(account({ live: ['facebook'], min: 2, max: 30 }));
  assert.match(note, /shorter than 4s/);
});

test('an older browser payload carrying no table warns about nothing', () => {
  // The limits arrive from the server, so a page loaded before this release
  // must go quiet rather than fall back to a number typed here.
  const stale = account({ live: ['facebook'], max: 90 });
  delete stale.social.lengthLimits;
  assert.equal(noteFor(stale), '');
});

test('the browser holds no second copy of the numbers', () => {
  const adapter = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const helper = adapter.slice(adapter.indexOf('function lengthWarning('));
  const body = helper.slice(0, helper.indexOf('\n  }') + 4);
  assert.ok(body.length > 200 && body.length < 3000, 'the helper was not isolated');
  assert.doesNotMatch(body, /\b60\b/, 'the ceiling must come from the payload, never a literal');
  assert.doesNotMatch(body, /\bfacebook\b/i, 'it must read the table, not name one platform');
});
