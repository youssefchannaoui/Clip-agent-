import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-clipstyle-'));
process.env.DATA_DIR = dataDir;
const templates = await import('../src/templates.js');

const user = { id: 'user_clipstyle' };

// Editing one clip used to write to the shared template, so moving a caption on
// one clip moved it on every clip in the lecture. These cover the override
// model that replaced that.

test('a style patch keeps only the keys it was given', () => {
  const patch = templates.sanitiseClipStyle({ captionFontSize: 72 });
  assert.deepEqual(Object.keys(patch), ['captionFontSize']);
  assert.equal(patch.captionFontSize, 72);
  // No defaults are filled in — an absent key must keep inheriting.
  assert.equal('captionPosition' in patch, false);
});

test('identity and frame geometry can never be overridden per clip', () => {
  const patch = templates.sanitiseClipStyle({
    id: 'hijacked', name: 'Renamed', description: 'nope',
    width: 720, height: 720, builtIn: true, userId: 'someone-else',
    captionFontSize: 80,
  });
  assert.deepEqual(Object.keys(patch), ['captionFontSize']);
});

test('out-of-range numbers clamp and bad values are dropped, not thrown', () => {
  const patch = templates.sanitiseClipStyle({
    captionFontSize: 9999,      // above the 140 ceiling
    smartFramingZoom: 0.1,      // below the 0.75 floor
    captionPosition: 'sideways',// not in the enum
    captionPrimary: 'red',      // not a hex colour
    captionOutline: '#aabbcc',  // valid, should upper-case
    voiceEnhance: 0,            // coerces to false
    somethingElse: 'ignored',
  });
  assert.equal(patch.captionFontSize, 140);
  assert.equal(patch.smartFramingZoom, 0.75);
  assert.equal('captionPosition' in patch, false);
  assert.equal('captionPrimary' in patch, false);
  assert.equal(patch.captionOutline, '#AABBCC');
  assert.equal(patch.voiceEnhance, false);
  assert.equal('somethingElse' in patch, false);
});

test('a clip renders with its own tweaks laid over the template', () => {
  const base = templates.createTemplate(user, { name: 'Override Base', captionFontSize: 96, captionPosition: 'middle' });
  const merged = templates.templateForClip(base, { captionFontSize: 60, captionPosition: 'bottom' });
  assert.equal(merged.captionFontSize, 60);
  assert.equal(merged.captionPosition, 'bottom');
  // Everything untouched still comes from the template.
  assert.equal(merged.captionHighlight, base.captionHighlight);
});

test('overriding a clip never renames or re-versions the shared style', () => {
  const base = templates.createTemplate(user, { name: 'Identity Guard', captionFontSize: 96 });
  const merged = templates.templateForClip(base, { captionFontSize: 48, name: 'Sneaky', version: 99 });
  assert.equal(merged.id, base.id);
  assert.equal(merged.name, base.name);
  assert.equal(merged.version, base.version);
  assert.equal(merged.captionFontSize, 48);
});

test('a clip with no tweaks renders with the template object itself', () => {
  const base = templates.createTemplate(user, { name: 'Untouched' });
  assert.equal(templates.templateForClip(base, undefined), base);
  assert.equal(templates.templateForClip(base, {}), base);
  // A patch of only-invalid keys is the same as no patch.
  assert.equal(templates.templateForClip(base, { name: 'x', width: 10 }), base);
});

test('editing one clip leaves the shared style untouched on disk', () => {
  const base = templates.createTemplate(user, { name: 'Shared Style', captionFontSize: 96 });
  templates.templateForClip(base, { captionFontSize: 40 });
  const reread = templates.templateById(base.id, user);
  assert.equal(reread.captionFontSize, 96, 'the template must not absorb a per-clip tweak');
});

test('CLIP_STYLE_FIELDS excludes identity and geometry but covers the editor controls', () => {
  for (const forbidden of ['id', 'name', 'description', 'width', 'height', 'version', 'userId', 'builtIn']) {
    assert.equal(templates.CLIP_STYLE_FIELDS.includes(forbidden), false, `${forbidden} must not be overridable`);
  }
  // Every control the clip editor exposes has to be in the list, or editing it
  // silently falls back to writing the template again.
  for (const control of [
    'captionFontSize', 'captionMarginV', 'captionPosition', 'captionHorizontal', 'captionUppercase',
    'captionFont', 'fitMode', 'smartFramingEnabled', 'smartFramingZoom', 'vignette', 'grain', 'warm',
    'watermarkPosition', 'watermarkOpacity', 'voiceEnhance',
  ]) {
    assert.equal(templates.CLIP_STYLE_FIELDS.includes(control), true, `${control} must be overridable per clip`);
  }
});
