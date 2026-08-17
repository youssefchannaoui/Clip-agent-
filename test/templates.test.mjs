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

// ── Save always means save ─────────────────────────────────────────────────

test('saving a built-in forks it onto the user\'s own copy', () => {
  // Pressing Save on a built-in used to fail with "Duplicate it first, then
  // edit your copy" — an instruction to do by hand the one thing the button was
  // for. The built-ins still have to stay pristine, since every account shares
  // them, so the edit lands on a copy instead.
  const saved = templates.saveTemplate(user, 'modern-minimal', { captionFontSize: 120 }, { allowFork: true });
  assert.equal(saved.forked, true);
  assert.equal(saved.from, 'Modern Minimal');
  assert.equal(saved.template.builtIn, false);
  assert.equal(saved.template.captionFontSize, 120, 'the edit survives the fork');
  assert.match(saved.template.name, /^Modern Minimal \(my copy\)/);
  // The original is untouched, for every other account too.
  assert.notEqual(templates.templateById('modern-minimal', user).captionFontSize, 120);
  // And the user is left on the copy, not still editing the protected one.
  assert.equal(templates.selectedTemplate(user).id, saved.template.id);
});

test('forking without asking is refused, so a slider drag cannot mint copies', () => {
  // Every control on the Templates screen writes through the same endpoint on a
  // debounce. Unguarded, dragging one slider would create a template per pixel.
  assert.throws(
    () => templates.saveTemplate(user, 'clean-white', { captionFontSize: 100 }),
    /protected/i,
  );
});

test('saving a template of your own updates it in place', () => {
  const created = templates.createTemplate(user, { name: 'Mine To Edit' });
  const saved = templates.saveTemplate(user, created.id, { captionFontSize: 64 });
  assert.equal(saved.forked, false);
  assert.equal(saved.template.id, created.id, 'same template, not a copy');
  assert.equal(saved.template.captionFontSize, 64);
  assert.equal(saved.template.version, created.version + 1);
});

test('two copies never share a name, because the picker selects by name', () => {
  // Duplicating twice produced two rows both reading "X Copy", and choosing the
  // second always resolved to the first — it could not be selected at all.
  const a = templates.duplicateTemplate(user, 'viral-stacked');
  const b = templates.duplicateTemplate(user, 'viral-stacked');
  const c = templates.duplicateTemplate(user, 'viral-stacked');
  const names = [a.name, b.name, c.name];
  assert.equal(new Set(names).size, 3, names.join(' / '));
  assert.notEqual(a.id, b.id);
});

test('repeated forks of the same built-in are told apart', () => {
  const first = templates.saveTemplate(user, 'clean-white', { captionFontSize: 30 }, { allowFork: true });
  const second = templates.saveTemplate(user, 'clean-white', { captionFontSize: 40 }, { allowFork: true });
  assert.notEqual(first.template.name, second.template.name);
  assert.match(second.template.name, /my copy 2/);
});

test('a forked name cannot collide with one the user already chose', () => {
  templates.createTemplate(user, { name: 'DeenClipped Gold (my copy)' });
  const forked = templates.saveTemplate(user, 'deenclipped-gold', { captionFontSize: 55 }, { allowFork: true });
  assert.notEqual(forked.template.name, 'DeenClipped Gold (my copy)');
});
