import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The legal surfaces, tested by RENDERING them rather than by reading the
// source: every one of these was wrong on the live site while the file looked
// perfectly reasonable, and a grep of marketing.js would have agreed with it.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-legal-copy-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'legal-copy-secret-long-enough-for-a-test';

const marketing = await import('../src/marketing.js');
const auth = await import('../src/auth.js');

test.after(() => {
  // Guarded: a leftover temp directory on a runner is harmless; a red branch
  // from the state-saver cleanup race is not.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

const base = 'https://deenclipped.online';
const privacy = () => marketing.privacy({ base, currentUser: null });
const terms = () => marketing.terms({ base, currentUser: null });

test('signing up shows the Terms and the Privacy Policy, and says what continuing means', () => {
  // The email form on this page CREATES the account -- it says so itself --
  // and so do both OAuth buttons, so the agreement has to sit below all three
  // rather than inside one of them.
  const page = auth.loginPage({});
  assert.match(page, /href="\/terms"/, 'the sign-in page must link the Terms');
  assert.match(page, /href="\/privacy"/, 'the sign-in page must link the Privacy Policy');
  assert.match(page, /By continuing you agree to the/i,
    'the page must say that continuing is agreement, not merely offer the links');
  const consent = page.indexOf('dc-legal-consent">');
  const form = page.indexOf('action="/auth/email"');
  const google = page.indexOf('/auth/google/start');
  assert.ok(consent > form && consent > google,
    'the consent line must come after every way of creating an account, so it covers all of them');
});

test('the legal pages name the screen the app actually has', () => {
  // "Platforms page" is a screen this product has never had. It is called
  // Connections, and it is the screen both pages tell people to go to.
  for (const [name, page] of [['privacy', privacy()], ['terms', terms()]]) {
    assert.ok(!/Platforms page/.test(page), `${name} names a screen that does not exist`);
    assert.match(page, /Connections screen/, `${name} should name Connections`);
  }
});

test('the policy states the self-serve deletion the app really has', () => {
  // auth.deleteAccount is immediate and complete, and the policy offered only
  // an email address and a 30-day promise resting on one person's inbox.
  const page = privacy();
  assert.match(page, /Account settings/, 'the policy must say where deletion lives');
  assert.match(page, /Delete my account/, 'the policy must name the control');
  assert.match(page, /immediately and cannot be undone/,
    'the policy must say the deletion is immediate rather than a 30-day request');
  assert.match(page, /support@deenclipped\.online/,
    'the email route must survive alongside it, for anyone who cannot sign in');
});

test('the policy discloses every cookie the site actually sets', () => {
  const page = privacy();
  const source = fs.readFileSync(path.join(process.cwd(), 'src/server.js'), 'utf8')
    + fs.readFileSync(path.join(process.cwd(), 'src/auth.js'), 'utf8');
  // Read the names out of the code, so a cookie added later fails this test
  // rather than going undisclosed.
  const names = new Set([...source.matchAll(/\bdc_[a-z]+(?==)/g)].map(m => m[0]));
  assert.ok(names.size >= 3, `expected the three known cookies, found ${[...names]}`);
  for (const name of names) {
    assert.ok(page.includes(name), `the policy does not disclose the ${name} cookie`);
  }
  assert.match(page, /no advertising cookies/i,
    'the policy should say plainly that none of them advertise');
});

test('both legal pages carry the same date', () => {
  // Two literals, one document set: a policy edited on one page and dated on
  // the other is worse than an old date on both.
  const read = page => (/Last updated: ([^<]+)</.exec(page) || [])[1];
  const p = read(privacy());
  const t = read(terms());
  assert.ok(p, 'the privacy policy must carry a date');
  assert.equal(p, t, 'the two legal pages disagree about when they were last updated');
});
