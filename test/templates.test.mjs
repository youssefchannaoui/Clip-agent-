import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-test-'));
process.env.DATA_DIR = dataDir;
const templates = await import('../src/templates.js');

const user = { id: 'user_test' };
const otherUser = { id: 'user_other' };

test('default local template is always resolvable', () => {
  const list = templates.listTemplates(user);
  assert.ok(list.length >= 2);
  const selected = templates.selectedTemplate(user);
  assert.ok(selected.captionFontSize > 0);
});

test('invalid template selection is blocked', () => {
  assert.throws(() => templates.setSelectedTemplate(user, 'does-not-exist'), /not available/i);
});

test('custom templates can be created, versioned, duplicated and deleted', () => {
  const created = templates.createTemplate(user, { name: 'Test Studio', captionHighlight: '#12AB34', filterPreset: 'crisp' });
  assert.equal(created.version, 1);
  assert.equal(created.captionHighlight, '#12AB34');
  const updated = templates.updateTemplate(user, created.id, { captionFontSize: 76 });
  assert.equal(updated.version, 2);
  assert.equal(updated.captionFontSize, 76);
  const copy = templates.duplicateTemplate(user, updated.id, 'Test Studio Variant');
  assert.notEqual(copy.id, updated.id);
  assert.equal(copy.name, 'Test Studio Variant');
  assert.equal(templates.deleteTemplate(user, copy.id), true);
  assert.equal(templates.templateById(copy.id, user), null);
});

test('built-in templates are protected from destructive edits', () => {
  assert.throws(() => templates.updateTemplate(user, 'deenclipped-gold', { name: 'Changed' }), /protected/i);
  assert.throws(() => templates.deleteTemplate(user, 'deenclipped-gold'), /cannot be deleted/i);
});

test('a custom template is invisible and unreachable to another account', () => {
  const created = templates.createTemplate(user, { name: 'Private Template' });
  assert.equal(templates.templateById(created.id, otherUser), null);
  assert.ok(!templates.listTemplates(otherUser).some(t => t.id === created.id));
  assert.throws(() => templates.updateTemplate(otherUser, created.id, { name: 'Hijacked' }), /does not exist/i);
});

test('smart speaker framing controls survive template sanitisation', () => {
  const created = templates.createTemplate(user, {
    name: 'Tracked Speaker', smartFramingEnabled: true,
    smartFramingPadding: 0.24, smartFramingZoom: 1.12, smartFramingSmoothing: 0.61,
  });
  assert.equal(created.smartFramingPadding, 0.24);
  assert.equal(created.smartFramingZoom, 1.12);
  assert.equal(created.smartFramingSmoothing, 0.61);
});
