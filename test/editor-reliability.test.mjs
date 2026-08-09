import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('editor history preserves exact caption timing and framing state', () => {
  assert.match(ui, /captionWords:editor\.captionWords,captionSource:editor\.captionSource,framingPlan:editor\.framingPlan/);
  const restore = ui.match(/function restoreHistory\(\)\{(.+)\}\nfunction markEditorDirty/);
  assert.ok(restore, 'restoreHistory should remain present');
  assert.match(restore[1], /snap\.captionWords/);
  assert.match(restore[1], /snap\.framingPlan/);
  assert.doesNotMatch(restore[1], /renderEditor\(/, 'undo must not rebuild and restart the editor');
});

test('edited transcript words keep the original speech timing reference', () => {
  assert.match(ui, /captionTimingReference:\[\]/);
  assert.match(ui, /mapEditedWordsToSpeech\(editor\.captionText,editor\.captionTimingReference\.length\?editor\.captionTimingReference:editor\.captionWords/);
  assert.match(ui, /editor\.captionTimingReference=clone\(timed\)/);
});

test('editor exposes explicit layers, safe zones, and keyboard precision controls', () => {
  assert.match(ui, /data-select-layer="video"/);
  assert.match(ui, /data-select-layer="captions"/);
  assert.match(ui, /id="dcSafeZones"/);
  assert.match(ui, /function nudgeEditorLayer\(dx,dy\)/);
  assert.match(ui, /Shift \+ arrows nudge/);
});

test('local recovery and save status are visible to the creator', () => {
  assert.match(ui, /version:2,draft:cleanDraft\(editor\.draft\),captionText:editor\.captionText/);
  assert.match(ui, /Draft backed up locally/);
  assert.match(ui, /All changes saved/);
});

test('save and export cannot run over each other', () => {
  assert.match(ui, /if\(!clip\|\|editor\.saving\|\|editor\.exporting\)return;editor\.saving=true/);
  assert.match(ui, /if\(!clip\|\|editor\.exporting\|\|editor\.saving\)return;editor\.exporting=true/);
  assert.match(ui, /finally\{editor\.saving=false/);
  assert.match(ui, /finally\{editor\.exporting=false/);
});

test('caption controls match exports and expose a broad font and timing set', () => {
  assert.match(ui, /rangeField\('Font size','captionFontSize',24,180,1\)/);
  assert.match(ui, /\['Manrope','Manrope'\]/);
  assert.match(ui, /\['Roboto','Roboto'\]/);
  assert.match(ui, /\['Noto Sans','Noto Sans'\]/);
  assert.match(ui, /\['Noto Naskh Arabic','Noto Naskh Arabic'\]/);
  assert.match(ui, /rangeField\('Clear on silent gap','captionClearPause'/);
  assert.match(ui, /rangeField\('Font weight','captionFontWeight'/);
  assert.match(ui, /id="dcSyncCaptions"/);
  assert.match(ui, />\$\{busy\?'Syncing…':'Sync captions'\}</);
});
