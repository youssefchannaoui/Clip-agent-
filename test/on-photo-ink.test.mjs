import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * INK OVER A PHOTOGRAPH MUST NOT FLIP WITH THE THEME.
 *
 * A clip's duration, its template name and a lecture's status line are drawn
 * on top of the thumbnail IMAGE, with no ground of their own. The photograph
 * is the same picture in both themes -- it does not get lighter in daylight --
 * so ink that inverts for paper lands dark-on-dark. Measured against the real
 * pixels (screenshot each label's own rect with the label hidden, take the
 * mean): ALL 22 such text nodes were under 3:1 in daylight, '0:44' at 1.12
 * and 'Clean Line' at 1.17, against 0 of 24 in the dark. Not dim -- gone.
 *
 * This is a SOURCE test on purpose. CI has no browser, and this is exactly the
 * rule that is invisible when it goes missing: the app renders, the suite
 * stays green, the labels just disappear again on one theme. Same reason
 * `dc-nav-tail` and the `overflow-anchor` rule are pinned this way.
 *
 * Every assertion below was proven red against the behaviour it pins.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const adapter = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');
const tokens = fs.readFileSync(path.join(root, 'src/public/studio-tokens.css'), 'utf8');

/** The body of one function in the adapter, brace-matched. */
function fn(name) {
  const at = adapter.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} is missing from studio-adapter.js`);
  let depth = 0, i = adapter.indexOf('{', at);
  const start = i;
  for (; i < adapter.length; i++) {
    if (adapter[i] === '{') depth += 1;
    else if (adapter[i] === '}') { depth -= 1; if (!depth) break; }
  }
  return adapter.slice(start, i + 1);
}

test('the marker travels with the photograph, and only with it', () => {
  // thumb() is the one place twelve call sites get their background from, so
  // emitting the marker HERE is what makes it inseparable from the image. A
  // card falling back to the raised ground must NOT carry it -- that ground
  // does flip with the theme, and forcing night ink onto it is the same bug
  // pointing the other way.
  // Split the ternary on its own `:` branch, not on the first colon in the
  // body -- the CSS strings inside it are full of them, and a naive split
  // handed this test two fragments of one string and failed against correct
  // code.
  const body = fn('thumb');
  const parts = body.split(/\n\s*:\s*(?=')/);
  assert.equal(parts.length, 2, 'thumb() is no longer one ternary -- re-read it');
  const [withUrl, without] = parts;
  assert.match(withUrl, /--dc-on-photo/, 'a real thumbnail does not carry the marker');
  assert.doesNotMatch(without, /--dc-on-photo/, 'the no-image fallback carries the marker');
});

test('the lecture card builds its own thumbnail, and carries the marker too', () => {
  // It does not go through thumb(): it paints a linear-gradient scrim over the
  // photo itself. That is the call site the first cut of this fix missed, and
  // the sweep still reported four labels at 2.28:1 afterwards.
  const at = adapter.indexOf('background-image: linear-gradient(to bottom, rgba(8,8,10,0) 40%');
  assert.ok(at > -1, 'the lecture card thumbnail is gone or rebuilt');
  assert.match(adapter.slice(at, at + 400), /--dc-on-photo/,
    'the lecture card paints a photograph and does not mark it');
});

test('the ink rule selects the marker, never a hashed class', () => {
  const at = tokens.indexOf('[style*="--dc-on-photo"]');
  assert.ok(at > -1, 'the on-photo ink rule is gone -- every label over a thumbnail flips again');
  const rule = tokens.slice(at, tokens.indexOf('}', at));
  assert.match(rule, /color:\s*var\(--dc-on-scrim-/, 'the rule must hand out a theme-invariant ink');
  // An id is what beats the generated rule's own class (1-2-0 against 0-1-0).
  const selector = tokens.slice(tokens.lastIndexOf('\n', at), tokens.indexOf('{', at));
  assert.match(selector, /#studio|#dcMobile/, 'without an id the generated class wins on specificity');
  assert.doesNotMatch(selector, /\.s[0-9a-z]{2,3}\b/, 'a hashed class renumbers on a design re-import');
});

test('the ink it hands out is theme-invariant by construction', () => {
  // --dc-on-scrim-* are declared on :root and NOWHERE else. build-light-theme
  // skips :root by design, so a token defined only there cannot be redefined
  // for daylight by anyone forgetting not to -- which is the whole point of
  // having a separate family rather than reusing --dc-ink-body.
  const at = tokens.indexOf('[style*="--dc-on-photo"]');
  const name = tokens.slice(at, tokens.indexOf('}', at)).match(/var\((--dc-on-scrim-[a-z0-9-]+)/)[1];
  const decls = [...tokens.matchAll(new RegExp(`^\\s*${name}\\s*:`, 'gm'))];
  assert.equal(decls.length, 1, `${name} is declared ${decls.length} times -- it must be declared once, on :root`);
  const before = tokens.slice(0, decls[0].index);
  assert.match(before.slice(before.lastIndexOf('{', before.length) - 200), /:root\s*\{[^}]*$/s,
    `${name} is not declared on :root`);
});
