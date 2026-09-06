import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { CLIP_STYLE_FIELDS, BRAND_FIELDS } from '../src/templates.js';

/*
 * The rebuilt desktop Templates screen (studio-templates.js + .css).
 *
 * It is a SECOND TEMPLATE over the same bindings -- the device studio-mobile.js
 * established: a hand-written module authors a template in the runtime's own
 * AST and renders it through the SAME StudioRuntime from the SAME
 * StudioAdapter.bindings() object. No copied logic, no new state, no new route.
 *
 * Everything below was a way this could have shipped broken, and every one of
 * them is SILENT: the app renders, the suite stays green, and the screen is
 * simply wrong on somebody's monitor. So they are asserted on executed output
 * -- the control specs the adapter really returns and the HTML the real runtime
 * really writes -- rather than on the source that builds them, which this repo
 * has now been caught by seven times.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function makeSandbox() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'test' }, location: { hash: '', search: '' },
    innerWidth: 1440,
    // No document and no matchMedia: the module must load without either.
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src('src/public/studio-runtime.js'), sandbox);
  vm.runInContext(src('src/public/studio-adapter.js'), sandbox);
  vm.runInContext(src('src/public/studio-templates.js'), sandbox);
  return sandbox;
}

const TEMPLATE = (extra = {}) => ({
  id: 'clean-line', name: 'Clean Line', customised: false,
  fitMode: 'crop', blurStrength: 22, frameBackground: '#000000',
  smartFramingEnabled: true, smartFramingBias: 'auto', smartFramingZoom: 1, smartFramingPadding: 0.18,
  framingSubjectBias: 0,
  captionMode: 'phrase', captionPosition: 'bottom', captionHorizontal: 'center',
  captionMarginV: 680, captionMarginH: 90, captionMaxWords: 5, captionTimingOffsetMs: 0,
  captionFont: 'Montserrat', captionFontSize: 89, captionUppercase: false, captionPrimary: '#FFFFFF',
  captionLetterSpacing: 0, captionLineHeight: 0.88,
  captionOutline: '#000000', captionOutlineWidth: 5, captionShadow: 2,
  captionBackground: '#000000', captionBackgroundOpacity: 0,
  captionHighlight: '#D9B478', captionHighlightFont: 'Montserrat', captionHighlightItalic: false,
  captionHighlightGlow: 0, captionPopScale: 100, captionPopMs: 120, captionFadeMs: 90,
  filterPreset: 'natural', brightness: 0, contrast: 1, saturation: 1, gamma: 1,
  sharpen: 0.45, vignette: 0, grain: 0, warm: 0,
  overlayEffect: 'none', overlayIntensity: 55, overlayDarken: 0,
  watermark: 'DEENCLIPPED', watermarkOpacity: 100, watermarkPosition: 'top-center',
  watermarkColor: '#D9B478', watermarkFontSize: 24, watermarkMarginV: 70, watermarkMarginH: 42,
  brandLineEnabled: false, brandLineColor: '#D9B478', brandLineHeight: 8,
  voiceEnhance: true, captionBehindSubject: false,
  promoBarEnabled: false, promoBarStartSec: 3, promoBarSeconds: 3,
  width: 1080, height: 1920,
  ...extra,
});

const DATA = (over = {}, extra = {}) => ({
  clips: [], projects: [], activity: [],
  // The adapter picks the active template out of DATA.templates BY ID, so a
  // stub row here leaves every field on its schema default and the whole
  // screen measures the defaults rather than the template.
  templates: [TEMPLATE(over), { id: 'quran-recitation', name: 'Quran Recitation' }],
  selectedTemplate: TEMPLATE(over), templateList: ['Clean Line', 'Quran Recitation'],
  brand: { watermark: 'DEENCLIPPED', watermarkOpacity: 100, promoBarEnabled: false },
  stylePresets: [], nasheeds: [], postTimes: ['09:00'],
  user: { name: 'Yusuf', email: 'y@x.com', role: 'creator' },
  billing: { current: { planName: 'Pro', plan: 'pro_monthly', tokens: 437, features: { watermark: true } }, plans: [] },
  ...extra,
});

// Bind the adapter and read the screen's own bindings back.
function bind(sandbox, data) {
  sandbox.StudioAdapter.ui.screen = 'templates';
  return sandbox.StudioAdapter.bindings(data);
}
// An adapter value crosses the vm realm, so strict deepEqual rejects its
// arrays on the prototype. Copy them out first (the standing lesson).
const own = list => Array.from(list || []);
const groups = vals => Object.keys(vals.tplControls || {});
const flat = vals => Object.keys(vals.tplControls).flatMap(k => own(vals.tplControls[k]));
const byField = (vals, field) => flat(vals).find(c => c.field === field) || null;
const labels = vals => flat(vals).map(c => c.label);

// Render the screen's real template with the real runtime.
function render(sandbox, vals) {
  const R = new sandbox.StudioRuntime._internals.Renderer('data-dct-h');
  const out = [];
  R.render(sandbox.StudioTemplates.template(), sandbox.StudioTemplates.vals(vals), out);
  return { html: out.join(''), missing: R.missing, handlers: R.handlers.length };
}

// ── the screen draws, and nothing on it is dead ─────────────────────────────

test('the screen renders from the real bindings with no unresolved binding', () => {
  const sandbox = makeSandbox();
  const vals = bind(sandbox, DATA());
  const { html, missing, handlers } = render(sandbox, vals);
  assert.deepEqual(own(missing), [], 'bindings the template names and the adapter does not send');
  assert.ok(handlers > 40, 'the screen wires its controls: ' + handlers);
  assert.match(html, /CLIP LAYOUT|Clip layout/);
  assert.match(html, /dct-row/);
});

test('every control the screen offers writes a field the renderer reads', () => {
  const sandbox = makeSandbox();
  const seen = new Set();
  // Walk every caption mode and both looks, so the conditional controls are
  // all visited rather than only the ones the default template happens to show.
  for (const mode of ['phrase', 'word', 'cards', 'fill', 'dynamic-stack', 'stack-build', 'quran']) {
    for (const look of ['natural', 'custom']) {
      for (const fit of ['crop', 'blur', 'contain']) {
        for (const brandLine of [false, true]) {
          const data = DATA({ captionMode: mode, filterPreset: look, fitMode: fit, brandLineEnabled: brandLine, overlayEffect: 'rain' });
          for (const c of flat(bind(sandbox, data))) seen.add(c.field);
        }
      }
    }
  }
  const style = new Set(CLIP_STYLE_FIELDS);
  for (const field of seen) {
    assert.ok(style.has(field), `the screen writes "${field}", which is not a clip-style field the renderer reads`);
  }
  // A control that cannot reach an export must not be shown (invariant 9), and
  // the hook is hard-disabled -- so it must not appear here either.
  for (const dead of ['hookEnabled', 'hookText', 'hookColor', 'hookBackground']) {
    assert.ok(!seen.has(dead), `the screen offers "${dead}", which cannot reach an export`);
  }
  assert.ok(seen.size >= 50, 'the screen covers the style: ' + seen.size);
});

test('no select ever shows a raw enum key', () => {
  const sandbox = makeSandbox();
  for (const mode of ['phrase', 'word', 'quran', 'dynamic-stack']) {
    const vals = bind(sandbox, DATA({ captionMode: mode }));
    for (const c of flat(vals)) {
      if (!c.isSelect) continue;
      for (const opt of own(c.opts)) {
        assert.ok(opt.label, `${c.field} offers "${opt.value}" with no label`);
        // A key is lower-case and hyphenated; a font name is its own label and
        // must not be forced to differ from its value.
        const isKey = v => /^[a-z][a-z0-9]*([-_][a-z0-9]+)*$/.test(v);
        if (isKey(opt.value)) {
          assert.notEqual(opt.label, opt.value, `${c.field} shows the raw key "${opt.value}"`);
        }
        assert.ok(!isKey(opt.label), `${c.field}'s label "${opt.label}" reads like a key`);
      }
    }
  }
});

// ── the visibility rules, which are what stop this being a wall of sliders ──

test('a control appears only where it does something', () => {
  const sandbox = makeSandbox();
  const shows = (extra, field) => Boolean(byField(bind(sandbox, DATA(extra)), field));

  // Stack fields belong to the two stacked modes.
  assert.equal(shows({ captionMode: 'dynamic-stack' }, 'captionStackLines'), true);
  assert.equal(shows({ captionMode: 'phrase' }, 'captionStackLines'), false);
  assert.equal(shows({ captionMode: 'dynamic-stack' }, 'captionStackProbability'), true);
  assert.equal(shows({ captionMode: 'stack-build' }, 'captionStackProbability'), false,
    'how often it stacks means nothing to the building stack');
  // Words per line is the stacked field OR the plain one, never both.
  assert.equal(shows({ captionMode: 'phrase' }, 'captionMaxWords'), true);
  assert.equal(shows({ captionMode: 'dynamic-stack' }, 'captionMaxWords'), false);
  assert.equal(shows({ captionMode: 'quran' }, 'captionMaxWords'), false,
    'the Quran template captions scripture and nothing else');

  // The ayah controls are the Quran mode's alone.
  assert.equal(shows({ captionMode: 'quran' }, 'captionArabicFont'), true);
  assert.equal(shows({ captionMode: 'phrase' }, 'captionArabicFont'), false);
  assert.equal(shows({ captionMode: 'quran', captionTranslation: true }, 'captionTranslationSize'), true);
  assert.equal(shows({ captionMode: 'quran', captionTranslation: false }, 'captionTranslationSize'), false,
    'a translation size with no translation line');

  // The grade sliders are what `custom` MEANS: filter_values in the worker is
  // applied under that preset and ignored under every other one.
  for (const field of ['brightness', 'contrast', 'saturation', 'gamma']) {
    assert.equal(shows({ filterPreset: 'custom' }, field), true, field);
    assert.equal(shows({ filterPreset: 'cinematic' }, field), false,
      `${field} is offered under a preset that overrides it`);
  }

  // Layout-specific.
  assert.equal(shows({ fitMode: 'blur' }, 'blurStrength'), true);
  assert.equal(shows({ fitMode: 'crop' }, 'blurStrength'), false);
  assert.equal(shows({ fitMode: 'contain' }, 'frameBackground'), true);
  assert.equal(shows({ fitMode: 'crop' }, 'frameBackground'), false);

  // Atmosphere strength with no atmosphere is a control that does nothing.
  assert.equal(shows({ overlayEffect: 'rain' }, 'overlayIntensity'), true);
  assert.equal(shows({ overlayEffect: 'none' }, 'overlayIntensity'), false);

  // The brand line's colour and height follow the line itself.
  assert.equal(shows({ brandLineEnabled: true }, 'brandLineColor'), true);
  assert.equal(shows({ brandLineEnabled: false }, 'brandLineColor'), false);

  // The highlight group is the live-word modes'.
  const hi = mode => own(bind(sandbox, DATA({ captionMode: mode })).tplControls.highlight).length;
  assert.ok(hi('word') > 0 && hi('fill') > 0 && hi('dynamic-stack') > 0);
  assert.equal(hi('phrase'), 0, 'a highlight colour on a mode with no highlighted word');
  assert.equal(hi('quran'), 0);
});

test('the two AI switches write their own fields', () => {
  // They shared one: the toggle wrote voiceEnhance for BOTH rows, so turning
  // "captions behind the speaker" on switched the voice enhancer instead.
  const sandbox = makeSandbox();
  const vals = bind(sandbox, DATA());
  const fields = own(vals.tplControls.processing).map(c => c.field);
  assert.deepEqual(fields, ['voiceEnhance', 'captionBehindSubject']);
  sandbox.StudioAdapter.ui.tplDraft = null;
  for (const c of own(vals.tplControls.processing)) c.toggle();
  const draft = sandbox.StudioAdapter.ui.tplDraft || {};
  assert.deepEqual(Object.keys(draft).sort(), ['captionBehindSubject', 'voiceEnhance']);
  assert.equal(draft.voiceEnhance, false, 'the on switch turned off');
  assert.equal(draft.captionBehindSubject, true, 'the off switch turned on');

  // The SAME pair on the old screen (still rendered on the phone and as the
  // fallback) shared one key: both rows wrote voiceEnhance, so turning
  // "captions behind the speaker" on switched the voice enhancer instead.
  sandbox.StudioAdapter.ui.tplDraft = null;
  const rows = own(bind(sandbox, DATA()).tplAIRows);
  assert.equal(rows.length, 2);
  for (const r of rows) r.toggle();
  assert.deepEqual(Object.keys(sandbox.StudioAdapter.ui.tplDraft || {}).sort(),
    ['captionBehindSubject', 'voiceEnhance'], 'the old screen\'s two rows share one key');
});

test('a slider carries the fill its track is drawn from', () => {
  const sandbox = makeSandbox();
  const vals = bind(sandbox, DATA({ captionMarginV: 680 }));
  const c = byField(vals, 'captionMarginV');
  // 20..960, value 680 -> (680-20)/940
  assert.equal(c.fillStyle, '--dct-pct: 70.2%;');
  const zero = byField(bind(sandbox, DATA({ captionMarginV: 20 })), 'captionMarginV');
  assert.equal(zero.fillStyle, '--dct-pct: 0%;');
});

// ── saved looks ─────────────────────────────────────────────────────────────

test('a saved look carries the style and neither brand switch', () => {
  const sandbox = makeSandbox();
  let fields = null;
  sandbox.StudioAdapter.onPresetSave = (name, sent) => { fields = sent; };
  sandbox.StudioAdapter.ui.presetName = 'My look';
  bind(sandbox, DATA()).savePreset();
  assert.ok(fields, 'Save look sent nothing');
  const style = new Set(CLIP_STYLE_FIELDS);
  for (const key of Object.keys(fields)) {
    assert.ok(style.has(key), `a look carries "${key}", which is not a clip-style field`);
    assert.ok(!BRAND_FIELDS.includes(key),
      `a look carries "${key}" -- the account's switch, which applying one would flip for every template`);
  }
  // Framing that belongs to the CLIP never travels either.
  for (const perClip of ['cropPositionX', 'cropPositionY']) {
    assert.ok(!(perClip in fields), `a look carries the per-clip ${perClip}`);
  }
  // The template's identity and its frame size are not part of a look.
  for (const key of ['id', 'name', 'width', 'height']) {
    assert.ok(!(key in fields), `a look carries "${key}"`);
  }
  assert.ok(Object.keys(fields).length >= 55, 'a look is the whole screen: ' + Object.keys(fields).length);
});

// ── mounting: the two ways this screen erased itself ────────────────────────

test('the screen stands down where the phone draws its own', () => {
  const sandbox = makeSandbox();
  const src2 = src('src/public/studio-templates.js');
  assert.match(src2, /StudioMobile[\s\S]{0,120}matchMedia/, 'the phone check reads StudioMobile.query');
  // paintTemplates with no document is a no-op rather than a throw: every host
  // panel runs from paintStudio, which also runs in a browser that has not
  // reached the studio yet.
  assert.doesNotThrow(() => sandbox.paintTemplates({}));
  assert.equal(sandbox.StudioTemplates.mounted(), false);
});

test('the generated screen is found by the walkthrough anchor, and never by a hashed class', () => {
  const js = src('src/public/studio-templates.js');
  assert.match(js, /\[data-tour="tpl-save"\]/, 'the generated screen is found by its anchor');
  // It carries the SAME anchor, so the finder must skip its own node: a bare
  // querySelector returned #dcTemplates (document order puts it first) and the
  // next repaint hid the screen it had just drawn.
  assert.match(js, /kid\.id === 'dcTemplates'/, 'the finder skips its own shell');
  assert.doesNotMatch(js, /document\.querySelector\(\s*'\[data-tour="tpl-save"\]'\s*\)/,
    'a document-wide lookup for the anchor finds this shell, not the generated screen');
  assert.doesNotMatch(js, /['"`]\.s[0-9a-z]{1,3}['"`]/, 'a hashed .sNN class named in the module');
});

test('the screen mounts its own runtime under its own handler attribute', () => {
  // An inner runtime's node bubbles to the OUTER root, which reads the same
  // attribute and calls an unrelated handler off its own table: picking a
  // caption mode unmounted the whole screen.
  const js = src('src/public/studio-templates.js');
  assert.match(js, /mount\(root, template, \{ attr: 'data-dct-h' \}\)/);
  const runtime = src('src/public/studio-runtime.js');
  assert.match(runtime, /function Renderer\(attr\)/, 'the renderer takes the attribute');
  assert.match(runtime, /this\.attr = attr \|\| 'data-dc-h'/);
  // And the two really do differ once rendered.
  const sandbox = makeSandbox();
  const { html } = render(sandbox, bind(sandbox, DATA()));
  assert.match(html, /data-dct-h="/);
  assert.doesNotMatch(html, /data-dc-h="/, 'the inner template writes the outer runtime\'s attribute');
});

test('index.html and the server carry the screen', () => {
  const html = src('src/public/index.html');
  assert.match(html, /<link rel="stylesheet" href="\/studio-templates\.css">/);
  assert.match(html, /<script src="\/studio-templates\.js"><\/script>/);
  assert.match(html, /paintTemplates\(vals\)/, 'paintStudio paints the screen');
  const server = src('src/server.js');
  assert.match(server, /'\/studio-templates\.css': \{ file: studioAsset\('studio-templates\.css'\)/);
  assert.match(server, /'\/studio-templates\.js': \{ file: studioAsset\('studio-templates\.js'\)/);
});

// ── the stylesheet: three faults that are invisible when they return ────────

test('the stylesheet names no hashed class and no token that does not exist', () => {
  const css = src('src/public/studio-templates.css');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.s[0-9a-z]{1,3}\b\s*[{,>]/,
    'a hashed .sNN class, which a design re-import renumbers');
  // A var() naming a token nothing declares fails SILENTLY -- and where it has
  // a hex fallback it renders correctly in night and never flips in daylight.
  const declared = new Set();
  for (const file of ['studio-tokens.css', 'studio-theme.generated.css', 'studio-templates.css']) {
    for (const m of src('src/public/' + file).matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
  }
  // --dct-pct is written as an INLINE style by the adapter beside the value it
  // comes from, so no sheet declares it; every other name must exist.
  declared.add('--dct-pct');
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/var\((--[a-z0-9-]+)/g)) {
    assert.ok(declared.has(m[1]), `studio-templates.css uses ${m[1]}, which is declared nowhere`);
  }
});

test('the slider pseudo-elements outrank the studio-wide range rule', () => {
  // index.html styles every studio slider at `#studio input[type=range]::…`
  // -- (1,1,1) -- and sets the track TRANSPARENT. A plain
  // `#dcTemplates .dct-range::…` is (1,1,0) and loses to it, so this screen's
  // track never painted in night at all. The attribute selector is what takes
  // it to (1,2,0).
  const css = src('src/public/studio-templates.css');
  assert.match(src('src/public/index.html'), /#studio input\[type=range\]::-webkit-slider-runnable-track\{background:transparent/,
    'the studio-wide rule this must outrank');
  for (const pseudo of ['-webkit-slider-runnable-track', '-webkit-slider-thumb', '-moz-range-track', '-moz-range-thumb']) {
    assert.ok(css.includes(`#dcTemplates .dct-range[type="range"]::${pseudo}`),
      `${pseudo} is not qualified by [type="range"] and loses to the studio-wide rule`);
    assert.ok(!new RegExp('#dcTemplates \\.dct-range::' + pseudo.replace(/-/g, '\\-')).test(css),
      `an unqualified ${pseudo} rule is still present`);
  }
});

test('the ordinary button carries no hex, so daylight cannot outrank the gold one', () => {
  // build-light-theme re-emits any rule whose value holds a hex, prefixed
  // `body.dc-light` -- (1,2,1), which beats `.dct-btn.dct-primary` at (1,2,0)
  // whatever the link order. Save and apply came out white on paper.
  const css = src('src/public/studio-templates.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const base = /#dcTemplates \.dct-btn \{([\s\S]*?)\}/.exec(css);
  assert.ok(base, 'the base button rule');
  assert.doesNotMatch(base[1], /#[0-9A-Fa-f]{3,8}\b/, 'a hex in the base button rule');
  const hover = /#dcTemplates \.dct-btn:hover \{?([^}]*)\}/.exec(css);
  assert.ok(hover && !/#[0-9A-Fa-f]{3,8}\b/.test(hover[1]), 'a hex in the base button hover');
  // And the generated sheet must therefore not carry either.
  const light = src('src/public/studio-light.generated.css');
  assert.doesNotMatch(light, /body\.dc-light #dcTemplates \.dct-btn\{/);
  assert.doesNotMatch(light, /body\.dc-light #dcTemplates \.dct-btn:hover\{/);
});

test('the select keeps its caret when daylight re-emits the rule', () => {
  // `background:` is a SHORTHAND: re-emitted alone it resets
  // background-position/size/repeat, and the two caret gradients then drew at
  // 0 0 / auto / repeat -- every select a slab split diagonally down the
  // middle. The ground is a longhand and the caret's colour carries no hex.
  const css = src('src/public/studio-templates.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /#dcTemplates \.dct-select \{([\s\S]*?)\}/.exec(css);
  assert.ok(rule, 'the select rule');
  assert.match(rule[1], /background-color:/, 'the select paints its ground with a longhand');
  assert.doesNotMatch(rule[1], /(^|;)\s*background:/, 'a background shorthand beside the caret longhands');
  const caret = /background-image:([\s\S]*?);/.exec(rule[1]);
  assert.ok(caret && !/#[0-9A-Fa-f]{3,8}\b/.test(caret[1]), 'a hex in the caret, which daylight would re-emit');
  const light = src('src/public/studio-light.generated.css');
  const emitted = /body\.dc-light #dcTemplates \.dct-select\{([^}]*)\}/.exec(light);
  assert.ok(emitted, 'daylight still repaints the select');
  assert.doesNotMatch(emitted[1], /background-image|(^|;)background:/, 'daylight resets the caret longhands');
});

test('the host brand panel is laid on this screen\'s own grid', () => {
  // paintWatermark draws its own markup with INLINE styles, which no
  // stylesheet outranks -- so its two switches sat at the card's right edge
  // beside four that sat at the control column. One card, two left edges.
  const css = src('src/public/studio-templates.css');
  const rule = /#dctBrandSlot #dcWatermark > label \{([\s\S]*?)\}/.exec(css);
  assert.ok(rule, 'the brand rows are laid out here');
  for (const prop of ['display', 'justify-content', 'padding']) {
    assert.match(rule[1], new RegExp(prop + ':[^;]*!important'),
      `${prop} is not !important, so the inline style wins`);
  }
  assert.match(rule[1], /grid-template-columns: var\(--dct-label\)/,
    'the switch lands on the row grid\'s own column rather than a measured number');
  assert.match(css, /#dctBrandSlot input\[type="checkbox"\][\s\S]*?width: 34px !important/,
    'the 17px inline square must be overridden or only the knob draws');
  assert.match(src('src/public/index.html'), /id="dctBrandSlot"|dctBrandSlot/,
    'paintWatermark knows the slot');
});

test('Brand is the first group in the configurator', () => {
  /* Youssef, 6 Sept 2026: "Brand should be at the top of the configurator".
     The watermark and the promo bar belong to the ACCOUNT rather than to the
     selected template, so they are what somebody checks before touching a
     caption -- and they were the one group you had to scroll past six others
     to reach. Asserted on the ORDER in the authored template rather than on a
     screenshot: nothing else would notice it drifting back down. */
  const js = src('src/public/studio-templates.js');
  const body = js.slice(js.indexOf("h('div', { class: 'dct-body' }"));
  const brand = body.indexOf("id: 'dctBrandSlot'");
  const first = body.indexOf("group('Clip layout'");
  assert.ok(brand > -1 && first > -1, 'both groups are still authored');
  assert.ok(brand < first, 'Brand is drawn before every template group');
});

