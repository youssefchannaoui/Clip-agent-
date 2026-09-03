import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The watermark and the promo bar belong to the ACCOUNT, not to a caption
 * style.
 *
 * Youssef, 3 Sept 2026: "the watermark and promotion should not need to save
 * with template it just works with all templates once on it turns on for all
 * ... any new uploads if they have it ticked off for, like, watermarks or if
 * it's ticked on or off, whatever, it should always be on ... it doesn't work
 * by template. It's incorrect."
 *
 * v3.107.0 answered this by writing the field to every template in a loop.
 * That reached the templates that existed at the moment the switch was
 * pressed, which is not the same thing: it left the value stored per template,
 * so anything that resolved a template by another route, or a shipped default
 * that changed afterwards, could still disagree with the switch. The value is
 * account-level now and laid over every template read in one place.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-brand-'));
process.env.DATA_DIR = dataDir;
const templates = await import('../src/templates.js');

const user = { id: 'user_brand' };
const other = { id: 'user_other_brand' };

test('one switch reaches every template, with nothing saved per template', () => {
  templates.setBrandSettings(user, { watermark: 'DEENCLIPPED', watermarkOpacity: 100, promoBarEnabled: true });
  const list = templates.listTemplates(user).filter(t => !templates.isScriptureTemplate(t.id));
  assert.ok(list.length >= 1, 'there is something to check');
  for (const tpl of list) {
    assert.equal(tpl.promoBarEnabled, true, `${tpl.id} carries the promo bar`);
    assert.equal(templates.visibleText(tpl.watermark) !== '', true, `${tpl.id} carries the watermark`);
  }
  // The whole point: no template was written to.
  assert.equal(templates.selectedTemplate(user).promoBarEnabled, true);
});

test('a template added later inherits it, because nothing was copied onto the others', () => {
  // The loop this replaces could only reach what already existed. Reading a
  // template by id is the route a NEW one would arrive through, and it has to
  // carry the account's answer without anybody having pressed the switch again.
  templates.setBrandSettings(user, { promoBarEnabled: true });
  const anyLecture = templates.listTemplates(user).find(t => !templates.isScriptureTemplate(t.id));
  const fetched = templates.templateById(anyLecture.id, user);
  assert.equal(fetched.promoBarEnabled, true);
});

test('it is one account\'s answer, never everybody\'s', () => {
  templates.setBrandSettings(user, { promoBarEnabled: true });
  const theirs = templates.listTemplates(other).find(t => !templates.isScriptureTemplate(t.id));
  assert.notEqual(theirs.promoBarEnabled, true, 'another account is untouched');
});

test('scripture is exempt, and the account cannot waive it', () => {
  // Nothing is drawn over an ayah -- no watermark, no promo bar. That rule
  // outranks a switch, and it is read from the SHIPPED file so an override
  // cannot mint an exemption for itself.
  templates.setBrandSettings(user, { watermark: 'DEENCLIPPED', watermarkOpacity: 100, promoBarEnabled: true });
  const quran = templates.listTemplates(user).find(t => templates.isScriptureTemplate(t.id));
  assert.ok(quran, 'the scripture template is listed');
  assert.equal(templates.visibleText(quran.watermark), '', 'no mark over the ayah');
  assert.notEqual(quran.promoBarEnabled, true, 'no bar over the ayah');
});

test('turning it off is remembered, not just absent', () => {
  templates.setBrandSettings(user, { promoBarEnabled: true });
  templates.setBrandSettings(user, { promoBarEnabled: false });
  const tpl = templates.listTemplates(user).find(t => !templates.isScriptureTemplate(t.id));
  assert.equal(tpl.promoBarEnabled, false);
  // A partial write leaves the other fields alone -- the duration chips send
  // promoBarSeconds by itself and must not clear the switch beside them.
  templates.setBrandSettings(user, { promoBarSeconds: 6 });
  const after = templates.listTemplates(user).find(t => !templates.isScriptureTemplate(t.id));
  assert.equal(after.promoBarSeconds, 6);
  assert.equal(after.promoBarEnabled, false, 'the switch was not disturbed');
});

test('BRAND_FIELDS is the whole list, and nothing else rides along', () => {
  // A field that reaches this setter without being in the list would be a
  // template edit wearing a brand switch's clothes -- applied to every
  // template, account-wide, with no version bump and no save.
  assert.deepEqual(Array.from(templates.BRAND_FIELDS).sort(), [
    'promoBarEnabled', 'promoBarSeconds', 'promoBarStartSec', 'watermark', 'watermarkOpacity',
  ]);
  templates.setBrandSettings(user, { captionFontSize: 999 });
  const tpl = templates.listTemplates(user).find(t => !templates.isScriptureTemplate(t.id));
  assert.notEqual(tpl.captionFontSize, 999, 'a non-brand field cannot travel this way');
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* a leftover temp dir is harmless */ } });
