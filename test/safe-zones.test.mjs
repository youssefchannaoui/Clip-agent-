import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * ONE TABLE FOR WHERE THE PLATFORMS COVER THE FRAME.
 *
 * Youssef, 6 Sept 2026, on the Templates preview: "make social media safe zone
 * more actirate for all videos cause its not."
 *
 * It was not, and the reason it could stay wrong is that the answer was
 * written down in SIX places that no two of which agreed: a hardcoded box in
 * the design export, a pair of literals in the adapter, a zone table in the
 * public checker, a "union" rectangle declared two lines under that table and
 * 130px taller than it, a hand-typed legend beside the checker, and four
 * sentences of guide prose. This file is the guard that they are now one
 * answer, because six copies is not a numbers problem that gets fixed once.
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Source with its comments stripped: a note explaining a removed number
 *  contains that number, and this repo has been caught by that five times. */
const code = rel => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

await import('../src/public/safe-zones.js');
const SAFE = globalThis.DCSafeZones;
// The adapter renders the box, so the last test drives it. Loaded AFTER the
// table, exactly as the browser loads the two.
await import('../src/public/studio-runtime.js');
await import('../src/public/studio-template.generated.js');
await import('../src/public/studio-adapter.js');
const { StudioAdapter } = globalThis;

test('the union is the worst case on each EDGE, not the strictest platform', () => {
  // No single platform is strictest on all four edges -- TikTok asks for the
  // most left margin, Meta for the deepest bottom -- so picking one platform
  // and using its box would leave a real edge uncovered.
  const ins = SAFE.unionInsets();
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    const worst = Math.max(...SAFE.ORDER.map(k => SAFE.ZONES[k][edge]));
    assert.equal(ins[edge], worst, `${edge} takes the worst case`);
  }
  // And it is genuinely a mixture, or the per-edge maximum is machinery doing
  // nothing. Proven on a REAL account shape rather than on all four: Meta's
  // unified area happens to be strictest on every edge today, so the full-set
  // union is simply Meta's box -- but a YouTube-and-TikTok account, which is
  // what this deployment actually posts with, takes its top from Shorts and
  // its bottom from TikTok. Picking one platform's box there would uncover an
  // edge.
  const pair = SAFE.unionInsets(['youtube', 'tiktok']);
  assert.equal(pair.top, SAFE.ZONES.youtube.top, 'Shorts sets the top');
  assert.equal(pair.bottom, SAFE.ZONES.tiktok.bottom, 'TikTok sets the bottom');
  assert.notEqual(pair.top, SAFE.ZONES.tiktok.top);
});

test('an empty choice is the union of everything, which is the safe direction', () => {
  // An account that has connected nothing must be shown the box that clears
  // every platform. Showing it the loosest would be a box that is wrong the
  // moment it connects anything.
  assert.deepEqual(SAFE.unionInsets([]), SAFE.unionInsets(SAFE.ORDER));
  assert.deepEqual(SAFE.unionInsets(undefined), SAFE.unionInsets(SAFE.ORDER));
});

test('fewer platforms can only ever widen the box', () => {
  const all = SAFE.safeArea(SAFE.ORDER, 1080, 1920);
  for (const key of SAFE.ORDER) {
    const one = SAFE.safeArea([key], 1080, 1920);
    assert.ok(one.top <= all.top + 1e-9, `${key} top`);
    assert.ok(one.left <= all.left + 1e-9, `${key} left`);
    assert.ok(one.right >= all.right - 1e-9, `${key} right`);
    assert.ok(one.bottom >= all.bottom - 1e-9, `${key} bottom`);
  }
});

test('a 9:16 output gets the insets unchanged', () => {
  // The common case, and the one to check first when the box looks wrong.
  const ins = SAFE.unionInsets();
  const box = SAFE.safeArea([], 1080, 1920);
  assert.ok(Math.abs(box.top - ins.top / 1920) < 1e-9);
  assert.ok(Math.abs(box.left - ins.left / 1080) < 1e-9);
  assert.ok(Math.abs(box.bottom - (1920 - ins.bottom) / 1920) < 1e-9);
  assert.ok(Math.abs(box.right - (1080 - ins.right) / 1080) < 1e-9);
});

