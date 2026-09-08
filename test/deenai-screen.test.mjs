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

/*
 * THE LAYOUT (v3.153.0). Youssef: "Deen Ai page looks so ugly layout is so bad
 * needs to be 100x better there no ai look to it".
 *
 * Measured on a seeded account at 1440x900 before anything moved: the screen
 * was SEVEN equal bordered boxes stacked down 1632px of a 785px viewport, and
 * the ask -- the one thing on it no other screen can do -- was the FOURTH,
 * below the fold. Every section stayed; only where they are drawn changed.
 *
 * Source tests for the same reason as the four above: CI has no browser, and
 * every one of these fails silently. The screen still renders either way.
 */

test('the screen is console left, context right — not one stack', () => {
  const paint = code.slice(code.indexOf('function repaint()'));
  const body = paint.slice(0, paint.indexOf('function paintDeenai'));
  assert.match(body, /dcai-grid/, 'the two columns exist');
  assert.match(body, /dcai-main/);
  assert.match(body, /dcai-side/);
  // The ask is the FIRST thing in the working column. It was fourth.
  const main = body.indexOf('main.appendChild(askCard');
  assert.ok(main > -1, 'the console is in the main column');
  // insightsCard is conditional, so it is appended through a local -- match
  // the call site rather than the appendChild, which does not name it.
  assert.ok(body.indexOf('main.appendChild(todayCard') > main, 'today comes after the ask');
  assert.ok(body.indexOf('insightsCard(vals)') > main, 'the counted insights come after the ask');
  assert.match(body, /main\.appendChild\(insights\)/, 'and land in the main column');
  // What is TRUE OF THE ACCOUNT goes in the rail; what you DO goes in the
  // column. A section in the wrong one is the stack coming back by halves.
  for (const rail of ['goalCard', 'metricsCard']) {
    assert.match(body, new RegExp('side\\.appendChild\\(' + rail), rail + ' is in the rail');
  }
  assert.ok(!/next\.appendChild\((goalCard|todayCard|askCard|metricsCard)/.test(body),
    'no section is appended straight to the screen any more');
});

test('the reply is a grid, so the answer can never sit beside its own label', () => {
  // It was flex-wrap first, and the streaming answer rendered on the SAME LINE
  // as the "DEENAI" label, hard against the right edge -- because the basis
  // that was meant to force the wrap named a `.dcai-answer` element this card
  // does not have. The card's children are a flat list (avatar, head, body,
  // note, row), so only a grid can place them without naming each one.
  const rule = css.slice(css.indexOf('#dcAi .dcai-card.is-reply {'));
  const decl = rule.slice(0, rule.indexOf('}'));
  assert.match(decl, /display: grid/);
  assert.match(decl, /grid-template-columns: 30px minmax\(0, 1fr\)/);
  assert.match(css, /#dcAi \.dcai-card\.is-reply > :not\(\.dcai-avatar\) \{[^}]*grid-column: 2/);
});

test('the entry animation is never put on the reply', () => {
  // The reply is rebuilt on every stream delta, so an entry animation there
  // restarts dozens of times a second. The gate for everything else is the
  // signature cache itself -- the screen is only rebuilt when it changes --
  // so there is no flag to maintain and a state poll cannot replay it.
  // The selector is a comma LIST across several lines, so the group has to be
  // read whole: matching one line found `.dcai-side > .dcai-card` and reported
  // the exclusion missing when it is on the line above.
  const at = css.indexOf('animation: dcaiRise');
  assert.ok(at > -1, 'the entry animation is declared');
  const group = css.slice(css.lastIndexOf('}', at) + 1, css.indexOf('{', css.lastIndexOf('#dcAi', at)));
  assert.match(group, /:not\(\.is-reply\)/, 'the reply is excluded');
  assert.match(css, /animation: dcaiRise[^;]*backwards/,
    'a forwards fill beats ordinary declarations for the element’s life');
});

test('every added animation has a reduced-motion kill', () => {
  const reduce = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  for (const name of ['dcaiBreathe', 'dcaiPulse', 'dcaiRise']) {
    assert.ok(css.includes('@keyframes ' + name), name + ' is declared');
  }
  // A bare `*` rule never matches a pseudo-element, so each is named.
  for (const cls of ['dcai-aurora', 'dcai-dot', 'dcai-step.is-live', 'dcai-card:not(.is-reply)']) {
    assert.ok(reduce.includes(cls), cls + ' keeps animating under reduced motion');
  }
  // The streaming caret is STATUS motion and stays: a frozen caret reads as an
  // answer that has stopped arriving.
  assert.ok(!/dcai-caret[^}]*animation: none/.test(reduce.slice(reduce.indexOf('{'), reduce.indexOf('\n}'))),
    'the streaming caret is not frozen');
});

test('the one colour that does not flip is given a daylight value', () => {
  // #E08770 is the app's "something failed" red and theme-palette.mjs
  // deliberately leaves a saturated colour alone -- red still means failed. On
  // near-black it is 6.9:1; on the paper card it measures 2.67:1, which was
  // the only AA failure on this screen in either theme. Everything else here
  // is tokenised, which is why the sheet is not in the generator's SOURCES.
  assert.match(css, /body\.dc-light #dcAi \.dcai-err[^{]*\{[^}]*#B4462C/);
  // The generator SKIPS a selector already naming dc-light, so this is not
  // re-emitted as `body.dc-light body.dc-light …`, which would match nothing.
  const light = fs.readFileSync(new URL('../src/public/studio-light.generated.css', import.meta.url), 'utf8');
  assert.ok(!/dc-light body\.dc-light/.test(light));
});

test('nothing added to the sheet uses --dc-ink-faint', () => {
  // It is 4.54:1 against the PAGE (v3.127.3 set that floor) and every surface
  // on this screen is a CARD, where the same token measures 3.70 -- under AA
  // on the 10-11px notes this screen is full of. --dc-ink-dim is 5.53 there.
  // Slice from the END of the block's own comment. Starting INSIDE it leaves
  // the comment's closing half in the text, and the comment explains the very
  // token it is checking for -- a test failing on its own explanation, which
  // this repo has now recorded eleven times. Strip, never reword.
  const marker = css.indexOf('THE LOOK (v3.153.0)');
  const added = css.slice(css.indexOf('*/', marker) + 2).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/--dc-ink-faint/.test(added), 'a note on a card must clear AA');
  // And the rules that DID use it are overridden back.
  assert.match(css, /#dcAi \.dcai-label,[\s\S]{0,200}color: var\(--dc-ink-dim/);
});
