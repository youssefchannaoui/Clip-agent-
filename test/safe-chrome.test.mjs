import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

/**
 * The covered areas of the preview are drawn as what they are (5 Sept 2026).
 *
 * Youssef, on the accurate safe box: "safe zone is horrible and its all
 * broken now." The numbers stay -- safe-zones.js is the one table, and its
 * own tests hold it. What changed is the DRAWING: a lone dashed rectangle in
 * the upper part of the frame became shaded bands where the platform's own
 * interface sits, with its buttons and caption lines ghosted in, host-drawn
 * from the adapter's `safeBox` so the shade and the design's dashed edge come
 * from one box.
 */
const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

function load() {
  const sandbox = {
    console, Date, Math, JSON, Intl, setTimeout, clearTimeout, isNaN, parseInt, parseFloat, Number, String, Boolean, Array, Object, RegExp,
    localStorage: { getItem: k => (/dcTour/.test(String(k)) ? '1' : null), setItem: () => {}, removeItem: () => {} },
    innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {}, contains: () => false } }, documentElement: { classList: { add() {}, remove() {}, contains: () => false } }, addEventListener() {} },
    navigator: { userAgent: '' }, location: { href: '', search: '', hash: '' }, history: { replaceState() {} },
    requestAnimationFrame: fn => fn(), addEventListener() {}, removeEventListener() {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/public/safe-zones.js'), sandbox);
  vm.runInContext(read('src/public/studio-adapter.js'), sandbox);
  return sandbox;
}
const tpl = { id: 'x', name: 'X', width: 1080, height: 1920, captionPosition: 'bottom', captionMarginV: 700 };
const state = (providers, publishing) => ({
  projects: [], clips: [], tracks: [], templates: [tpl], selectedTemplate: tpl,
  social: { providers }, publishingSettings: { enabled: true, ...publishing },
});

test('the shade is positioned from the same box the dashed edge is drawn from', () => {
  const sb = load();
  const v = sb.StudioAdapter.bindings(state({ youtube: { connected: true } }, { youtube: { enabled: true } }));
  const box = sb.DCSafeZones.safeArea(['youtube'], 1080, 1920);
  for (const k of ['left', 'right', 'top', 'bottom']) assert.ok(Math.abs(v.safeBox[k] - box[k]) < 1e-9, k);
  assert.equal(v.safeBox.degenerate, false);
  assert.deepEqual(Array.from(v.safePlatforms), ['youtube']);
  // And the design's own edge reads the identical numbers.
  assert.match(v.safeBoxStyle, new RegExp(`top: ${(box.top * 100).toFixed(2)}%`));
  assert.match(v.safeBoxStyle, new RegExp(`bottom: ${((1 - box.bottom) * 100).toFixed(2)}%`));
});

test('with nothing connected the shade is the union, and says so', () => {
  const sb = load();
  const v = sb.StudioAdapter.bindings(state({}, {}));
  const box = sb.DCSafeZones.safeArea([], 1080, 1920);
  assert.ok(Math.abs(v.safeBox.bottom - box.bottom) < 1e-9);
  assert.match(v.safeHint, /every platform/);
});

test('the hint is one line about the shade, and the snap list is gone from it', () => {
  const sb = load();
  const hint = sb.StudioAdapter.bindings(state({ youtube: { connected: true }, tiktok: { connected: true } },
    { youtube: { enabled: true }, tiktok: { enabled: true } })).safeHint;
  assert.match(hint, /^The shaded parts are where Shorts and TikTok/);
  assert.match(hint, /Keep text in the clear\./);
  assert.ok(!/Drag snaps to/.test(hint), 'the snap points announce themselves while dragging');
  assert.ok(!/inside the box/.test(hint), 'there is no lone box to keep inside any more');
  assert.ok(hint.length < 140, `one line, not a label: ${hint.length} chars`);
});

test('the covered areas are host-drawn, appended, under the caption, and gone off Templates', () => {
  const page = read('src/public/index.html');
  const fn = page.slice(page.indexOf('function paintSafeChrome('));
  const body = fn.slice(0, fn.indexOf('\n    }\n'));
  assert.match(page, /safeChromeEl\.setAttribute\('data-host-owned',''\)/, 'marked, or the patcher pairs it against a generated sibling');
  assert.match(body, /frame\.appendChild\(safeChromeEl\)/, 'appended -- a host node at the front shifts every generated sibling');
  assert.ok(!/insertBefore\(safeChromeEl/.test(body));
  assert.match(body, /dcSetHtml\(safeChromeEl/, 'redrawn only when the markup changes');
  assert.match(body, /screen==='templates'/, 'Templates only');
  assert.match(body, /safeChromeEl\.remove\(\)/, 'and removed elsewhere');
  assert.match(body, /box\.degenerate/, 'a box that covers the whole picture draws no shade');
  const list = page.slice(page.indexOf('\n  paintPreviewPic(vals);'), page.indexOf('\n  paintTemplatesLayout();'));
  assert.match(list, /paintPreviewPic\(vals\);\n  paintSafeChrome\(vals\);/, 'painted right after the picture it sits on, in paintStudio');
  // Four bands, one per edge, tiling the covered area without overlap.
  assert.match(body, /dc-safe-top[^`]*height:\$\{T\}/);
  assert.match(body, /dc-safe-bottom[^`]*height:\$\{B\}/);
  assert.match(body, /dc-safe-left[^`]*top:\$\{T\};bottom:\$\{B\}/);
  assert.match(body, /dc-safe-rail[^`]*top:\$\{T\};bottom:\$\{B\}/);
});

test('the shade sits under the caption and takes no pointer events', () => {
  const css = read('src/public/studio-tokens.css');
  const root = /#dcSafeChrome \{[^}]*\}/.exec(css)[0];
  assert.match(root, /pointer-events: none/);
  assert.match(root, /z-index: 1;/, 'below the design safe edge (2), the guides (6) and the caption (8)');
  const design = read('design/studio-dashboard.dc.html');
  assert.match(design, /z-index: 2; pointer-events: none; border: 1px dashed[^"]*\{\{ safeBoxStyle \}\}/, 'the dashed edge still marks the clear area');
  const band = /#dcSafeChrome \.dc-safe-band \{[^}]*\}/.exec(css)[0];
  assert.match(band, /pointer-events: none/);
  // No hex and no rgba(0,0,0): the light-theme generator remaps both, and the
  // stage is night in both themes.
  const block = css.slice(css.indexOf('#dcSafeChrome {'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block.replace(/#dcSafeChrome/g, '')), 'no hex colour in the shade rules');
  assert.ok(!/rgba\(\s*0\s*,\s*0\s*,\s*0/.test(block), 'no rgba(0,0,0) in the shade rules');
  assert.ok(!/body\.dc-light[^{]*dcSafeChrome/.test(read('src/public/studio-light.generated.css')), 'and the generated daylight sheet carries no twin of it');
});