test('a square export does not lose the band that falls on the letterbox', () => {
  // THE HALF THAT MAKES IT RIGHT "FOR ALL VIDEOS". The insets describe a 9:16
  // PLAYER, not the file. A square clip is letterboxed into that player, so
  // the chrome at the very top and bottom of the screen sits on the black bars
  // rather than on the picture -- and treating a 1:1 export as though it lost
  // its bottom 35% would fence the caption into a strip for no reason.
  const square = SAFE.safeArea([], 1080, 1080);
  assert.equal(square.top, 0, 'the top chrome is above the picture entirely');
  assert.ok(square.bottom > SAFE.safeArea([], 1080, 1920).bottom,
    'and it keeps more of its own height than a 9:16 clip does');
  // The side rail still applies: it runs the full height of the screen.
  assert.ok(square.left > 0 && square.right < 1, 'the button column still covers it');

  // Widescreen keeps almost all its height and still loses the rail.
  const wide = SAFE.safeArea([], 1920, 1080);
  assert.equal(wide.top, 0);
  assert.ok(wide.bottom > 0.9);
  assert.ok(wide.right < 1);
});

test('a box that cannot exist is reported as the whole frame, never inverted', () => {
  // A caption has to go somewhere, and a rectangle with its edges crossed
  // renders as a border drawn inside out.
  const tiny = SAFE.safeArea([], 1080, 40);
  assert.ok(tiny.right > tiny.left && tiny.bottom > tiny.top, 'never inverted');
});

test('only connected AND switched-on platforms narrow the box', () => {
  // Switched on with nothing connected posts nowhere, so it must not tighten
  // the box -- the account would be fenced in for a destination that cannot
  // receive anything.
  const social = { providers: { youtube: { connected: true }, tiktok: { connected: false } } };
  const ps = { youtube: { enabled: true }, tiktok: { enabled: true }, instagram: { enabled: false } };
  assert.deepEqual(SAFE.platformsFor(ps, social), ['youtube']);
  assert.deepEqual(SAFE.platformsFor({}, social), []);
  assert.deepEqual(SAFE.platformsFor(ps, {}), []);
});

