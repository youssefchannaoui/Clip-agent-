import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The publishing connections dialog.
 *
 * Youssef, 3 Sept 2026, with a screenshot: "ALL connecting and disccount and
 * so many issues with connecting tiktok its a mess ... its just messy cluncky
 * conntions feel un statifying and dont know if im connecting or not, tiktok
 * gives back 504 errors, when disconnecting nothing changes not instant".
 *
 * Three separate faults, and each of them is silent — nothing errors, nothing
 * logs, the dialog simply feels broken.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const host = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
const social = fs.readFileSync(path.join(root, 'src/social.js'), 'utf8');

test('disconnect changes the row before the server answers', () => {
  const at = host.indexOf('StudioAdapter.onDisconnect=');
  assert.ok(at > -1);
  const body = host.slice(at, at + 1800);
  const painted = body.indexOf('paintConnections()');
  const sent = body.indexOf('studioDo(');
  assert.ok(painted > -1 && sent > -1);
  assert.ok(painted < sent, 'painted BEFORE the write, or the row waits on the network');
  // The row reads its connected state from social.providers. A first cut
  // mutated socialConnections instead and the row went only as far as
  // "Paused", still naming an account that had just been removed — caught by
  // measuring, not by reading.
  assert.ok(/\(\(DATA\|\|\{\}\)\.social\|\|\{\}\)\.providers/.test(body),
    'the optimistic update must touch the shape the row actually reads');
  assert.ok(/connected:\s*false/.test(body) && /accounts:\s*\[\]/.test(body),
    'both the flag and the account list, or the row keeps naming the account');
});

test('disconnecting Meta clears both of its platforms', () => {
  // Instagram and Facebook are one Meta login. Clearing only the one that was
  // clicked leaves the other showing an account that no longer exists.
  const at = host.indexOf('StudioAdapter.onDisconnect=');
  const body = host.slice(at, at + 1800);
  assert.ok(/shared\?\['instagram','facebook'\]/.test(body), 'both, when it is Meta');
});

test('Connect says it is doing something', () => {
  // Pressing Connect hands off to the platform's OAuth page; until that page
  // paints there was nothing on screen saying anything had happened.
  const at = host.indexOf("$$('[data-conn-connect]')");
  const body = host.slice(at, at + 900);
  assert.ok(body.includes("b.textContent='Opening…'"), 'the button reports the hand-off');
  assert.ok(body.includes('b.disabled=true'), 'and stops taking a second press');
  assert.ok(/setTimeout\(\(\)=>\{if\(b\.isConnected/.test(body),
    'and recovers if the hand-off never happens, rather than sticking on Opening…');
});

test('the headroom hint does not repeat the button beside it', () => {
  // It used to be a heading plus "Press Connect again to add another." under
  // EVERY platform — eight lines of near-identical boilerplate in one dialog,
  // saying what the button two inches away already says in two words.
  assert.ok(!host.includes('Press Connect again to add another.'),
    'the sentence duplicated the Add another button');
  assert.ok(!host.includes('studio-conn-headroom'),
    'and its style went with it rather than being left behind');
  assert.ok(host.includes('channels connected'), 'the COUNT stays — it answers a real question');
});

test('creator_info cannot outlive the gateway', () => {
  // jsonRequest defaults to 120s. This call runs inside a request a BROWSER is
  // waiting on, and Render's proxy gives up long before that and answers 504 —
  // so a slow TikTok could never surface its own error.
  const at = social.indexOf('async function queryTikTokCreator');
  assert.ok(at > -1);
  const body = social.slice(at, at + 1400);
  assert.ok(/AbortSignal\.timeout\(15_000\)/.test(body),
    'an interactive TikTok call needs a short timeout of its own');
  // The long default must stay where it belongs: a real upload takes minutes.
  assert.ok(/signal: options\.signal \|\| AbortSignal\.timeout\(120_000\)/.test(social),
    'the upload path keeps the long default');
});
