import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

/**
 * A screen that is fetching must not look finished (v3.145.0).
 *
 * Two screens fetch when they OPEN and both looked wrong while they waited.
 * MEASURED before anything was built, by slowing /api/owner and /api/deenai in
 * a real browser:
 *
 *   Owner   calls FOUR endpoints and only repaints when all four settle, so a
 *           first open drew a complete, confident screen of ZEROS — "MRR none
 *           active", "A$0.00", "STRIPE NOT CONFIGURED" — for the whole round
 *           trip. Worse than a spinner: a spinner says wait, a zero says your
 *           money is gone.
 *   DeenAI  drew its header and the ask box and then NOTHING beneath them,
 *           under a footnote reading "Every figure above is counted from your
 *           own clips" — about figures that were not there.
 *
 * Boot needed nothing and was checked rather than assumed: #splash holds the
 * screen until /api/state answers, with a timeout that says "taking longer
 * than expected". An earlier reading of "blank page" was wrong — it looked at
 * #gate/#app/#connect and missed the splash covering them.
 *
 * CI has no browser, so this pins the shape: the painter exists, runs from
 * paintStudio, covers both surfaces, hides rather than removes, restores, and
 * the fill is a per-theme token rather than one that inverts wrongly.
 */
const host = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
const tokens = fs.readFileSync(new URL('../src/public/studio-tokens.css', import.meta.url), 'utf8');

function fn(name) {
  const at = host.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name} exists`);
  return host.slice(at, host.indexOf('\n    }', at));
}

test('the painter runs from paintStudio, like every other host panel', () => {
  assert.match(host, /paintAiActions\(vals\);\n\s*paintLoadingSkeleton\(\);/,
    'in the list, never on an observer');
});

test('it only paints while the screen has NOTHING to show', () => {
  // A refresh over data already on screen must not blank it: the old numbers
  // stay true until the new ones land, and blanking them is a second flicker.
  const body = fn('paintLoadingSkeleton');
  assert.match(body, /ownerBusy&&!\(window\.DC_OWNER&&window\.DC_OWNER\.finance\)/);
  assert.match(body, /aiBusyLoad&&!window\.DC_DEENAI/);
});

test('both loads actually set the flag it reads', () => {
  // Owner's flag, and DeenAI's — the template's own "reading your numbers"
  // block is gated on `aiBusy`, which only the ASK sets, so the screen's own
  // load had nothing at all.
  assert.match(host, /StudioAdapter\.ui\.ownerBusy=true;/);
  assert.match(host, /ownerLoading=false;StudioAdapter\.ui\.ownerBusy=false/);
  assert.match(host, /StudioAdapter\.ui\.aiBusyLoad=true;renderAll\(\);/);
  assert.match(host, /deenaiLoading=false;StudioAdapter\.ui\.aiBusyLoad=false/);
});

test('the data region is HIDDEN, never removed', () => {
  // Taking a generated node out shortens the live child list against the
  // rendered one and the patcher pairs everything after it one across — the
  // v3.124.5 lesson. Hidden in place, and restored.
  const body = fn('paintLoadingSkeleton');
  assert.match(body, /style\.display='none'/);
  assert.doesNotMatch(body.replace(/\/\*[\s\S]*?\*\//g, ''), /\.remove\(\)[^;]*skelhid/);
  const restore = fn('skelRestore');
  assert.match(restore, /style\.display=''/);
  assert.match(restore, /removeAttribute\('data-host-skelhid'\)/);
  assert.match(body, /data-host-owned/, 'the skeleton itself is marked for the patcher');
});

test('the anchor is a SECTION of the screen, not the deepest node with the words', () => {
  // The first cut matched the innermost tab container, so "everything after
  // the anchor" meant its siblings INSIDE that container — one nested element
  // hidden and the whole KPI row still on display.
  const body = fn('paintLoadingSkeleton');
  assert.match(body, /parentElement\.tagName!=='MAIN'/, 'it walks up to the screen root');
  assert.match(body, /section\.parentElement!==screenRoot/, 'then takes that root\'s own section');
});

test('it names no hashed class — the anchors are the design\'s own words', () => {
  const at = host.indexOf('const SKEL_AT=');
  assert.ok(at > 0);
  const table = host.slice(at, host.indexOf('};', at));
  assert.match(table, /Overview/);
  assert.match(table, /ASK DEENAI/i);
  const code = fn('paintLoadingSkeleton').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\.s[0-9][0-9a-z]?\b/, 'no generated class name');
});

test('both surfaces, because the phone draws its own screens', () => {
  assert.match(fn('paintLoadingSkeleton'), /#dcMobile, #studio/,
    'scoped to #studio alone it paints where nobody can see it');
});

test('THE FILL IS A PER-THEME TOKEN, not one that inverts the wrong way', () => {
  // --dc-bg-alt was the obvious choice and it was wrong: it inverts to
  // near-white on paper, so the blocks sat at 1.07:1 on a white card. A
  // skeleton nobody can see is worse than none — the screen just looks blank,
  // which is the complaint this whole change exists for.
  // Measured after: 1.32:1 dark, 1.22:1 light.
  assert.match(tokens, /--dc-skel-fill:/, 'declared');
  const dark = /:root \{[\s\S]*?--dc-skel-fill: ([^;]+);/.exec(tokens);
  const light = /body\.dc-light \{[\s\S]*?--dc-skel-fill: ([^;]+);/.exec(tokens);
  assert.ok(dark && light, 'declared for BOTH themes');
  assert.notEqual(dark[1].trim(), light[1].trim(), 'and they differ');
  // The rule reads only var(), so build-light-theme finds no hex to remap and
  // leaves it alone — the escape hatch v3.127.0 established.
  assert.match(tokens, /\.dc-skel-b \{[\s\S]*?background: var\(--dc-skel-fill\);/);
  const generated = fs.readFileSync(new URL('../src/public/studio-light.generated.css', import.meta.url), 'utf8');
  assert.doesNotMatch(generated, /\.dc-skel-b\{background:#/, 'the generator did not re-emit it');
});

test('a skeleton is the only thing saying the screen works, so reduced motion keeps the SHAPE', () => {
  // Only the sweep goes — the same call the processing spinners make, because
  // a frozen skeleton still says "loading" and an absent one says nothing.
  const at = tokens.indexOf('@media (prefers-reduced-motion: reduce)', tokens.indexOf('.dc-skel-b'));
  const block = tokens.slice(at, at + 200);
  assert.match(block, /\.dc-skel-b \{ animation: none/);
  assert.doesNotMatch(block, /display: none/, 'the shapes stay');
});

test('it is announced, not only drawn', () => {
  // A block of grey rectangles tells a screen reader nothing.
  const body = fn('paintLoadingSkeleton');
  assert.match(body, /setAttribute\('role','status'\)/);
  assert.match(body, /setAttribute\('aria-live','polite'\)/);
  assert.match(fn('skelMarkup'), /Reading your books/);
  assert.match(fn('skelMarkup'), /Reading your clips/);
});