test('nothing outside the table restates a platform inset', () => {
  // The whole point. Every number lives in safe-zones.js; a second copy is
  // exactly how the six disagreeing answers came about.
  const insets = new Set();
  for (const key of SAFE.ORDER) {
    for (const edge of ['top', 'right', 'bottom', 'left']) insets.add(SAFE.ZONES[key][edge]);
  }
  const adapter = code('src/public/studio-adapter.js');
  const widgets = code('src/public/tool-widgets.js');
  for (const value of insets) {
    // A bare small number can appear innocently, so this looks for it in the
    // shape an inset would take rather than anywhere at all.
    const asInset = new RegExp(`(top|right|bottom|left)\\s*:\\s*${value}\\b`);
    assert.ok(!asInset.test(adapter), `the adapter restates ${value}`);
    assert.ok(!asInset.test(widgets), `the checker restates ${value}`);
  }
  // And the checker holds no rectangle of its own any more.
  assert.ok(!/UNIVERSAL\s*=\s*\{/.test(widgets), 'the hand-maintained union rectangle is gone');
  assert.ok(/SAFE\.unionInsets\(\)/.test(widgets), 'it asks the table instead');
});

test('the guide prose quotes the table, to the pixel', () => {
  // Four sentences of the public guide state these numbers. They said "a
  // centred 900 x 1400 rectangle", which was neither the union nor centred,
  // and stood for weeks because prose is not executed. It is checked here.
  const copy = read('src/seo-copy.js');
  const ins = SAFE.unionInsets();
  const w = SAFE.REF_WIDTH - ins.left - ins.right;
  const h = SAFE.REF_HEIGHT - ins.top - ins.bottom;

  assert.ok(copy.includes(`${w} x ${h}`), `the guide must quote ${w} x ${h}`);
  assert.ok(!/900 x 1400|900x1400/.test(copy), 'the old rectangle is gone');
  // It must never be called centred again: it is not, and that was the part
  // that made people place captions in the wrong half of the frame.
  assert.ok(!/centred rectangle|centred area of/.test(copy),
    'the safe area is not centred and must not be described as though it were');
  // Every per-platform figure the prose quotes is the table's own.
  for (const [key, fragment] of [
    ['tiktok', `bottom ${SAFE.ZONES.tiktok.bottom} pixels`],
    ['instagram', `bottom ${SAFE.ZONES.instagram.bottom} pixels`],
  ]) {
    assert.ok(copy.includes(fragment), `${key}: the prose must say "${fragment}"`);
  }
  assert.ok(!/bottom 430 pixels|top 220 of/.test(copy),
    'the pre-unification Reels numbers are gone');
});

test('the checker page is served the table before the script that reads it', () => {
  const marketing = read('src/marketing.js');
  const i = marketing.indexOf('/safe-zones.js');
  const j = marketing.indexOf('/tool-widgets.js', i);
  assert.ok(i > -1 && j > i, 'safe-zones.js is loaded first on the checker page');
  // And the legend is built from the table rather than typed beside it.
  assert.ok(/SAFE\.ORDER\.map/.test(marketing), 'the legend rows come from the table');
  assert.ok(!/<td>100<\/td>|<td>220<\/td>/.test(marketing), 'no hand-typed legend numbers');
});

test('the studio loads the table before the adapter that reads it', () => {
  const html = read('src/public/index.html');
  const i = html.indexOf('/safe-zones.js');
  const j = html.indexOf('/studio-adapter.js');
  assert.ok(i > -1, 'index.html loads it');
  assert.ok(i < j, 'and before the adapter, which reads it at load time');
  assert.ok(read('src/server.js').includes("'/safe-zones.js'"), 'and the server serves it');
});

test('a caption anchored inside the covered band is called out, not moved', () => {
  // Making the box accurate immediately showed that the SHIPPED DEFAULT is
  // outside it: Clean Line anchors its caption 464px from the bottom and
  // TikTok covers 484. Saying so is the point -- a correct rectangle with the
  // caption plainly outside it and no explanation is worse than the wrong
  // rectangle was.
  const state = tpl => ({
    projects: [], clips: [], tracks: [],
    templates: [tpl], selectedTemplate: tpl,
    social: { providers: { tiktok: { connected: true } } },
    publishingSettings: { enabled: true, tiktok: { enabled: true } },
  });
  const base = { id: 'x', name: 'X', width: 1080, height: 1920 };

  const covered = StudioAdapter.bindings(state(
    { ...base, captionPosition: 'bottom', captionMarginV: 464 })).safeHint;
  assert.match(covered, /sits \d+px outside it/, 'the shipped default is called out');

  const clear = StudioAdapter.bindings(state(
    { ...base, captionPosition: 'bottom', captionMarginV: 700 })).safeHint;
  assert.ok(!/outside it/.test(clear), 'a caption inside the box is not nagged');

  // A centred caption is always inside, and must never be warned about.
  const middle = StudioAdapter.bindings(state(
    { ...base, captionPosition: 'middle', captionMarginV: 0 })).safeHint;
  assert.ok(!/outside it/.test(middle));

  // And it is a WARNING, never a correction: nothing about the drawn box may
  // rewrite a saved caption position, because that changes how every clip from
  // that template renders.
  const writes = [];
  StudioAdapter.onTemplateField = (...a) => writes.push(a);
  StudioAdapter.bindings(state({ ...base, captionPosition: 'bottom', captionMarginV: 464 }));
  assert.deepEqual(writes, [], 'drawing the box saves nothing');
});

test('no shipped template anchors its caption in the covered band', () => {
  /*
   * THE LAW THIS WHOLE CHANGE EXISTS TO MAKE ENFORCEABLE.
   *
   * Correcting the box showed that the SHIPPED DEFAULTS were outside it: Clean
   * Line anchored 464px from the bottom against TikTok's 484 and Meta's 670,
   * and Bold Stack sat 10px inside Meta's top band. Both moved (Youssef,
   * 6 Sept 2026: "move clean line caption up so its inside the box").
   *
   * Checked against the union of ALL FOUR rather than against whatever this
   * deployment happens to have connected: a shipped template is used by every
   * account, so it has to clear every platform any of them might post to.
   *
   * ASS semantics, and they differ by anchor: for a bottom alignment MarginV
   * is the gap from the frame's bottom edge to the text's bottom, and for a
   * top alignment it is from the top edge to the text's top (alignment_for and
   * the stack builder's `baseline = margin_v + ink_top` in clip_worker.py). A
   * middle alignment ignores MarginV entirely and is always inside.
   */
  const box = SAFE.safeArea([], 1080, 1920);
  const dir = path.join(ROOT, 'src/templates');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 5, 'the shipped templates are being read');

  const covered = [];
  for (const file of files) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const pos = t.captionPosition;
    if (pos !== 'top' && pos !== 'bottom') continue;
    const height = Number(t.height) || 1920;
    const margin = Number(t.captionMarginV) || 0;
    // The shadow is drawn OUTSIDE the text box, so it is part of what a
    // platform would cover.
    const ink = Number(t.captionShadow) || 0;
    const need = (pos === 'top' ? box.top : 1 - box.bottom) * height + ink;
    if (margin < need) covered.push(`${file}: ${pos} margin ${margin} needs ${Math.ceil(need)}`);
  }
  assert.deepEqual(covered, [], `these ship with captions under the platform's own interface:\n  ${covered.join('\n  ')}`);
});
