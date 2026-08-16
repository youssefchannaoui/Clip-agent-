import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// studio-runtime.js is a browser IIFE that falls back to globalThis off-window.
await import('../src/public/studio-runtime.js');
const { Renderer, evalValue, lookup } = globalThis.StudioRuntime._internals;

const render = (ast, vals) => {
  const r = new Renderer();
  const out = [];
  r.render(ast, vals, out);
  return { html: out.join(''), handlers: r.handlers };
};

// ── runtime ────────────────────────────────────────────────────────────────

test('text bindings are HTML-escaped', () => {
  const { html } = render([{ t: 'txt', v: { p: 'title' } }], { title: '<img src=x onerror=alert(1)>' });
  assert.equal(html, '&lt;img src=x onerror=alert(1)&gt;');
});

test('attribute values escape quotes so they cannot break out', () => {
  const { html } = render([{ t: 'el', tag: 'div', a: { title: { p: 'v' } } }], { v: 'a" onclick="evil()' });
  assert.equal(html, '<div title="a&quot; onclick=&quot;evil()"></div>');
});

test('sc-if renders only when the condition is truthy', () => {
  const ast = [{ t: 'if', c: { p: 'open' }, ch: ['shown'] }];
  assert.equal(render(ast, { open: true }).html, 'shown');
  assert.equal(render(ast, { open: false }).html, '');
});

test('an empty array is falsy for sc-if, matching the design intent', () => {
  const ast = [{ t: 'if', c: { p: 'rows' }, ch: ['shown'] }];
  assert.equal(render(ast, { rows: [] }).html, '');
  assert.equal(render(ast, { rows: [1] }).html, 'shown');
});

test('sc-for repeats children and scopes the loop variable', () => {
  const ast = [{ t: 'for', l: { p: 'items' }, as: 'it', ch: [{ t: 'txt', v: { p: 'it.label' } }] }];
  const { html } = render(ast, { items: [{ label: 'a' }, { label: 'b' }] });
  assert.equal(html, 'ab');
});

test('loop scope shadows outer values without mutating them', () => {
  const vals = { it: 'outer', items: [{ label: 'inner' }] };
  const ast = [
    { t: 'for', l: { p: 'items' }, as: 'it', ch: [{ t: 'txt', v: { p: 'it.label' } }] },
    { t: 'txt', v: { p: 'it' } },
  ];
  assert.equal(render(ast, vals).html, 'innerouter');
  assert.equal(vals.it, 'outer');
});

test('nested loops keep each level of scope reachable', () => {
  const ast = [{
    t: 'for', l: { p: 'groups' }, as: 'g',
    ch: [{ t: 'for', l: { p: 'g.rows' }, as: 'r', ch: [{ t: 'txt', v: { cat: [{ p: 'g.name' }, ':', { p: 'r' }, ' '] } }] }],
  }];
  const { html } = render(ast, { groups: [{ name: 'x', rows: ['1', '2'] }] });
  assert.equal(html, 'x:1 x:2 ');
});

test('a missing path yields empty output rather than "undefined"', () => {
  const { html } = render([{ t: 'txt', v: { p: 'a.b.c' } }], {});
  assert.equal(html, '');
});

test('void elements are not given a closing tag', () => {
  const { html } = render([{ t: 'el', tag: 'input', a: { type: 'text' } }], {});
  assert.equal(html, '<input type="text">');
});

test('bound styles render inline while literal ones stay hoisted in CSS', () => {
  const { html } = render([{ t: 'el', tag: 'div', a: { class: 's0' }, st: { p: 'rowStyle' } }], { rowStyle: 'color: red;' });
  assert.equal(html, '<div class="s0" style="color: red;"></div>');
});

test('false and null attributes are dropped, true renders bare', () => {
  const ast = [{ t: 'el', tag: 'input', a: { disabled: { p: 'off' }, checked: { p: 'on' }, name: { p: 'missing' } } }];
  assert.equal(render(ast, { off: false, on: true }).html, '<input checked>');
});

test('handlers are collected into an indexed table the DOM can reference', () => {
  const fn = () => {};
  const ast = [{ t: 'el', tag: 'button', on: { click: { p: 'go' } } }];
  const { html, handlers } = render(ast, { go: fn });
  assert.equal(html, '<button data-dc-h="click=0"></button>');
  assert.equal(handlers[0], fn);
});