test('the preview column is the larger of the two', () => {
  /* Two instructions, an hour apart on 6 Sept 2026. First "make the left side
     config smaller and make it more spacious for the right side, 50% 50% ratio
     to look cleaner" -- the settings column had been taking every spare pixel
     while the preview was capped. Then, looking at that: "make the preview
     larger by like 15% so left side is smaller".

     So the RELATIONSHIP is pinned, not the numbers: the preview column is
     strictly the larger, and the settings column is not starved either. Tuning
     the ratio is his call and must not fail the suite; inverting it is the
     regression this catches.

     minmax(0, Nfr) twice, never a bare `Nfr`: a grid track's automatic minimum
     is its content, and the frame plus the hint under it would push the preview
     column past its share and the row past the screen. */
  const css = src('src/public/studio-templates.css');
  const rule = /#dcTemplates \.dct-body \{([\s\S]*?)\}/.exec(css);
  assert.ok(rule, 'the body grid is still declared here');
  const cols = /grid-template-columns:\s*([^;]+);/.exec(rule[1]);
  assert.ok(cols, 'the body still sets its columns');
  // Split on the gap BETWEEN tracks -- `minmax(0, 44fr)` has a space of its
  // own inside it, so a naive split on whitespace cuts a track in half.
  const tracks = cols[1].trim().match(/minmax\([^)]*\)|\S+/g) || [];
  assert.equal(tracks.length, 2, `two tracks, got ${tracks.length}: ${cols[1].trim()}`);
  const share = t => {
    const m = /^minmax\(\s*0\s*,\s*([\d.]+)fr\s*\)$/.exec(t);
    assert.ok(m, `each track floors at 0 and takes a share: ${t}`);
    return Number(m[1]);
  };
  const [left, right] = tracks.map(share);
  assert.ok(right > left, `the preview column takes the larger share (${left} vs ${right})`);
  assert.ok(left / (left + right) >= 0.35,
    'the settings column still has to hold a label, a control and a readout');
});

