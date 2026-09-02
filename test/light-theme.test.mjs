import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { daylight, toHsl } from '../scripts/theme-palette.mjs';

/**
 * Daylight — white, gold and black.
 *
 * There are TWO sources for this theme: the hand-written token block in
 * studio-tokens.css (which the whole app reads) and scripts/theme-palette.mjs
 * (which generates the sheet and the inline-style tokens). A colour that moves
 * in one and not the other is a seam down the middle of the screen, and that
 * has happened: v3.92.1 shipped a black weekday header because one stylesheet
 * was missing from the generator's list.
 *
 * Youssef, 3 Sept 2026: "scrap the cream make it white ... white gold and
 * black maybe? show boxes more like night shows."
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tokens = fs.readFileSync(path.join(root, 'src/public/studio-tokens.css'), 'utf8');

/** Read one `--name: #hex;` block. */
function block(startRe) {
  const at = tokens.search(startRe);
  assert.ok(at > -1, `token block ${startRe} is missing`);
  const body = tokens.slice(at, tokens.indexOf('\n}', at));
  const out = new Map();
  for (const m of body.matchAll(/(--dc-[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)) out.set(m[1], m[2]);
  return out;
}

const dark = block(/^:root \{/m);
const light = block(/^:root\.dc-light,/m);
const lum = hex => toHsl(hex).l;

test('every daylight token has a night twin', () => {
  for (const name of light.keys()) {
    assert.ok(dark.has(name), `${name} is set in daylight and nowhere in the default`);
  }
});

test('the token block and the generator agree, colour for colour', () => {
  // The generator is what paints the export's 585 rules and every inline
  // style; the block is what the hand-written sheets read. They must be the
  // same answer to the same question.
  for (const [name, night] of dark) {
    if (!light.has(name)) continue;
    const derived = daylight(night);
    if (!derived) continue;  // a status colour keeps its meaning in both
    assert.equal(light.get(name).toUpperCase(), derived.toUpperCase(),
      `${name}: the sheet says ${light.get(name)} and the generator says ${derived}`);
  }
});

test('a card is lighter than the page in BOTH themes', () => {
  // This is what "show boxes more like night shows" means, and it is not
  // automatic: a plain inversion REVERSES the order among the near-blacks, so
  // the month cell (#151517) came back darker than the page it sits on and
  // every cell read as a hole.
  for (const [label, map] of [['night', dark], ['daylight', light]]) {
    assert.ok(lum(map.get('--dc-bg')) > lum(map.get('--dc-page')),
      `${label}: a card must sit above the page, not below it`);
    assert.ok(lum(map.get('--dc-bg-raised')) >= lum(map.get('--dc-bg-deepest')),
      `${label}: a raised control must sit above the page ground`);
  }
  // And the same for anything the ALGORITHM derives, not just the named ones.
  assert.ok(lum(daylight('#151517')) > lum(light.get('--dc-page')),
    'a derived ground must clear the page too');
});

test('daylight is white and near-black, not cream and brown', () => {
  const sat = hex => toHsl(hex).s;
  for (const name of ['--dc-bg', '--dc-bg-raised', '--dc-page', '--dc-bg-deepest']) {
    assert.ok(sat(light.get(name)) < 0.12,
      `${name} is ${light.get(name)} — a ground this saturated reads as cream`);
  }
  assert.equal(light.get('--dc-bg'), '#FFFFFF', 'a card is white');
  assert.ok(lum(light.get('--dc-ink')) < 0.12, 'headings are near-black');
  // The gold is the ONE thing that carries warmth, and it survives.
  assert.ok(toHsl(light.get('--dc-gold')).s > 0.3, 'the brand colour stays gold');
});

test('an SVG presentation attribute is never given a var()', () => {
  // `stroke="var(--x, #D9B478)"` does not resolve — the path then draws with
  // the default, a black fill and no stroke. It reached the arch mark once.
  for (const file of ['src/public/index.html', 'src/public/studio-adapter.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/(?:stroke|fill|stop-color)\s*=\s*["']var\(/.test(text),
      `${file} passes a var() to an SVG attribute`);
  }
});
