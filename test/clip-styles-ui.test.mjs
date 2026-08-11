import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('templates are presented as an understandable clip-style workflow', () => {
  // Copy was rewritten on 11 Aug when the page moved to preview-led tiles.
  // What must survive is the meaning, not the wording: the page says what a
  // style controls, promises existing clips are untouched, marks the current
  // default, and separates ready-made from custom.
  assert.match(ui, /\['templates','Clip Styles','style'\]/);
  assert.match(ui, /Choose how new clips look/);
  assert.match(ui, /current default/);
  assert.match(ui, /Existing clips stay as they are/);
  assert.match(ui, /Recommended styles/);
  assert.match(ui, /Your styles/);
});

test('a style is never applied to existing clips without an explicit action', () => {
  // Silently restyling clips the user already approved would be destructive,
  // so applying to existing clips must stay a separate, named control.
  assert.match(ui, /data-apply-template/);
  assert.match(ui, /Apply default to existing clips/);
  assert.match(ui, /Nothing changes until you choose/);
});

test('clip-style previews read the real top-level template settings', () => {
  assert.match(ui, /function templatePreviewMarkup/);
  assert.match(ui, /t\.captionHighlight/);
  assert.match(ui, /t\.captionMode/);
  assert.match(ui, /t\.fitMode/);
  assert.match(ui, /t\.captionFont/);
  assert.match(ui, /t\.watermarkPosition/);
  assert.match(ui, /projectThumbUrl\(project,\[\]\)/);
  assert.doesNotMatch(ui, /t\.caption\?\.highlightStyle/);
  assert.doesNotMatch(ui, /t\.caption\?\.highlightColor/);
});

test('preview, future-default, editor and bulk actions have distinct labels', () => {
  assert.match(ui, /data-preview-template/);
  assert.match(ui, /Use for new clips/);
  assert.match(ui, /Apply to existing clips/);
  assert.match(ui, /data-open-style-editor/);
  assert.match(ui, /Nothing changes until you choose/);
});
