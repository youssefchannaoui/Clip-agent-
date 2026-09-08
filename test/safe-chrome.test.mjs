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

test('the shade is positioned from the same box the edge span is positioned from', () => {
  const sb = load();
  const v = sb.StudioAdapter.bindings(state({ youtube: { connected: true } }, { youtube: { enabled: true } }));
  // YouTube alone connected still draws the TikTok+Shorts pair (the floor);
  // what this test pins is that the shade and the edge span read ONE box.
  /* THE BOX IS THE EVEN GUIDE NOW (Youssef, 8 Sept 2026), not the platform
     union -- he was told it cannot match what the platforms cover and chose it
     anyway. What this test pins is unchanged and is the part that matters: the
     shade and the design's edge span read ONE box, whichever box that is. */
  const box = sb.DCSafeZones.guideBox(1080, 1920);
  for (const k of ['left', 'right', 'top', 'bottom']) assert.ok(Math.abs(v.safeBox[k] - box[k]) < 1e-9, k);
  assert.equal(v.safeBox.degenerate, false);
  assert.deepEqual(Array.from(v.safePlatforms), ['youtube', 'tiktok']);
  // The silhouette still draws from the REAL union, so the chrome it shows
  // stays truthful even though the rectangle around it is even.
  const real = sb.DCSafeZones.postingBox(['youtube', 'tiktok'], 1080, 1920);
  for (const k of ['left', 'right', 'top', 'bottom']) assert.ok(Math.abs(v.safeReal[k] - real[k]) < 1e-9, `real ${k}`);
  // And the design's own edge span reads the identical numbers.
  assert.match(v.safeBoxStyle, new RegExp(`top: ${(box.top * 100).toFixed(2)}%`));
  assert.match(v.safeBoxStyle, new RegExp(`bottom: ${((1 - box.bottom) * 100).toFixed(2)}%`));
});

test('the guide is even on all four sides, and the real union is still computed', () => {
  // Youssef, 6 Sept 2026: "figure out the perfect safe social zone using
  // TikTok and YouTube and use it for ours". The pair is the floor whether or
  // not either is connected while a template is being designed; a connected
  // Meta platform widens it (the sibling test in safe-zones.test.mjs).
  const sb = load();
  const v = sb.StudioAdapter.bindings(state({}, {}));
  // Equal in FRAME PIXELS, so the margin looks even rather than being equal in
  // percentage and reading wider top-to-bottom on a 9:16 frame.
  const left = v.safeBox.left * 1080, right = (1 - v.safeBox.right) * 1080;
  const top = v.safeBox.top * 1920, bottom = (1 - v.safeBox.bottom) * 1920;
  for (const [what, px] of [['left', left], ['right', right], ['top', top], ['bottom', bottom]]) {
    assert.ok(Math.abs(px - sb.DCSafeZones.GUIDE_INSET) < 0.5, `${what} is the even inset, got ${px}`);
  }
  // The pair is still the floor for everything that is still a real check.
  assert.deepEqual(Array.from(v.safePlatforms), ['youtube', 'tiktok']);
});

