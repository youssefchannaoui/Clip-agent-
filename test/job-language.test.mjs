import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Whisper guesses the spoken language from the opening seconds, and Islamic
// lectures open with Arabic greetings: a 10-minute English lecture came back
// with two of three clips titled and captioned in Urdu, plus a second full
// translate pass nobody needed. The wizard now pins the language; these cover
// the sanitiser every submission path feeds.

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-lang-'));
const { jobLanguage } = await import('../src/local-engine.js');

test('the three offered languages pass through, case- and space-proof', () => {
  assert.equal(jobLanguage({ language: 'en' }), 'en');
  assert.equal(jobLanguage({ language: ' AR ' }), 'ar');
  assert.equal(jobLanguage({ language: 'UR' }), 'ur');
});

test('auto, absence and junk all fall back to detection', () => {
  // '' is the worker's "detect it" value; anything unrecognised must become
  // that rather than reaching Whisper as a bogus language code.
  assert.equal(jobLanguage({ language: 'auto' }), '');
  assert.equal(jobLanguage({ language: '' }), '');
  assert.equal(jobLanguage({}), '');
  assert.equal(jobLanguage({ language: 'xx' }), '');
  assert.equal(jobLanguage({ language: 'english; rm -rf /' }), '');
});

test('every submission route sends the language option', () => {
  // Three routes create jobs; a route that forgets the option silently
  // reverts that path to guessing. Executed-output testing is impossible
  // without a real import, so this pins the wiring the cheap way.
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const sites = server.match(/submitVideo\(/g) || [];
  const wired = server.match(/language: String\((body\.language|req\.headers\['x-source-language'\])/g) || [];
  assert.equal(wired.length, sites.length, `${sites.length} submitVideo call sites, ${wired.length} pass language`);
});
