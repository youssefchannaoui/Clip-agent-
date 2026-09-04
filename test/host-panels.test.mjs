/* ── Every node the host puts into the design's tree says so ───────────────
 *
 * `studio-runtime.js` patch() pairs a container's LIVE children against the
 * freshly rendered ones BY INDEX, skipping only the ones carrying
 * `data-host-owned`. So a panel the host injects and does not mark is paired
 * against a generated sibling: it is given that sibling's attributes, its own
 * children are replaced with the sibling's, and everything after it in the
 * container shifts one place across. That is what destroyed the Home paste
 * field (v3.124.2) -- typing into it survived exactly one keystroke.
 *
 * Swept on 4 Sept 2026 across every screen by forcing an idle repaint
 * (STUDIO.lastHtml = ''; paintStudio()) with removeChild/replaceChild/
 * appendChild wrapped, and the same fault was live in TEN more places. What
 * the sweep measured, before and after:
 *
 *   DOM operations on an unchanged repaint  ...  0-29 per screen  ->  0
 *   host nodes destroyed by one             ...  up to 14         ->  0
 *   focus kept on the Templates watermark
 *   switch, the bell's email switch and a
 *   Lecture-library row                     ...  lost to <body>   ->  kept
 *   the rail seal's 28s rotation            ...  reset every poll ->  runs
 *
 * CI HAS NO BROWSER, so none of that can be re-measured here -- and this is
 * exactly the shape of rule that is invisible when it goes missing: the app
 * renders, the suite stays green, the panel just churns again. So this file
 * reads the source, the way test/rail-nav.test.mjs and the overflow-anchor
 * test already do for the same reason.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const page = read('src/public/index.html');

/* Each entry: the id, the createElement line that makes it, and why it is
   injected into generated markup rather than added to the design export. */
const PANELS = [
  ['dcEmailNotifRow', "row.id='dcEmailNotifRow'", 'a row inside the bell dropdown'],
  ['dcowEarn', "box.id='dcowEarn'", 'the earnings table on Owner'],
  ['dcowFirst100', "box.id='dcowFirst100'", 'the First 100 funnel on Owner'],
  ['dcInvite', "box.id='dcInvite'", 'the invite panel on Tokens'],
  ['dcWatermark', "box.id='dcWatermark'", 'the brand switches on Templates'],
  ['dcLibStats', "box.id='dcLibStats'", "the Lecture library's sidebar"],
  ['dcSchedChannels', "box.id='dcSchedChannels'", 'the channel switcher on Schedule'],
  ['dcHelp', "el.id='dcHelp'", 'the whole Help screen'],
  ['dcOnboard', "row.id='dcOnboard'", 'the Create/Review/Publish strip on Home'],
  ['dcTaskSlot', "slot.id='dcTaskSlot'", "the task ladder's rail card"],
  ['dcFirstRunHead', "head.id='dcFirstRunHead'", "the beginner's headline"],
  ['dcFirstRunSteps', "steps.id='dcFirstRunSteps'", "the beginner's three beats"],
  ['dcFirstRunCost', "cost.id='dcFirstRunCost'", "the beginner's cost line"],
  ['dcFirstRunShow', "show.id='dcFirstRunShow'", "the beginner's tour card"],
];

