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

/**
 * The posting options moved into a sheet of their own.
 *
 * Youssef, 3 Sept 2026: "add settings next to tiktok and move all the settings
 * on that button when clicked opens a new page in the middle fix the new look
 * of the whole thing as well."
 *
 * The panel used to sit permanently below the platform rows, so the dialog was
 * a list of four connections with ONE platform's posting options bolted
 * underneath — long, and it read as though those options governed everything
 * above them.
 */
test('Settings is only drawn where there are settings', () => {
  // A Settings button on a platform with nothing behind it is a dead control.
  assert.ok(host.includes('const HAS_SETTINGS={tiktok:true}'),
    'the list is explicit, not a button on every row');
  assert.ok(host.includes('HAS_SETTINGS[r.key]&&linked'),
    'and it needs a connected account to configure');
});

test('the options open in a sheet, not inline under the list', () => {
  assert.ok(host.includes("el.id='dcConnSheet'"), 'the sheet exists');
  assert.ok(/sheet\.hidden=StudioAdapter\.ui\.connSettings!=='tiktok'/.test(host),
    'and is shown only for the platform whose Settings was pressed');
  assert.ok(host.includes('data-conn-sheet-body'), 'the panel is moved into it');
  // The scrim matters: without one the rows behind stay clickable and a stray
  // press changes a connection while its options are open.
  assert.ok(host.includes('dccs-scrim'), 'the rows behind are covered');
});

test('the sheet can reach the painter across inline script scopes', () => {
  // index.html has MULTIPLE inline script scopes and this is the FOURTH
  // feature caught by it. The close button threw "paintConnections is not
  // defined" and the sheet would not shut — silently, because a click
  // handler's exception goes to the console and nowhere a user looks.
  assert.ok(host.includes('window.paintConnections=paintConnections'),
    'the painter is window-pinned');
  assert.ok(host.includes('if(window.paintConnections)window.paintConnections()'),
    'and the sheet reaches it through window, not through scope');
});

test('the row gives the count and the actions separate ground', () => {
  // Both were given grid-area 'actions' in a first cut, so "1 OF 3 CHANNELS
  // CONNECTED" was drawn on top of "Add another Settings Disconnect".
  assert.ok(/grid-template-areas: 'mark who state switch' 'accounts accounts accounts accounts' 'actions actions actions actions'/.test(host),
    'three rows, one purpose each');
  assert.ok(host.includes('.studio-conn-accounts { grid-area: accounts; }'),
    'the count sits in its own area, not on top of the buttons');
});
