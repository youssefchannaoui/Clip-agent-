import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The clip preview's configuration column.
 *
 * Youssef, 4 Sept 2026, with a screenshot of the bare modal -- a title, the
 * video and a scrub bar: "it should give you buttons on, let's say, on the
 * right side ... a nice, like, floating new section that has configuration. So
 * you can use the editor ... AI titles ... AI, the description ... And then it
 * should give you a text box where you can tell the AI ... make the title
 * Arabic ... no rerendering needs to be done with titlings, of course."
 *
 * What matters here and cannot be seen by looking: the panel must never be
 * reached through a hashed class (a design re-import regenerates every one of
 * them), it must be repainted from paintStudio's list rather than an observer
 * (the lesson v3.53.5 paid three attempts for), and nothing it writes may
 * touch a render.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/public/studio-tokens.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');

/** The body of one function in index.html, brace-matched. */
function fn(name) {
  const at = html.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} is missing from index.html`);
  let depth = 0, i = html.indexOf('{', at);
  const start = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') { depth -= 1; if (!depth) break; }
  }
  return html.slice(start, i + 1);
}

test('the panel and the star are painted from paintStudio, never an observer', () => {
  // An observer is delivered part-way through a render, so a node inserted
  // there is wiped by the innerHTML write that follows and never returns --
  // and during a drag it alternates present/absent for the whole drag.
  const paint = fn('paintStudio');
  assert.match(paint, /paintClipTools\(/, 'paintClipTools is not in paintStudio\'s list');
  assert.match(paint, /paintClipStars\(/, 'paintClipStars is not in paintStudio\'s list');
});

test('nothing in the panel names a generated class', () => {
  // Every .sNN is renumbered by `npm run design:import`. The panel finds its
  // mount by an inline style the export cannot renumber, and its own nodes by
  // ids and literal dcct-/data-ct hooks.
  for (const name of ['paintClipTools', 'paintClipStars']) {
    const body = fn(name);
    const hashed = body.match(/['"`]\.s[0-9a-z]{2,3}\b/g) || [];
    assert.deepEqual(hashed, [], `${name} names a generated class: ${hashed.join(', ')}`);
  }
  // Strip comments first -- the block explains WHY it does not lean on .sku,
  // and a scan that reads its own explanation is the source-string trap this
  // repo has now been caught by four times.
  const rules = css.slice(css.indexOf('data-host-pp')).replace(/\/\*[\s\S]*?\*\//g, '');
  const hashedCss = rules.match(/\.s[0-9a-z]{2,3}[\s,{]/g) || [];
  assert.deepEqual(hashedCss, [], 'the panel CSS names a generated class');
});

test('the grid areas ride data-host-pp, the one attribute the patcher keeps', () => {
  // studio-runtime's patcher strips attributes it does not own -- except the
  // data-host-* family. A grid area hung on anything else is gone by the next
  // state poll.
  const body = fn('paintClipTools');
  for (const area of ['card', 'head', 'stage', 'bar', 'tools']) {
    assert.match(body, new RegExp(`'data-host-pp',\\s*'${area}'|data-host-pp="${area}"`),
      `the ${area} area is not stamped through data-host-pp`);
    assert.match(css, new RegExp(`\\[data-host-pp="${area}"\\]`), `no CSS binds the ${area} area`);
  }
});

test('the card is two columns above the seam and one below it', () => {
  const rule = css.slice(css.indexOf('#studio [data-host-pp="card"] {'));
  assert.match(rule.slice(0, 600), /grid-template-areas:\s*"head head" "stage tools" "bar tools"/);
  // max-content, not auto: an auto track absorbs the card's free width and
  // leaves the 360px frame floating in a 484px column.
  assert.match(rule.slice(0, 600), /grid-template-columns:\s*minmax\(0,\s*max-content\)/);
  const narrow = css.slice(css.indexOf('@media (max-width: 900px)', css.indexOf('data-host-pp')));
  assert.match(narrow.slice(0, 500), /grid-template-areas:\s*"head" "stage" "bar" "tools"/,
    'below the seam the panel must go UNDER the video, not beside it');
});

