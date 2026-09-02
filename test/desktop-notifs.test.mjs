import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * Desktop notifications, 2 Sept 2026.
 *
 * Reported as "I don't think desktop notifications work". Two things were
 * true, and only the second was a code fault:
 *
 *  1. The only switch was inside the BELL dropdown, so nobody had turned them
 *     on. It is in Account settings now as well, and both read one state.
 *  2. The "clip published" notification was keyed on c.id + provider. A Studio
 *     account posts one clip to three Facebook Pages -- three targets sharing
 *     one provider -- so once the first Page posted, the other two could never
 *     notify. Silent: nothing failed, the pop-up simply never came.
 *
 * FOUR states, not a boolean. 'denied' and 'unsupported' cannot be fixed by
 * pressing the switch, so a surface that only knows on/off draws a control
 * that silently refuses -- which is what the original report looks like.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// A sandbox whose localStorage and Notification are ours to set, so all four
// states can be driven rather than reasoned about.
function adapterIn({ pref, permission }) {
  const store = pref === undefined ? {} : { deenDesktopNotifs: pref };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; },
    },
    navigator: { userAgent: 'test' }, location: { hash: '', search: '' }, innerWidth: 1440,
  };
  if (permission !== undefined) sandbox.Notification = { permission, requestPermission: async () => permission };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src('src/public/studio-runtime.js'), sandbox);
  vm.runInContext(src('src/public/studio-adapter.js'), sandbox);
  return sandbox.StudioAdapter;
}

test('the switch reports four states, not two', () => {
  // The browser has never been asked. Pressing the switch is the right action.
  assert.equal(adapterIn({ permission: 'default' }).desktopNotifsState(), 'off');
  // Granted but never switched on here: still off, and pressing it works.
  assert.equal(adapterIn({ permission: 'granted' }).desktopNotifsState(), 'off');
  assert.equal(adapterIn({ pref: 'on', permission: 'granted' }).desktopNotifsState(), 'on');
  // Switched on, then the browser permission was revoked. The app must NOT
  // claim to be on -- nothing would ever appear, which is the exact shape of
  // "I don't think they work".
  assert.equal(adapterIn({ pref: 'on', permission: 'denied' }).desktopNotifsState(), 'denied');
  assert.equal(adapterIn({ pref: 'on', permission: 'default' }).desktopNotifsState(), 'off');
  // No Notification constructor at all (iOS Safari outside a home-screen app).
  assert.equal(adapterIn({ pref: 'on' }).desktopNotifsState(), 'unsupported');
});

test('every surface reads the one state function', () => {
  const on = adapterIn({ pref: 'on', permission: 'granted' });
  const off = adapterIn({ permission: 'granted' });
  const blocked = adapterIn({ pref: 'on', permission: 'denied' });

  // The bell dropdown's inline styles (desktop template), the phone's class
  // (mobile template) and the note must agree with the state, or one surface
  // says a different thing about one switch.
  const bell = a => {
    const v = a.bindings({ user: { id: 'u' }, projects: [], clips: [], log: [], activity: [] });
    return { on: v.desktopNotifsOn, cls: v.desktopNotifsCls, knob: /left: 17px/.test(v.desktopNotifsKnobStyle), note: v.desktopNotifsNote };
  };
  assert.deepEqual(bell(on), { on: true, cls: 'on', knob: true, note: 'On — you will be told when clips are ready' });
  assert.deepEqual(bell(off), { on: false, cls: '', knob: false, note: 'Off — turn on to hear when clips are ready' });
  assert.deepEqual(bell(blocked), { on: false, cls: '', knob: false, note: 'Blocked in your browser settings' });
});

test('the Account dialog draws the row, and never a switch that would refuse', () => {
  const html = src('src/public/index.html');
  // The row itself, beside the email one it was missing next to.
  assert.match(html, /<b>Desktop notifications<\/b>/, 'Account settings must offer the switch');
  assert.match(html, /data-acct="desktop"/, 'and it must be wired');
  assert.match(html, /case 'desktop':await StudioAdapter\.onToggleDesktopNotifs\(\)/,
    'through the same handler the bell dropdown uses, so the two cannot disagree');
  // A blocked browser needs a different action, not a dead toggle.
  assert.match(html, /data-acct="desktop-help"/, 'a blocked browser gets guidance, not a switch');
  assert.match(html, /deskState==='unsupported'\?''/, 'a browser with no Notification gets no control at all');
  assert.match(html, /StudioAdapter\.desktopNotifsState/, 'the dialog reads the adapter, never a fifth derivation');
});

test('one clip posted to three Pages notifies three times, not once', () => {
  const html = src('src/public/index.html');
  const START = 'window.fireClipNotifs=function';
  const END = '}catch(e){}};';
  const from = html.indexOf(START);
  assert.ok(from > 0, 'fireClipNotifs must still be window-pinned -- it is called from another script scope');
  const to = html.indexOf(END, from);
  assert.ok(to > from, 'and it must still end in the swallow-all catch');
  const body = html.slice(from, to + END.length);

  // Rebuild the real function with a counting Notification. Reading the source
  // for a regex would pass against the broken key; this runs it.
  const fired = [];
  const sandbox = {
    Notification: function (title, opts) { fired.push(title + ' :: ' + ((opts || {}).body || '')); this.close = () => {}; },
    localStorage: { getItem: () => 'on' },
    window: {}, console,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.Notification.permission = 'granted';
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);

  const target = (accountId, status) => ({ provider: 'facebook', accountId, accountName: 'Page ' + accountId, status });
  const clip = targets => ({ projects: [], clips: [{ id: 'c1', title: 'Never lose hope', targets }] });
  sandbox.fireClipNotifs(
    clip([target('A', 'posted'), target('B', 'publishing'), target('C', 'publishing')]),
    clip([target('A', 'posted'), target('B', 'posted'), target('C', 'posted')]),
  );
  assert.equal(fired.length, 2, 'both newly posted Pages notify; keyed on provider alone this was 0');
  assert.ok(fired.every(f => /Never lose hope/.test(f)));
  // Named, or three Pages read as "facebook" three times.
  assert.ok(fired.some(f => /Page B/.test(f)) && fired.some(f => /Page C/.test(f)));

  // A project finishing and a project failing are the other two moments.
  fired.length = 0;
  const proj = status => ({ projects: [{ id: 'p1', title: 'Az-Zumar', status, clipCount: 5 }], clips: [] });
  sandbox.fireClipNotifs(proj('processing'), proj('done'));
  sandbox.fireClipNotifs(proj('processing'), proj('failed'));
  assert.equal(fired.length, 2);
  assert.match(fired[0], /Your clips are ready/);
  assert.match(fired[1], /could not be processed/);

  // Switched off, nothing fires -- the preference is the gate, not decoration.
  fired.length = 0;
  sandbox.localStorage.getItem = () => 'off';
  sandbox.fireClipNotifs(proj('processing'), proj('done'));
  assert.equal(fired.length, 0);

  // First load never replays history.
  fired.length = 0;
  sandbox.localStorage.getItem = () => 'on';
  sandbox.fireClipNotifs(null, proj('done'));
  assert.equal(fired.length, 0);
});
