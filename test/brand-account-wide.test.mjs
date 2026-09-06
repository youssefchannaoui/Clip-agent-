import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * EVERYTHING UNDER BRAND WORKS WITHOUT BEING SAVED.
 *
 * Youssef, 6 Sept 2026: "REMEMBER EVERYTHIG UNDER BRAND does nto need to be
 * saved to work, once its configured it works for all clips."
 *
 * The Templates screen had TWO save models sitting in one column and the Brand
 * group was on the wrong one. The two switches (Show watermark, Show promo bar)
 * have belonged to the ACCOUNT since v3.113.0 -- one write, every template --
 * while the seven placement rows beside them went into the template DRAFT, so
 * moving the watermark left the toolbar reading "Unsaved changes" and applied
 * to the one template you happened to be looking at. Measured before this:
 * a Watermark position change left all five templates on `top-center` with the
 * account's brand record empty.
 *
 * BRAND_FIELDS is the one definition of what belongs to the account, and the
 * browser mirrors it as BRAND_KEYS -- so the drift between the two is what this
 * file guards hardest. Everything else is driven over HTTP with a real account,
 * because the paywall and the scripture exemption both live in the request
 * handler.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-brandwide-'));
process.env.DATA_DIR = dataDir;
// The OS picks the port: a randomised one can land in Linux's ephemeral range
// and be taken between the choice and the listen, which reports as FEWER tests
// rather than as a failure anyone can read.
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.APP_SESSION_SECRET = 'brand-account-wide-secret-long-enough-here';
process.env.SOCIAL_TOKEN_KEY = 'brand-account-wide-social-key-over-32-chars';

const { server } = await import('../src/server.js');
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const templates = await import('../src/templates.js');

test.after(() => new Promise(resolve => server.close(() => resolve())));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