test('every colour in the panel is a theme token or the brand gold', () => {
  // A literal neutral is the wrong colour in one of the two themes, and the
  // failure is silent. Gold is the brand colour and is the same in both.
  const block = css.slice(css.indexOf('#dcClipTools {'));
  const end = block.indexOf('/* Below the two-column seam');
  // Strip each var()'s OWN fallback -- the night value, by design. Filtering
  // by "this hex appears as a fallback somewhere in the block" is not the same
  // thing, and let a bare #E9E9ED through because the same hex was a fallback
  // three rules down. That probe came back green.
  // COMMENTS ARE STRIPPED FIRST. A note explaining that a colour measured
  // #141418 in daylight is not a colour the panel uses, and failing on it is
  // this repo's recurring "the test fails on its own explanation" shape --
  // which pushes the next person to reword the comment rather than fix
  // anything. Now the fourth time; strip, do not reword.
  const literals = block.slice(0, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/var\(\s*(--dc-[a-z0-9-]+)\s*,[^)]*\)/g, 'var($1)')
    .match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
  assert.deepEqual(literals, [], `un-tokenised colours in the panel: ${literals.join(', ')}`);
});

test('every var() the panel uses is a token that exists', () => {
  // A var() naming a token nobody declares falls back silently, so the rule
  // looks applied and is not.
  const block = css.slice(css.indexOf('#dcClipTools {'));
  const used = new Set([...block.matchAll(/var\((--dc-[a-z0-9-]+)/g)].map(m => m[1]));
  const declared = new Set([...css.matchAll(/^\s*(--dc-[a-z0-9-]+)\s*:/gm)].map(m => m[1]));
  for (const name of used) assert.ok(declared.has(name), `${name} is used and never declared`);
});

test('a title or description change goes through PATCH, which never re-renders', () => {
  // agent.updateClip writes the field and leaves stylePending alone. Anything
  // that queued a render here would make a retitle cost a worker slot -- the
  // one thing Youssef ruled out ("no rerendering needs to be done with
  // titlings, of course").
  const body = fn('clipToolsWrite');
  assert.match(body, /method:\s*'PATCH'/);
  assert.doesNotMatch(body, /rerender|stylePending|render/i, 'the save path mentions rendering');
});

test('the retitle route refuses honestly without a worker', () => {
  const at = server.indexOf("retitle$/");
  assert.ok(at > -1, 'the retitle route is gone');
  const route = server.slice(at, at + 2200);
  assert.match(route, /processingMode !== 'remote'|!workerClient\.configured\(\)/,
    'the route does not check that a worker exists');
  assert.match(route, /503/, 'a missing worker must refuse, not hang');
});

test('the star is drawn only where clips are listed', () => {
  const body = fn('paintClipStars');
  assert.match(body, /'queue'|"queue"/);
  assert.match(body, /'library'|"library"/);
  assert.match(body, /'detail'|"detail"/);
  // A nested <button> is invalid and swallows the card's own click, which is
  // why the schedule's remove control is a span too.
  assert.match(body, /createElement\('span'\)/, 'the star must not be a nested <button>');
  assert.match(body, /'role',\s*'button'/);
  // pointerdown as well as click: the card starts its own gestures on
  // pointerdown, so stopping click alone still selects the clip underneath.
  assert.match(body, /addEventListener\('pointerdown'/);
});

test('the panel unmounts with the preview', () => {
  // Left mounted it would sit over whatever screen came next, holding a stale
  // clip's title.
  const body = fn('paintClipTools');
  const at = body.search(/if \(!vals\.playerOpen\)/);
  assert.ok(at > -1, 'the panel does not check whether the preview is open');
  // The closed BRANCH, not the function: `clipToolsNode.remove()` also appears
  // in the re-mount path, so asserting on the whole body passed against a
  // version that never took the node out.
  // Brace-matched, not sliced to a `return;` at a guessed indentation --
  // indexOf returned -1 for the wrong indent, slice(at, -1) handed back the
  // whole function, and the probe stayed green.
  const branch = (() => {
    let i = body.indexOf('{', at), depth = 0;
    const from = i;
    for (; i < body.length; i++) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}') { depth -= 1; if (!depth) break; }
    }
    return body.slice(from, i + 1);
  })();
  assert.match(branch, /clipToolsNode\.remove\(\)/, 'the closed branch leaves the panel mounted');
});