test('a binding that is not a function is not wired as a handler', () => {
  const { html } = render([{ t: 'el', tag: 'button', on: { click: { p: 'go' } } }], { go: 'not-a-function' });
  assert.equal(html, '<button></button>');
});

test('concat values join literals and bindings in order', () => {
  assert.equal(evalValue({ cat: ['a', { p: 'x' }, 'c'] }, { x: 'b' }), 'abc');
});

test('lookup walks dotted paths and stops safely at a gap', () => {
  assert.equal(lookup({ a: { b: 1 } }, 'a.b'), 1);
  assert.equal(lookup({ a: null }, 'a.b'), undefined);
});

// ── importer ───────────────────────────────────────────────────────────────

const FIXTURE = `<!DOCTYPE html>
<html><head></head><body>
<x-dc>
<div style="color: red;" style-hover="color: blue;">
  <sc-if value="{{ isOpen }}" hint-placeholder-val="{{ true }}">
    <span style="color: red;">{{ label }}</span>
  </sc-if>
  <sc-for list="{{ rows }}" as="row" hint-placeholder-count="3">
    <a href="#" onClick="{{ row.click }}" style="{{ row.style }}" style-hover="opacity: .5;">{{ row.name }}</a>
  </sc-for>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script>{ isOpen: true, label: 'hi' }</script>
</body></html>`;

