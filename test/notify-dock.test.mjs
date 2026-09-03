import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * The notification dock, 3 Sept 2026.
 *
 * Youssef: "make a notification system that popup over all layouts to be clear
 * and shows when all settings are like turned on or off or things are posted
 * ... replace the bad one we have now."
 *
 * The old `.toasts` dock sat at z-index 80. Measured in a browser, everything
 * that matters in this app is above it: the design export's overlays run
 * 88-120, the dialogs 200, the tour spotlight 202, the confirm 240, the
 * billing layer 420, the charge layer 520. So a confirmation was painted
 * UNDER the very dialog whose switch had just been flicked, dimmed by that
 * layer's own scrim.
 *
 * These tests pin the three properties that fail SILENTLY -- nothing throws,
 * the suite stays green, the app just stops telling anyone what happened.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => fs.readFileSync(path.join(root, rel), 'utf8');

/* ------------------------------------------------------------------ *
 * A DOM stub thin enough to read, thick enough to run the real module.
 * ------------------------------------------------------------------ */
function fakeNode(tag) {
  return {
    tagName: tag, id: '', className: '', textContent: '', innerHTML: '',
    style: {}, offsetWidth: 1, children: [], parentNode: null, isConnected: false,
    classList: { _set: new Set(), add(c) { this._set.add(c); }, contains(c) { return this._set.has(c); } },
    setAttribute() {}, addEventListener() {},
    appendChild(child) { child.parentNode = this; child.isConnected = true; this.children.push(child); return child; },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null; child.isConnected = false;
    },
    /* Enough to satisfy arm() (.dcn-bar), the repeat badge (.dcn-more) and
       the probes below. Any other selector gets a scratch node. */
    querySelector(sel) {
      if (sel === '.dcn-more') return this.children.find(c => c.className === 'dcn-more') || null;
      return fakeNode('span');
    },
  };
}

function loadDock() {
  const body = fakeNode('body');
  const timers = new Set();
  const sandbox = {
    console, JSON, Date, Math,
    setTimeout: (fn, ms) => { const id = Symbol('t'); timers.add(id); return id; },
    clearTimeout: id => timers.delete(id),
    document: {
      readyState: 'complete', body,
      getElementById: () => null,
      createElement: tag => fakeNode(tag),
      addEventListener() {},
    },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src('src/public/studio-notify.js'), sandbox);
  const dock = body.children[0];
  return { api: sandbox.DCNotify, cards: () => dock.children.filter(c => !c.classList.contains('is-going')) };
}

/* ------------------------------------------------------------------ *
 * 1. Above everything. This is the whole bug.
 * ------------------------------------------------------------------ */
test('the dock outranks every layer this app draws', () => {
  const sheet = src('src/public/studio-notify.css');
  const mine = /#dcNotes\s*\{[^}]*?z-index:\s*(\d+)/.exec(sheet);
  assert.ok(mine, '#dcNotes must declare a z-index');
  const ours = Number(mine[1]);

  /* Every z-index the app declares anywhere a stacking context can reach.
     Read from the files rather than listed by hand: a layer added next month
     is compared automatically, which a typed list would not be. */
  const files = ['src/public/index.html', 'src/public/studio-adapter.js', 'src/public/studio-styles.generated.css',
    'src/public/studio-help.css', 'src/public/studio-owner.css', 'src/public/studio-tokens.css',
    'src/public/studio-motion.css', 'src/public/studio-mobile.css', 'src/public/studio-mobile.js',
    'src/public/studio-responsive.css', 'src/public/studio-editor-gate.css'];
  let highest = 0, where = '';
  for (const file of files) {
    for (const hit of src(file).matchAll(/z-index:\s*(\d+)/g)) {
      const value = Number(hit[1]);
      if (value > highest) { highest = value; where = file; }
    }
  }
  assert.ok(ours > highest,
    `the dock is z-index ${ours} but ${where} declares ${highest}: a confirmation would paint underneath it`);
});

/* ------------------------------------------------------------------ *
 * 2. A burst must not hang the browser. This one was real: remove() left
 *    the card on the live list until its exit animation finished, so
 *    trim()'s `while (live.length > MAX)` never saw the length drop and
 *    span forever -- the FIFTH notification of a burst froze the tab.
 *    A test that hangs is a failing test, which is exactly the alarm here.
 * ------------------------------------------------------------------ */