/* ── The three faults Youssef found by using it (v3.124.4) ──────────────── */

test('the panel mounts on the PLAYER, never on the first 9:16 box in the studio', () => {
  /*
   * THE BUG THIS PINS IS THE WHOLE FEATURE NOT WORKING.
   *
   * The mount was `document.querySelector('#studio [style*="aspect-ratio: 9 / 16"]')`
   * and then that node's parent. EVERY clip card's thumbnail carries that
   * inline style (`thumbStyle` in the adapter), and the player overlay is a
   * root-level sibling of <main> -- so with the review queue behind the modal
   * the selector lost on document order every single time and returned the
   * FIRST CARD IN THE GRID.
   *
   * MEASURED at 1440x950 with three clips seeded: the panel mounted into
   * `ARTICLE[data-clip=c1]`. So the configuration column never appeared in the
   * preview at all, and the card it landed in was left 314px wide beside its
   * 202px siblings.
   */
  const body = fn('paintClipTools');
  assert.match(body, /querySelector\('#studio \[data-dc-player\]'\)/,
    'the panel does not anchor on the player');
  assert.ok(!/querySelector\('#studio \[style\*="aspect-ratio/.test(html),
    'the loose 9:16 lookup is back — it finds a clip card, not the preview');

  // The anchor has to exist in the generated markup, or the panel silently
  // never mounts. Exactly one, or `querySelector` picks whichever came first.
  const template = fs.readFileSync(path.join(root, 'src/public/studio-template.generated.js'), 'utf8');
  const hits = template.match(/"data-dc-player":""/g) || [];
  assert.equal(hits.length, 1, 'the player card carries exactly one data-dc-player anchor');
});

test('closing the preview takes the grid areas off again', () => {
  /*
   * `data-host-*` is the ONE attribute family the patcher never strips, which
   * is exactly why it survives a re-render -- and why nothing but this removes
   * it. Left behind on a card in the grid, the panel's CSS went on laying that
   * card out as the preview column for the rest of the session: measured, the
   * card stayed 314px wide against 202px siblings through every later paint.
   *
   * It sweeps the whole studio rather than a remembered node, so a card
   * wrecked by an earlier paint heals rather than staying broken until a
   * reload.
   */
  const sweep = fn('clearClipToolsAreas');
  assert.match(sweep, /querySelectorAll\('#studio \[data-host-pp\]'\)/,
    'the sweep does not look for stamped nodes');
  assert.match(sweep, /removeAttribute\('data-host-pp'\)/, 'the sweep does not remove the stamp');

  // And the CLOSED branch must call it -- the same brace-matched slice the
  // unmount test uses, because `clipToolsNode.remove()` appears in the
  // re-mount path too and asserting on the whole body proves nothing.
  const body = fn('paintClipTools');
  const at = body.search(/if \(!vals\.playerOpen\)/);
  assert.ok(at > -1);
  const branch = (() => {
    let i = body.indexOf('{', at), depth = 0;
    const from = i;
    for (; i < body.length; i++) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}') { depth -= 1; if (!depth) break; }
    }
    return body.slice(from, i + 1);
  })();
  assert.match(branch, /clearClipToolsAreas\(\)/, 'closing leaves the grid areas stamped on the card');
});