function runImporter(source, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-design-'));
  const src = path.join(dir, 'fixture.dc.html');
  fs.writeFileSync(src, source);
  let stdout = '', stderr = '', status = 0;
  try {
    stdout = execFileSync(process.execPath,
      [path.join(ROOT, 'scripts/import-design.mjs'), '--src', src, '--out', dir, ...extraArgs],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    stdout = err.stdout || '';
    stderr = err.stderr || '';
    status = err.status;
  }
  const read = f => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null);
  const result = { stdout, stderr, status, js: read('studio-template.generated.js'), css: read('studio-styles.generated.css') };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

function astOf(js) {
  const g = {};
  new Function('window', js)(g);
  return { ast: g.STUDIO_TEMPLATE, bindings: g.STUDIO_BINDINGS };
}

test('the importer compiles sc-if and sc-for into AST nodes', () => {
  const { ast } = astOf(runImporter(FIXTURE).js);
  const div = ast.find(n => n.t === 'el' && n.tag === 'div');
  assert.ok(div, 'root div survived');
  assert.equal(div.ch.filter(n => n.t === 'if').length, 1);
  const loop = div.ch.find(n => n.t === 'for');
  assert.equal(loop.as, 'row');
  assert.deepEqual(loop.l, { p: 'rows' });
});

test('editor-only hint attributes are dropped', () => {
  const { js } = runImporter(FIXTURE);
  assert.doesNotMatch(js, /hint-placeholder/);
});

test('identical literal styles are hoisted into one shared class', () => {
  const { css } = runImporter(FIXTURE);
  // "color: red;" appears on two elements but must produce a single rule.
  const rules = [...css.matchAll(/^\.(\w+)\{color: red\}$/gm)];
  assert.equal(rules.length, 1, 'duplicate literal styles collapse to one class');
});

test('hover styles become real CSS because they cannot be inline', () => {
  const { css } = runImporter(FIXTURE);
  assert.match(css, /:hover\{color: blue\}/);
});

test('hover rules use !important only when the base style is a runtime binding', () => {
  const { css } = runImporter(FIXTURE);
  // The <a> has style="{{ row.style }}", so inline would otherwise beat :hover.
  assert.match(css, /:hover\{opacity: \.5 !important\}/);
  // The <div> has a literal base style, so no !important is needed.
  assert.match(css, /:hover\{color: blue\}/);
});

test('bindings used by the template are reported', () => {
  const { bindings } = astOf(runImporter(FIXTURE).js);
  assert.ok(bindings.includes('isOpen'));
  assert.ok(bindings.includes('rows'));
  // `row` is a loop variable, not something the adapter must supply.
  assert.ok(!bindings.includes('row'));
});

test('a truncated export is detected and reported rather than silently compiled', () => {
  // Cut inside the behaviour script, leaving the markup block intact — this is
  // exactly the shape of an export capped mid-file.
  const cut = FIXTURE.indexOf('data-dc-script>') + 'data-dc-script>'.length;
  const { stdout, status } = runImporter(FIXTURE.slice(0, cut) + '{ isOpen: true,');
  assert.match(stdout, /truncated/i);
  assert.equal(status, 1, 'a truncated source is not a clean import');
});

test('--check reports without writing files and fails on unsupplied bindings', () => {
  const { status, js, css, stdout } = runImporter(FIXTURE, ['--check']);
  assert.equal(js, null, '--check writes nothing');
  assert.equal(css, null);
  // The fixture's script supplies isOpen and label but not rows.
  assert.equal(status, 1);
  assert.match(stdout, /rows/);
});

test('a source without an <x-dc> block is rejected with a usable message', () => {
  const { status, stderr, js } = runImporter('<html><body>nope</body></html>');
  assert.equal(status, 2);
  assert.equal(js, null, 'nothing is written for an unusable source');
  assert.match(stderr, /no <x-dc> block/i);
});

// ── adapter integration ────────────────────────────────────────────────────
// Renders the real generated template through the real adapter, so a design
// re-import that changes a binding name fails here rather than in the browser.

await import('../src/public/studio-template.generated.js');
await import('../src/public/studio-adapter.js');
const { StudioAdapter, STUDIO_TEMPLATE, STUDIO_BINDINGS } = globalThis;

const SAMPLE_STATE = {
  user: { email: 'youssef@deenclipped.online' },
  projects: [
    { id: 'p1', title: 'The Night Prayer', status: 'ready', clipCount: 6, durationSec: 3720, submittedAt: Date.now() - 7200e3, sourceThumbUrl: '/api/p/p1/thumb' },
    { id: 'p2', title: 'Patience in Hardship', status: 'processing', clipCount: 0, durationSec: 2400, submittedAt: Date.now() - 600e3, sourceThumbUrl: null },
  ],
  clips: [
    { id: 'c1', title: 'Whoever wakes safe', status: 'waiting', score: 92, durationMs: 38000, thumbUrl: '/api/clips/c1/thumb', reviewRequired: true, targets: [] },
    { id: 'c2', title: 'Three duaa never turned back', status: 'waiting', score: 88, durationMs: 44000, thumbUrl: '/api/clips/c2/thumb', targets: [] },
    { id: 'c3', title: 'He did not say the reciter', status: 'scheduled', score: 81, durationMs: 41000, scheduledAt: new Date(Date.now() + 3600e3).toISOString(), targets: [{ platform: 'youtube' }] },
  ],
  tracks: [{ id: 't1', name: 'Nasheed A' }],
  log: [{ level: 'error', message: 'TikTok token expired', at: Date.now() - 900e3 }],
  social: { youtube: { connected: true, accounts: [{ name: 'DeenClipped' }] }, instagram: { connected: false }, tiktok: { connected: false } },
  billing: { current: { plan: 'creator', remaining: 412, unlimited: false } },
};

const renderScreen = (screen, patch = {}) => {
  Object.assign(StudioAdapter.ui, { screen, bellOpen: false, menuOpen: false, railOpen: true }, patch);
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  return { ...render(STUDIO_TEMPLATE, vals), vals };
};

test('the dashboard renders real state with nothing left unresolved', () => {
  const { html } = renderScreen('home');
  assert.ok(!html.includes('{{'), 'no unresolved bindings');
  assert.ok(!html.includes('undefined'), 'no undefined leaked into markup');
  assert.ok(!html.includes('[object'), 'no object stringified into markup');
  assert.ok(!html.includes('<sc-'), 'no template directives survived');
});

test('Home shows real lectures, clips and account details', () => {
  const { html } = renderScreen('home');
  assert.match(html, /The Night Prayer/);
  assert.match(html, /Whoever wakes safe/);
  assert.match(html, /youssef@deenclipped\.online/);
  assert.match(html, /412/, 'token balance');
});

test('nav counts derive from clip state, not mock data', () => {
  const { vals } = renderScreen('home');
  const counts = Object.fromEntries(vals.navProduce.map(n => [n.label, n.count]));
  assert.equal(counts['Review queue'], 2, 'two clips await a decision');
  assert.equal(counts['Schedule'], 1, 'one clip is scheduled');
});

test('every screen renders and titles itself', () => {
  for (const [screen, title] of Object.entries({
    home: 'Home', queue: 'Review queue', library: 'Lecture library',
    schedule: 'Schedule', templates: 'Templates', music: 'Nasheed library',
    language: 'Arabic & terms', performance: 'Performance', tokens: 'Tokens & billing',
  })) {
    const { html, vals } = renderScreen(screen);
    assert.equal(vals.pageTitle, title, `${screen} title`);
    assert.ok(html.length > 1000, `${screen} rendered something`);
  }
});

test('an empty account renders the onboarding copy rather than breaking', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home' });
  const vals = StudioAdapter.bindings({});
  const { html } = render(STUDIO_TEMPLATE, vals);
  assert.equal(vals.isEmptyStudio, true);
  assert.match(vals.subline, /Paste a lecture link/);
  assert.ok(!html.includes('undefined'));
});

