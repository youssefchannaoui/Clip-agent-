import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * The rail's grouping and its bottom cluster.
 *
 * Both failures guarded here are SILENT -- the app renders, every other test
 * stays green, and the only symptom is a sidebar that looks wrong:
 *
 *  - `dc-nav-tail` is the ONLY hook holding DeenAI, Help and Owner at the foot
 *    of the rail (studio-tokens.css). Lose it and they slide back up into the
 *    middle of the list, leaving the 340px of dead space this arrangement was
 *    built to remove.
 *  - The two group headings ("Produce", "Set up") are literal strings inside
 *    the generated template, so they cannot be renamed without a design
 *    re-import. What each group MEANS is therefore carried entirely by which
 *    items are put in it, and nothing but this test says so.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');

const sandbox = {
  window: {},
  document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  innerWidth: 1440,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const A = sandbox.StudioAdapter;

const DATA = {
  clips: [], projects: [],
  user: { role: 'owner', email: 'owner@deenclipped.test' },
  billing: { current: { plan: 'studio_monthly' } },
};

// The adapter runs in a vm context, so the arrays it returns are that realm's
// Array -- strict deepEqual compares prototypes and rejects them. Array.from
// is the host's, so this copies the values into arrays these assertions can
// actually read.
const railOf = data => {
  A.ui.screen = 'home';
  A.ui.railOpen = true;
  const b = A.bindings(data);
  return {
    produce: Array.from(b.navProduce, i => String(i.label)),
    setup: Array.from(b.navSetup, i => String(i.label)),
    all: Array.from(b.navSetup, i => ({ label: String(i.label), mobileClass: String(i.mobileClass || '') })),
  };
};

test('Produce is the working loop, end to end', () => {
  // Bring a lecture in, decide on the clips, give them slots, see how they
  // did. Performance sat under "Set up", which it has never been.
  assert.deepEqual(railOf(DATA).produce,
    ['Lecture library', 'Review queue', 'Schedule', 'Performance']);
});

test('Set up holds only what an account configures once, then the tail', () => {
  const { setup } = railOf(DATA);
  assert.deepEqual(setup.slice(0, 2), ['Templates', 'Nasheed library'],
    'the two configure-once screens lead the group');
  assert.deepEqual(setup.slice(2), ['DeenAI', 'Help', 'Owner'],
    'and the tail follows: assistant, support, the operator door');
});

test('the bottom cluster starts at DeenAI and is marked for the stylesheet', () => {
  const { all } = railOf(DATA);
  const tails = all.filter(i => String(i.mobileClass || '').split(/\s+/).includes('dc-nav-tail'));
  assert.equal(tails.length, 1, 'exactly one item opens the cluster');
  assert.equal(tails[0].label, 'DeenAI');
  // It rides on the class attribute the template already binds, which is why
  // this needed no design re-import.
  assert.match(tails[0].mobileClass, /dc-nav-(primary|secondary)/,
    'the tail marker is added to the phone class, never instead of it');
});

test('every tail item is hidden from the phone tab bar, which fits five', () => {
  // studio-responsive.css hides dc-nav-secondary on a phone. If a tail item
  // were ever promoted to primary it would appear in the tab bar AND take the
  // desktop auto-margin, which in a row layout pushes it out of line.
  const { all } = railOf(DATA);
  for (const item of all.slice(2)) {
    assert.match(item.mobileClass, /dc-nav-secondary/, `${item.label} would land in the phone tab bar`);
  }
});

test('a creator sees the same rail without the operator door', () => {
  const creator = { ...DATA, user: { role: 'creator', email: 'someone@deenclipped.test' } };
  const { setup } = railOf(creator);
  assert.deepEqual(setup, ['Templates', 'Nasheed library', 'DeenAI', 'Help'],
    'Owner is the operator\'s, and presentation is not the gate -- the routes are');
  // The cluster must still exist for everyone, or a creator gets the old
  // top-heavy rail back.
  assert.ok(setup.includes('Help'));
});

test('a collapsed rail names its icons on hover', () => {
  // The tooltip span has been in the template all along -- every nav item ends
  // in one carrying the label -- positioned, styled, and at `opacity: 0` with
  // nothing anywhere turning it on. So the collapsed rail was a column of
  // unlabelled icons and the control meant to fix that had never been wired.
  // Youssef, 1 Sept 2026: "Add on hover of mouse. It should come up with the
  // tab name."
  //
  // Both halves are needed and each fails silently without the other, so both
  // are asserted here.
  A.ui.railOpen = false;
  const collapsed = A.bindings(DATA);
  const items = Array.from(collapsed.navProduce).concat(Array.from(collapsed.navSetup));
  assert.ok(items.length >= 4, 'the rail has items to name');
  for (const item of items) {
    assert.ok(!/display:\s*none/.test(item.tipStyle), `${item.label} has a tooltip when collapsed`);
    assert.match(item.tipStyle, /opacity: 0/, 'which starts hidden, to be revealed on hover');
    assert.ok(item.label, 'and the tooltip renders item.label');
  }

  // Open, the label is already on screen, so the tooltip must stay away.
  A.ui.railOpen = true;
  for (const item of Array.from(A.bindings(DATA).navProduce)) {
    assert.match(item.tipStyle, /display: none/, `${item.label} has no tooltip when the rail is open`);
  }

  // The reveal. It has to be !important (the opacity above is an INLINE style,
  // which no stylesheet can outrank) and it must not fire on touch, where the
  // same nav is the phone's bottom tab bar and :hover sticks after a tap.
  const css = fs.readFileSync(path.join(root, 'src/public/studio-tokens.css'), 'utf8');
  const rule = /@media \(min-width: 821px\) and \(hover: hover\) \{\s*#dcRailNav a:hover > span:last-child \{ opacity: 1 !important; \}/;
  assert.match(css, rule, 'studio-tokens.css reveals the tooltip on hover');
});

test('the brand seal is painted with the other host panels, not on an observer', () => {
  // The rotating seal is injected into the generated template's brand row, and
  // the studio renders through innerHTML -- so it is destroyed on every paint
  // and must be restored synchronously at the end of paintStudio. A
  // MutationObserver loses that race during a drag; that lesson cost three
  // attempts on the watermark row (v3.53.3-v3.53.5) and is not worth paying
  // again.
  const html = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
  const paint = /function paintStudio\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(paint, /paintBrandSeal\(\)/, 'paintBrandSeal runs on every paint');
  // It must find the arch by its own viewBox. "The first svg in the row" finds
  // the ring once the ring is in, and wraps the wrapper on every paint.
  assert.match(html, /querySelector\('svg\[viewBox="0 0 40 52"\]'\)/);
});

/*
 * THE RAIL'S DENSITY (Youssef, 8 Sept 2026: "the old tabs starting to get
 * pretty clunk up ... make it, like, maybe smaller or whatever, so then it
 * looks more spacious").
 *
 * Silent in the same way as everything else in this file: the app renders, the
 * suite stays green, the sidebar just goes back to being a solid block. What
 * is pinned is the RELATIONSHIP -- rows smaller than the design draws them,
 * with more air between them than the design leaves -- and WHERE each half has
 * to live, which is not a preference:
 *
 *  - the row's own padding and the rail's width are INLINE styles from the
 *    adapter, because an inline style is the one thing a stylesheet cannot
 *    outrank (this repo has paid for that four times: the live-row spinner,
 *    the rail tooltips, the brand switches, the phone paste field);
 *  - the gaps and the type are hand-written CSS, because the generated ones
 *    (.s7 gap 14px, .s8 gap 2px) are HASHED and renumber on a design re-import.
 */
const tokens = fs.readFileSync(path.join(root, 'src/public/studio-tokens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');   // strip comments: they quote the values they replace

const railBlock = (() => {
  // The desktop block only. The same nav is the phone's bottom tab bar, so a
  // rail rule that escaped this query would lay a tab out as a list row.
  const at = tokens.indexOf('@media (min-width: 821px)');
  assert.ok(at > 0, 'the desktop rail block is gone');
  let depth = 0, i = tokens.indexOf('{', at);
  for (let j = i; j < tokens.length; j++) {
    if (tokens[j] === '{') depth++;
    else if (tokens[j] === '}' && --depth === 0) return tokens.slice(at, j + 1);
  }
  throw new Error('unbalanced media query');
})();

test('the rail gives its rows air, and never by naming a hashed class', () => {
  const gap = railBlock.match(/#dcRailNav\s*>\s*div\s*\{[^}]*gap:\s*([\d.]+)px/);
  assert.ok(gap, 'nothing sets the gap between nav rows, so .s8 wins at 2px and they read as one block');
  assert.ok(Number(gap[1]) > 2,
    `rows need more air than the design's 2px, got ${gap[1]}px`);
  assert.doesNotMatch(railBlock, /\.s[0-9][0-9a-z]{0,2}\b/,
    'a rail rule names a generated class, which a design re-import renumbers');
});

test('a nav row is smaller than the design draws it, and the rail narrower', () => {
  // Both are inline styles, so they can only be changed where they are written.
  const row = source.match(/gap: 9px; padding: ' \+ \(open \? '(\d+)px (\d+)px'/);
  assert.ok(row, 'the nav row no longer sets its own padding inline');
  assert.ok(Number(row[1]) < 8, `a row's vertical padding must be under the design's 8px, got ${row[1]}px`);
  const width = source.match(/width: ' \+ \(open \? '(\d+)px' : '68px'\)/);
  assert.ok(width, 'the rail no longer sets its own width inline');
  assert.ok(Number(width[1]) < 228, `the rail must be narrower than 228px, got ${width[1]}px`);
  assert.equal(source.includes("'68px'"), true, 'the collapsed width must stay 68px: the collapse control is centred on it');
});