test('the toolbar and the settings card share a left edge', () => {
  /* The content's left edge against the header above it is one of the
     alignments this repo measures, and the two paddings are set in different
     rules -- so trimming one for vertical room silently moves the toolbar's
     controls off the card below them. Measured in a browser after this change:
     both at x=256, and both right edges at 1412. */
  const css = src('src/public/studio-templates.css');
  const side = name => {
    const rule = new RegExp(`#dcTemplates \\.${name} \\{([\\s\\S]*?)\\}`).exec(css);
    assert.ok(rule, `${name} is still declared here`);
    const pad = /padding:\s*([^;]+);/.exec(rule[1]);
    assert.ok(pad, `${name} still sets its padding`);
    const parts = pad[1].trim().split(/\s+/);
    // `a b` is vertical then horizontal; `a b c d` is top right bottom left.
    return parts.length === 2 ? parts[1] : parts[1];
  };
  assert.equal(side('dct-bar'), side('dct-body'),
    'the toolbar and the row must be inset from the side by the same amount');
});

test('the preview fills its column, bounded only by the column\'s own width', () => {
  /* The preview IS this screen, so a constant ceiling holds it short of the
     room it has. Measured at 1920x1080 before this: 759px of room and a frame
     pinned to 620 -- 139px of the right-hand half left empty. That is the same
     fault the GENERATED screen's own sizing carried until v3.132.0 ("The right
     side video should fill as much as the page can"), so shipping it on the
     screen people actually see would have been that fix undone.

     The width bound is the real constraint and is not interchangeable with a
     number: a frame given the full height wants `height * ratio` of width, and
     a WIDE template blows through the column -- a 16:9 export at 759px of room
     asks for 1349px inside a 778px one. `max-width: 100%` does NOT save it:
     with an explicit height AND an aspect-ratio, clamping the width breaks the
     RATIO rather than the height, so the preview renders the wrong shape and
     misrepresents the export. Measured both ways at 1920x1080 with a 16:9
     aspect: bounded, 778x438 (shape 1.776); with a literal 620 in its place,
     778x620 -- shape 1.255. */
  const js = src('src/public/studio-templates.js');
  const fit = js.slice(js.indexOf('function fitFrame()'));
  const body = fit.slice(0, fit.indexOf('\n  }\n'));
  assert.ok(body.includes('clientWidth'),
    'the bound is derived from the column the frame has to fit inside');
  const clamp = /var wanted = [^;]+;/.exec(body);
  assert.ok(clamp, 'fitFrame still clamps to one wanted height');
  assert.match(clamp[0], /Math\.min\(\s*byWidth\s*,/,
    'the upper bound is the width-derived one, not a constant');
  assert.ok(!/Math\.min\(\s*\d/.test(clamp[0]),
    'a numeric ceiling here holds the preview short of the room it has');
  assert.ok(!/FRAME_MAX/.test(js), 'the arbitrary ceiling is gone, not merely unused');
});
