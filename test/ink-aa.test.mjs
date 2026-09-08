import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Every ink must be readable on every ground, in BOTH themes.
 *
 * `light-theme.test.mjs` guards the DAYLIGHT block against the generator --
 * that the two sources agree. Nothing guarded whether the answer they agree on
 * can actually be read, and the night side had no guard at all. So
 * --dc-ink-faint sat at #6E6E76 for the life of the product: 3.43:1 on
 * --dc-bg-alt and 3.94 on the page, under AA on every night ground, carrying
 * ~250 label sites across the design export and eleven hand-written rules.
 * Nothing failed. The app rendered, the suite stayed green, the labels simply
 * could not be read -- which is the exact shape this repo keeps paying for.
 *
 * TWO THINGS THIS FILE LEARNED THE HARD WAY, both in v3.159.0:
 *
 *  - THE PAGE IS NOT THE STRICTEST GROUND. v3.127.3 set the daylight floor
 *    against #ECECEE and landed the label greys on 4.54. But --dc-bg-deep is
 *    #E7E7EA -- scroll troughs, the schedule's rows, the Tokens funnel -- where
 *    the same ink reads 4.34. Nine nodes were under on the screens that release
 *    had swept. Compare against EVERY ground, not the one you happen to picture.
 *
 *  - A FALLBACK IS A COLOUR TOO. `var(--dc-ink-faint, #6A6A72)` names a
 *    DAYLIGHT hex in a page that opens at night, so if the token sheet ever
 *    fails those nodes render paper-grey on black. Three of those were live.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tokens = fs.readFileSync(path.join(root, 'src/public/studio-tokens.css'), 'utf8');

function block(startRe) {
  const at = tokens.search(startRe);
  assert.ok(at > -1, `token block ${startRe} is missing`);
  const body = tokens.slice(at, tokens.indexOf('\n}', at));
  const out = new Map();
  for (const m of body.matchAll(/(--dc-[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)) out.set(m[1], m[2]);
  return out;
}

const lum = (hex) => {
  const parts = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a) + 0.05, lum(b) + 0.05];
  return Math.round((Math.max(x, y) / Math.min(x, y)) * 100) / 100;
};

const THEMES = [['night', block(/^:root \{/m)], ['paper', block(/^:root\.dc-light,/m)]];
/** Anything text is drawn ON. A line token is not one -- nothing reads on a hairline. */
const GROUNDS = ['--dc-page', '--dc-page-2', '--dc-bg-deepest', '--dc-bg-deep', '--dc-bg', '--dc-bg-raised', '--dc-bg-alt'];
/** The neutral inks. The gold is judged separately below, for a stated reason. */
const INKS = ['--dc-ink-faint', '--dc-ink-muted', '--dc-ink-dim', '--dc-ink-soft', '--dc-ink-body', '--dc-ink-bright', '--dc-ink'];
const AA = 4.5;   // normal text. These tokens carry 10-13px labels, never headings.

test('every neutral ink clears AA on every ground, in both themes', () => {
  const bad = [];
  for (const [name, theme] of THEMES) {
    for (const ink of INKS) {
      for (const ground of GROUNDS) {
        if (!theme.has(ink) || !theme.has(ground)) continue;
        const c = contrast(theme.get(ink), theme.get(ground));
        if (c < AA) bad.push(`${name}: ${ink} ${theme.get(ink)} on ${ground} ${theme.get(ground)} = ${c}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'ink that cannot be read:\n  ' + bad.join('\n  '));
});

test('the gold reads as ink on every ground, in both themes', () => {
  // This was a PINNED EXCEPTION until v3.161.0: #8A6425 was chosen in v3.127.3
  // against the paper PAGE (4.53) and read 4.33 on the sunken well, the ground
  // that release did not enumerate. Both golds moved together -- #856022 and
  // #7A5714 -- because the two nodes that actually rendered under AA were one
  // of each. There is no exception left, so a gold that gets worse turns this
  // red rather than joining a list.
  //
  // The FILL direction needs no entry here and that was checked rather than
  // assumed: no gold fill anywhere carries text. Every `background:
  // var(--dc-gold*)` is a dot, a caret, a slider thumb or a progress bar, and
  // the buttons that do sit on gold use --dc-gold-solid, which is declared
  // once on :root and deliberately never redeclared for daylight.
  const bad = [];
  for (const [name, theme] of THEMES) {
    for (const gold of ['--dc-gold', '--dc-gold-lit']) {
      for (const ground of GROUNDS) {
        if (!theme.has(gold) || !theme.has(ground)) continue;
        const c = contrast(theme.get(gold), theme.get(ground));
        if (c < AA) bad.push(`${name}: ${gold} ${theme.get(gold)} on ${ground} ${theme.get(ground)} = ${c}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'gold that cannot be read:\n  ' + bad.join('\n  '));
});

test('a var() fallback names its own token\'s value in the DEFAULT theme', () => {
  // The page opens at night, so a fallback holding a daylight hex renders
  // paper-grey on black the moment the token sheet does not arrive. It is also
  // how a token and the hex beside it drift: 30 sites said #6E6E76 and three
  // said #6A6A72, for the same token, in one file.
  const files = ['src/public/index.html', 'src/public/studio-adapter.js', 'src/public/studio-tokens.css',
    'src/public/studio-templates.css', 'src/public/studio-help.css', 'src/public/studio-owner.css',
    'src/public/studio-motion.css', 'src/public/studio-deenai.css'];
  const night = THEMES[0][1];
  const wrong = [];
  for (const rel of files) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/var\((--dc-[a-z0-9-]+),\s*(#[0-9A-Fa-f]{3,6})\)/g)) {
      const want = night.get(m[1]);
      if (!want) continue;   // a token declared somewhere other than the block
      if (m[2].toUpperCase() !== want.toUpperCase()) wrong.push(`${rel}: var(${m[1]}, ${m[2]}) but the night value is ${want}`);
    }
  }
  assert.deepEqual([...new Set(wrong)], []);
});
