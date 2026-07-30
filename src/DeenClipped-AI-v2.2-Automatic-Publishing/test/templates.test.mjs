import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-test-'));
process.env.DATA_DIR = dataDir;
const templates = await import('../src/templates.js');

test('default local template is always resolvable', () => {
  const list = templates.listTemplates();
  assert.ok(list.length >= 2);
  const selected = templates.selectedTemplate();
  assert.equal(selected.id, 'deenclipped-gold');
  assert.ok(selected.captionFontSize > 0);
  assert.equal(selected.captionMode, 'word');
});

test('invalid template selection is blocked', () => {
  assert.throws(() => templates.setSelectedTemplate('does-not-exist'), /not available/i);
});

test('custom templates can be created, versioned, duplicated and deleted', () => {
  const created = templates.createTemplate({ name: 'Test Studio', captionHighlight: '#12AB34', filterPreset: 'crisp' });
  assert.equal(created.version, 1);
  assert.equal(created.captionHighlight, '#12AB34');
  const updated = templates.updateTemplate(created.id, { captionFontSize: 76 });
  assert.equal(updated.version, 2);
  assert.equal(updated.captionFontSize, 76);
  const copy = templates.duplicateTemplate(updated.id, 'Test Studio Variant');
  assert.notEqual(copy.id, updated.id);
  assert.equal(copy.name, 'Test Studio Variant');
  assert.equal(templates.deleteTemplate(copy.id), true);
  assert.equal(templates.templateById(copy.id), null);
});

test('built-in templates are protected from destructive edits', () => {
  assert.throws(() => templates.updateTemplate('deenclipped-gold', { name: 'Changed' }), /protected/i);
  assert.throws(() => templates.deleteTemplate('deenclipped-gold'), /cannot be deleted/i);
});