test('a thumbnail URL cannot break out of the CSS url() it lands in', () => {
  const vals = StudioAdapter.bindings({
    ...SAMPLE_STATE,
    projects: [{ id: 'p', title: 'x', status: 'ready', sourceThumbUrl: 'a") ; background: red; x:url("b' }],
  });
  const style = vals.lectures[0].thumbStyle;
  // The payload's text may survive, but only inertly: the quote and paren that
  // would close url() early must be encoded, so the declaration cannot break out.
  const inside = style.slice(style.indexOf('url("') + 5, style.lastIndexOf('")'));
  assert.ok(!inside.includes('"'), 'no raw quote can terminate the url');
  assert.ok(!inside.includes(')'), 'no raw paren can terminate the url');
  assert.match(inside, /%22%29/, 'breakout characters were percent-encoded');
});

test('collapsing the rail changes its width and hides labels', () => {
  const wide = renderScreen('home', { railOpen: true }).vals;
  const narrow = renderScreen('home', { railOpen: false }).vals;
  assert.match(wide.railStyle, /width: 228px/);
  assert.match(narrow.railStyle, /width: 68px/);
  assert.match(narrow.navHome[0].labelStyle, /display: none/);
});

test('the adapter supplies every binding the template actually reads', () => {
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  const missing = STUDIO_BINDINGS.filter(b => !(b in vals));
  // Staged rollout: shell + Home are wired, later screens are not yet.
  assert.ok(!missing.includes('navHome'), 'shell bindings are supplied');
  assert.ok(!missing.includes('pageTitle'));
  assert.ok(!missing.includes('lectures'), 'Home bindings are supplied');
});

test('lecture length reads as hours, not as an ambiguous m:ss clock', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home' });
  const vals = StudioAdapter.bindings({
    projects: [
      { id: 'a', title: 'Long', status: 'ready', durationSec: 3720, submittedAt: Date.now() },
      { id: 'b', title: 'Short', status: 'ready', durationSec: 1500, submittedAt: Date.now() },
    ],
  });
  assert.match(vals.lectures[0].meta, /^1h 2m ·/, '3720s is an hour and two minutes');
  assert.match(vals.lectures[1].meta, /^25m ·/);
});

test('Home floaters carry the design collage geometry', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home' });
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  assert.equal(vals.floaters.length, 4, 'four collage slots regardless of clip count');
  for (const f of vals.floaters) {
    assert.match(f.style, /position: absolute/);
    assert.match(f.style, /rotate: -?[\d.]+deg/);
    assert.match(f.style, /animation: dcFloat/);
  }
});

test('empty collage slots are marked empty rather than rendering a blank card', () => {
  const vals = StudioAdapter.bindings({ clips: [{ id: 'c', title: 'only one', status: 'waiting' }] });
  assert.equal(vals.floaters[0].has, true);
  assert.equal(vals.floaters[3].empty, true);
  assert.match(vals.floaters[3].style, /dashed/);
});

// ── wiring ─────────────────────────────────────────────────────────────────
// The server serves static files by explicit route, so a generated file is
// invisible until it is listed. That is easy to miss on a re-import.

test('every studio asset the page requests has a server route', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  const referenced = [...html.matchAll(/(?:src|href)="(\/studio-[\w.-]+)"/g)].map(m => m[1]);
  assert.ok(referenced.length >= 4, 'the page pulls in the studio bundle');
  for (const asset of new Set(referenced)) {
    assert.ok(server.includes(`'${asset}'`), `${asset} needs a route in server.js or it 404s`);
  }
});

