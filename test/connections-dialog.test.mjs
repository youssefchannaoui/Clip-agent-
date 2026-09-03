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
  // The count itself stays — "how do I know I get three?" is a real question
  // and this is the screen that answers it. Its wording moved when the channels
  // became rows: it now reads "Posting to N of MAX allowed" above them.
  assert.ok(/Posting to \$\{chosen\.length\} of \$\{max\} allowed/.test(host),
    'the count stays, above the channel rows');
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
  assert.ok(/\.studio-conn-accounts \{ grid-area: accounts;/.test(host),
    'the channels sit in their own area, not on top of the buttons');
});

/**
 * Every connected channel gets a row, with its handle.
 *
 * Youssef, 3 Sept 2026, comparing us with OpusClip: "ours is good but not
 * great and no layout to see 3 connected channels with each @".
 *
 * The list used to appear only once a SECOND account existed, so a platform
 * with one channel showed a count and no channel — and even at three, the rows
 * were bare names with no way to tell one account from another.
 */
test('a connected channel is always listed, even when there is one', () => {
  const at = host.indexOf('function accountPicker');
  const body = host.slice(at, at + 1600);
  assert.ok(body.includes("if(accounts.length===0)return ''"),
    'nothing to list only when there is nothing connected');
  assert.ok(!/if\(accounts\.length<2\)\{\s*if\(max<2\|\|accounts\.length===0\)return ''/.test(body),
    'a single channel must not be hidden behind a count');
});

test('each channel row carries its own face, handle and disconnect', () => {
  const at = host.indexOf('function accountRows');
  assert.ok(at > -1, 'the rows are built by their own function');
  const body = host.slice(at, at + 1600);
  assert.ok(body.includes('studio-conn-face'), 'an avatar, or its initial');
  assert.ok(body.includes('creatorInfo.creator_username'), 'the real handle where the platform gives one');
  assert.ok(body.includes('data-conn-drop'), 'and its own disconnect');
  // Inventing an @ from a display name would be making up a handle that may
  // not exist, so it is shown only where the platform actually supplies one.
  assert.ok(body.includes("?'@'+a.creatorInfo.creator_username:''"),
    'no handle is fabricated from a display name');
});

test('the channels stack rather than wrapping into a tag cloud', () => {
  assert.ok(/\.studio-conn-accounts \{ grid-area: accounts; display: flex; flex-direction: column;/.test(host),
    'a column, or the labels flow inline and wrap two-per-line');
  assert.ok(/\.studio-conn-account \{\s*width: 100%;/.test(host), 'and each row fills the width');
});

/**
 * Every connected channel gets a row.
 *
 * Youssef, 3 Sept 2026, comparing us with OpusClip: "opus layout is better
 * like ours is good but not great and no layout to see 3 connected channels
 * with each @".
 *
 * The list used to render only once a SECOND account existed, so a platform
 * with one channel showed a count and no channel — and even at three, the rows
 * were bare names in wrapping pills.
 */
test('the channel list is drawn whenever there is a channel', () => {
  const at = host.indexOf('function accountPicker');
  const body = host.slice(at, at + 1400);
  assert.ok(body.includes("if(accounts.length===0)return ''"),
    'nothing to list is the ONLY reason to draw nothing');
  assert.ok(!/if\(accounts\.length<2\)\{\s*if\(max<2\|\|accounts\.length===0\)return ''/.test(body),
    'a single connected channel must still be listed');
});

test('a channel row carries its face, its name and its handle', () => {
  const at = host.indexOf('function accountRows');
  assert.ok(at > -1, 'the rows have their own builder');
  const body = host.slice(at, at + 1800);
  assert.ok(body.includes('studio-conn-face'), 'an avatar, or initials when there is none');
  assert.ok(body.includes('studio-conn-acct-who'), 'name and handle together');
  // TikTok is the one platform that hands us a real username. An @ invented
  // from a display name is a handle that may not exist.
  assert.ok(body.includes("a.creatorInfo.creator_username"),
    'the handle comes from the platform, never from the display name');
  assert.ok(body.includes('data-conn-drop'), 'and its own disconnect');
});

test('the channels stack instead of wrapping into pills', () => {
  // Two rows side by side leave a ragged third on its own line once each row
  // carries a face, a name and a handle. Id-scoped because the older chip rule
  // was too, and specificity decides.
  assert.ok(/#studioConnList \.studio-conn-accounts \{[^}]*flex-direction: column/.test(host),
    'the container stacks');
  assert.ok(/#studioConnList \.studio-conn-account \{[^}]*display: grid/.test(host),
    'and each row is a grid, not an inline pill');
});
