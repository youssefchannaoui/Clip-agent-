import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('Clip Styles is a template studio with the full editing chrome', () => {
  assert.match(ui, /\['templates','Clip Styles','style'\]/);
  assert.match(ui, /function renderTemplatesPage\(\)/);
  // Top bar: switch template, undo, redo, discard, save.
  for (const id of ['dcStyleSwitch', 'dcStyleUndo', 'dcStyleRedo', 'dcStyleRevert', 'dcStyleSave', 'dcStyleNew']) {
    assert.match(ui, new RegExp(id), `${id} should exist`);
  }
});

test('every settings group is backed by real template fields', () => {
  // A control that writes a field the renderer does not read is a lie about
  // what the export will look like, so each group is pinned to its fields.
  const fields = {
    layout: ['fitMode', 'frameBackground', 'filterPreset', 'blurStrength'],
    captions: ['captionMode', 'captionFont', 'captionPrimary', 'captionHighlight', 'captionPositionX', 'captionMaxWords'],
    headline: ['hookEnabled', 'hookDuration', 'hookFontSize', 'hookBackgroundOpacity'],
    framing: ['smartFramingEnabled', 'smartFramingBias', 'smartFramingZoom'],
    overlay: ['watermark', 'watermarkPosition', 'watermarkOpacity', 'brandLineEnabled'],
    audio: ['voiceEnhance'],
  };
  for (const [group, keys] of Object.entries(fields)) {
    for (const key of keys) {
      assert.match(ui, new RegExp(`'${key}'`), `${group}: ${key} should be editable`);
    }
  }
});

test('no control is offered for a feature the worker cannot do', () => {
  // OpusClip ships these; our pipeline does not. A dead toggle would quietly
  // promise a render change that never happens.
  const worker = fs.readFileSync(new URL('../worker/clip_worker.py', import.meta.url), 'utf8');
  for (const absent of ['Remove filler words', 'Remove pauses', 'AI emojis', 'Stock Video B-Roll', 'AI keywords highlighter']) {
    assert.doesNotMatch(ui, new RegExp(absent), `${absent} is not implemented in the worker`);
  }
  // Guard the inverse: if the worker ever grows filler-word removal, this
  // test should be revisited rather than silently passing forever.
  assert.doesNotMatch(worker, /remove_filler_words/);
});

test('saving a built-in template creates a custom copy instead of failing', () => {
  // src/templates.js marks built-ins editable:false, so PUT would be rejected.
  assert.match(ui, /if\(!base\|\|base\.builtIn\)\{/);
  assert.match(ui, /\(custom\)/);
  assert.match(ui, /method:'PUT'/);
});

test('templates can still be duplicated, deleted and made the default', () => {
  assert.match(ui, /data-duplicate-template/);
  assert.match(ui, /data-delete-template/);
  assert.match(ui, /data-use-template/);
  assert.match(ui, /\/duplicate/);
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