test('every host panel injected into the design tree carries data-host-owned', () => {
  for (const [id, made, why] of PANELS) {
    const at = page.indexOf(made);
    assert.ok(at > -1, id + ' (' + why + ') is no longer created here — update this list');
    /* The marker must be set on the SAME statement or the next line or two:
       anywhere later and a paint between the two leaves it unmarked. */
    const near = page.slice(at, at + 260);
    assert.match(near, /setAttribute\('data-host-owned'/,
      id + ' (' + why + ') must be marked, or patch() pairs it against a generated sibling');
  }
});

/* Marking stops the PATCHER destroying a panel. It does nothing about the
   PAINTER, which assigned innerHTML on every call -- so the panel rebuilt its
   own controls on every state poll, roughly every two seconds, and focus fell
   to <body>. dcSetHtml writes only when the markup actually changed, keeping
   the signature on a JS property nothing in the patcher can strip. */
test('a host panel is only redrawn when its markup changed', () => {
  assert.match(page, /window\.dcSetHtml=function\(node,html\)\{/, 'the one guard exists');
  assert.match(page, /if\(node\.__dcHtml===html\)return false;/, 'and it compares before writing');
  /* The panels whose painter rewrote everything every time. #dcSchedChannels
     and the task card keep their own signature checks (dataset.sig and a
     string compare) and are deliberately not here; the clip card's "Posts to"
     row keeps its data-dc-dest signature, which works now that the row is
     marked and the patcher leaves the attribute alone. */
  const GUARDED = ['dcEmailNotifRow', 'dcowEarn', 'dcowFirst100', 'dcInvite', 'dcWatermark',
    'dcLibStats', 'dcHelp', 'dcOnboard', 'dcFirstRunHead', 'dcFirstRunSteps',
    'dcFirstRunCost', 'dcFirstRunShow'];
  for (const id of GUARDED) {
    const made = PANELS.find((p) => p[0] === id)[1];
    const at = page.indexOf(made);
    /* From where the panel is made to the end of the painter that makes it. */
    const next = page.indexOf('\nfunction ', at);
    const body = page.slice(at, next > -1 ? next : at + 9000);
    assert.match(body, /window\.dcSetHtml\(/,
      id + ' is redrawn unconditionally — every state poll rebuilds its controls');
  }
});

test('the waveform keeps a signature the patcher cannot strip', () => {
  /* The strip is the DESIGN'S own node, so syncAttributes rewrites its
     attributes from the render every paint and removes any the render does not
     carry. `data-wave` was one of those, so the guard never once matched and
     every card's bars were rebuilt on every poll. data-host-* is the one
     family syncAttributes leaves alone. */
  const at = page.indexOf('function paintClipWaveforms');
  const body = page.slice(at, page.indexOf('function paintPlanChip'));
  assert.match(body, /getAttribute\('data-host-wave'\)===signature/, 'the guard reads a surviving name');
  assert.ok(!/dataset\.wave/.test(body), 'data-wave is stripped by syncAttributes');
  assert.match(body, /setAttribute\('data-host-style'/, "and the host's inline styles survive too");
  /* The bars are children the render does not have, so patch() removes them
     unless each one says it is ours. */
  assert.ok((body.match(/<i data-host-owned/g) || []).length >= 1, 'the bars are marked');
  assert.match(body, /<span data-host-owned style="position:absolute/, 'and so is the flat baseline');
});

test('the library sidebar HIDES the design\'s warnings card, never removes it', () => {
  /* Taking a generated node out shortens the live child list against the
     rendered one, so everything after it pairs one place across -- which is
     how #dcLibStats was handed the warnings card's markup and lost its own id,
     on every state poll. */
  const at = page.indexOf('function paintLibraryAside');
  const body = page.slice(at, page.indexOf('let dragCell', at));
  assert.match(body, /sec\.setAttribute\('data-host-style'/, 'marked so the style survives a patch');
  assert.match(body, /sec\.style\.display='none'/, 'and hidden rather than removed');
  assert.ok(!/^\s*if\(\/\^Before you import\/\.test\(sec\.textContent\|\|''\)\)sec\.remove\(\);/m.test(body),
    'removing it shifts every generated sibling after it');
});

test('the rail seal is a sibling of the arch, not a wrapper around it', () => {
  /* A wrapper around a generated node is one the patcher cannot be told to
     skip: marked, the child it holds is inserted a second time; unmarked --
     which is what shipped -- it is paired against the arch's own span, given
     its class and then patched, which replaced the arch and deleted the ring.
     So the seal was rebuilt on every poll and its 28s rotation restarted
     before a single degree of it was ever seen. Measured on the shipped code:
     currentTime 0, 0, 0, 0 across four repaints a second apart; after:
     4983, 6117, 7250, 8366. */
  const at = page.indexOf('function paintBrandSeal');
  const body = page.slice(at, page.indexOf('\n}', page.indexOf('holder.insertBefore(ring', at)));
  assert.ok(!/createElement\('span'\)/.test(body), 'no wrapper is created');
  assert.ok(!/seal\.appendChild\(holder\)/.test(body), 'and the arch is never moved into one');
  assert.match(body, /ring\.setAttribute\('data-host-owned', ?''\)/, 'the ring says it is ours');
  assert.match(body, /holder\.insertBefore\(ring,holder\.firstChild\)/,
    "and goes inside the design's own span");
  /* The 42px box and the .86 scale moved with it, addressed through the arch
     rather than through a hashed class a re-import renumbers. */
  const css = read('src/public/studio-tokens.css');
  assert.match(css, /#dcRailBrand > span:has\(> svg\[viewBox="0 0 40 52"\]\)/,
    'the seal box is on the design\'s span now');
  assert.ok(!/#dcRailBrand \.dc-seal \{/.test(css), 'and the wrapper rule is gone');
});

test('nothing generated is moved into the rail nav', () => {
  assert.ok(!/seatTaskCard/.test(page), 'the task card has its own container');
  const at = page.indexOf('function railFooterSlot(){');
  const body = page.slice(at, page.indexOf('function paintTaskCard'));
  assert.match(body, /insertBefore\(slot, ?tail\)/, 'inserted above the DeenAI/Help/Owner tail');
  assert.match(body, /setAttribute\('data-host-owned'/, 'and marked');
});
