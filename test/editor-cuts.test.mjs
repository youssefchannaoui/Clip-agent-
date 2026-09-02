import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// The editor's section cuts, v3.78.0. The render pipeline learned to cut on
// 26 Aug (cutsSec, retime_for_cuts) and agent.updateClip has persisted a LIST
// of keep ranges since -- but the only control was a single trim. A cut out of
// the middle is the same primitive with a gap in it, and this is that control.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadAdapter() {
  const src = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  const sandbox = {
    window: {}, document: { addEventListener() {}, createElement: () => ({ style: {} }), getElementById: () => null, querySelector: () => null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { language: 'en' }, console, setTimeout, clearTimeout, requestAnimationFrame: undefined,
    Intl, Date, Math, JSON, Number, String, Array, Object, isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.StudioAdapter;
}

const SA = loadAdapter();

function clip(extra = {}) {
  return {
    id: 'c1', projectId: 'p1', title: 'A clip', status: 'waiting', score: 80, durationMs: 40000,
    transcript: 'one two three four', captionSegments: [{ start: 0, end: 4, text: 'one two three four' }],
    templateId: 'clean-line', renderQuality: 'final', musicVerified: true, renderVerified: true, targets: [], ...extra,
  };
}

function open(c, ui = {}) {
  Object.assign(SA.ui, { screen: 'editor', edClipId: 'c1', edTrim: null, edCutOuts: null, edCutMark: null, edTime: 0, edDirty: false, ...ui });
  return SA.bindings({ clips: [c], projects: [{ id: 'p1', title: 'L', status: 'done' }], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
}

const ev = { preventDefault() {}, stopPropagation() {} };

test('a clip with no cuts keeps the whole thing and offers the cut', () => {
  const v = open(clip());
  assert.deepEqual(Array.from(v.edKeeps).map(r => Array.from(r)), [[0, 40]]);
  assert.equal(v.edCutSections.length, 0);
  assert.equal(v.edCutArmed, false);
  assert.match(v.edCutButtonLabel, /^Cut a section from here/);
  assert.match(v.edTrimLabel, /whole clip is kept/);
});

test('two presses of the cut button remove the stretch between them', () => {
  let v = open(clip(), { edTime: 10 });
  v.markCut(ev);
  v = open(clip(), { edTime: 10, edCutMark: SA.ui.edCutMark, edCutOuts: SA.ui.edCutOuts });
  assert.equal(v.edCutArmed, true, 'armed after the first press');
  assert.equal(v.edCutMarkAt, 10);
  SA.ui.edTime = 16;
  v = SA.bindings({ clips: [clip()], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  assert.match(v.edCutButtonLabel, /Cut to here \(0:10.0:16\)/);
  v.markCut(ev);
  v = SA.bindings({ clips: [clip()], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  assert.deepEqual(Array.from(v.edKeeps).map(r => Array.from(r)), [[0, 10], [16, 40]]);
  assert.equal(v.edCutSections.length, 1);
  assert.equal(v.edCutSections[0].label, '0:10–0:16');
  assert.match(v.edTrimLabel, /Keeping 0:34 of 0:40 in 2 sections/);
  assert.equal(SA.ui.edDirty, true);
  assert.equal(v.edCutArmed, false, 'disarmed after the second press');
});

test('the order of the two presses does not matter, and a double-press is not a cut', () => {
  let v = open(clip(), { edTime: 30 });
  v.markCut(ev);
  SA.ui.edTime = 20;
  v = SA.bindings({ clips: [clip()], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  v.markCut(ev);
  v = SA.bindings({ clips: [clip()], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  assert.deepEqual(Array.from(v.edKeeps).map(r => Array.from(r)), [[0, 20], [30, 40]]);

  v = open(clip(), { edTime: 12 });
  v.markCut(ev);
  SA.ui.edTime = 12.2;
  v = SA.bindings({ clips: [clip()], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  v.markCut(ev);
  v = SA.bindings({ clips: [clip()], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  assert.equal(v.edCutSections.length, 0, 'under half a second is a double-press');
  assert.equal(v.edCutArmed, false);
});

test('a saved list of keep ranges is read back as its gaps, and restore puts one back', () => {
  let v = open(clip({ cutsSec: [[2, 10], [15, 22], [30, 38]] }));
  assert.equal(v.edCutSections.length, 2, 'two gaps between three kept ranges');
  assert.deepEqual(Array.from(v.edKeeps).map(r => Array.from(r)), [[2, 10], [15, 22], [30, 38]]);
  assert.match(v.edTrimLabel, /in 3 sections/);
  v.restoreCut(0);
  v = SA.bindings({ clips: [clip({ cutsSec: [[2, 10], [15, 22], [30, 38]] })], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  assert.deepEqual(Array.from(v.edKeeps).map(r => Array.from(r)), [[2, 22], [30, 38]]);
});

test('the shading darkens every removed stretch, not only the outer trim', () => {
  const v = open(clip({ cutsSec: [[0, 10], [16, 40]] }));
  assert.match(v.edTrimKeepStyle, /transparent 0\.00% 25\.00%/);
  assert.match(v.edTrimKeepStyle, /rgba\(8,8,10,\.72\) 25\.00% 40\.00%/);
  assert.match(v.edTrimKeepStyle, /transparent 40\.00% 100\.00%/);
  assert.doesNotMatch(v.edTrimKeepStyle, /opacity: 0/);
});

test('save sends the whole keep list, and clears the working state', () => {
  const calls = [];
  SA.onSaveClip = (id, payload) => calls.push([id, payload]);
  SA.onClipStyle = () => {};
  let v = open(clip(), { edTime: 10 });
  v.markCut(ev);
  SA.ui.edTime = 16;
  v = SA.bindings({ clips: [clip()], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  v.markCut(ev);
  v = SA.bindings({ clips: [clip()], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  v.saveEdit(ev);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].cutsSec)), [[0, 10], [16, 40]]);
  assert.equal(SA.ui.edCutOuts, null);
  assert.equal(SA.ui.edTrim, null);
});

test('"Use the whole clip" clears the sections as well as the trim', () => {
  let v = open(clip({ cutsSec: [[0, 10], [16, 40]] }));
  v.resetTrim(ev);
  v = SA.bindings({ clips: [clip({ cutsSec: [[0, 10], [16, 40]] })], projects: [], templates: [], selectedTemplate: null, social: {}, publishingSettings: {}, billing: {}, jobs: [] });
  assert.deepEqual(Array.from(v.edKeeps).map(r => Array.from(r)), [[0, 40]]);
  assert.equal(v.edCutSections.length, 0);
});

test('the editor is no longer gated', () => {
  const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  const phone = fs.readFileSync(path.join(ROOT, 'src/public/studio-responsive.css'), 'utf8');
  assert.doesNotMatch(host, /editor-gate/, 'the gate script and sheet are not linked');
  assert.doesNotMatch(server, /editor-gate/, 'and not served');
  assert.doesNotMatch(phone, /dcEditorSoon/, 'the phone rule no longer exempts a notice that does not exist');
  assert.match(host, /function paintTrimTools\(vals\)/);
  assert.match(host, /\n  paintTrimTools\(vals\);\n/, 'registered in paintStudio, never on an observer');
});