test('the AI star clears the card\'s own select control', () => {
  /*
   * MEASURED at 1440x950: the select button sits at top 9, right 9, 22x22 --
   * and the star was a 26px box at top 8, right 8, so it covered the control
   * completely and a hovered card could not be ticked. "the ai button is
   * covering the select button".
   *
   * The numbers are the control's, so this stays true if the star is resized:
   * the star's top edge must clear the button's bottom edge.
   */
  const SELECT_TOP = 9, SELECT_SIZE = 22;      // the export's own top-right control
  const rule = css.slice(css.indexOf('#studio article[data-clip] > [data-dc-star] {'));
  const top = Number((rule.match(/top:\s*(\d+)px/) || [])[1]);
  assert.ok(Number.isFinite(top), 'the star has no top offset');
  assert.ok(top >= SELECT_TOP + SELECT_SIZE,
    `the star at top ${top}px overlaps the select control, which ends at ${SELECT_TOP + SELECT_SIZE}px`);
});

test('the panel and the star answer to ONE gate, and it is not typed here', () => {
  // DeenAI is one feature at one tier (v3.122.0). The panel must not carry its
  // own idea of which plan that is -- v3.72.10 shipped a button naming the
  // wrong plan exactly because the name was a literal beside a gate that moved.
  const tools = fn('paintClipTools');
  const stars = fn('paintClipStars');
  assert.match(tools, /vals\.aiLocked/, 'the panel reads the gate binding');
  assert.match(tools, /vals\.aiPlanName/, 'and the plan name comes with it');
  assert.match(stars, /vals && vals\.aiLocked/,
    'the star calls the same route, so it must answer to the same gate');
  // No tier name may be written into the panel by hand.
  for (const tier of ['Pro', 'Studio', 'Basic']) {
    assert.ok(!new RegExp(`Unlock with ${tier}'|Unlock with ${tier}"`).test(tools),
      `the panel hardcodes ${tier}`);
  }
});

test('the shapes differ by target, and a description never offers a question', () => {
  // A description is a caption: hashtags belong in it and a question does not.
  const body = fn('paintClipTools');
  const shapes = body.slice(body.indexOf('const shapes ='), body.indexOf('const spark ='));
  assert.match(shapes, /CLIPTOOLS\.target === 'description'/, 'the row changes with the target');
  const [forDesc, forTitle] = shapes.split('    : [');
  assert.match(forDesc, /hashtags/, 'a description can ask for hashtags');
  assert.ok(!/question/.test(forDesc), 'a description is not phrased as a question');
  assert.match(forTitle, /question/, 'a title can be');
  assert.ok(!/hashtags/.test(forTitle), 'a title never carries hashtags');
});

test('a shape is sent as `style`, never as the typed instruction', () => {
  // The whole reason the two are separate: a style must not override the
  // recitation reference, and typed text must.
  const body = fn('paintClipTools');
  assert.match(body, /what\.indexOf\('style-'\) === 0/, 'the chips are handled');
  assert.match(body, /clipToolsAsk\(CLIPTOOLS\.target, '', what\.slice\(6\)\)/,
    'the shape goes in the style slot with an EMPTY instruction');
});

