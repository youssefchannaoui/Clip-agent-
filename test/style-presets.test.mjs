import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Saved looks, and putting a template back (v3.134.0).
 *
 * Youssef: "sort out a new system if needed in terms of saving templates".
 * The catalogue is deliberately one template per content type -- createTemplate
 * and duplicateTemplate throw, and copies once turned two templates into eight
 * -- so a saved LOOK is a snapshot of the style fields kept on the account,
 * not a new template. Applying one loads it as an unsaved change, so the one
 * save path persists and re-renders exactly as a hand edit does.
 *
 * Driven over HTTP with a real account, because the store, the sanitiser and
 * the route each refuse different things and only the route sees all three.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-presets-'));
process.env.DATA_DIR = dataDir;
// The OS picks the port: a randomised one can land in Linux's ephemeral range
// and be taken between the choice and the listen, which reports as FEWER tests
// rather than as a failure anyone can read.
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.APP_SESSION_SECRET = 'style-presets-secret-long-enough-for-the-check';
process.env.SOCIAL_TOKEN_KEY = 'style-presets-test-social-key-over-32-characters';

const { server } = await import('../src/server.js');
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const { MAX_STYLE_PRESETS, BRAND_FIELDS } = await import('../src/templates.js');
const { state } = await import('../src/store.js');

test.after(() => new Promise(resolve => server.close(() => resolve())));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

