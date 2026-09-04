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

test('nothing in the dialog offers a second channel any more', () => {
  // Studio sold three per platform from v3.41.0 until Youssef retired it on
  // 4 Sept 2026: "REMOVE ALL THINGS TO DO WITH 3 CHANNELS REMOVE IT, ITS NOT
  // PRCATICAL". With one channel per platform there is nothing to choose
  // between, so a tick box with one option in it is a control that does
  // nothing (invariant 9) -- and a button reading "Add another" points at a
  // limit that is now always reached.
  assert.ok(!host.includes('Press Connect again to add another.'));
  assert.ok(!host.includes('studio-conn-headroom'));
  assert.ok(!host.includes("'Add another'"), 'the Connect button no longer offers a second');
  assert.ok(!/of \$\{max\} allowed/.test(host), 'and no allowance is quoted');
  assert.ok(!host.includes('data-conn-account'), 'no picker, and no handler for one');
  assert.ok(!host.includes('maxAccounts'), 'the cap is not read here at all');
  // An account that connected several while it WAS sold still has them on
  // disk, so they are still listed and still individually disconnectable --
  // hiding them would read as the app having lost them.
  assert.ok(host.includes('data-conn-drop'), 'the extras can still be tidied away');
  assert.ok(/DeenClipped posts to the first of these/.test(host),
    'and the screen says which one actually posts');
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

/**
 * The watermark and the promo bar belong to the ACCOUNT, not to a caption
 * style, and not to a template save.
 *
 * Youssef, 3 Sept 2026: "the watermark and promotion should not need to save
 * with template it just works with all templates once on it turns on for all
 * ... it doesn't work by template. It's incorrect."
 *
 * This test used to assert the LOOP that answered him the first time --
 * writing the field to every template one save at a time. That only reached
 * the templates that existed at the moment the switch was pressed, and left
 * the value stored per template, which is the half he was still describing.
 * The value lives on the account now and templates.js lays it over every
 * template read. The behaviour being protected is the same and stronger: one
 * source, so the two switches cannot drift apart from each other or from the
 * templates they apply to.
 */
test('both brand switches write to the account, not to a template', () => {
  assert.ok(/async function saveBrand\(patch\)\{/.test(host),
    'one helper, so the two switches cannot drift apart');
  assert.ok(/api\('\/api\/brand',\{method:'POST'/.test(host),
    'it writes the account setting');
  assert.ok(!/applyToAllTemplates/.test(host),
    'the per-template loop is gone, not merely joined by another route');
  assert.ok(!/api\('\/api\/templates'[\s\S]{0,400}promoBar/.test(host),
    'no template is saved to change a brand switch');
  const wm = host.indexOf("toggle.addEventListener('change'");
  assert.ok(host.slice(wm, wm + 900).includes('saveBrand(patch)'), 'watermark uses it');
  const pb = host.indexOf("bar.addEventListener('change'");
  assert.ok(host.slice(pb, pb + 700).includes('saveBrand({promoBarEnabled:want})'), 'promo bar uses it');
  // The duration chips are rebuilt by the innerHTML above them, so a
  // `dataset.wired` guard would leave the NEW buttons dead. They are rewired
  // on every paint, deliberately.
  assert.ok(/box\.querySelectorAll\('\[data-pb-secs\]'\)/.test(host),
    'the duration chips exist and are rewired each paint');
  assert.ok(/saveBrand\(\{promoBarSeconds:n\}\)/.test(host), 'and they write the account setting too');
});

/**
 * The schedule shows the platform, not a sentence about it.
 *
 * Youssef: "for the logos here dont be writing just put logos that are
 * posting." A row going to two places read as "YouTube · DeenClipped —
 * waiting  TikTok · DeenClipped — waiting".
 */
test('a healthy destination is its logo; a broken one keeps its word', () => {
  const adapter = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');
  const at = adapter.indexOf('function destinations');
  // To the end of the function rather than a fixed character window: v3.116.0
  // added the multi-channel lookup at the top and pushed the `quiet` line past
  // an 1800-character slice, failing this against code that had not changed.
  const body = adapter.slice(at, adapter.indexOf('\n  }', at));
  assert.ok(/var quiet = t\.status === 'scheduled' \|\| t\.status === 'publishing' \|\| t\.status === 'posted'/.test(body),
    'waiting, posting and posted are the quiet states');
  assert.ok(/state: quiet \? '' :/.test(body), 'anything else still prints its word');
  // This app has already shipped the bug where a clip live on YouTube with a
  // refused TikTok "looked entirely fine on the row" (v3.28.0).
  assert.ok(body.includes('title: label'), 'the full sentence stays available on hover');
});

test('every action the dialog DEMANDS is a button the dialog offers', () => {
  // Youssef, 4 Sept 2026, trying to switch Facebook on after swapping the
  // TikTok credentials to production. The save was refused account-wide with
  // "Run TikTok Test connection before enabling it. TikTok requires the latest
  // creator privacy and interaction options to be displayed."
  //
  // The guard is correct -- creator_info is fetched per client key, so a
  // credential swap invalidates it. What was wrong is that the control it
  // names existed ONLY on the legacy ?classic=1 page. `onTestConnection` was
  // wired, the route was live, and nothing in the shipped dialog could reach
  // it: a required action with no button. That is invariant 9 from the other
  // side, and because the publishing save validates every provider at once it
  // blocked Facebook as well as TikTok.
  // `host` is already read at the top of this file.

  // The guard names it...
  assert.match(host, /Run TikTok Test connection before enabling it/,
    'the guard still asks for a Test connection');
  // ...so the dialog must offer it.
  assert.match(host, /data-conn-test="\$\{esc\(r\.key\)\}"/,
    'the connections dialog draws a Test button on a connected row');
  assert.match(host, /\$\$\('\[data-conn-test\]'\)\.forEach/,
    'and wires it');
  assert.match(host, /StudioAdapter\.onTestConnection\(b\.dataset\.connTest\)/,
    'to the handler that already existed');

  // Only on a CONNECTED row: testing a platform with no account would call a
  // route that can only fail, which is a control that cannot work.
  const row = /\$\{linked\?`<button type="button" data-conn-test=/.exec(host);
  assert.ok(row, 'the Test button is drawn only when an account is linked');

  // It repaints afterwards, or the row keeps showing the state the test just
  // changed -- the whole reason for pressing it.
  const handler = host.slice(host.indexOf("$$('[data-conn-test]')"), host.indexOf("$$('[data-conn-toggle]')"));
  assert.match(handler, /paintConnections\(\)/, 'and repaints so the result shows');
});

