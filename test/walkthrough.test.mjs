import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * THE WALKTHROUGH IS DRIVEN HERE, NOT READ.
 *
 * The tests that came with it assert source strings, and this repo has now
 * been caught five times by a source test passing against a behaviour that
 * changed underneath it. These call tourNext, tourDismiss and tourSkip and
 * read what comes back.
 *
 * Every fault pinned below was found by driving the real app in a browser, and
 * every one of them was invisible to a green suite:
 *   - the veil had no hole, so every step told you to do something and then
 *     physically prevented it ("see cant do anything here");
 *   - a gated step could not be passed, so review / schedule / finish were
 *     unreachable in a first sitting;
 *   - one stray click on the dim spent the walkthrough for ever;
 *   - the review step's anchor does not exist on an account with no clips.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// A document stub with a switchable set of anchors, so an anchor LIST can be
// tested by taking the first one away.
const present = new Set();
const rects = new Map();
function el(sel) {
  return {
    sel,
    focus() { this.focused = true; },
    click() { this.clicked = true; },
    scrollIntoView() { this.scrolled = true; },
    querySelector: () => ({ focus() {} }),
    getBoundingClientRect: () => rects.get(sel) || { left: 100, top: 200, width: 300, height: 40 },
  };
}

const sandbox = {
  window: {},
  document: {
    addEventListener() {},
    querySelectorAll: () => [],
    getElementById: () => null,
    querySelector: (sel) => (present.has(sel) ? el(sel) : null),
  },
  innerWidth: 1440,
  innerHeight: 950,
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  localStorage: (() => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      _store: store,
    };
  })(),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('src/public/studio-adapter.js'), sandbox);
const A = sandbox.StudioAdapter;
const store = sandbox.localStorage._store;

// Nothing connected, no nasheed, no lecture: the account the walkthrough is
// written for, and the one every fault below showed up on.
const EMPTY = { social: { providers: {} }, tracks: [], projects: [], clips: [], tasks: {} };

