import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('templates are presented as an understandable clip-style workflow', () => {
  assert.match(ui, /\['templates','Clip Styles','style'\]/);
  assert.match(ui, /Choose how every new clip looks/);
  assert.match(ui, /Current default for new clips/);
  assert.match(ui, /Existing clips stay unchanged/);
  assert.match(ui, /Recommended styles/);
  assert.match(ui, /Your saved styles/);
  assert.match(ui, /Style previews use sample caption text/);
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
