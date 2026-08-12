import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIP_STYLE_FIELDS, isClipStyleField, clipStyleSettings, clipStyleDrift, defaultTemplateDraft,
} from '../src/templates.js';

// The Clip Style contract (Step 1, instruction 7): applying a style may write
// exactly these fields and nothing else. Without a contract "apply" means
// "spread the template over the clip", which carries the style's identity and
// this clip's framing along with the look.

test('the contract covers the schema minus a short, deliberate exclusion list', () => {
  const all = Object.keys(defaultTemplateDraft());
  const excluded = all.filter(key => !isClipStyleField(key)).sort();
  assert.deepEqual(excluded, [
    'builtIn', 'description', 'editable', 'id', 'name', 'updatedAt', 'userId', 'version',
  ], 'exclusions must stay explicit — adding one should require saying why');
  assert.equal(CLIP_STYLE_FIELDS.length, all.length - excluded.length);

  // Derived from the schema, so a new field is a style field by default. That
  // is the safe direction: a look that forgets to travel is a visible bug,
  // whereas a field that travels when it should not corrupts other clips.
  assert.ok(CLIP_STYLE_FIELDS.length > 60, 'the contract should cover the bulk of the schema');
});

test('framing stays excluded even though it is not in the schema today', () => {
  // cropPositionX/Y live on editor.draft at runtime, not in DEFAULTS, so they
  // are absent from the derived list by accident rather than by decision. The
  // exclusion list names them anyway: if they are ever promoted into the
  // schema they must not silently become part of every style.
  assert.equal(isClipStyleField('cropPositionX'), false);
  assert.equal(isClipStyleField('cropPositionY'), false);
});

test('a style never carries its own identity onto a clip', () => {
  // Copying id/name would make the clip claim to *be* the style, so later
  // clip edits would read as edits to the saved style.
  for (const key of ['id', 'name', 'description', 'builtIn', 'editable', 'userId', 'version', 'updatedAt']) {
    assert.equal(isClipStyleField(key), false, `${key} must not be copied`);
  }
  const settings = clipStyleSettings({ ...defaultTemplateDraft(), id: 'tpl_1', name: 'Podcast Gold' });
  assert.ok(!('id' in settings) && !('name' in settings));
});

test('per-clip framing is not part of the look', () => {
  // cropPositionX/Y is where the subject sits in THIS clip. Applying one
  // clip's framing to every other clip moves the speaker in all of them.
  const settings = clipStyleSettings({ ...defaultTemplateDraft(), cropPositionX: 12, cropPositionY: 88 });
  assert.ok(!('cropPositionX' in settings) && !('cropPositionY' in settings));
});

test('the look itself is carried', () => {
  const settings = clipStyleSettings(defaultTemplateDraft());
  for (const key of [
    'captionFont', 'captionFontSize', 'captionPrimary', 'captionMode',
    'width', 'height', 'fitMode', 'smartFramingEnabled',
    'filterPreset', 'brightness', 'contrast', 'saturation',
    'voiceEnhance', 'watermark', 'brandLineEnabled', 'hookEnabled',
  ]) {
    assert.ok(key in settings, `${key} should come from the style`);
  }
});

test('applying a style returns a copy, not a live reference', () => {
  // A live reference is how editing one clip would mutate the saved style,
  // which §11 forbids.
  const template = defaultTemplateDraft();
  const settings = clipStyleSettings(template);
  settings.captionFontSize = 999;
  assert.notEqual(template.captionFontSize, 999, 'the saved style must be untouched');
});

test('drift reports only fields the clip actually changed', () => {
  const template = defaultTemplateDraft();
  const clip = { ...clipStyleSettings(template) };
  assert.deepEqual(clipStyleDrift(clip, template), [], 'a freshly applied style has no drift');

  clip.captionFontSize = Number(template.captionFontSize) + 20;
  clip.brightness = template.brightness;               // re-set to the same value
  clip.cropPositionX = 5;                              // clip-owned, not drift
  assert.deepEqual(clipStyleDrift(clip, template), ['captionFontSize'],
    'only a real difference in an owned field counts');
});

test('clip-owned content is invisible to the contract', () => {
  // These must survive applying a style. If any ever became a style field,
  // applying a style would overwrite the clip's own content.
  const template = defaultTemplateDraft();
  for (const key of ['startSec', 'endSec', 'durationMs', 'transcript', 'textLayers', 'clipUrl', 'title']) {
    assert.equal(isClipStyleField(key), false, `${key} is clip-owned`);
  }
  const clip = { ...clipStyleSettings(template), transcript: 'my words', startSec: 300, textLayers: [{ id: 't1' }] };
  const reapplied = { ...clip, ...clipStyleSettings(template) };
  assert.equal(reapplied.transcript, 'my words');
  assert.equal(reapplied.startSec, 300);
  assert.deepEqual(reapplied.textLayers, [{ id: 't1' }]);
});