// The sign-in throttle is real, and a file that spends it reports a broken
// route when the route is fine. One account, reused.
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({
    email: 'brand@deenclipped.test',
    password: 'correct horse battery staple',
    returnTo: '/',
  }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
assert.ok(cookie.startsWith('dc_session='), 'the account signed up');

const send = (url, body, method = 'POST') => fetch(`${base}${url}`, {
  method,
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify(body),
});
const state = async () => (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json();

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = fs.readFileSync(path.join(here, '..', 'src', 'public', 'studio-adapter.js'), 'utf8');
const screen = fs.readFileSync(path.join(here, '..', 'src', 'public', 'studio-templates.js'), 'utf8');
// Comments stripped before matching. A red probe that commented the pin OUT
// left the text on the page and the assertion went on passing -- the shape this
// repo has now been caught by eight times.
const host = fs.readFileSync(path.join(here, '..', 'src', 'public', 'index.html'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('the browser and the server agree on what Brand means', () => {
  // The whole feature is "these fields go to the account instead of the
  // template". Two lists deciding that is two answers to one question, and the
  // failure is silent: a field missing from BRAND_KEYS quietly goes back to
  // being a per-template draft that has to be saved.
  const block = /var BRAND_KEYS = \[([\s\S]*?)\];/.exec(adapter);
  assert.ok(block, 'the adapter names the brand fields');
  const keys = [...block[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);
  assert.deepEqual(keys.slice().sort(), templates.BRAND_FIELDS.slice().sort(),
    'BRAND_KEYS must be exactly templates.BRAND_FIELDS');
});

test('every row the Brand group draws is one of them', () => {
  // The rows are built in the adapter and rendered by the screen; a row added
  // here that is NOT a brand field would need a save, in the one group that is
  // documented as needing none.
  const block = /brand: present\(\[([\s\S]*?)\n {8}\]\)/.exec(adapter);
  assert.ok(block, 'the adapter builds the Brand rows');
  const fields = [...block[1].matchAll(/tpl(?:Select|Colour|Range|Switch)\('([A-Za-z]+)'/g)].map(m => m[1]);
  assert.ok(fields.length >= 7, `expected the Brand rows, found ${fields.length}`);
  for (const field of fields) {
    assert.ok(templates.BRAND_FIELDS.includes(field),
      `${field} is drawn under Brand but is not an account-wide field`);
  }
  assert.match(screen, /dctBrandSlot/, 'and the host switches still dock into that group');
});

test('a Brand write reaches every template at once, without a save', async () => {
  const before = await state();
  assert.ok((before.templates || []).length >= 2, 'the account has the built-ins');

  const res = await send('/api/brand', { watermarkPosition: 'top-left', watermarkFontSize: 44 });
  assert.equal(res.status, 200, 'the brand route accepted it');

  const after = await state();
  const ordinary = (after.templates || []).filter(t => t.id !== 'quran-recitation');
  assert.ok(ordinary.length >= 3, 'there is more than one ordinary template to check');
  for (const t of ordinary) {
    assert.equal(t.watermarkPosition, 'top-left', `${t.id} took the account's position`);
    assert.equal(t.watermarkFontSize, 44, `${t.id} took the account's size`);
  }
  // Nothing was saved onto a template, so nothing re-rendered and no version
  // moved -- which is the entire point of the field belonging to the account.
  for (const t of ordinary) assert.equal(t.version, 1, `${t.id} was not re-versioned`);
});

test('scripture is exempt, and it is not the account\'s to waive', async () => {
  const after = await state();
  const quran = (after.templates || []).find(t => t.id === 'quran-recitation');
  assert.ok(quran, 'the scripture template is listed');
  assert.notEqual(quran.watermarkPosition, 'top-left',
    'nothing is drawn over an ayah, so the account\'s placement does not reach it');
  assert.equal(templates.visibleText(quran.watermark), '', 'and it still carries no mark');
});

test('the whole Brand group travels, not only the two switches', async () => {
  // Widened from five fields to thirteen. Before this the placement rows, the
  // colour and the brand line were template DRAFT fields: they needed a save
  // and they landed on one template.
  const res = await send('/api/brand', {
    watermarkColor: '#22CC88', watermarkMarginV: 120, watermarkMarginH: 70,
    brandLineEnabled: true, brandLineColor: '#112233', brandLineHeight: 12,
    promoBarEnabled: true, promoBarStartSec: 5, promoBarSeconds: 6,
  });
  assert.equal(res.status, 200);
  const clean = (await state()).templates.find(t => t.id === 'clean-line');
  assert.equal(clean.watermarkColor, '#22CC88');
  assert.equal(clean.watermarkMarginV, 120);
  assert.equal(clean.watermarkMarginH, 70);
  assert.equal(clean.brandLineEnabled, true);
  assert.equal(clean.brandLineColor, '#112233');
  assert.equal(clean.brandLineHeight, 12);
  assert.equal(clean.promoBarEnabled, true);
  assert.equal(clean.promoBarStartSec, 5);
  assert.equal(clean.promoBarSeconds, 6);
});

test('a junk value is cleaned before it is stored, not only before it renders', async () => {
  // withBrand() sanitises on READ, so a wild number could never reach a render
  // -- but the panel reads the stored record, so the screen would have shown a
  // number the export would never use.
  await send('/api/brand', { watermarkFontSize: 9999, brandLineHeight: -4, watermarkColor: 'not a colour' });
  const stored = (await state()).brand || {};
  assert.equal(stored.watermarkFontSize, 90, 'clamped to the field\'s own ceiling');
  assert.equal(stored.brandLineHeight, 2, 'and to its floor');
  assert.match(stored.watermarkColor, /^#[0-9A-F]{6}$/i, 'and a colour is a colour');
});

test('the watermark paywall still stands on the brand route', async () => {
  // This account is free. Emptying the mark is one of exactly two things this
  // product charges for, and moving the field to the account must not open a
  // second door to it.
  const res = await send('/api/brand', { watermark: '', watermarkOpacity: 0 });
  assert.equal(res.status, 402, 'a free account may not remove the mark');
  const body = await res.json();
  assert.match(body.error, /watermark is a Pro feature/i);
});

test('a brand field never enters the template draft', () => {
  // The screen writes every control through one funnel. saveStyle splits the
  // patch: brand keys go to the account and apply on the spot, everything else
  // becomes the draft the toolbar calls "Unsaved changes".
  const split = /if \(brandPatch\) saveBrandFields\(brandPatch\);\s*\n\s*if \(!stylePatch\) return;/.test(adapter);
  assert.ok(split, 'saveStyle sends brand keys to the account and returns when nothing else is left');
  assert.match(adapter, /window\.dcSaveBrand|global\.dcSaveBrand/,
    'and it reaches the host through window -- index.html is a separate script scope');
  assert.match(host, /window\.dcSaveBrand\s*=\s*saveBrand/, 'which the host pins');
});

test('a saved look carries no brand field', () => {
  // A look is a snapshot of the STYLE. One carrying the brand switches would
  // turn the watermark off for every template the moment it was applied --
  // straight around the paywall above.
  const block = /var PRESET_FIELDS = \[([\s\S]*?)\];/.exec(adapter);
  assert.ok(block, 'the adapter names the preset fields');
  const fields = [...block[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);
  for (const field of templates.BRAND_FIELDS) {
    assert.ok(!fields.includes(field), `${field} belongs to the account and must not travel in a look`);
  }
  // The server strips them too, so a look saved by an older browser is clean.
  const preset = templates.saveStylePreset({ id: 'u1' }, 'x', { captionFontSize: 70, watermarkPosition: 'top-left' });
  assert.equal(preset.fields.captionFontSize, 70);
  assert.equal(preset.fields.watermarkPosition, undefined);
});