test('a burst of notifications is capped and terminates', () => {
  const { api, cards } = loadDock();
  for (let i = 0; i < 30; i += 1) api.done('Clip ' + i + ' approved');
  assert.equal(cards().length, 4, 'at most four are kept on screen');
});

/* ------------------------------------------------------------------ *
 * 3. A setting says which way it went, and keeps saying the truth.
 * ------------------------------------------------------------------ */
test('a switch flicked twice shows the state it landed in, not the first one', () => {
  const { api, cards } = loadDock();
  api.switched('YouTube', true);
  api.switched('YouTube', false);
  const open = cards();
  assert.equal(open.length, 1, 'one subject, one card -- never a contradictory pair');
  assert.match(open[0].innerHTML, />Off</, 'and it reads Off, the state it is actually in');
  assert.match(open[0].className, /dcn-off/);
});

test('the same message twice is counted, not stacked', () => {
  const { api, cards } = loadDock();
  api.fail('Could not reach TikTok', 'The request timed out');
  api.fail('Could not reach TikTok', 'The request timed out');
  api.fail('Could not reach TikTok', 'The request timed out');
  const open = cards();
  assert.equal(open.length, 1);
  assert.equal(open[0].querySelector('.dcn-more').textContent, '×3');
});

/* ------------------------------------------------------------------ *
 * 4. The compatibility floor. toast(message, type) is called from
 *    seventy-one places in index.html and none of them was rewritten.
 * ------------------------------------------------------------------ */
test('a trailing on/off becomes a state chip, and a failure never does', () => {
  const { api } = loadDock();
  /* Copied out of the vm realm before comparing: an object built in there has
     that realm's prototype, and strict deepEqual rejects it as "same structure
     but not reference-equal". This repo has paid for that one twice. */
  const read = (text, type) => { const hit = api._readSwitch(text, type); return hit ? { ...hit } : hit; };
  assert.deepEqual(read('Email notifications on', ''), { label: 'Email notifications', on: true });
  assert.deepEqual(read('Notifications off', ''), { label: 'Notifications', on: false });
  /* The dangerous direction: "Could not turn it on" must never be read as a
     setting that is now ON. A failure is never a switch. */
  assert.equal(read('Could not turn it on', 'bad'), null);
  /* Nor may a whole sentence that happens to end in the word. */
  assert.equal(read('We could not work out whether that destination is on', ''), null);
  assert.equal(read('Clip scheduled', ''), null);
});

test('every legacy toast kind still draws a card', () => {
  const { api, cards } = loadDock();
  api.legacy('Posted successfully', 'good');
  api.legacy('Publishing failed', 'bad');
  api.legacy('Copied', '');
  assert.equal(cards().length, 3);
  assert.deepEqual(cards().map(c => c.className.replace('dcn dcn-', '')), ['good', 'bad', 'info']);
});

/* ------------------------------------------------------------------ *
 * 5. Work in flight resolves in place rather than stacking a second card.
 * ------------------------------------------------------------------ */
test('a working card becomes its own outcome', () => {
  const { api, cards } = loadDock();
  const work = api.working('Working');
  assert.equal(cards().length, 1);
  assert.match(cards()[0].className, /dcn-work/);
  work.done('Clip scheduled', 'It will post at 07:00');
  assert.equal(cards().length, 1, 'the spinner BECOMES the outcome; it does not leave one behind');
  assert.match(cards()[0].className, /dcn-good/);
  assert.match(cards()[0].innerHTML, /Clip scheduled/);
});

/* ------------------------------------------------------------------ *
 * 6. Wiring. Each of these fails silently: the app renders, nothing
 *    throws, and outcomes simply stop being announced.
 * ------------------------------------------------------------------ */
test('both assets are served, linked and loaded', () => {
  const server = src('src/server.js');
  assert.match(server, /'\/studio-notify\.css':/, 'the sheet must be in the asset table or it 404s');
  assert.match(server, /'\/studio-notify\.js':/, 'so must the module');
  const page = src('src/public/index.html');
  assert.match(page, /<link rel="stylesheet" href="\/studio-notify\.css">/);
  assert.match(page, /<script src="\/studio-notify\.js"><\/script>/);
  assert.match(page, /<div id="dcNotes"/, 'the dock element itself');
});

