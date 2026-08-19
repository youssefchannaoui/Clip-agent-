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

// ── one template per content type, edited in place ────────────────────────
//
// The catalogue is exactly two templates: Quran Recitation for recitations and
// Simple Bold for lectures. Forking and duplicating are gone -- they are what
// turned two templates into eight rows of near-identical copies -- and an
// account's edits to a built-in are stored as a patch over the shipped file,
// so ids stay stable and Save always means save.

test('the catalogue is exactly one template per content type', () => {
  const list = templates.listTemplates(user);
  assert.deepEqual(list.map(t => t.id).sort(), ['quran-recitation', 'simple-bold']);
  const modes = Object.fromEntries(list.map(t => [t.id, t.captionMode]));
  assert.equal(modes['quran-recitation'], 'quran');
  assert.notEqual(modes['simple-bold'], 'quran');
});

test('saving a built-in edits it in place for this account only', () => {
  const saved = templates.saveTemplate(user, 'simple-bold', { captionFontSize: 120 }, { allowFork: true });
  assert.equal(saved.forked, false, 'no copy is ever minted');
  assert.equal(saved.template.id, 'simple-bold', 'identity never moves');
  assert.equal(saved.template.captionFontSize, 120);
  // Another account still sees the shipped template.
  assert.notEqual(templates.templateById('simple-bold', otherUser).captionFontSize, 120);
  // And the catalogue has not grown.
  assert.equal(templates.listTemplates(user).length, 2);
});

test('a second save bumps the version, so propagation can tell clips are stale', () => {
  const before = templates.templateById('quran-recitation', user).version;
  const saved = templates.saveTemplate(user, 'quran-recitation', { vignette: 0.2 }, { allowFork: false });
  assert.equal(saved.template.version, before + 1);
  assert.equal(saved.template.id, 'quran-recitation');
});

test('minting new templates is refused, with the reason', () => {
  // A slider drag on a debounce must never create a template, and neither may
  // anything else: the product is one template per content type.
  assert.throws(() => templates.createTemplate(user, { name: 'Another One' }), /one template per content type/i);
  assert.throws(() => templates.duplicateTemplate(user, 'simple-bold'), /one template per content type/i);
});

test('the built-ins cannot be deleted', () => {
  assert.throws(() => templates.deleteTemplate(user, 'simple-bold'), /cannot be deleted/i);
});

// ── the built-in templates new accounts start from ─────────────────────────

test('Simple Bold is two thick words a line, dimmed behind the live one', () => {
  // The reference clip: short uppercase lines low in the frame, the word being
  // said in white and the rest greyed — no colour, no outline, no sticker.
  const t = templates.templateById('simple-bold', user);
  assert.ok(t, 'the template ships');
  assert.equal(t.captionStackMaxWords, 2, 'two words a line is what gives it the rhythm');
  assert.equal(t.captionUppercase, true);
  assert.equal(t.captionOutlineWidth, 0, 'no outline');
  assert.equal(t.captionBackgroundOpacity, 0, 'and no box');
  // The dimming is primary vs highlight, not a second colour.
  assert.equal(t.captionHighlight, '#FFFFFF', 'the live word');
  assert.notEqual(t.captionPrimary, '#FFFFFF', 'the rest are dimmed');
  assert.equal(t.captionHighlightFont, t.captionFont, 'the live word must not change face too');
  assert.equal(t.captionPosition, 'bottom');
});

test('Quran Recitation captions scripture, not the transcript', () => {
  const t = templates.templateById('quran-recitation', user);
  assert.ok(t, 'the template ships');
  assert.equal(t.captionMode, 'quran');
  assert.equal(t.captionTranslation, true, 'the translation sits under the ayah');
  // Amiri and Scheherazade draw the end-of-ayah ornament with the verse number
  // inside it; a Latin face leaves a bare circle.
  assert.ok(['Amiri', 'Scheherazade'].includes(t.captionArabicFont), t.captionArabicFont);
  // An ayah is one held line, not a stack that builds word by word.
  assert.equal(t.captionPopMs, 0, 'no word pop');
});

test('every built-in survives its own sanitiser unchanged', () => {
  // A template that loses a field on load is a template whose look silently
  // differs from the file that defines it.
  for (const template of templates.listTemplates(user).filter(t => t.builtIn)) {
    const again = templates.sanitiseTemplate(template, { id: template.id, builtIn: true });
    for (const key of ['captionMode', 'captionFont', 'captionArabicFont', 'captionUppercase',
      'captionPrimary', 'captionHighlight', 'captionPopScale', 'captionPopMs', 'captionFadeMs']) {
      assert.deepEqual(again[key], template[key], `${template.id}.${key}`);
    }
  }
});
