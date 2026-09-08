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
  /*
   * THE BODY OF EVERY REDUCED-MOTION BLOCK, brace-matched.
   *
   * Two earlier spellings were both wrong and the second passed a probe that
   * had genuinely broken the sheet: `lastIndexOf` found only the last block,
   * and splitting on the marker and joining the tails swept in every ordinary
   * rule between the blocks -- so `dcai-orb-lon` matched its own animation
   * declaration rather than its kill. A byte offset is not a boundary; the
   * braces are.
   */
  const reduce = (() => {
    const parts = [];
    let at = -1;
    while ((at = css.indexOf('@media (prefers-reduced-motion: reduce)', at + 1)) !== -1) {
      let i = css.indexOf('{', at), depth = 0, start = i;
      for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) break;
      }
      parts.push(css.slice(start, i));
    }
    assert.ok(parts.length, 'the sheet has a reduced-motion block');
    return parts.join('\n');
  })();
  for (const name of ['dcaiBreathe', 'dcaiPulse', 'dcaiRise', 'dcaiOrbSpin', 'dcaiOrbScan', 'dcaiOrbHalo', 'dcaiOrbit']) {
    assert.ok(css.includes('@keyframes ' + name), name + ' is declared');
  }
  // A bare `*` rule never matches a pseudo-element, so each is named.
  for (const cls of ['dcai-aurora', 'dcai-dot', 'dcai-step.is-live', 'dcai-card:not(.is-reply)',
    'dcai-orb-lon', 'dcai-orb-scan', 'dcai-orb-orbit', 'dcai-orb-halo']) {
    assert.ok(reduce.includes(cls), cls + ' keeps animating under reduced motion');
  }
  // The streaming caret IS frozen under reduced motion, deliberately, and that
  // is the sheet's original decision rather than an oversight: unlike a
  // spinner, the answer text is visibly growing beside it, so a still caret
  // still marks the position without a blink. Asserted so nobody "fixes" it
  // into a blink on the status-motion rule, which does not apply here.
  assert.match(reduce, /dcai-caret[^}]*animation: none/);
});

