import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8');
const agent = fs.readFileSync(path.join(root, 'src', 'agent.js'), 'utf8');

test('the editor header contains a real Template selector', () => {
  assert.match(ui, /id="dcEditorStyleSelect"/);
  assert.match(ui, /Browse Templates…/);
  assert.match(ui, /Create new Template…/);
  assert.match(ui, /mountEditorStylePicker\(\)/,
    'the selector must be mounted beside the clip title');
  assert.match(ui, /\$\('#dcSaveDraft'\)\?\.remove\(\)/,
    'the old global Save button must not remain in the autosaving editor');
});

test('applying a style uses the server contract and preserves clip-owned values', () => {
  assert.match(ui, /DATA\?\.clipStyleFields/,
    'the browser must use the same style-field contract as the server');
  assert.match(ui, /'cropPositionX','cropPositionY','captionTimingOffsetMs'/,
    'the offline fallback must preserve framing and speech alignment too');
  assert.match(ui, /Object\.assign\(editor\.draft,clipStyleValues\(style\)\)/);
});

test('style actions are explicit and updating a style does not propagate', () => {
  for (const id of ['dcResetClipStyle', 'dcSaveClipStyleAsNew', 'dcUpdateClipStyle']) {
    assert.match(ui, new RegExp(`id="${id}"`));
  }
  assert.match(ui, /propagate:false/);
  assert.match(server, /body\.propagate !== false && selected\?\.id === template\.id/);
});

test('draft autosave persists transcript, editor state and applied style together', () => {
  assert.match(ui, /function scheduleEditorAutosave/);
  assert.match(ui, /function persistEditorDraft/);
  assert.match(ui, /transcript:editor\.captionText,editorDraft:cleanDraft\(editor\.draft\),editorAppliedStyleId:editor\.appliedStyleId/);
  assert.match(ui, /if\(!\(await flushEditorAutosave\(\)\)\)/,
    'export must wait for the latest autosave');
  assert.match(agent, /fields\.transcript/,
    'the server write path must not silently discard transcript edits');
  assert.match(agent, /fields\.editorDraft/);
  assert.match(agent, /fields, 'editorAppliedStyleId'/);
});

test('public state returns the saved editor draft and shared style contract', () => {
  assert.match(server, /editorDraft: clip\.editorDraft \|\| null/);
  assert.match(server, /editorAppliedStyleId: clip\.editorAppliedStyleId \|\| null/);
  assert.match(server, /clipStyleFields: templates\.CLIP_STYLE_FIELDS/);
});
