import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * THE TEMPLATES TOOLBAR: Undo, Redo, Reset, and a Save that costs something.
 *
 * Youssef, 6 Sept 2026: "top bar of saving about everything in terms of
 * templates, save as new template should ALL WORK PERECTLY."
 *
 * Driven, not read. `tplDirty` was a stored FLAG answering a question it could
 * not see: Undo back to the value already on the template left it set, so the
 * bar read "Unsaved changes" beside a template with none -- and pressing Save
 * there bumped the version AND queued a re-render of every unposted clip.
 * Measured in a browser on 6 Sept: v3 -> v4 with nothing pending, which on a
 * single-slot worker is minutes of real work for a change that was not one.
 *
 * The flag is gone. "Are there unsaved changes" is answered by comparing the
 * draft against the template it was laid over, and the one answer drives the
 * label, the dot and whether Save can be pressed at all.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src', 'public', 'studio-adapter.js'), 'utf8');
const screen = fs.readFileSync(path.join(here, '..', 'src', 'public', 'studio-templates.js'), 'utf8');

// `global` inside the adapter IS this window, and it reaches setTimeout through
// it -- the debounce behind every control write. Without these the first edit
// throws "global.setTimeout is not a function".
const sandbox = { window: {}, document: undefined, setTimeout, clearTimeout, console };
sandbox.window.window = sandbox.window;
sandbox.window.setTimeout = setTimeout;
sandbox.window.clearTimeout = clearTimeout;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'studio-adapter.js' });
const StudioAdapter = sandbox.window.StudioAdapter;
assert.ok(StudioAdapter, 'the adapter loaded');

const TEMPLATE = {
  id: 'clean-line', name: 'Clean Line', height: 1920, width: 1080, version: 3,
  captionFontSize: 96, captionMarginV: 680, filterPreset: 'natural', captionMode: 'dynamic-stack',
};
const STATE = {
  projects: [], clips: [], tracks: [],
  templates: [TEMPLATE], selectedTemplate: TEMPLATE,
};

function screenAt(extra = {}) {
  Object.assign(StudioAdapter.ui, {
    screen: 'templates', tplDraft: null, tplTimer: null,
    tplPast: [], tplFuture: [], tplReplaying: false, ...extra,
  });
  StudioAdapter.onTemplateField = () => {};
  StudioAdapter.onResetTemplate = () => {};
  return StudioAdapter.bindings(STATE);
}

test('an untouched template has nothing to save, and says so', () => {
  const b = screenAt();
  assert.equal(b.tplDirtyLabel, 'All changes saved');
  assert.equal(b.tplSaveDisabled, true);
});

test('a real edit arms it', () => {
  const b = screenAt({ tplDraft: { captionFontSize: 120 } });
  assert.equal(b.tplDirtyLabel, 'Unsaved changes');
  assert.equal(b.tplSaveDisabled, false);
});

test('a draft written back to the value it already had is NOT a change', () => {
  // This is the Undo case. The old flag stayed true here, so the bar lied and
  // Save was armed to spend a worker on nothing.
  const b = screenAt({ tplDraft: { captionFontSize: 96 } });
  assert.equal(b.tplDirtyLabel, 'All changes saved');
  assert.equal(b.tplSaveDisabled, true);
});

test('a draft that changes one field of several is still a change', () => {
  const b = screenAt({ tplDraft: { captionFontSize: 96, captionMarginV: 700 } });
  assert.equal(b.tplSaveDisabled, false, 'one moved field is enough');
  let sent = null;
  StudioAdapter.onSaveTemplate = (id, pending) => { sent = { id, pending }; };
  b.saveTpl({ preventDefault() {} });
  // Copied out of the vm realm: an object built in there is that realm's
  // Object, and strict deepEqual rejects it on the prototype.
  assert.equal(sent.id, 'clean-line');
  assert.deepEqual({ ...sent.pending }, { captionMarginV: 700 },
    'and only what actually moved is sent');
});

test('Save with nothing pending writes nothing at all', () => {
  // The button is disabled, so this is the backstop -- a keyboard, or a render
  // one paint behind. It must not reach the server: that route bumps the
  // version and re-renders every unposted clip.
  const b = screenAt({ tplDraft: { captionFontSize: 96 } });
  let called = false;
  StudioAdapter.onSaveTemplate = () => { called = true; };
  b.saveTpl({ preventDefault() {} });
  assert.equal(called, false, 'no save was sent');
  assert.equal(StudioAdapter.ui.tplDraft, null, 'and the no-op draft was cleared');
});

test('the Save button is disabled from that same answer', () => {
  // The runtime omits an attribute bound to false, so this is a real boolean
  // rather than the string "false", which HTML would read as disabled forever.
  assert.match(screen, /disabled: b\('tplSaveDisabled'\)/,
    'the toolbar binds the disabled state');
  assert.match(screen, /#?dct-btn|dct-primary/, 'on the primary button');
});

test('Undo steps back, Redo puts it back, and the bar follows both', () => {
  const b = screenAt();
  b.setSize({ target: { value: '120' } });
  assert.equal(StudioAdapter.ui.tplDraft.captionFontSize, 120);
  assert.equal(StudioAdapter.bindings(STATE).tplSaveDisabled, false, 'armed after the edit');

  StudioAdapter.bindings(STATE).undoEdit({ preventDefault() {} });
  assert.equal(StudioAdapter.bindings(STATE).tplSaveDisabled, true,
    'undone back to the template, so there is nothing to save');

  StudioAdapter.bindings(STATE).redoEdit({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.tplDraft.captionFontSize, 120);
  assert.equal(StudioAdapter.bindings(STATE).tplSaveDisabled, false, 'armed again');
});

test('Reset discards the draft rather than restoring the shipped file', () => {
  // Two different controls, deliberately: Reset drops unsaved changes, and
  // "Restore the shipped defaults" clears the account's overrides. Collapsing
  // them would make one of the two a control that does something else.
  const b = screenAt({ tplDraft: { captionFontSize: 120 } });
  let restored = 0;
  StudioAdapter.onTemplateRestore = () => { restored += 1; };
  b.resetTpl({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.tplDraft, null, 'the draft is gone');
  assert.equal(restored, 0, 'and nothing asked the server to restore anything');
  assert.equal(StudioAdapter.bindings(STATE).tplSaveDisabled, true);

  StudioAdapter.bindings(STATE).restoreTpl({ preventDefault() {} });
  assert.equal(restored, 1, 'that is the other button');
});

test('there is no tplDirty flag left to disagree with the draft', () => {
  // A second answer to one question is how every drift in this file started,
  // and this one was measurably wrong in the direction that costs work.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/tplDirty\b(?!Label|DotStyle)/.test(stripped),
    'tplDirty is gone from the adapter outside its label bindings');
});
