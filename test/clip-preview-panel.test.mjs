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
  const literals = block.slice(0, end)
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
