import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { addConnection } from '../src/tenancy.js';

/**
 * ADDING A SECOND CHANNEL ON A PLATFORM.
 *
 * Youssef, 8 Sept 2026, with one account connected on each of the four:
 * "to add, like, more than one account, I don't see a button in the
 * connections to add another account. on each social media. Like, I only have
 * one on each."
 *
 * The affordance was WORKING and wearing the wrong word. Connecting again on a
 * platform that stores its own credentials appends whenever the allowance has
 * room (tenancy.addConnection), and replaces in place when the SAME account
 * comes back -- so one button already did both. It said "Reconnect", which is
 * exactly what you call replacing the one you have, so nothing on screen ever
 * suggested a second channel was possible. And the picker, with one account
 * and three allowed, printed nothing at all.
 *
 * The cap itself is owner-only and pinned in test/one-channel.test.mjs; this
 * file is about whether the screen ADMITS to the room the cap leaves.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const host = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
const social = fs.readFileSync(path.join(root, 'src/social.js'), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('the button says Add another where connecting adds, and Reconnect where it replaces', () => {
  const at = host.indexOf('const connectLabel=');
  assert.ok(at > -1, 'the label is computed rather than typed into the markup');
  const body = strip(host.slice(at - 900, at + 900));
  assert.match(body, /canAdd\s*\?\s*'Add another'\s*:\s*'Reconnect'/,
    'headroom reads Add another; otherwise Reconnect');
  const cond = /const canAdd=([^;]+);/.exec(strip(host))[1];
  assert.match(cond, /linked/, 'never before anything is connected');
  assert.match(cond, /!stale/,
    'a dead credential still says Reconnect -- that is the urgent thing, and the state pill beside it is already reporting it');
  assert.match(cond, /addsAccounts\(r\)/, 'only where connecting appends');
  assert.match(cond, /<\s*allowedHere/, 'and only while the allowance has room');
});

test('Meta is the one platform where connecting again does NOT add', () => {
  // Structural, not a preference: one Facebook login carries every Page, so a
  // Meta row's accounts come from that login's Page list and connecting again
  // re-runs it. Read from r.oauth, which the server derives -- never a list of
  // platform names typed into the host, which is what left direct Instagram
  // out of the per-account disconnect.
  const fn = /const addsAccounts=([^;]+);/.exec(strip(host));
  assert.ok(fn, 'addsAccounts exists');
  assert.match(fn[1], /r\.oauth\s*!==\s*'meta'/);
  const addsAccounts = r => r.oauth !== 'meta';
  assert.equal(addsAccounts({ oauth: 'youtube' }), true);
  assert.equal(addsAccounts({ oauth: 'tiktok' }), true);
  assert.equal(addsAccounts({ oauth: 'instagram' }), true, 'direct Instagram Login keeps its own credential');
  assert.equal(addsAccounts({ oauth: 'meta' }), false, 'facebook, and Instagram reached through a Page');
});

test('the picker says how many of the allowance are used', () => {
  const at = host.indexOf('const headroom=');
  assert.ok(at > -1);
  const body = strip(host.slice(at, at + 400));
  assert.match(body, /allowed>accounts\.length/, 'drawn only where there is room left');
  assert.match(body, /channels connected/);
  // It must reach the ordinary case: ONE account connected with three allowed
  // showed nothing, which is the silent half of the complaint.
  const picker = strip(/function accountPicker\([\s\S]*?\n    \}/.exec(host)[0]);
  assert.match(picker, /\)\+headroom;/,
    'appended to the behaviour line rather than replacing it, so 2 of 3 says both');
});

test('the allowance has ONE reader in the dialog', () => {
  // Two copies of "how many channels" is how a screen comes to say "posts to
  // the first of these" while three of them post.
  const bare = strip(host);
  const at = bare.indexOf('const perPlatform=');
  assert.ok(at > -1, 'perPlatform() is the reader');
  const dialog = bare.slice(at, bare.indexOf('window.paintConnections=paintConnections'));
  // perPlatform's own declaration is the one place the payload is read.
  const decl = /const perPlatform=[^;]+;/.exec(dialog)[0];
  const raw = dialog.replace(decl, '').match(/accountsPerPlatform/g) || [];
  assert.equal(raw.length, 0,
    'nothing else in the dialog reads the payload directly');
  assert.match(decl, /accountsPerPlatform/);
});

test('the Instagram connect stores against the connection map, not a string', () => {
  /*
   * A LATENT CRASH ON THE FIRST REAL DIRECT-INSTAGRAM CONNECT.
   *
   * tenancy.addConnection takes (socialConnections, userId, provider,
   * connection, opts). completeInstagramLogin called it with (userId,
   * provider, connection, opts) -- four arguments, the first a string. ES
   * modules are strict, so assigning a property on a string primitive throws
   * a TypeError rather than failing quietly.
   *
   * It has never run: v3.160.0 leaves the direct login inert without
   * INSTAGRAM_CLIENT_ID/SECRET, and no token has ever been exchanged with
   * Instagram from this codebase. It would have thrown the moment those
   * credentials were set.
   */
  const calls = [...social.matchAll(/addConnection\(([^,]+),/g)].map(m => m[1].trim());
  assert.ok(calls.length >= 3, 'every platform that keeps its own credentials');
  for (const first of calls) {
    assert.equal(first, 'state.socialConnections',
      'the first argument is the connection map, never the user id');
  }
  // And the shape the wrong call produced, so the reason is reproducible.
  assert.throws(() => addConnection('user-1', 'instagram', { accountId: 'a' }, { max: 3 }), TypeError);
});
