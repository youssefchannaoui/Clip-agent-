import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

/**
 * The two rules the DeenAI screen breaks SILENTLY.
 *
 * Source tests, deliberately, and for the same reason `overflow-anchor` and
 * `dc-nav-tail` are: CI has no browser, and both of these fail without an
 * error anywhere. The app renders, the suite stays green, and either the
 * screen never draws at all or it eats what somebody is typing every two
 * seconds. Both were found by driving it, and both would come back invisibly.
 */

const src = fs.readFileSync(new URL('../src/public/studio-deenai.js', import.meta.url), 'utf8');
const host = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/public/studio-deenai.css', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('the studio\'s DATA is passed in, and the parameter does not shadow the payload reader', () => {
  // `window.DATA` is a DIFFERENT object from the studio's scoped DATA -- the
  // trap this repo has recorded six times -- so the painter must be handed it.
  assert.match(host, /window\.paintDeenai\(vals,\s*DATA\)/, 'index.html passes the studio\'s own DATA');
  const signature = code.match(/function paintDeenai\(([^)]*)\)/);
  assert.ok(signature, 'paintDeenai is declared');
  const params = signature[1].split(',').map(s => s.trim());
  assert.equal(params.length, 2, 'it takes the bindings and the studio DATA');
  // A parameter called `data` shadows this module's own `data()` reader, and
  // paintDeenai then threw on EVERY paint -- swallowed by index.html's
  // try/catch, so the screen simply never drew.
  assert.ok(!params.includes('data'), 'the DATA parameter does not shadow data()');
  assert.match(code, /function data\(\)/, 'the payload reader is still a function called data()');
  assert.ok(!/global\.DATA/.test(code), 'nothing reads window.DATA');
});

test('the screen is redrawn only when what it shows has changed', () => {
  // The studio repaints on every state poll. Without this the textarea
  // somebody is typing into is destroyed every couple of seconds -- the fault
  // v3.124.5 found in every other host panel.
  assert.match(code, /function signature\(/, 'a signature is computed');
  const repaint = code.slice(code.indexOf('function repaint()'));
  const body = repaint.slice(0, repaint.indexOf('\n  }'));
  assert.match(body, /sig === lastSig/, 'and an unchanged signature returns early');
  // The typed question must NOT be in it, or the field is rebuilt per keystroke.
  const sig = code.slice(code.indexOf('function signature('), code.indexOf('var loading'));
  assert.ok(!/M\.question/.test(sig), 'the typed question is not in the signature');
});

test('the screen is host-owned and hides the generated one in place', () => {
  assert.match(code, /setAttribute\('data-host-owned', ''\)/, 'the root is marked host-owned');
  assert.match(code, /screen\.setAttribute\('data-host-style', ''\)/, 'the generated screen keeps its style attribute');
  assert.match(code, /screen\.style\.display = 'none'/, 'and is hidden rather than removed');
  assert.ok(!/\.removeChild\(screen\)/.test(code), 'the generated screen is never removed');
  // Found by its own literal, never by a hashed class a re-import renumbers.
  assert.ok(!/\.s[0-9][0-9a-z]{1,2}\b/.test(code), 'no generated class name is referenced');
});

test('every button reaches something that exists', () => {
  // The one destination map. A second one is how "the Platforms page" happens.
  assert.match(code, /StudioAdapter\.goToStep/, 'navigation goes through goToStep');
  // A confirm-class proposal is a BUTTON to the screen, never an action.
  assert.match(code, /DeenAI cannot schedule anything/, 'the proposal says what it does not do');
});

test('the sheet declares every token it uses, and the gold button holds no hex', () => {
  const declared = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
  const studioTokens = fs.readFileSync(new URL('../src/public/studio-tokens.css', import.meta.url), 'utf8');
  for (const m of studioTokens.matchAll(/--([\w-]+)\s*:/g)) declared.add(m[1]);
  const generated = fs.readFileSync(new URL('../src/public/studio-theme.generated.css', import.meta.url), 'utf8');
  for (const m of generated.matchAll(/--([\w-]+)\s*:/g)) declared.add(m[1]);
  const missing = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/var\(\s*--([\w-]+)/g)) {
    if (!declared.has(m[1])) missing.push(m[1]);
  }
  // A var() naming a token nothing declares falls silently to its fallback,
  // which reads as though a token were in charge when nothing is.
  assert.deepEqual([...new Set(missing)], [], 'every token exists');

  // The gold button is written in var() names with NO hex, so the light-theme
  // generator finds nothing to remap and the tokens flip it themselves.
  const primary = css.slice(css.indexOf('.dcai-btn.is-primary'));
  const rule = primary.slice(0, primary.indexOf('}'));
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(rule), 'no hex in the gold button rule');
});