// The sign-up throttle is three a day per address, and a file that spends it
// reports a broken route when the route is fine. ONE account, reused.
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({
    email: 'looks@deenclipped.test',
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
  body: body === undefined ? undefined : JSON.stringify(body),
});
const read = async (url) => {
  const res = await fetch(`${base}${url}`, { headers: { Cookie: cookie } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const LOOK = {
  captionMode: 'word', captionFont: 'Anton', captionFontSize: 120,
  captionPrimary: '#FFEEDD', captionUppercase: true, filterPreset: 'cinematic',
};

test('a saved look is kept on the account and comes back on /api/state', async () => {
  const res = await send('/api/style-presets', { name: 'Bold word', fields: LOOK });
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, `save was refused: ${body.error || res.status}`);
  assert.equal(body.preset.name, 'Bold word');
  assert.equal(body.preset.fields.captionFontSize, 120);
  assert.equal(body.presets.length, 1);

  // The studio reads them off the state payload rather than a second fetch, so
  // a look is on screen the moment it is saved.
  const state = await read('/api/state');
  assert.equal(state.status, 200);
  const listed = (state.body.stylePresets || []).find(p => p.name === 'Bold word');
  assert.ok(listed, '/api/state does not carry the saved looks');
  assert.equal(listed.fields.captionFont, 'Anton');
});

test('it is sanitised, and it carries neither brand switch', async () => {
  const res = await send('/api/style-presets', {
    name: 'Hostile',
    fields: {
      captionFontSize: 96,
      // Not a style field at all.
      id: 'clean-line', name: 'Renamed', role: 'owner',
      // The template's own frame, which is not part of a look.
      width: 720, height: 1280,
      // Out of range, and the wrong type.
      captionMarginV: 99999, captionMode: 'not-a-mode', captionPrimary: 'javascript:alert(1)',
      // The ACCOUNT's switches. A look that carried them would turn the
      // watermark off for every template the moment it was applied, straight
      // around the paywall that guards that switch.
      watermark: '', watermarkOpacity: 0, promoBarEnabled: true,
    },
  });
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, body.error);
  const fields = body.preset.fields;
  assert.equal(fields.captionFontSize, 96, 'the one real field survived');
  for (const key of ['id', 'name', 'role', 'width', 'height']) {
    assert.ok(!(key in fields), `a look kept "${key}"`);
  }
  for (const key of BRAND_FIELDS) {
    assert.ok(!(key in fields), `a look kept the account-wide "${key}"`);
  }
  assert.ok(!('captionMode' in fields), 'an out-of-enum caption mode was kept');
  assert.ok(!('captionPrimary' in fields), 'a colour that is not a hex was kept');
  assert.notEqual(fields.captionMarginV, 99999, 'an out-of-range margin was kept verbatim');
});

test('a look with nothing real in it is refused rather than saved empty', async () => {
  const res = await send('/api/style-presets', { name: 'Nothing', fields: { nope: 1, alsoNope: 'x' } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /nothing to save/i);
  const named = await send('/api/style-presets', { name: '   ', fields: LOOK });
  assert.equal(named.status, 400, 'a look with no name');
});

test('saving under a name that exists REPLACES it', async () => {
  // Two rows with one label is two things nobody can tell apart.
  const first = await (await send('/api/style-presets', { name: 'Reused', fields: LOOK })).json();
  const before = first.presets.filter(p => p.name === 'Reused');
  assert.equal(before.length, 1);
  const again = await (await send('/api/style-presets', { name: 'Reused', fields: { ...LOOK, captionFontSize: 64 } })).json();
  const after = again.presets.filter(p => p.name === 'Reused');
  assert.equal(after.length, 1, 'saving the same name twice made two rows');
  assert.equal(after[0].id, before[0].id, 'the row was replaced, not re-minted');
  assert.equal(after[0].fields.captionFontSize, 64);
});

test('renaming and deleting reach the same list', async () => {
  const made = await (await send('/api/style-presets', { name: 'Temporary', fields: LOOK })).json();
  const id = made.preset.id;
  const renamed = await send(`/api/style-presets/${id}`, { name: 'Permanent' }, 'PATCH');
  assert.equal(renamed.status, 200);
  const list = (await renamed.json()).presets;
  assert.ok(list.some(p => p.id === id && p.name === 'Permanent'));
  assert.ok(!list.some(p => p.name === 'Temporary'));

  const gone = await send(`/api/style-presets/${id}`, undefined, 'DELETE');
  assert.equal(gone.status, 200);
  assert.ok(!(await gone.json()).presets.some(p => p.id === id));

  // Renaming something that no longer exists says so rather than throwing.
  const missing = await send(`/api/style-presets/${id}`, { name: 'Ghost' }, 'PATCH');
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /no longer exists/i);
});

test('the cap is enforced, and it never blocks replacing one', async () => {
  const state = await read('/api/style-presets');
  let count = state.body.presets.length;
  for (let i = count; i < MAX_STYLE_PRESETS; i++) {
    const res = await send('/api/style-presets', { name: `Look ${i}`, fields: LOOK });
    assert.equal(res.status, 200, `look ${i} was refused before the cap`);
  }
  const over = await send('/api/style-presets', { name: 'One too many', fields: LOOK });
  assert.equal(over.status, 400, 'the cap did not hold');
  assert.match((await over.json()).error, new RegExp(String(MAX_STYLE_PRESETS)));
  // Saving over an existing name is a replacement, not a new row, so it must
  // still be allowed at the cap -- otherwise a full list cannot be edited.
  const replace = await send('/api/style-presets', { name: 'Look 5', fields: { ...LOOK, captionFontSize: 40 } });
  assert.equal(replace.status, 200, 'replacing a look was refused at the cap');
});

test('restoring a built-in DROPS the overrides rather than freezing today\'s defaults', async () => {
  const edited = await send('/api/templates/clean-line', { template: { captionFontSize: 42 } }, 'PUT');
  assert.equal(edited.status, 200, (await edited.clone().json()).error);
  assert.equal((await edited.json()).template.captionFontSize, 42);

  const reset = await send('/api/templates/clean-line/reset');
  assert.equal(reset.status, 200);
  const back = (await reset.json()).template;
  assert.notEqual(back.captionFontSize, 42, 'the edit survived the restore');
  assert.equal(back.customised, undefined, 'a restored template still says it is customised');

  // Read it again through the ordinary route: the override is GONE from the
  // account rather than replaced with a copy of the shipped values, so a later
  // change to the shipped template reaches this account.
  const state = await read('/api/state');
  const listed = (state.body.templates || []).find(t => t.id === 'clean-line');
  assert.ok(listed);
  assert.notEqual(listed.captionFontSize, 42);
  // Read the LIVE state, not state.json: the save is atomic and coalesced, so
  // the file lags a request by design and a disk read here measures the
  // debounce rather than the store.
  const overrides = Object.values(state.userSettings || {})
    .map(s => (s.templateOverrides || {})['clean-line'])
    .filter(Boolean);
  assert.deepEqual(overrides, [], 'the account still holds an override for a restored template');
});

test('a look belongs to the account that saved it', async () => {
  // No cookie at all: the whole API is behind sign-in, so this is the shape of
  // "somebody else's looks" as far as an unauthenticated caller can reach.
  const res = await fetch(`${base}/api/style-presets`);
  assert.ok(res.status === 401 || res.status === 403, `an anonymous read got ${res.status}`);
});