test('every studio asset with a route exists on disk', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  const block = server.slice(server.indexOf('const STUDIO_ASSETS'), server.indexOf('};', server.indexOf('const STUDIO_ASSETS')));
  const files = [...block.matchAll(/studioAsset\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(files.length >= 4);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, 'src/public', f)), `${f} missing — run npm run design:import`);
  }
});

test('the approve call matches the endpoint the server actually exposes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const call = /StudioAdapter\.onApprove\s*=[^;]+/.exec(html)[0];
  assert.match(call, /'PATCH'/, 'clips are updated with PATCH /api/clips/:id');
  assert.match(call, /JSON\.stringify/, 'api() forwards options to fetch, so body must be a string');
});

test('the studio mount point does not become a flex or grid container', () => {
  // The design's own root is a height:100vh grid with an `auto minmax(0,1fr)`
  // column pair. Making the mount point a flex/grid container turns that root
  // into a non-growing item and the 1fr column collapses to content width,
  // leaving dead space to the right of the page.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const rule = /body\.studio-active\s+#studio\s*\{([^}]*)\}/.exec(html);
  assert.ok(rule, 'the mount point has a visibility rule');
  assert.doesNotMatch(rule[1], /display:\s*(flex|grid)/, 'must stay a plain block');
});

test('the generated root still relies on being a full-height grid', () => {
  // If a re-import changes this, the mount rule above needs revisiting.
  const css = fs.readFileSync(path.join(ROOT, 'src/public/studio-styles.generated.css'), 'utf8');
  const root = /\.s0\{([^}]*)\}/.exec(css);
  assert.ok(root, 'the root class is emitted');
  assert.match(root[1], /display: grid/);
  assert.match(root[1], /height: 100vh/);
});

// ── editor fields that used to be discarded ───────────────────────────────

test('grain, warmth and crop zoom survive template sanitisation', async () => {
  const templates = await import('../src/templates.js');
  const out = templates.sanitiseTemplate({ name: 'T', grain: 40, warm: -25, smartFramingZoom: 1.6 }, { id: 't' });
  assert.equal(out.grain, 40, 'grain is kept');
  assert.equal(out.warm, -25, 'warmth is kept');
  assert.equal(out.smartFramingZoom, 1.6, 'zoom is kept');
});

test('the new editor fields are clamped to their documented ranges', async () => {
  const templates = await import('../src/templates.js');
  const out = templates.sanitiseTemplate({ name: 'T', grain: 999, warm: -999, smartFramingZoom: 99 }, { id: 't' });
  assert.equal(out.grain, 100);
  assert.equal(out.warm, -100);
  assert.equal(out.smartFramingZoom, 2.5);
});

test('a template with none of the new fields renders unchanged', async () => {
  const templates = await import('../src/templates.js');
  const out = templates.sanitiseTemplate({ name: 'T' }, { id: 't' });
  assert.equal(out.grain, 0, 'no grain by default');
  assert.equal(out.warm, 0, 'neutral by default');
  assert.equal(out.smartFramingZoom, 1, 'untouched framing by default');
});

test('the editor supplies every binding the design asks for', () => {
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  const missing = STUDIO_BINDINGS.filter(b => !(b in vals));
  assert.deepEqual(missing, [], 'no binding is left without a supplier');
});

test('editor sliders read the template and write back in schema units', () => {
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'c1', edTab: 'look' });
  const vals = StudioAdapter.bindings({
    ...SAMPLE_STATE,
    selectedTemplate: { id: 'tpl', name: 'T', grain: 25, warm: 40, smartFramingZoom: 1.5, vignette: 0.5 },
    templates: [{ id: 'tpl', name: 'T', grain: 25, warm: 40, smartFramingZoom: 1.5, vignette: 0.5 }],
  });
  assert.equal(vals.edGrain, 25);
  assert.equal(vals.edWarmLabel, '+40', 'warmth shows its sign');
  assert.equal(vals.edZoom, 150, 'zoom is shown as a percentage');
  assert.equal(vals.edVignette, 50, 'vignette 0-1 is shown as a percentage');
});