test('toast() routes into the dock and still has a floor under it', () => {
  const page = src('src/public/index.html');
  const fn = page.slice(page.indexOf('function toast(message,type='));
  const body = fn.slice(0, fn.indexOf('let API_SEQUENCE'));
  assert.match(body, /window\.DCNotify/, 'toast must hand off to the dock');
  assert.match(body, /\$\('#toasts'\)/,
    'and must keep the old dock beneath it: an outcome that goes unannounced because an asset 404d is the bug being fixed');
});

test('the switches that have a state say which state', () => {
  const page = src('src/public/index.html');
  /* Each of these used to be a bare sentence in a grey box, indistinguishable
     from "a clip was posted". They carry an On/Off chip now. */
  assert.match(page, /DCNotify\.switched\('Email notifications'/);
  assert.match(page, /DCNotify\.switched\('Notifications on this device'/);
  assert.match(page, /DCNotify\.switched\(DEST_NAME\[key\]\|\|key, ?on/);
});

test('the publishing switch is announced only after the save lands', () => {
  const page = src('src/public/index.html');
  const start = page.indexOf('StudioAdapter.onPublishingToggle=');
  const handler = page.slice(start, start + 900);
  /* studioDo swallows its own failure and resolves either way, so announcing
     off the returned promise would report a switch that had been refused.
     The announcement has to sit after the awaited api() call, inside fn. */
  assert.ok(handler.indexOf('await api(') < handler.indexOf('DCNotify.switched'),
    'the card must come after the awaited save, not off studioDo\'s promise');
  assert.ok(!/\.then\(\(\)=>\{if\(window\.DCNotify\)window\.DCNotify\.switched/.test(handler),
    'and never off a .then(), which cannot tell success from refusal here');
});

test('studioDo shows work in flight without flashing on a fast action', () => {
  const page = src('src/public/index.html');
  const start = page.indexOf('const studioDo=async(fn,ok,onFail)=>');
  const body = page.slice(start, start + 800);
  assert.match(body, /DCNotify\.working/, 'a slow action must show that it is running');
  assert.match(body, /setTimeout\([^,]*,\s*400\)/,
    'and must wait before doing so -- a card that flashes up and away on an instant action is noise');
  assert.match(body, /note\.fail\(/, 'a failure resolves the spinner rather than leaving it spinning');
});

/* ------------------------------------------------------------------ *
 * 7. The look, in both themes. The old dock computed a dark brown box on
 *    paper because --surface-2 is not a themed token, so in Daylight the
 *    notifications were dark slabs on a white page.
 * ------------------------------------------------------------------ */
test('the dock has a palette for night and for both paper themes', () => {
  const sheet = src('src/public/studio-notify.css');
  const night = /#dcNotes\s*\{([\s\S]*?)\}/.exec(sheet)[1];
  const paper = /body\.dc-light #dcNotes[^{]*\{([\s\S]*?)\}/.exec(sheet);
  assert.ok(paper, 'the desktop paper theme must redefine the dock palette');
  assert.match(paper[0], /body\.dcm-light/,
    'and the phone keeps its theme in a SEPARATE preference, so it needs the same override');
  for (const token of ['--dcn-card', '--dcn-line', '--dcn-ink', '--dcn-dim', '--dcn-gold', '--dcn-good', '--dcn-bad']) {
    assert.ok(night.includes(token), `night must define ${token}`);
    assert.ok(paper[1].includes(token),
      `paper must redefine ${token}, or it falls back to the night value on a white page`);
  }
});

test('reduced motion still shows the spinner and still animates the exit', () => {
  const sheet = src('src/public/studio-notify.css');
  const block = sheet.slice(sheet.indexOf('@media (prefers-reduced-motion: reduce)'));
  /* A frozen spinner reads as a hang -- status motion is essential, and this
     repo has written that rule down twice already. */
  assert.match(block, /\.dcn-work \.dcn-ic svg\s*\{\s*animation-duration/,
    'the spinner is slowed, never stopped');
  assert.match(block, /\.dcn\.is-going\s*\{\s*animation: dcnFadeOut/,
    'and the exit still runs: tearing a card out mid-animation blinks');
});
