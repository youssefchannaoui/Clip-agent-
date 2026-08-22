import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-plans-'));
process.env.DATA_DIR = dataDir;
const templates = await import('../src/templates.js');

const user = { id: 'user_plan_test' };

// ── which templates belong to which plan ──────────────────────────────────
//
// Free gets the default style and the DeenClipped watermark; everything else
// in the catalogue is Pro. The flag is shipped in the template file, so it can
// only be changed by shipping a new one.

test('the default template is the free one and the rest are Pro', () => {
  const list = templates.listTemplates(user);
  const free = list.filter(t => !t.pro).map(t => t.id);
  assert.deepEqual(free, ['clean-line'], 'exactly one free style, and it is the default');
  assert.ok(list.filter(t => t.pro).length >= 3, 'the rest are Pro');
});

test('an account edit cannot move a template onto the free plan', () => {
  // Save writes a patch over the shipped file. If `pro` travelled in that
  // patch, editing a Pro template would unlock it for free.
  templates.saveTemplate(user, 'bold-stack', { pro: false, captionFontSize: 150 });
  const after = templates.templateById('bold-stack', user);
  assert.equal(after.pro, true, 'still Pro');
  assert.equal(after.captionFontSize, 150, 'but the actual edit did save');
});

test('a per-clip override cannot move a template onto the free plan either', () => {
  const base = templates.templateById('headline', user);
  const merged = templates.templateForClip(base, { pro: false, captionFontSize: 120 });
  assert.equal(merged.pro, true);
  assert.equal('pro' in templates.sanitiseClipStyle({ pro: false }), false,
    'pro is not a style field at all');
});

test('a custom template is never Pro', () => {
  // Only built-ins carry the flag; a fork could otherwise declare itself.
  const forged = templates.sanitiseTemplate({ name: 'Mine', pro: true }, { id: 'mine', builtIn: false });
  assert.equal(forged.pro, false);
});
