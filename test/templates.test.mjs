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

test('the catalogue carries the shipped set: one Quran style, four lecture styles', () => {
  // Grown from "one per content type" on request: the lecture styles are
  // modelled on the reference reels (clean bold, greyscale minimal, slate
  // stack) plus the original Simple Bold.
  const list = templates.listTemplates(user);
  assert.deepEqual(list.map(t => t.id).sort(),
    ['clean-bold', 'mono-minimal', 'quran-recitation', 'simple-bold', 'slate-stack']);
  const modes = Object.fromEntries(list.map(t => [t.id, t.captionMode]));
  assert.equal(modes['quran-recitation'], 'quran');
  for (const id of ['clean-bold', 'mono-minimal', 'simple-bold', 'slate-stack']) {
    assert.notEqual(modes[id], 'quran', id + ' captions the transcript');
  }
});

test('saving a built-in edits it in place for this account only', () => {
  const saved = templates.saveTemplate(user, 'simple-bold', { captionFontSize: 120 }, { allowFork: true });
  assert.equal(saved.forked, false, 'no copy is ever minted');
  assert.equal(saved.template.id, 'simple-bold', 'identity never moves');
  assert.equal(saved.template.captionFontSize, 120);
  // Another account still sees the shipped template.
  assert.notEqual(templates.templateById('simple-bold', otherUser).captionFontSize, 120);
  // And the catalogue has not grown.
  assert.equal(templates.listTemplates(user).length, 5);
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
  // A mushaf face draws the end-of-ayah ornament with the verse number inside
  // it; a Latin face leaves a bare circle. KFGQPC HAFS is the Madinah mushaf's
  // own digital face and ships bundled in worker/fonts.
  assert.ok(['KFGQPC HAFS Uthmanic Script', 'Amiri', 'Scheherazade'].includes(t.captionArabicFont), t.captionArabicFont);
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

// ── the fixes from the template/editor rework ──────────────────────────────

test('a per-clip captionTranslation override survives sanitising', () => {
  const patch = templates.sanitiseClipStyle({ captionTranslation: false });
  assert.deepEqual(patch, { captionTranslation: false },
    'the schema advertises it as overridable, so the validator must keep it');
});

test('letter spacing is a real field, per clip too', () => {
  const clean = templates.sanitiseTemplate({ captionLetterSpacing: 12.5 });
  assert.equal(clean.captionLetterSpacing, 12.5);
  assert.equal(templates.sanitiseTemplate({ captionLetterSpacing: 99 }).captionLetterSpacing, 40, 'clamped');
  assert.deepEqual(templates.sanitiseClipStyle({ captionLetterSpacing: -2 }), { captionLetterSpacing: -2 });
});

test('manual framing and caption timing are real fields now', () => {
  const clean = templates.sanitiseTemplate({ cropPositionX: 0.2, cropPositionY: 1.7, captionTimingOffsetMs: -250, smartFramingPadding: 0.3 });
  assert.equal(clean.cropPositionX, 0.2);
  assert.equal(clean.cropPositionY, 1, 'clamped to the frame');
  assert.equal(clean.captionTimingOffsetMs, -250);
  assert.equal(clean.smartFramingPadding, 0.3);
  // And per clip: position is framing, so a clip may hold its own.
  const patch = templates.sanitiseClipStyle({ cropPositionX: 0.9, captionTimingOffsetMs: 5000 });
  assert.equal(patch.cropPositionX, 0.9);
  assert.equal(patch.captionTimingOffsetMs, 2000, 'clamped to the schema range');
});

test('a shipped version bump still shows through an account patch', async () => {
  const { state } = await import('../src/store.js');
  const saved = templates.saveTemplate(user, 'simple-bold', { captionFontSize: 101 }).template;
  const before = templates.templateById('simple-bold', user).version;
  assert.equal(before, saved.version, 'sanity: reads see the saved counter');
  // Simulate the patch predating a deploy that bumped the shipped file: the
  // stored shippedVersion is one behind what ships now.
  const tenancy = await import('../src/tenancy.js');
  const all = tenancy.readUserSetting(state, user.id, 'templateOverrides');
  assert.ok(Number(all['simple-bold'].shippedVersion) >= 1, 'the patch records the shipped version it was made against');
  all['simple-bold'].shippedVersion -= 1;
  tenancy.writeUserSetting(state, user.id, 'templateOverrides', all);
  const after = templates.templateById('simple-bold', user).version;
  assert.equal(after, before + 1,
    'the deploy drift adds on top of the account counter, so templateOutdated can fire');
  all['simple-bold'].shippedVersion += 1;
  tenancy.writeUserSetting(state, user.id, 'templateOverrides', all);
});

test('deleting any resolvable template is refused, and a missing one is a no-op', () => {
  assert.throws(() => templates.deleteTemplate(user, 'quran-recitation'), /cannot be deleted/i);
  assert.equal(templates.deleteTemplate(user, 'ghost-template'), false);
});

test('an explicitly empty watermark is saveable (TikTok forbids third-party watermarks)', () => {
  assert.equal(templates.sanitiseTemplate({ watermark: '' }).watermark, '', 'empty string survives');
  assert.equal(templates.sanitiseTemplate({ watermark: '   ' }).watermark, '', 'whitespace-only reads as none');
  assert.equal(templates.sanitiseTemplate({}).watermark, 'DEENCLIPPED', 'an absent field still defaults');
});

test('watermark removal is a paid feature (isPaid drives the gate)', async () => {
  const billing = await import('../src/billing.js');
  assert.equal(billing.isPaid({ id: 'f1', role: 'creator', billing: { plan: 'free' } }), false);
  assert.equal(billing.isPaid({ id: 'p1', role: 'creator', billing: { plan: 'monthly' } }), true);
  assert.equal(billing.isPaid({ id: 'a1', role: 'owner', billing: {} }), true, 'the operator is never locked out');
});

test('every built-in survives the enum: no field silently falls back', () => {
  // Mono Minimal shipped captionHorizontal "middle", which is not in the
  // enum -- it became "right" and the greyscale style rendered off-centre
  // instead of centred like its reference. Sanitising must be a no-op.
  for (const template of templates.listTemplates(user)) {
    const clean = templates.sanitiseTemplate(template, { id: template.id, builtIn: true });
    for (const field of ['captionHorizontal', 'captionPosition', 'captionMode', 'fitMode', 'filterPreset']) {
      assert.equal(clean[field], template[field], `${template.id}.${field} must be a valid value`);
    }
  }
});