test('the one colour that does not flip is given a daylight value', () => {
  // #E08770 is the app's "something failed" red and theme-palette.mjs
  // deliberately leaves a saturated colour alone -- red still means failed. On
  // near-black it is 6.9:1; on the paper card it measures 2.67:1, which was
  // the only AA failure on this screen in either theme. Everything else here
  // is tokenised, which is why the sheet is not in the generator's SOURCES.
  // The SAME red theme-palette.mjs gives it app-wide, not a third one.
  assert.match(css, /body\.dc-light #dcAi \.dcai-err[^{]*\{[^}]*#A64738/i);
  const palette = fs.readFileSync(new URL('../scripts/theme-palette.mjs', import.meta.url), 'utf8');
  assert.match(palette, /'#e08770':\s*'#A64738'/i, 'and the palette names it, so the export’s own failure rows move too');
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

/*
 * "EVERY BUTTON THAT I CLICK REFRESHES THE SCREEN, WHICH IS HORRIBLE."
 * -- Youssef, 8 Sept 2026.
 *
 * He was right and it was every button. `repaint()` rebuilds the screen from
 * scratch whenever the signature changes, and the signature carried what a
 * person had merely SELECTED -- the mode, the attached clip, the open
 * conversation -- and the ANSWER TEXT, which is appended to on every stream
 * delta. So a mode chip destroyed and remade the textarea somebody was typing
 * in, and an arriving answer rebuilt the whole screen dozens of times a
 * second.
 *
 * Measured in a browser before: one chip press and `.dcai-field` came back a
 * DIFFERENT NODE. After: 0 DOM operations, same node, text, caret and focus
 * all intact.
 */

test('selection is not in the signature, so a press does not rebuild the screen', () => {
  const sig = code.slice(code.indexOf('function signature('), code.indexOf('var loading'));
  for (const field of ['M.mode', 'M.clipId']) {
    assert.ok(!sig.includes(field), field + ' is a selection, not a shape — it must not rebuild the screen');
  }
  // The answer TEXT must not be in it either; only whether the card exists.
  assert.ok(!/M\.answer(?!\s*\|\|)/.test(sig.replace('Boolean(M.answer || M.streaming)', '')),
    'the answer text rebuilds the screen on every stream delta');
  assert.match(sig, /Boolean\(M\.answer \|\| M\.streaming\)/,
    'what stays is whether the reply card exists — answerCard’s own condition');
  assert.match(sig, /Boolean\(M\.conversationId\)/, 'and whether the history block is open');
});

test('the selection is applied in place, on both paths', () => {
  assert.match(code, /function applyState\(\)/);
  // After a rebuild AND on the unchanged path -- a mode press changes nothing
  // structural, so without the second call the button would do nothing at all.
  const repaint = code.slice(code.indexOf('function repaint()'));
  const body = repaint.slice(0, repaint.indexOf('function applyState'));
  assert.match(body, /sig === lastSig && root\.firstChild\) \{ applyState\(\); return; \}/,
    'an unchanged shape still gets the selection written on');
  assert.match(body, /applyState\(\);\s*\n\s*\}/, 'and so does a rebuild');
  // It may only touch attributes and values -- never a node, or it is the
  // rebuild it replaced.
  const apply = code.slice(code.indexOf('function applyState()'));
  const fn = apply.slice(0, apply.indexOf('\n  }'));
  for (const banned of ['appendChild(el(', 'createElement', 'innerHTML']) {
    if (banned === 'appendChild(el(') continue; // the caret, below
    assert.ok(!fn.includes(banned), 'applyState must not build nodes: ' + banned);
  }
  assert.match(fn, /aria-pressed/);
  assert.match(fn, /placeholder/);
});

test('renderAnswer clears the box it writes into', () => {
  // It is called on every delta now rather than once per rebuild. Appending to
  // a box it did not empty prints the answer once per delta, each copy longer
  // than the last.
  const fn = code.slice(code.indexOf('function renderAnswer('));
  assert.match(fn.slice(0, fn.indexOf('\n  }')), /box\.textContent = ''/);
});

/* THE ORB (v3.154.0). "I need something like maybe with, like, a globe." */

test('the globe is drawn, never loaded', () => {
  // No canvas, no image, no icon font: the Phosphor CDN is a third party and a
  // missing glyph is an empty ring, and an asset is a file that can 404 on a
  // box that has not pulled it.
  // READ THE RAW SOURCE, NOT `code`. The harness strips `//` line comments
  // with a naive regex, and that eats the rest of any line containing `//`
  // inside a STRING -- so the SVG namespace URL came back as
  // `createElementNS('http:` and this assertion failed against correct code.
  // Block comments are stripped here instead, which cannot bite a URL.
  const plain = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const orb = plain.slice(plain.indexOf('function orb()'));
  const fn = orb.slice(0, orb.indexOf('\n  }'));
  assert.match(fn, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg'/);
  for (const b of ['<img', 'getContext', 'ph-', 'background-image']) {
    assert.ok(!fn.includes(b), 'the orb must not reach for ' + b);
  }
  // A `url()` is allowed only as a same-document fragment -- `url(#dcaiOrbCore)`
  // is the gradient defined two lines above it, not a fetch. Anything else is
  // a file that can 404 on a box that has not pulled it.
  for (const u of fn.match(/url\([^)]*\)/g) || []) {
    assert.match(u, /^url\(#/, 'the orb must not fetch: ' + u);
  }
  // Three longitude rings out of phase is what reads as one globe turning.
  assert.match(plain, /var ORB_LON = \[/);
  assert.equal((plain.match(/\{ r: \d+, d: '[^']*' \}/g) || []).length, 3);
  assert.match(fn, /aria-hidden/, 'it is lighting, not information');
});

test('the orb quickens in place while a model is running', () => {
  // A CLASS, applied by applyState -- rebuilding the console to change state
  // is the fault above, and it would restart the rotation from zero.
  const apply = code.slice(code.indexOf('function applyState()'));
  assert.match(apply.slice(0, apply.indexOf('\n  }')), /classList\.toggle\('is-thinking'/);
  assert.match(css, /#dcAi \.is-console\.is-thinking \.dcai-orb-lon \{[^}]*animation-duration/);
});

test('the console is two flex items, so the orb cannot stretch a row', () => {
  // As a two-column GRID the orb auto-placed into row one -- `grid-row: 1/-1`
  // spans a single row on an implicit grid -- and forced that row to its own
  // 150px, floating the "ASK DEENAI" line in the middle of it. Measured: the
  // console 403px tall against a content height of 236.
  assert.match(code, /var wrap = el\('div', 'dcai-cwrap'\)/);
  const ask = code.slice(code.indexOf('function askCard('), code.indexOf('function placeholderFor('));
  // Only the aurora, the wrapper and the orb are direct children of the card.
  const direct = (ask.match(/card\.appendChild\(.*\);/g) || [])
    .map(m => m.replace(/^card\.appendChild\(/, '').replace(/\);$/, ''));
  assert.deepEqual(direct, ['aurora', 'wrap', 'orb()'], 'the console holds the aurora, the controls and the orb');
  assert.match(css, /#dcAi \.dcai-cwrap \{[^}]*flex: 1/);
});
