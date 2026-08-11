import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Executes the studio's real logic rather than grepping for strings.

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const between = (from, to) => {
  const start = ui.indexOf(from);
  const end = ui.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `could not slice ${from} .. ${to}`);
  return ui.slice(start, end);
};

const stubs = `
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v || {}));
const shortText = (v, n) => String(v || '').slice(0, n);
const templateSafeColor = (v, f='#FFFFFF') => /^#[0-9A-F]{6}$/i.test(String(v||'')) ? String(v).toUpperCase() : f;
const templateModeLabel = m => m === 'phrase' ? 'Phrase captions' : m === 'word' ? 'Word highlight' : 'Dynamic word stack';
const templateFitLabel = m => m === 'crop' ? 'Full-frame crop' : m === 'blur' ? 'Blurred background' : 'Full source visible';
const templatePreviewMarkup = () => '<div class="dc-style-phone"></div>';
const data = () => DATA;
const ICON = { style:'<svg/>', captions:'<svg/>', details:'<svg/>', canvas:'<svg/>', brand:'<svg/>', audio:'<svg/>', chevron:'<svg/>' };
let DATA = { templates: [], selectedTemplate: null };
`;

const mod = new Function(
  stubs +
  between('const STYLE_GROUPS=[', 'async function styleStudioSave(){') +
  '; return { styleStudio, styleStudioLoad, styleStudioSet, styleStudioPush, styleGroupControls, styleGroupSummary, styleTemplateCard, STYLE_GROUPS, setData: v => { DATA = v; } };',
)();

const TEMPLATE = {
  id: 'deenclipped-gold', name: 'DeenClipped Gold', builtIn: true,
  fitMode: 'contain', filterPreset: 'natural', frameBackground: '#000000', blurStrength: 28,
  captionMode: 'dynamic-stack', captionFont: 'DejaVu Sans', captionPrimary: '#FFFFFF',
  captionHighlight: '#D9B478', captionPositionX: 78, captionPositionY: 58, captionMaxWords: 4,
  hookEnabled: false, hookDuration: 2.4,
  smartFramingEnabled: true, smartFramingBias: 'auto',
  watermark: 'DEENCLIPPED', watermarkPosition: 'top-center', watermarkOpacity: 100,
  brandLineEnabled: false, brandLineColor: '#D9B478', voiceEnhance: true,
};

test('loading a template seeds the draft and a single history entry', () => {
  mod.styleStudioLoad(TEMPLATE);
  assert.equal(mod.styleStudio.baseId, 'deenclipped-gold');
  assert.equal(mod.styleStudio.dirty, false);
  assert.equal(mod.styleStudio.history.length, 1);
  assert.equal(mod.styleStudio.index, 0);
  // The draft must be a copy — editing it must not mutate the saved template.
  mod.styleStudioSet('captionFont', 'Amiri');
  assert.equal(TEMPLATE.captionFont, 'DejaVu Sans', 'the source template was mutated');
});

test('edits push history and mark the studio dirty', () => {
  mod.styleStudioLoad(TEMPLATE);
  mod.styleStudioSet('captionMode', 'phrase');
  mod.styleStudioSet('captionMode', 'word');
  assert.equal(mod.styleStudio.dirty, true);
  assert.equal(mod.styleStudio.history.length, 3);
  assert.equal(mod.styleStudio.index, 2);
  assert.equal(mod.styleStudio.draft.captionMode, 'word');
});

test('editing after an undo discards the abandoned redo branch', () => {
  mod.styleStudioLoad(TEMPLATE);
  mod.styleStudioSet('captionMode', 'phrase');
  mod.styleStudioSet('captionMode', 'word');
  // Simulate an undo, then a fresh edit.
  mod.styleStudio.index = 1;
  mod.styleStudio.draft = JSON.parse(JSON.stringify(mod.styleStudio.history[1]));
  mod.styleStudioSet('captionFont', 'Amiri');
  assert.equal(mod.styleStudio.index, 2);
  assert.equal(mod.styleStudio.history.length, 3, 'the stale redo entry should be dropped');
  assert.equal(mod.styleStudio.history[2].captionFont, 'Amiri');
});

test('history is capped so a long session cannot grow without bound', () => {
  mod.styleStudioLoad(TEMPLATE);
  for (let i = 0; i < 90; i += 1) mod.styleStudioSet('captionFontSize', 60 + i);
  assert.ok(mod.styleStudio.history.length <= 60, `history grew to ${mod.styleStudio.history.length}`);
  assert.equal(mod.styleStudio.draft.captionFontSize, 149, 'the newest edit must survive the trim');
});

test('every group renders controls bound to real field keys', () => {
  mod.styleStudioLoad(TEMPLATE);
  const expected = {
    layout: ['fitMode', 'frameBackground', 'filterPreset'],
    captions: ['captionMode', 'captionPrimary', 'captionPositionX'],
    headline: ['hookEnabled', 'hookDuration'],
    framing: ['smartFramingEnabled', 'smartFramingBias'],
    overlay: ['watermark', 'watermarkPosition', 'brandLineEnabled'],
    audio: ['voiceEnhance'],
  };
  for (const [group, keys] of Object.entries(expected)) {
    const html = mod.styleGroupControls(group);
    assert.ok(html.length > 0, `${group} should render controls`);
    assert.doesNotMatch(html, /\[object Object\]/, `${group} stringified an object`);
    assert.doesNotMatch(html, /undefined/, `${group} rendered undefined`);
    for (const key of keys) {
      assert.ok(
        html.includes(`data-style-key="${key}"`) || html.includes(`data-style-seg="${key}"`),
        `${group} should bind ${key}`,
      );
    }
  }
});

