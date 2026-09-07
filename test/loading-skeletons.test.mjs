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
  assert.match(body, /section\.parentElement!==container/, 'then takes that container\'s own section');
});

test('THE PHONE HAS NO <main>, so the container is found per surface', () => {
  // Requiring a <main> ancestor meant NOTHING painted at 390px — the phone
  // shell has none; .dcm-body holds the screen's cards directly.
  //
  // And the second cut was worse than the bug: treating .dcm-body as the
  // SECTION rather than as the container made the ask card's own header the
  // section, so the skeleton went INSIDE the ask card and hid its input, chips
  // and Ask button while the stray footnote below stayed on display.
  const body = fn('paintLoadingSkeleton');
  assert.match(body, /closest\('\.dcm-body'\)/, 'the phone container is the body of the screen');
  const containerAt = body.indexOf('const phoneBody=');
  const sectionAt = body.indexOf('let section=anchor;');
  assert.ok(containerAt > 0 && sectionAt > containerAt,
    'the container is resolved BEFORE the section is walked up to it');
  // dcm-body is a literal class studio-mobile.js writes, so it survives a
  // design re-import — unlike anything hashed.
  const mobile = fs.readFileSync(new URL('../src/public/studio-mobile.js', import.meta.url), 'utf8');
  assert.match(mobile, /dcm-body/, 'and the phone actually writes it');
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

test('THE PHONE KEEPS ITS OWN THEME, so the tokens flip under its key too', () => {
  // body.dcm-light is a SEPARATE key from the desktop's dc-light, and
  // `dcm-light` does not contain the substring `dc-light` — so nothing that
  // flips for paper flipped for a paper phone. Measured before the fix:
  // --dc-skel-fill stayed at night's #f2f2f41c against a #F4EFE4 ground, and
  // the label sat at 2.8:1. After: 1.22:1 block step and 5.26:1 label, the
  // same readings the desktop's paper theme gives.
  const arm = /body\.dcm-light #dcMobile \{([^}]*)\}/.exec(tokens);
  assert.ok(arm, 'the phone has a paper arm');
  for (const token of ['--dc-skel-fill', '--dc-skel-sweep', '--dc-skel-ink']) {
    assert.match(arm[1], new RegExp(token.replace(/-/g, '\\-') + ':'), `${token} flips on the phone too`);
  }
  // Scoped to #dcMobile rather than declared on the body, because Owner, Help
  // and the editor are still FRAMED from the desktop's own dark DOM inside a
  // paper phone — they paint into #studio and must keep the night values, or
  // this would blank them out instead of fixing them.
  assert.doesNotMatch(tokens, /body\.dcm-light \{[^}]*--dc-skel-fill/,
    'never declared on the body, or the framed dark screens would take paper values');
});

test('the skeleton has its OWN ink token, not the general one', () => {
  // --dc-ink-dim is redefined for the desktop's paper theme only, so on a
  // paper phone the label kept night's #8B8B93 on warm paper.
  assert.match(tokens, /\.dc-skel-say \{[\s\S]*?color: var\(--dc-skel-ink/);
  assert.match(tokens, /:root \{[\s\S]*?--dc-skel-ink:/);
  assert.match(tokens, /body\.dc-light \{[\s\S]*?--dc-skel-ink:/);
});

test('the light-theme generator skips the phone\'s key, and closes nested groups', () => {
  const script = fs.readFileSync(new URL('../scripts/build-light-theme.mjs', import.meta.url), 'utf8');
  // `dcm-light` is NOT caught by the dc-light test — a rule already written for
  // the phone's paper theme, re-scoped under the desktop's, would be
  // `body.dc-light body.dcm-light …`: a body inside a body, matching nothing.
  assert.match(script, /includes\('dcm-light'\)/);
  const generated = fs.readFileSync(new URL('../src/public/studio-light.generated.css', import.meta.url), 'utf8');
  assert.doesNotMatch(generated, /dcm-light/, 'so no such rule is emitted');

  // A STACK, not one slot. studio-tokens.css nests @media (min-width: 1200px)
  // inside @media (min-width: 821px), and with a single slot the inner group's
  // `}` cleared it — the outer was never closed and EVERY rule after it was
  // emitted inside the desktop media query. Measured before the fix: 53 of 681
  // rules, the whole skeleton block among them, so their daylight colours
  // simply did not apply below 821px.
  assert.match(script, /const groups = \[\]/);
  let open = 0, trapped = 0, total = 0, current = null;
  for (const raw of generated.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('@')) { current = line; open += 1; continue; }
    if (line === '}') { open = Math.max(0, open - 1); current = null; continue; }
    if (line.includes('{') && line.endsWith('}')) {
      total += 1;
      if (open && current && current.includes('821')) trapped += 1;
    }
  }
  assert.ok(total > 400, 'the sheet was read');
  assert.ok(trapped < 10, `only genuinely desktop-only rules sit in the 821px group, saw ${trapped}`);
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
