import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The template fields behind caption direction and framing dwell time.
 *
 * These are the app-side half of the worker's framing and right-to-left
 * caption work: if a field does not survive `sanitiseTemplate`, the worker
 * silently falls back to its own default and the setting appears to do
 * nothing.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-framing-settings-'));
process.env.DATA_DIR = dataDir;
const templates = await import('../src/templates.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const user = { id: 'user_framing' };

test('caption direction defaults to automatic detection', () => {
  const draft = templates.defaultTemplateDraft();
  assert.equal(draft.captionDirection, 'auto');
});

test('caption direction accepts only the three writing modes', () => {
  for (const direction of ['auto', 'ltr', 'rtl']) {
    assert.equal(templates.sanitiseTemplate({ captionDirection: direction }, { id: 't' }).captionDirection, direction);
  }
  // Anything else falls back rather than reaching the subtitle renderer.
  for (const rubbish of ['sideways', '', null, 42, {}]) {
    assert.equal(templates.sanitiseTemplate({ captionDirection: rubbish }, { id: 't' }).captionDirection, 'auto');
  }
});

test('framing dwell time defaults to a real hold and is clamped', () => {
  const draft = templates.defaultTemplateDraft();
  assert.equal(draft.smartFramingDwellSeconds, 1.2);
  assert.equal(templates.sanitiseTemplate({ smartFramingDwellSeconds: 99 }, { id: 't' }).smartFramingDwellSeconds, 5);
  assert.equal(templates.sanitiseTemplate({ smartFramingDwellSeconds: -4 }, { id: 't' }).smartFramingDwellSeconds, 0);
  assert.equal(templates.sanitiseTemplate({ smartFramingDwellSeconds: 'soon' }, { id: 't' }).smartFramingDwellSeconds, 1.2);
});

test('both settings survive a save and reload of a custom template', () => {
  const created = templates.createTemplate(user, {
    name: 'Arabic lecture', captionDirection: 'rtl', smartFramingDwellSeconds: 2.5,
  });
  const reloaded = templates.templateById(created.id, user);
  assert.equal(reloaded.captionDirection, 'rtl');
  assert.equal(reloaded.smartFramingDwellSeconds, 2.5);

  const updated = templates.updateTemplate(user, created.id, { ...reloaded, captionDirection: 'auto' });
  assert.equal(updated.captionDirection, 'auto');
  assert.equal(updated.smartFramingDwellSeconds, 2.5, 'an unrelated edit should not reset framing dwell');
});

test('the default template still places captions right of centre', () => {
  // The worker biases the subject away from the caption block, and its tests
  // assume this layout. If the default moves, that assumption needs revisiting.
  const draft = templates.defaultTemplateDraft();
  assert.equal(draft.captionHorizontal, 'right');
  assert.ok(draft.captionPositionX > 50, 'captions are expected right of centre by default');
});
