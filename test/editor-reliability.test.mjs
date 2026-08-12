import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('editor history preserves exact caption timing and framing state', () => {
  assert.match(ui, /captionWords:editor\.captionWords,captionSource:editor\.captionSource,framingPlan:editor\.framingPlan/);
  const restore = ui.match(/function restoreHistory\(\)\{(.+)\}\nfunction scheduleEditorAutosave/);
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
  assert.match(ui, /version:3,draft:cleanDraft\(editor\.draft\),captionText:editor\.captionText,appliedStyleId:editor\.appliedStyleId/);
  assert.match(ui, /Draft backed up locally/);
  assert.match(ui, /Saved ✓/);
  assert.match(ui, /Could not save/);
});

test('save and export cannot run over each other', () => {
  assert.match(ui, /if\(editor\.savePromise\)\{await editor\.savePromise/);
  assert.match(ui, /if\(!\(await flushEditorAutosave\(\)\)\)/);
  assert.match(ui, /editor\.saving=false;editor\.savePromise=null/);
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
});

test('captions synchronise themselves instead of offering a Sync button', () => {
  // 12 Aug: the caption panel used to lead with "Sync captions", asking the
  // user to run a repair the app already knew how to perform — there was no
  // case where "leave it unsynced" was the right answer. The button is gone
  // and autoSyncCaptions() runs on open.
  assert.doesNotMatch(ui, /id="dcSyncCaptions"/, 'the manual sync button must not come back');
  assert.doesNotMatch(ui, /'Sync captions'/, 'nothing should still offer syncing as a user chore');
  assert.match(ui, /async function autoSyncCaptions\(clip\)\{/);
  assert.match(ui, /autoSyncCaptions\(clip\);/, 'it must actually be called when a clip opens');
});

test('auto-sync never discards the user own caption edits', () => {
  // Re-pulling Whisper over hand-edited words would silently throw away the
  // user's rewrite, which is worse than slightly-off timing.
  const fn = ui.slice(ui.indexOf('async function autoSyncCaptions(clip){'));
  // Comments stripped: this file explains its reasoning inline, and prose that
  // names a call is not a call. Asserting against raw text made the comment
  // "Not markEditorDirty(): ..." read as evidence of the very bug it prevents.
  const body = fn.slice(0, fn.indexOf('\n}')).replace(/^\s*\/\/.*$/gm, '');
  assert.match(body, /captionSource==='whisper'\|\|editor\.captionSource==='edited'\)return/);
  // A repair the user did not ask for must not mark their draft dirty, or
  // every clip opens claiming unsaved changes.
  assert.doesNotMatch(body, /markEditorDirty\(\)/);
  // And a clip switch mid-flight must not write stale words over the new clip.
  assert.match(body, /if\(editor\.clipId!==clipId\)return;/);
});