test('the panel remembers what it has already offered, and sends it', () => {
  // Youssef, 4 Sept 2026: "cant chnage more than once". The worker is
  // stateless, so a second press can only differ if the browser tells it what
  // the first one gave. Both controls read ONE history -- two would let the
  // star hand back what Rewrite just rejected.
  assert.match(html, /function clipToolsSeen\(id, kind\)/,
    'one history, keyed by clip and field');
  const calls = [...html.matchAll(/\/retitle['"][\s\S]{0,900}?\}\),/g)].map(m => m[0]);
  assert.equal(calls.length, 2, 'the panel and the star, and nothing else');
  for (const call of calls) assert.match(call, /avoid:/, 'every retitle call carries the history');
  // Both READ that one history rather than keeping their own: the call sites
  // resolve it a line above, so this counts the readers rather than looking
  // inside each call.
  assert.equal((html.match(/function clipToolsSeen\(/g) || []).length, 1,
    'one accessor, so there is one history');
  assert.equal((html.match(/CLIPTOOLS\.seen\b/g) || []).length, 2,
    'and it is read and written only through that accessor');
});

test('the line on screen is avoided too, not only the previous answers', () => {
  // "Give me another" means another than THIS one as well. Without the current
  // value in the list the very first press can hand back what is already
  // there, which is where the complaint started.
  const calls = [...html.matchAll(/\/retitle['"][\s\S]{0,900}?\}\),/g)].map(m => m[0]);
  for (const call of calls) assert.match(call, /\.concat\(/, 'the current value joins the list');
});

test('an unchanged answer is never remembered as a new one', () => {
  // It IS the line already in the list; recording it again would spend one of
  // the twelve slots the prompt can carry on a duplicate.
  assert.match(html, /r\.source !== ['"]unchanged['"]/,
    'only a genuinely new line is remembered');
});

test('the avoid list is capped where it arrives from the customer', () => {
  // It reaches a prompt, so its length and each entry's length are the
  // server's business rather than the browser's.
  const route = server.slice(server.indexOf('/retitle$/'));
  const block = route.slice(0, 2000);
  assert.match(block, /Array\.isArray\(asked\?\.avoid\)/);
  assert.match(block, /\.slice\(0, 12\)/, 'a bounded number of lines');
  assert.match(block, /v\.slice\(0, 200\)/, 'each of a bounded length');
});

test('the DeenAI mark is gold, and its selector actually matches', () => {
  // A COMMENT IS NOT A SEPARATOR. This rule was written as
  // `.dcct-row /* ... */ .dcct-ai { ... }`, which CSS reads as the descendant
  // selector `.dcct-row .dcct-ai` -- so the one gold mark on the panel had
  // never once been gold on any screen. Found by reading the sheet, not by
  // looking at it.
  const rule = css.slice(css.indexOf('.dcct-ai {'));
  assert.match(rule.slice(0, 200), /color:\s*var\(--dc-gold-lit/);
  const before = css.slice(0, css.indexOf('.dcct-ai {'));
  assert.ok(/[};*/]\s*$/.test(before.trimEnd()),
    'nothing but a closed rule or comment may precede it, or it is a descendant selector');
});


test('the solid gold button is written in tokens, and they do not flip', () => {
  // MEASURED IN THE BROWSER at 1.52:1 in daylight before this was tokenised.
  // `build-light-theme` re-emits any rule naming a colour and remaps every hex
  // it finds -- and #0E0E11 is a page ground everywhere else in this app, so
  // the ink on a gold button inverted to paper and vanished. A rule written
  // entirely in var() names has no hex for the generator to see.
  const rule = css.slice(css.indexOf('#dcClipTools .dcct-primary {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /background: var\(--dc-gold-solid\)/);
  assert.match(body, /color: var\(--dc-on-gold\)/);
  // The pair is declared once, on :root, and NEVER redeclared for daylight --
  // that is the whole of what makes one declaration serve both themes.
  // The palette block itself, by its own selector -- not "the first mention of
  // dc-light anywhere", which is a line of prose in the comment above it and
  // made this probe come back green against a redeclared token.
  const at = css.indexOf(':root.dc-light,\nbody.dc-light {');
  assert.ok(at > -1, 'the daylight palette block moved; this test needs pointing at it');
  const light = css.slice(at, css.indexOf('\n}', at));
  for (const token of ['--dc-gold-solid', '--dc-on-gold', '--dc-gold-hover']) {
    assert.match(css, new RegExp(`\\n\\s*${token}:`), `${token} must be declared`);
    assert.ok(!light.includes(`${token}:`), `${token} must not be redeclared in daylight`);
  }
  // And the generated sheet must not be overriding it either.
  const gen = fs.readFileSync(path.join(root, 'src/public/studio-light.generated.css'), 'utf8');
  const emitted = gen.match(/body\.dc-light #dcClipTools \.dcct-primary\{[^}]*\}/);
  if (emitted) {
    assert.ok(!/background:|color:/.test(emitted[0]),
      `daylight is still repainting the button: ${emitted[0]}`);
  }
});
