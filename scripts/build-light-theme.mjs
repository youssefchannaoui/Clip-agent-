#!/usr/bin/env node
/**
 * Build the studio's light sheet FROM the generated dark one.
 *
 * studio-styles.generated.css is written by the design import and must never
 * be hand-edited — a re-import would throw the edit away, and its class names
 * renumber, so nothing may reference them by hand either. This reads it and
 * emits every rule that sets a neutral colour a second time, prefixed with
 * `body.dc-light` and remapped to the paper palette. Run it from the design
 * import, and the light theme regenerates itself whenever the design does.
 *
 * Only the twelve neutrals move. Gold is ink on paper as readily as it is
 * light on black, and green still means posted whatever the ground is —
 * re-tinting those would be a second design rather than the same one in
 * daylight.
 *
 *   node scripts/build-light-theme.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/*
 * Every sheet the studio loads, not just the generated one.
 *
 * The hand-written sheets carry real colour too — the Help screen and the
 * Owner screen are drawn almost entirely by studio-help.css and
 * studio-owner.css — and processing only the export left those two screens
 * with dark headings on paper.
 */
const SOURCES = [
  'src/public/studio-styles.generated.css',
  'src/public/studio-help.css',
  'src/public/studio-owner.css',
  'src/public/studio-responsive.css',
].map(rel => path.join(ROOT, rel)).filter(file => fs.existsSync(file));
const TARGET = path.join(ROOT, 'src/public/studio-light.generated.css');

import { daylight } from './theme-palette.mjs';

const remapColour = (value) => daylight(value);

const remapRgba = (declaration) => declaration
  .replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)/gi,
    (_, alpha) => `rgba(58, 44, 20, ${Math.min(0.18, Number(alpha) * 0.55).toFixed(3)})`)
  .replace(/rgba\(\s*217\s*,\s*180\s*,\s*120\s*,\s*([0-9.]+)\s*\)/gi,
    (_, alpha) => `rgba(162, 118, 44, ${Math.min(0.9, Number(alpha) * 1.15).toFixed(3)})`)
  .replace(/rgba\(\s*240\s*,\s*214\s*,\s*166\s*,\s*([0-9.]+)\s*\)/gi,
    (_, alpha) => `rgba(126, 91, 24, ${Math.min(0.9, Number(alpha) * 1.15).toFixed(3)})`);

// Comments are stripped before walking: left in, a `/* note */` sitting above
// a rule is swallowed into the selector and comes out as
// `body.dc-light /* note */ .sNN`, which matches nothing.
const css = SOURCES.map(file => fs.readFileSync(file, 'utf8')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// A minimal rule walker. The generated sheet is plain CSS with @media blocks
// and no nesting beyond that, so tracking brace depth is enough — and a real
// parser would be a dependency this repo deliberately does not have.
const out = [];
let atRule = null;
let depth = 0;
let buffer = '';

const flushRule = (selector, body) => {
  const kept = [];
  for (const raw of body.split(';')) {
    const declaration = raw.trim();
    if (!declaration) continue;
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const prop = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    let next = value.replace(/#[0-9A-Fa-f]{3,8}\b/g, (hex) => remapColour(hex) || hex);
    next = remapRgba(next);
    if (next !== value) kept.push(`${prop}:${next}`);
  }
  if (!kept.length) return;
  // Every selector in the list gets the prefix, or `a, b` would light only `a`.
  const scoped = selector.split(',')
    .map(part => `body.dc-light ${part.trim()}`)
    .join(',');
  out.push(`${scoped}{${kept.join(';')}}`);
};

let index = 0;
while (index < css.length) {
  const char = css[index];
  if (char === '{') {
    depth += 1;
    if (depth === 1) {
      const head = buffer.trim();
      buffer = '';
      if (head.startsWith('@')) {
        // Only conditional groups carry ordinary rules. @keyframes holds
        // percentage steps, not selectors, and prefixing those with
        // `body.dc-light` would produce nonsense; @font-face has no colours at
        // all. Both are skipped whole rather than half-copied.
        if (/^@(media|supports|container|layer)\b/.test(head)) { atRule = head; out.push(`${head}{`); depth = 0; }
        else {
          let inner = 1; index += 1;
          while (index < css.length && inner > 0) {
            if (css[index] === '{') inner += 1;
            else if (css[index] === '}') { inner -= 1; if (!inner) break; }
            index += 1;
          }
          depth = 0; index += 1; continue;
        }
      }
      else { // collect the body
        let body = '';
        index += 1;
        let inner = 1;
        while (index < css.length && inner > 0) {
          if (css[index] === '{') inner += 1;
          else if (css[index] === '}') { inner -= 1; if (!inner) break; }
          body += css[index];
          index += 1;
        }
        depth = 0;
        flushRule(head, body);
      }
      index += 1;
      continue;
    }
  } else if (char === '}') {
    if (atRule) { out.push('}'); atRule = null; buffer = ''; index += 1; continue; }
  }
  buffer += char;
  index += 1;
}

// A conditional group whose rules all turned out colourless is an empty block
// in the output. Harmless, but it reads as a bug in a generated file.
const cleaned = out.join('\n').replace(/@[^{]+\{\s*\}/g, '').replace(/\n{2,}/g, '\n').trim();

const banner = `/* GENERATED by scripts/build-light-theme.mjs from every studio sheet.
   Do not edit: re-run the design import, or this script, instead.
   Only the twelve neutrals, white, black and black shadows are remapped; the
   gold and the semantic colours are the same in daylight. */\n`;
fs.writeFileSync(TARGET, banner + cleaned + '\n');
console.log(`Wrote ${path.relative(ROOT, TARGET)} — ${cleaned.split('\n').length} rules, `
  + `${(fs.statSync(TARGET).size / 1024).toFixed(1)}KB`);