test('controls reflect the current draft, not the defaults', () => {
  mod.styleStudioLoad({ ...TEMPLATE, captionMode: 'phrase', hookEnabled: true });
  const captions = mod.styleGroupControls('captions');
  assert.match(captions, /data-style-seg="captionMode" data-style-value="phrase" class="on"/);
  assert.match(mod.styleGroupControls('headline'), /data-style-key="hookEnabled" data-style-type="bool" checked/);
});

test('every group has a summary and none of them read undefined', () => {
  mod.styleStudioLoad(TEMPLATE);
  for (const [id] of mod.STYLE_GROUPS) {
    const summary = mod.styleGroupSummary(id);
    assert.ok(summary && summary.length, `${id} needs a summary`);
    assert.doesNotMatch(summary, /undefined|NaN|\[object/, `${id} summary: ${summary}`);
  }
});

test('the template being edited is marked, and built-ins cannot be deleted', () => {
  mod.setData({ templates: [TEMPLATE], selectedTemplate: { id: "deenclipped-gold" } });
  mod.styleStudioLoad(TEMPLATE);
  const card = mod.styleTemplateCard(TEMPLATE, '');
  assert.match(card, /is-editing/);
  assert.match(card, /dc-style-flag/);
  assert.doesNotMatch(card, /data-delete-template/, 'built-in templates must not be deletable');
  assert.match(card, /data-duplicate-template="deenclipped-gold"/);

  const custom = mod.styleTemplateCard({ ...TEMPLATE, id: 'c1', name: 'Mine', builtIn: false }, '');
  assert.match(custom, /data-delete-template="c1"/);
  assert.match(custom, /data-use-template="c1"/, 'a non-default template can be made default');
});

test('template names are escaped, not injected', () => {
  mod.setData({ templates: [], selectedTemplate: null });
  const card = mod.styleTemplateCard({ id: 'x', name: '<img src=x onerror=alert(1)>', builtIn: false }, '');
  assert.doesNotMatch(card, /<img src=x onerror/);
  assert.match(card, /&lt;img src=x onerror/);
});

test('the template picker is a dropdown that starts closed', () => {
  // It used to be an always-open strip of full-size cards that pushed the
  // settings below the fold and made the editor look like a gallery.
  mod.styleStudioLoad(TEMPLATE);
  assert.equal(mod.styleStudio.menuOpen, false, 'the menu must start closed');
  assert.match(ui, /class="dc-style-picker/);
  assert.match(ui, /styleStudio\.menuOpen\?`<div class="dc-style-menu"/, 'the list renders only when open');
  assert.doesNotMatch(ui, /class="dc-style-strip"/, 'the always-open strip is gone');
});

test('a template row is compact, not a full-size card', () => {
  mod.setData({ templates: [TEMPLATE], selectedTemplate: { id: 'deenclipped-gold' } });
  mod.styleStudioLoad(TEMPLATE);
  const row = mod.styleTemplateCard(TEMPLATE, '');
  assert.match(row, /class="dc-style-row /);
  assert.match(row, /dc-style-row-art/);
  assert.doesNotMatch(row, /dc-style-card-art/, 'the big card layout is gone');
});

test('the stage draws exactly one preview badge', () => {
  // templatePreviewMarkup already renders its own "Sample preview" pill;
  // a second one was being stacked on top of it and the two overlapped.
  assert.doesNotMatch(ui, /dc-style-demo/, 'the duplicate badge must be gone');
  // Count rendered markup only — the file also carries CSS selectors for it.
  assert.equal(
    (ui.match(/class="dc-style-sample-badge"/g) || []).length,
    1,
    'exactly one badge element is rendered',
  );
});

// The drag itself needs a DOM, so these assert the two things that would
// silently rot without one: that the studio and the clip editor share the
// same feel, and that a drag costs one undo step rather than sixty.

const styleDrag = between('function bindStyleCaptionDrag(sourcePreview){', 'function styleStudioPaint');
const editorDrag = between('function bindCaptionDrag(){', 'function bindVideo');

test('the studio caption drag matches the editor gesture for gesture', () => {
  for (const source of [styleDrag, editorDrag]) {
    assert.match(source, /snapPoints=\[25,50,75\],snapDistance=2\.5/, 'shared snap behaviour');
    assert.match(source, /clamp\(drag\.startSize\+delta\/Math\.max\(1,drag\.rect\.height\)\*260,24,160\)/, 'shared resize curve');
    assert.match(source, /setPointerCapture/, 'pointer capture so the drag survives leaving the element');
  }
});

test('dragging writes the same template fields the sliders do', () => {
  assert.match(styleDrag, /captionPositionX/);
  assert.match(styleDrag, /captionPositionY/);
  assert.match(styleDrag, /captionFontSize/);
  // Position stays inside the frame.
  assert.match(styleDrag, /clamp\(x,8,92\)/);
  assert.match(styleDrag, /clamp\(y,12,88\)/);
});

test('a drag costs exactly one undo step', () => {
  const move = styleDrag.slice(styleDrag.indexOf('caption.onpointermove'), styleDrag.indexOf('const finish'));
  const finish = styleDrag.slice(styleDrag.indexOf('const finish'));
  assert.doesNotMatch(move, /styleStudioPush\(\)/, 'pointermove must not push history');
  assert.match(finish, /styleStudioPush\(\)/, 'pointerup commits one entry');
});

test('the stage renders snap guides for the drag to show', () => {
  assert.match(ui, /data-style-guide="v"/);
  assert.match(ui, /data-style-guide="h"/);
  assert.match(ui, /function styleStageInner\(sourcePreview\)/);
});