function stepKeys() {
  const source = read('src/public/studio-adapter.js');
  const block = source.slice(source.indexOf('var TOUR = ['), source.indexOf('\n  ];', source.indexOf('var TOUR = [')));
  return [...block.matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
}

function at(step) {
  A.ui.tourStep = step;
  A.ui.tourAwait = null;
  A.ui.tourNavAt = null;
  A.ui.tourStarted = true;
  return A.bindings(EMPTY);
}

test('a gated step performs itself once, then lets you past — it is not a wall', () => {
  // Every step with a `done` used to refuse to advance until its condition was
  // met. A brand-new account could not get past "connect a channel" without
  // connecting one, nor past the import without a lecture -- and a lecture
  // takes about twenty minutes to come back. So review, schedule and finish
  // were UNREACHABLE in a first sitting, and pressing the button again did
  // nothing whatsoever: a dead control on the screen that teaches the product.
  present.clear();
  let opened = 0;
  A.onOpenConnections = () => { opened += 1; };

  const first = at(0);
  assert.equal(first.tourNextLabel, 'Connect a channel', 'the button is named after the thing it does');

  first.tourNext(null);
  assert.equal(opened, 1, 'the press performs the step');
  assert.equal(A.ui.tourStep, 0, 'and does NOT advance — it waits for a real channel');
  assert.equal(A.ui.tourAwait, 0, 'the walkthrough records that it is waiting on this step');

  const waiting = A.bindings(EMPTY);
  assert.equal(waiting.tourNextLabel, 'Next', 'the second press is an ordinary Next');
  assert.match(waiting.tourBody, /Waiting for you/, 'and the card says what it is waiting for');
  assert.match(waiting.tourBody, /moves on by itself/, 'including that it advances on its own');

  waiting.tourNext(null);
  assert.equal(A.ui.tourStep, 1, 'so the step can be walked past');
  assert.equal(A.ui.tourAwait, null,
    'and the wait is cleared, or a condition met later would yank you back to a step you left');
});

test('a step the card cannot perform never waits at all', () => {
  // Approving is a decision about somebody's content and the walkthrough must
  // never make it for them, so the review step has no `does` -- and a step with
  // nothing to perform must not pretend to be waiting on its own button.
  present.clear();
  const keys = stepKeys();
  const review = keys.indexOf('review');
  assert.ok(review > 0, 'there is a review step');
  const v = at(review);
  assert.equal(v.tourNextLabel, 'Next', 'its button says exactly what it does');
  v.tourNext(null);
  assert.equal(A.ui.tourStep, review + 1, 'and it advances on the first press');
});

test('clicking the dim puts the walkthrough away; only Skip spends it', () => {
  // "it randomly popped up for a sec then disappeared." The veil covers the
  // whole page and ate any click, and that click called endTour(), which writes
  // the seen key -- so one slip ended the walkthrough for ever with no way back
  // except finding it in the account menu.
  store.clear();
  const v = at(1);
  v.tourDismiss(null);
  assert.equal(A.ui.tourStep, -1, 'the dim is still a way out');
  assert.equal(store.get('dcTour:walkthrough'), undefined,
    'but it is NOT marked as seen, so it is there again on the next visit');

  const again = at(1);
  again.tourSkip(null);
  assert.equal(A.ui.tourStep, -1);
  assert.equal(store.get('dcTour:walkthrough'), '1',
    'the explicit Skip is a decision, and that one finishes it for good');
});

test('the veil has a hole at the spotlit control, and the ring does not fill it back in', () => {
  // MEASURED in Chromium before this was built: elementFromPoint at the centre
  // of the spotlit paste box returned the VEIL, so the box could not be clicked
  // or typed into. clip-path cuts a real hit-testing hole.
  present.clear();
  present.add('[data-tour="paste"]');
  rects.set('[data-tour="paste"]', { left: 262, top: 385, width: 478, height: 60 });
  const keys = stepKeys();
  const v = at(keys.indexOf('import'));

  assert.match(v.tourVeilStyle, /clip-path: polygon\(/, 'the veil is cut open');
  // The hole is the anchor's own rectangle, padded by the same number the ring
  // uses, so the two cannot drift apart.
  assert.ok(v.tourVeilStyle.includes('256px') && v.tourVeilStyle.includes('379px'),
    'the hole starts at the anchor, less the shared padding: ' + v.tourVeilStyle);
  assert.ok(v.tourVeilStyle.includes('746px') && v.tourVeilStyle.includes('451px'),
    'and ends at its far corner: ' + v.tourVeilStyle);

  // The spotlight used to paint its own 9999px shadow. Left in place it would
  // dim the page twice AND paint straight back over the hole the veil opened.
  assert.ok(!/9999px/.test(v.tourSpotStyle), 'the spotlight is the ring alone');
  assert.match(v.tourSpotStyle, /pointer-events: none/, 'and never takes the click itself');
  assert.match(v.tourSpotStyle, /left: 256px/, 'ring and hole share one rectangle');
});

test('with nothing to point at there is no hole, and the veil is whole', () => {
  present.clear();                       // no anchor resolves
  const v = at(0);
  assert.equal(v.tourSpotStyle, 'display: none;', 'no ring');
  assert.ok(!/clip-path/.test(v.tourVeilStyle),
    'and no hole — a gap cut at nothing would let clicks through to nowhere in particular');
});

test('an anchor may be a list, and the fallback is used when the first is absent', () => {
  // The review step wants the deck's Approve button. A brand-new account
  // walking this has just imported and has no clips, so there is no Approve
  // button to ring -- measured on a fresh account, that step drew NO highlight.
  present.clear();
  present.add('[data-tour="queue-tabrow"]');
  rects.set('[data-tour="queue-tabrow"]', { left: 244, top: 176, width: 862, height: 40 });
  const v = at(stepKeys().indexOf('review'));
  assert.match(v.tourSpotStyle, /left: 238px/, 'it falls back to the tab row');

  // And the fallback must be a CONTROL, not the screen. The container that was
  // already tagged `queue-tabs` measures 1224x847 on a 1440x950 screen -- 96%
  // of the viewport, which is the reason the first step's `rail` anchor was
  // taken off.
  const source = read('src/public/studio-adapter.js');
  const block = source.slice(source.indexOf('var TOUR = ['), source.indexOf('\n  ];', source.indexOf('var TOUR = [')));
  assert.ok(!/'queue-tabs'/.test(block), 'the whole-screen container is not an anchor');
  assert.ok(!/anchor: 'rail'/.test(block), 'nor is the whole sidebar');
});

test('the style step sits between the nasheed and the import', () => {
  // The per-screen tours it replaced covered Templates; the single walkthrough
  // dropped it, so a first run went connect -> nasheed -> import and the
  // captions were whatever the default happened to be. It comes BEFORE the
  // import because the style is applied when the clips are cut.
  assert.deepEqual(stepKeys(),
    ['connect', 'nasheed', 'style', 'import', 'review', 'schedule', 'finish']);
});

test('the first-run panel marks every node it puts in the generated tree', () => {
  /*
   * THE BUG THIS PINS COST THE PASTE BOX.
   *
   * studio-runtime's patch() pairs the live children of a container against the
   * freshly rendered ones by INDEX, skipping anything marked data-host-owned.
   * These three nodes were injected into the hero column unmarked, so the
   * pairing shifted by three and indices 5, 6 and 7 were removed on every
   * repaint -- one of which is the paste box. MEASURED: typing one character
   * rebuilt the input, focus fell to <body>, and every later keystroke went
   * nowhere. Pasting worked, which is why it survived unnoticed, and it is
   * exactly the control the walkthrough's import step tells you to use.
   *
   * A source test deliberately: CI has no browser, and this rule is invisible
   * when it is missing -- the app renders, the suite stays green, and the field
   * simply stops accepting typing.
   */
  const host = read('src/public/index.html');
  for (const id of ['dcFirstRunHead', 'dcFirstRunSteps', 'dcFirstRunCost', 'dcFirstRunShow']) {
    const line = host.split('\n').find((l) => l.includes(`.id='${id}'`));
    assert.ok(line, `${id} is created somewhere`);
    assert.match(line, /setAttribute\('data-host-owned'/,
      `${id} is injected into the generated tree and must say so, or the patcher `
      + 'mispairs everything after it');
  }
});