test('the hint no longer claims a caption inside the box is clear', () => {
  /*
   * THE WHOLE POINT OF THE TRADE. The box is an even inset chosen for how it
   * looks, so it cannot say what any platform covers -- and the old sentence
   * named them and warned in pixels. Repeating that over a guide would be the
   * app asserting a safety it has stopped checking, which is the stale-claim
   * failure this repo keeps paying for.
   */
  const sb = load();
  const hint = sb.StudioAdapter.bindings(state({ youtube: { connected: true }, tiktok: { connected: true } },
    { youtube: { enabled: true }, tiktok: { enabled: true } })).safeHint;
  assert.match(hint, /\bguide\b/i, 'it says what it is');
  assert.match(hint, /not a platform safe area/i, 'and what it is not');
  assert.doesNotMatch(hint, /Keep text in the clear/, 'that promised a safety it no longer checks');
  assert.doesNotMatch(hint, /sits \d+px into the shade/, 'and so did the pixel warning');
  assert.doesNotMatch(hint, /Drag snaps to/, 'the snap points announce themselves while dragging');
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
  // THE SHADE'S OWN RULES, not "from #dcSafeChrome to the end of the file".
  // That slice swept up whatever was appended to the sheet next — the loading
  // skeletons, whose var() fallbacks are hex — and failed on rules that have
  // nothing to do with the stage. A byte offset is not a boundary; the
  // selector is. Same trap as clip-preview-panel's 2,200-character window.
  // Comments stripped first: the rules are introduced by a comment SAYING they
  // use rgba(9,9,10) "rather than hex or rgba(0,0,0)", so the checks below
  // failed on their own explanation. Tenth time in this repo. Strip, never
  // reword — rewording a comment to appease a test protects nothing.
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (noComments.match(/[^}]*(?:#dcSafeChrome|\.dc-safe-)[^{]*\{[^}]*\}/g) || []).join('\n');
  assert.ok(block.includes('#dcSafeChrome {'), 'the shade rules were found');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block.replace(/#dcSafeChrome/g, '')), 'no hex colour in the shade rules');
  assert.ok(!/rgba\(\s*0\s*,\s*0\s*,\s*0/.test(block), 'no rgba(0,0,0) in the shade rules');
  assert.ok(!/body\.dc-light[^{]*dcSafeChrome/.test(read('src/public/studio-light.generated.css')), 'and the generated daylight sheet carries no twin of it');
});

/**
 * The silhouette (6 Sept 2026). Youssef: "show a siloet where side buttons
 * and text would go". safeSilhouette() is pulled out of index.html and CALLED
 * with two boxes -- the TikTok + Shorts floor and one widened by Meta -- and
 * the SVG it returns is read: every part is there, the rail and the foot
 * are positioned from the box, nothing is drawn in the clear area, and every
 * colour is an rgba literal the daylight generator cannot remap.
 */
function silhouette() {
  const page = read('src/public/index.html');
  const start = page.indexOf('function safeSilhouette(');
  const end = page.indexOf('\n    }\n', start) + 6;
  return new Function(page.slice(start, end) + '; return safeSilhouette;')();
}
const boxFor = keys => {
  const sb = load();
  return sb.DCSafeZones.postingBox(keys, 1080, 1920);
};
const attr = (svg, part, name) => {
  const group = new RegExp(`<g data-part="${part}">([\\s\\S]*?)</g>`).exec(svg);
  assert.ok(group, `part ${part} is drawn`);
  const value = new RegExp(`${name}="(-?[0-9.]+)"`).exec(group[1]);
  assert.ok(value, `${part} carries ${name}`);
  return Number(value[1]);
};

test('the silhouette draws the rail, the foot and the tabs from the same box as the shade', () => {
  const draw = silhouette();
  const floor = boxFor(['youtube', 'tiktok']);
  const svg = draw(floor);
  assert.match(svg, /^<svg class="dc-safe-ui" viewBox="0 0 1080 1920"/);
  for (const part of ['tabs', 'nav', 'sound', 'caption', 'handle', 'disc', 'share', 'comment', 'like', 'avatar']) {
    assert.match(svg, new RegExp(`data-part="${part}"`), `${part} is drawn`);
  }
  // The rail sits on the centre line of the right-hand band.
  const railW = Math.round((1 - floor.right) * 1080);
  assert.equal(attr(svg, 'disc', 'cx'), 1080 - Math.round(railW / 2));
  // and stacks up from the bottom band's top edge, so it moves with the box.
  const bandBottom = Math.round(floor.bottom * 1920);
  assert.equal(attr(svg, 'disc', 'cy'), bandBottom - 70);
  // like, comment and share are paths; their count bars carry the y.
  assert.ok(attr(svg, 'avatar', 'cy') < attr(svg, 'like', 'y'), 'avatar above like');
  assert.ok(attr(svg, 'like', 'y') < attr(svg, 'comment', 'y'), 'like above comment');
  assert.ok(attr(svg, 'comment', 'y') < attr(svg, 'share', 'y'), 'comment above share');
  assert.ok(attr(svg, 'share', 'y') < attr(svg, 'disc', 'cy'), 'share above the disc');
  // The foot is measured from the frame's bottom and stays under the band.
  assert.ok(attr(svg, 'nav', 'y') > attr(svg, 'handle', 'y'), 'the tab bar is under the handle');
  // The tabs sit inside the top band.
  assert.ok(attr(svg, 'tabs', 'y') + 46 <= Math.round(floor.top * 1920), 'the tabs are in the top band');
  /* THE BAND'S TOP EDGE AND THE CAPTION BARS ARE ONE NUMBER.
     Youssef, 6 Sept 2026, twice. First "move the social safe zone down to
     shere my cursor is" -- the shade was cut at TikTok's published 484 while
     the chrome drawn inside it started at 312, so 172px of it covered nothing.
     Then, still wrong: "SOCIAL SAFE BOX IS STILL WRONG IT SHOULD GO ALL THE
     WAY DOWN TO ON TOP OF THE CAPTIONS". So the edge is the top of the caption
     bars, and POSTING_BOTTOM is that -- a shade that claims more than it shows
     is what made it read as arbitrary both times.

     The @username line above them is deliberately OUTSIDE the band: it is one
     short left-aligned line rather than a block that hides text, and reserving
     for it cost 54px of frame. That is his call, and it is why the assertion
     is on the caption rather than on the topmost drawn thing. */
  assert.equal(attr(svg, 'caption', 'y'), 1920 - load().DCSafeZones.POSTING_BOTTOM,
    'the caption bars sit exactly on the band edge');
  assert.equal(Math.round(floor.bottom * 1920), 1920 - load().DCSafeZones.POSTING_BOTTOM);
  assert.ok(attr(svg, 'handle', 'y') < attr(svg, 'caption', 'y'),
    'the @username line is above the captions');

  /* META NO LONGER WIDENS THE FOOT, and that is the fix rather than a
     relaxation. Its published 670 is the room it ASKS you to leave for a
     caption it may not draw; connecting it used to push the band from 312 to
     670 -- a third of the frame, up to under the clip's own caption -- while
     the silhouette went on drawing the same chrome in the same place. The
     shade and the drawing are one answer now, at every combination. */
  for (const keys of [['youtube', 'tiktok', 'instagram'],
                      ['youtube', 'tiktok', 'instagram', 'facebook']]) {
    assert.equal(boxFor(keys).bottom, floor.bottom,
      `${keys.join('+')} must not move the foot`);
  }
  // The rail still stacks from whatever bottom edge it is given.
  const shallow = { top: floor.top, right: floor.right, bottom: 0.5, left: floor.left };
  assert.equal(attr(draw(shallow), 'disc', 'cy'), Math.round(0.5 * 1920) - 70);
  // Ink only: rgba literals, never hex, never a var() an SVG attribute cannot resolve.
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(svg), 'no hex in the silhouette');
  assert.ok(!/var\(/.test(svg), 'no var() in an SVG attribute');
  assert.match(read('src/public/studio-tokens.css'), /#dcSafeChrome \.dc-safe-ui \{[^}]*pointer-events: none/);
});


test('the dashed rectangle is off, and it is off by outranking the export', () => {
  /* Youssef, 6 Sept 2026: "That dotted zone is so bad btw."

     THREE dashed rectangles were on one frame -- the safe box, the caption's
     own drag outline and the mark's -- all gold, all the same weight, so the
     one that meant "you may not draw here" read as one more handle. The
     shaded bands say it already; the outline only competed with the two
     outlines that ARE controls.

     It is switched off from the BINDING rather than by editing the export.
     The design writes `border: 1px dashed ...` and then interpolates
     `{{ safeBoxStyle }}` in the SAME style attribute, so a later declaration
     wins -- no re-import, and no hashed class name moves. Both halves are
     pinned: the ORDER in the generated template, and the declarations in the
     binding. Restoring the dashes is deleting the three below. */
  const sb = load();
  const v = sb.StudioAdapter.bindings(state({}, {}));
  assert.match(v.safeBoxStyle, /border:\s*0\b/, 'the safe edge draws no border');
  assert.match(v.safeBoxStyle, /box-shadow:\s*none/, 'and no halo under it');
  assert.match(v.safeBoxStyle, /border-radius:\s*0/);
  // Positioning still comes first, so the span is still the box.
  assert.ok(v.safeBoxStyle.indexOf('top:') < v.safeBoxStyle.indexOf('border:'), 'position, then the switch-off');

  const design = read('design/studio-dashboard.dc.html');
  const spans = design.split('\n').filter(l => l.includes('{{ safeBoxStyle }}'));
  assert.ok(spans.length >= 1, 'the export still draws the safe edge span');
  for (const line of spans) {
    const border = line.indexOf('border:');
    const binding = line.indexOf('{{ safeBoxStyle }}');
    assert.ok(border === -1 || border < binding,
      'the binding must be interpolated AFTER the export’s own border, or the dashes win');
  }
});

test('the covered bands read as a step, not as a fog', () => {
  /* .46 dulled most of the picture without ever reading as "covered": the
     bands take 7.8% off the top, 25.2% off the foot and 18.6% across, so at
     that alpha the whole frame simply looked washed. The floor is stated
     rather than the value pinned -- tune it, but not back below the number
     that was called bad. */
  const css = read('src/public/studio-tokens.css');
  const rule = css.match(/#dcSafeChrome \.dc-safe-band \{[^}]*\}/);
  assert.ok(rule, 'the band rule is still here');
  const alpha = rule[0].match(/rgba\(\s*9\s*,\s*9\s*,\s*10\s*,\s*([.\d]+)\s*\)/);
  assert.ok(alpha, 'the band is a near-black wash, never a themed token: the stage is night in both themes');
  assert.ok(Number(alpha[1]) >= 0.6, `the shade must read as a step, not a fog (got ${alpha[1]})`);
});

test('the caption words take the caption box’s own colour in both themes', () => {
  /* studio-tokens.css keeps the stage night in daylight by repainting every
     DESCENDANT of the three video frames. Its comment said the caption was
     safe "because it carries an INLINE colour" -- true of the BOX, and not of
     the host-owned span the words live in, which had none: measured on the
     Templates preview, #FFFFFF in the dark and #BCBCC3 in daylight while the
     render drew captionPrimary in both. That is invariant 4 in one theme
     only, which is why nothing caught it.

     Both halves are pinned, because either alone hides the other: the rule
     still uses a universal descendant, and both painters answer it. */
  const css = read('src/public/studio-tokens.css');
  const stage = css.match(/body\.dc-light #studio \*:has\(> #studioPreviewPic\) \*[^{]*\{[^}]*\}/);
  assert.ok(stage, 'the stage rule still repaints every descendant');
  assert.match(stage[0], /color:/);

  const html = read('src/public/index.html');
  const painters = html.split("let span=box.querySelector(':scope > [data-host-owned]');").slice(1);
  assert.equal(painters.length, 2, 'the editor echo and the Templates sample, both of them');
  for (const [i, body] of painters.entries()) {
    assert.match(body.slice(0, 1600), /span\.style\.color\s*=\s*'inherit'/,
      `caption painter ${i + 1} must hand the words the box’s own colour`);
  }
});
