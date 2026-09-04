import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * EVERY ACTION ON A CLIP CARD IS NAMED, AND THE CARD HAS ROOM FOR THE WORDS.
 *
 * Youssef, 4 Sept 2026, with an OpusClip screenshot: "see how good opus does
 * it, clean very helpful and buttons for many features ... focus on making the
 * website more clean, more spacsious less croweded".
 *
 * Measured before anything changed: the card offered SIX actions and FOUR had
 * no visible label, in a grid whose floor was 190px -- so a card was ~202px at
 * EVERY viewport width and a wider screen bought more cards, never a bigger
 * one. After: 246 / 336 / 271 / 319px at 1100 / 1280 / 1440 / 1920, and one
 * unlabelled action left (the AI star, which is an overlay and keeps its
 * tooltip).
 *
 * A SOURCE test, deliberately: CI has no browser, and these are the rules that
 * are invisible when they go missing -- the app renders, the suite stays
 * green, and the labels are simply gone again. Same reason `dc-nav-tail` and
 * the overflow-anchor rule are pinned this way. Every assertion was proven
 * red.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/public/studio-tokens.css'), 'utf8');

/** The body of one function in index.html, brace-matched. */
function fn(name) {
  const at = html.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} is missing from index.html`);
  let depth = 0, i = html.indexOf('{', at);
  const start = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') { depth -= 1; if (!depth) break; }
  }
  return html.slice(start, i + 1);
}

test('the label painter runs from paintStudio, never an observer', () => {
  // The lesson v3.53.5 paid three attempts for: an observer reacting to a
  // removal cannot win against the render that removed it.
  const list = html.slice(html.indexOf('  paintClipStars(vals);'), html.indexOf('  paintClipStars(vals);') + 1200);
  assert.match(list, /paintClipActions\(/, 'paintClipActions is not in paintStudio\'s list');
});

test('its nodes are host-owned and swept by their own marker', () => {
  const body = fn('paintClipActions');
  assert.match(body, /setAttribute\('data-host-owned'/,
    'an unmarked host node is paired against a generated sibling by patch()');
  // Sweeping by the CARD cannot find a node that was carried onto a different
  // card by a re-pair -- the stranded-star fault, v3.125.0 finding 10.
  assert.match(body, /querySelectorAll\('#studio \[data-dc-alabel\]'\)/,
    'the sweep must run over the marker, not over [data-clip]');
});

test('an overlay control is never labelled', () => {
  // The first cut stuffed the word "Select" into the 22x22 tick on the
  // thumbnail, which is pinned by an INLINE width so no stylesheet could widen
  // it: the text was clipped inside the box. An action sits in the card's
  // flow; a state toggle drawn over the picture is absolutely positioned.
  const body = fn('paintClipActions');
  assert.match(body, /getComputedStyle\(btn\)\.position === 'absolute'\) continue/,
    'an absolutely-positioned button is not skipped -- the select tick gets a word in it');
});

test('a button that already shows words is left alone', () => {
  // Approve and Restore are drawn by the design with their own text. Appending
  // to them would double the label.
  const body = fn('paintClipActions');
  assert.match(body, /if \(shows\)/, 'the painter does not check whether the button already shows text');
  // and its own tag must not count as the button's own text, or the label
  // would be removed on the very next repaint.
  assert.match(body, /data-dc-alabel/, 'the "already shows text" check must exclude our own tag');
});

test('the grid is selected by [data-clip], never a hashed class', () => {
  const at = css.indexOf('div:has(> article[data-clip])');
  assert.ok(at > -1, 'the clip-grid rule is gone -- cards go back to ~202px at every width');
  const near = css.slice(Math.max(0, at - 400), at + 400);
  assert.doesNotMatch(near.replace(/\/\*[\s\S]*?\*\//g, ''), /\.s[0-9a-z]{2,3}\b/,
    'a hashed class renumbers on a design re-import');
});

test('the card floor is two-step, or the narrow desktop drops to one card', () => {
  // At 1100 the queue's grid has 510px (a 300px aside at every width), and a
  // flat 258px floor gave a SINGLE 510px card per row. Measured.
  const block = css.slice(css.indexOf('THE CLIP CARD: FEWER, WIDER'));
  const floors = [...block.matchAll(/minmax\((\d+)px, 1fr\)/g)].map(m => Number(m[1]));
  assert.ok(floors.length >= 2, `expected two card floors, found ${floors.length}`);
  assert.ok(floors[0] < floors[1], 'the narrow step must be the smaller floor');
  assert.match(block, /@media \(min-width: 1200px\)/, 'the wider floor is not behind its own query');
});

test('none of it escapes the desktop query', () => {
  // Below 821px this nav is the phone shell and these cards are drawn by
  // studio-mobile.js instead.
  const at = css.indexOf('THE CLIP CARD: FEWER, WIDER');
  const before = css.slice(0, css.indexOf('div:has(> article[data-clip])', at));
  assert.match(before.slice(-400), /@media \(min-width: 821px\) \{[^}]*$/s,
    'the clip-card rules are not inside the desktop query');
});
