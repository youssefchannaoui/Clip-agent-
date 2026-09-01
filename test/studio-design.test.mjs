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
  // `missing` is every event binding the template asked for that resolved to
  // something other than a function. The runtime skips those silently, so this
  // is the only way to see a dead control without clicking it.
  return { html: out.join(''), handlers: r.handlers, missing: r.missing };
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
const templatesModule = await import('../src/templates.js');
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

// ── design-pull ────────────────────────────────────────────────────────────
// The vendored export is the input to everything else, so the pull step must
// never leave a broken one in its place.

function runPull(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-pull-'));
  const src = path.join(dir, 'export.dc.html');
  fs.writeFileSync(src, source);
  let stdout = '', stderr = '', status = 0;
  try {
    stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts/design-pull.mjs'), src],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    stdout = err.stdout || '';
    stderr = err.stderr || '';
    status = err.status;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { stdout, stderr, status };
}

const VENDORED = path.join(ROOT, 'design/studio-dashboard.dc.html');

test('an export cut before the script tag is refused without touching the vendored copy', () => {
  const good = fs.readFileSync(VENDORED, 'utf8');
  const { status, stderr } = runPull(good.slice(0, 40000));
  assert.equal(status, 1);
  assert.match(stderr, /never closes/);
  assert.equal(fs.readFileSync(VENDORED, 'utf8'), good, 'the good export survives');
});

test('an export cut mid-script is refused without touching the vendored copy', () => {
  const good = fs.readFileSync(VENDORED, 'utf8');
  const cut = good.indexOf('data-dc-script') + 3000;
  const { status, stderr } = runPull(good.slice(0, cut));
  assert.equal(status, 1);
  assert.match(stderr, /behaviour script never closes/);
  assert.equal(fs.readFileSync(VENDORED, 'utf8'), good);
});

test('a file that is not a design export is rejected outright', () => {
  const { status, stderr } = runPull('<html><body>nope</body></html>');
  assert.equal(status, 2);
  assert.match(stderr, /no <x-dc> block/i);
});

test('re-pulling the current export is a no-op', () => {
  const { status, stdout } = runPull(fs.readFileSync(VENDORED, 'utf8'));
  assert.equal(status, 0);
  assert.match(stdout, /nothing to do/);
});

// ── two bugs that made the dashboard unusable ─────────────────────────────

test('onChange compiles to the input event, not change', () => {
  // The design is React, where onChange fires per keystroke. The DOM's `change`
  // only fires on blur, so mapping it literally left the search box, the caption
  // editor and every slider reading their value only after focus moved away.
  const src = FIXTURE.replace('onClick="{{ row.click }}"', 'onChange="{{ row.type }}"');
  const { ast } = astOf(runImporter(src).js);
  const found = [];
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n && n.on) found.push(...Object.keys(n.on));
      if (n && n.ch) walk(n.ch);
    }
  })(ast);
  assert.ok(found.includes('input'), 'onChange became an input handler');
  assert.ok(!found.includes('change'), 'nothing is left listening for change');
});

test('the live template wires no change handlers at all', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  assert.ok(!js.includes('"change"'), 'a change handler would only fire on blur');
});

test('nav items do not drive hover through adapter state', () => {
  // Hover through setUI re-rendered the whole dashboard via innerHTML, replacing
  // the element under the pointer. A browser only fires `click` when mousedown
  // and mouseup land on the same element, so hovering made nav unclickable.
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  for (const item of [...vals.navHome, ...vals.navProduce, ...vals.navSetup]) {
    assert.notEqual(typeof item.enter, 'function', `${item.label} must not re-render on hover`);
    assert.notEqual(typeof item.leave, 'function', `${item.label} must not re-render on hover`);
  }
});

test('the active nav item wins over the stylesheet hover rule', () => {
  Object.assign(StudioAdapter.ui, { screen: 'queue' });
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  const active = vals.navProduce.find(n => n.label === 'Review queue');
  const idle = vals.navProduce.find(n => n.label === 'Schedule');
  // Inline !important is the one declaration a stylesheet :hover cannot override.
  assert.match(active.style, /background:[^;]*!important/);
  assert.doesNotMatch(idle.style, /!important/);
});

test('the page carries the CSS hover rule that replaced the JS one', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  assert.match(html, /#studio nav a:hover\s*\{[^}]*!important/);
});

// ── binding shapes ─────────────────────────────────────────────────────────

test('every sc-for list binding is supplied as an array', () => {
  // A string here is not a type error, it is a rendering disaster: the runtime
  // iterates it and renders one row per character. `jobNasheeds` shipped like
  // that and drew ~20 blank buttons.
  const lists = new Set();
  (function walk(nodes, scope) {
    for (const n of nodes || []) {
      if (!n || typeof n === 'string') continue;
      let inner = scope;
      if (n.t === 'for') {
        const p = n.l && n.l.p;
        if (p && !p.includes('.') && !scope.has(p)) lists.add(p);
        inner = new Set(scope); inner.add(n.as);
      }
      walk(n.ch, inner);
    }
  })(STUDIO_TEMPLATE, new Set());

  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  const wrong = [...lists].filter(name => vals[name] !== undefined && !Array.isArray(vals[name]));
  assert.deepEqual(wrong, [], 'these render one row per character');
});

test('an unknown source duration shows the whole lecture, not an empty range', () => {
  // sourceInfo() returns durationSec: null in remote processing mode, which is
  // what production runs, so this is the normal path and not an edge case.
  StudioAdapter.openJob({ url: 'https://youtu.be/x', title: 'Talk', durationSec: null });
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  assert.equal(vals.jobRangeLabel, 'Whole lecture');
  assert.match(vals.jobLenLabel, /confirmed once the worker/i);
  assert.match(vals.jobTokenLabel, /confirmed after download/i);
  assert.doesNotMatch(vals.jobBandStyle, /display: none/, 'the band fills rather than vanishing');
});

test('a known duration still gives a real range and a token estimate', () => {
  StudioAdapter.openJob({ url: 'https://youtu.be/x', title: 'Talk', durationSec: 2531 });
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  assert.equal(vals.jobRangeLabel, '0:00 – 42:11');
  assert.match(vals.jobLenLabel, /^42m selected/);
  assert.match(vals.jobTokenLabel, /^≈ 43 tokens/);
});

test('generate sends no range when the length is unknown', () => {
  StudioAdapter.openJob({ url: 'https://youtu.be/x', title: 'Talk', durationSec: null });
  let sent = 'not called';
  StudioAdapter.onGenerate = (url, range) => { sent = range; };
  StudioAdapter.bindings(SAMPLE_STATE).runGenerate({ preventDefault() {} });
  assert.equal(sent, null, 'a 0-0 range would be a lie the server must interpret');
});

// ── connections read the right part of DATA ───────────────────────────────

const SOCIAL_STATE = {
  social: {
    providers: {
      youtube: { configured: true, connected: true, accounts: [{ id: 'y1', name: 'DeenClipped' }], lastTestAt: Date.now() - 120000 },
      instagram: { configured: true, connected: true, accounts: [{ id: 'i1', name: '@deenclipped' }], lastTestError: 'Token expired' },
      facebook: { configured: true, connected: false, accounts: [] },
      tiktok: { configured: false, connected: false, accounts: [] },
    },
  },
  publishingSettings: { youtube: { enabled: true }, instagram: { enabled: false } },
  clips: [], projects: [], tracks: [], log: [], billing: { current: {} },
};

test('connections read DATA.social.providers, not DATA.social', () => {
  // Reading DATA.social.youtube returns undefined, which rendered every platform
  // as disconnected no matter what was actually linked.
  const vals = StudioAdapter.bindings(SOCIAL_STATE);
  const yt = vals.connections.find(c => c.name === 'YouTube');
  assert.equal(yt.handle, 'DeenClipped', 'the linked account name is shown');
  assert.equal(yt.note, 'Active');
});

test('all four platforms appear, including Facebook', () => {
  const names = StudioAdapter.bindings(SOCIAL_STATE).connections.map(c => c.name);
  assert.deepEqual(names.sort(), ['Facebook', 'Instagram', 'TikTok', 'YouTube']);
});

test('connected is not the same as switched on', () => {
  const vals = StudioAdapter.bindings(SOCIAL_STATE);
  const ig = vals.connections.find(c => c.name === 'Instagram');
  // Connected, but publishingSettings.instagram.enabled is false.
  assert.equal(ig.note, 'Connected — not switched on');
  assert.match(ig.dotStyle, /#E6B770/, 'amber, not green — it will not post');
});

test('Post now unblocks once a connected channel is switched on', () => {
  // The reported symptom, exactly: YouTube connected, every scheduled row
  // reading "No channel on". Anchored on the clip's own day, so an hour from
  // now still shows late in the evening.
  Object.assign(StudioAdapter.ui, { screen: 'schedule', schedAnchor: new Date(Date.now() + 3600000).setHours(0, 0, 0, 0) });
  const scheduled = on => ({
    social: { providers: { youtube: { configured: true, connected: true, accounts: [{ id: 'y1', name: 'DeenClipped' }] } } },
    publishingSettings: { enabled: on, youtube: { enabled: on } },
    directPublishingEnabled: true,
    clips: [{
      id: 'c1', projectId: 'p1', title: 'Clip', status: 'scheduled', scheduledAt: Date.now() + 3600000,
      score: 90, musicVerified: true, renderVerified: true, templateId: 't1', transcript: 'x',
      targets: [{ platform: 'youtube' }],
    }],
    projects: [{ id: 'p1', title: 'Lecture', status: 'done' }], tracks: [], log: [], billing: { current: {} },
  });
  const labels = vals => {
    const seen = new Set(), out = [];
    (function walk(v) {
      if (!v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (typeof v.postLabel === 'string') out.push(v.postLabel);
      for (const k of Object.keys(v)) walk(v[k]);
    })(vals);
    return [...new Set(out)];
  };
  assert.deepEqual(labels(StudioAdapter.bindings(scheduled(false))), ['No channel on']);
  assert.deepEqual(labels(StudioAdapter.bindings(scheduled(true))), ['Post now'],
    'switching the channel on is all that was missing');
});

test('the connections modal offers a switch, not only Connect/Disconnect', () => {
  // The reported bug: YouTube connected, every Post now button reading "No
  // channel on", and the modal saying "Connected — not switched on" while
  // offering no control that could switch it on. The binding that does it
  // (toggleConnEnabled) lived on the design's per-platform panel, which this
  // modal replaced and made unreachable.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const paint = /function paintConnections\(\)[\s\S]*?\n    }\n/.exec(html)[0];
  assert.match(paint, /data-conn-toggle/, 'each row carries a switch');
  assert.match(paint, /role="switch"/);
  assert.match(paint, /aria-checked="\$\{on\}"/, 'the switch reflects the real state');
  assert.match(paint, /StudioAdapter\.onPublishingToggle\(p\.key/, 'and it is wired');
  assert.match(paint, /\$\$\('\[data-conn-toggle\]'\)\.forEach/, 'to every row, not just the first');
});

test('Post now with a connected but switched-off channel opens the switch', () => {
  // A toast naming a "Channels" screen was the whole remedy, and no screen by
  // that name exists in the nav.
  const adapter = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  const guard = /if \(!activeCount\) \{[\s\S]*?\n                \}/.exec(adapter)[0];
  assert.match(guard, /onOpenConnections/, 'the panel with the switch is opened');
  assert.doesNotMatch(guard, /under Channels/, 'no screen by that name exists');
});

test('a channel switched on but disconnected does not count as postable', () => {
  const vals = StudioAdapter.bindings({
    ...SOCIAL_STATE,
    social: { providers: { youtube: { configured: true, connected: false, accounts: [] } } },
    publishingSettings: { youtube: { enabled: true } },
  });
  const yt = vals.connections.find(c => c.name === 'YouTube');
  assert.equal(yt.note, 'Connect to publish', 'enabled alone is not enough');
});

test('an unconfigured platform says so rather than offering to connect', () => {
  const vals = StudioAdapter.bindings(SOCIAL_STATE);
  const tt = vals.connections.find(c => c.name === 'TikTok');
  assert.equal(tt.note, 'Not configured on the server');
  assert.equal(tt.handle, 'Needs API keys');
});

test('a failed connection test is not hidden behind its timestamp', () => {
  // The server sets lastTestAt on failure too, so checking the timestamp first
  // reports "Checked 2m ago" and never shows the error.
  Object.assign(StudioAdapter.ui, { connProvider: 'instagram' });
  const vals = StudioAdapter.bindings(SOCIAL_STATE);
  assert.match(vals.connNote, /Last check failed: Token expired/);
});

test('the modal warns that Instagram and Facebook share one connection', () => {
  Object.assign(StudioAdapter.ui, { connProvider: 'instagram' });
  assert.equal(StudioAdapter.bindings(SOCIAL_STATE).connShared, true);
  Object.assign(StudioAdapter.ui, { connProvider: 'youtube' });
  assert.equal(StudioAdapter.bindings(SOCIAL_STATE).connShared, false);
});

test('disconnecting Meta is flagged as affecting both platforms', () => {
  Object.assign(StudioAdapter.ui, { connProvider: 'facebook' });
  let args = null;
  StudioAdapter.onDisconnect = (oauth, shared) => { args = { oauth, shared }; };
  StudioAdapter.bindings(SOCIAL_STATE).disconnect({ preventDefault() {} });
  assert.deepEqual(args, { oauth: 'meta', shared: true });
});

// ── failures and in-flight work ───────────────────────────────────────────

const BROKEN_STATE = {
  projects: [
    { id: 'p1', title: 'Failed lecture', status: 'failed', error: 'yt-dlp failed: https://x.y/z blocked', submittedAt: Date.now() - 60000 },
    { id: 'p2', title: 'Running lecture', status: 'processing', stage: 'Transcribing audio', progress: 40, startedAt: Date.now() - 30000 },
  ],
  clips: [
    { id: 'c1', projectId: 'p2', title: 'Bad upload', status: 'publish_failed', targets: [{ provider: 'tiktok', status: 'failed', error: 'Token expired', updatedAt: Date.now() }] },
    { id: 'c2', projectId: 'p2', title: 'Uploading', status: 'scheduled', scheduledAt: Date.now() + 1000, targets: [{ provider: 'youtube', status: 'publishing', progressPercent: 60, updatedAt: Date.now() }] },
  ],
  rerenderJobs: [{ id: 'r1', clipId: 'c1', status: 'failed', error: 'render crashed', createdAt: Date.now() - 5000 }],
  tracks: [], log: [{ level: 'info', message: 'Something happened', at: Date.now() }],
  social: { providers: {} }, billing: { current: {} },
};

test('failed work reaches the activity feed instead of vanishing', () => {
  Object.assign(StudioAdapter.ui, { activityAll: false });
  const vals = StudioAdapter.bindings(BROKEN_STATE);
  const text = vals.activity.map(a => a.text).join(' | ');
  assert.match(text, /Failed lecture needs attention/);
  assert.match(text, /Publish failed · Bad upload/);
  assert.match(text, /Edit failed · Bad upload/);
});

test('failures lead the feed and are tagged', () => {
  const vals = StudioAdapter.bindings(BROKEN_STATE);
  assert.equal(vals.activity[0].tag, 'Failed', 'a failure outranks an info log line');
  assert.match(vals.activity[0].iconStyle, /#E3928C/);
});

test('error text is stripped of URLs and kept to one line', () => {
  const vals = StudioAdapter.bindings(BROKEN_STATE);
  const lecture = vals.activity.find(a => /Failed lecture/.test(a.text));
  assert.doesNotMatch(lecture.meta, /https?:/);
  assert.match(lecture.meta, /yt-dlp failed/);
});

test('the badge counts failures as well as clips awaiting review', () => {
  const vals = StudioAdapter.bindings(BROKEN_STATE);
  // 3 failures, 0 clips waiting in this fixture.
  assert.equal(vals.activityNeedsYou, '3 need you');
});

test('live work tracks renders and uploads, not only lectures', () => {
  const vals = StudioAdapter.bindings(BROKEN_STATE);
  const labels = vals.liveAll.map(i => i.label).join(' | ');
  assert.match(labels, /Running lecture/, 'a processing lecture');
  assert.match(labels, /Uploading → YouTube/, 'an upload in flight');
  assert.ok(vals.liveCount > 0);
});

test('live work is empty when nothing is running', () => {
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [] });
  assert.equal(vals.liveCount, 0);
  assert.deepEqual(vals.liveAll, []);
  assert.deepEqual(vals.liveItems, []);
});

test("the design's own floating dock stays off on every screen", () => {
  // Live work is drawn by the host instead — a stable docked section on Home
  // and one compact bar everywhere else. Leaving this binding true rendered a
  // second, unstyled bar underneath the real one.
  for (const screen of ['home', 'schedule', 'queue', 'library', 'templates']) {
    StudioAdapter.ui.screen = screen;
    assert.equal(StudioAdapter.bindings(BROKEN_STATE).liveDock, false, screen);
  }
  StudioAdapter.ui.screen = 'home';
});

test('every live row carries a percentage, an ETA and a progress bar', () => {
  // The floating bar and the Home section both read these. `text`/`textStyle`
  // were missing once and every row of the bar rendered unstyled.
  const vals = StudioAdapter.bindings(BROKEN_STATE);
  assert.ok(vals.liveAll.length, 'fixture has work in flight');
  for (const row of vals.liveAll) {
    for (const key of ['label', 'title', 'stage', 'percent', 'eta', 'text', 'textStyle', 'meta', 'barStyle', 'icon', 'iconStyle']) {
      assert.ok(key in row, `live row is missing ${key}`);
      assert.equal(typeof row[key], 'string', `${key} must be a string`);
    }
    assert.match(row.barStyle, /width: \d+%/, 'the bar needs a width to draw');
    if (row.percent) assert.match(row.percent, /^\d{1,3}%$/);
  }
});

test('a lecture is never headed by its own URL', () => {
  // submitVideo used to store the URL as the title, and the worker only replaces
  // it when the job finishes — so a running lecture was headed
  // "https://www.youtube.com/watch?v=..." for its entire run, which is exactly
  // the window Happening now covers.
  const titleOf = p => StudioAdapter.bindings({
    projects: [{ id: 'p', status: 'processing', stage: 'Transcribing', progress: 40, submittedAt: Date.now(), ...p }],
    clips: [], tracks: [],
  }).liveAll[0].title;
  assert.equal(titleOf({ title: 'https://www.youtube.com/watch?v=abc' }), 'Untitled lecture');
  assert.equal(titleOf({ title: 'https://youtu.be/abc', sourceTitle: 'E68: The Matrix' }), 'E68: The Matrix',
    'the fetched title is preferred over the link');
  assert.equal(titleOf({ title: 'The Night Prayer' }), 'The Night Prayer');
  assert.equal(titleOf({}), 'Untitled lecture');
  // Only a leading scheme counts, or a legitimate title would be thrown away.
  assert.equal(titleOf({ title: 'Why http matters' }), 'Why http matters');
});

test('submitting a lecture does not bake the URL into the record', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'src/local-engine.js'), 'utf8');
  assert.match(engine, /title: String\(title \|\| ''\)\.trim\(\) \|\| sourceMeta\?\.title \|\| ''/,
    'the preflight title is used, and an empty string left for the read path to resolve');
});

// ── the per-clip breakdown behind "Rendering clip 2 of 4" ──────────────────

const rendering = extra => StudioAdapter.bindings({
  projects: [{
    id: 'p', title: 'Lecture', status: 'processing', stage: 'Rendering clip 2 of 4',
    progress: 80, etaSec: 300, submittedAt: Date.now(), ...extra,
  }],
  clips: [], tracks: [],
}).liveAll[0];

test('a rendering lecture breaks down into one line per clip', () => {
  const row = rendering({
    currentClip: 2, totalClips: 4, clipPercent: 37,
    clipPlan: [{ index: 1, title: 'On patience' }, { index: 2, title: 'The night prayer' },
      { index: 3, title: 'Sincerity' }, { index: 4, title: 'Gratitude' }],
  });
  assert.equal(row.hasClips, true);
  assert.equal(row.clipCount, 4);
  assert.equal(row.clipsLabel, '1 of 4 done');
  assert.deepEqual(row.clips.map(c => [c.title, c.state, c.percent]), [
    ['On patience', 'Done', '100%'],
    ['The night prayer', 'Rendering', '37%'],
    ['Sincerity', 'Queued', ''],
    ['Gratitude', 'Queued', ''],
  ]);
});

test('a clip that has not started shows no percentage rather than a fake one', () => {
  // Clips render strictly in order, so done/rendering/queued is a fact. Only the
  // current clip's percentage is a measurement, and only the worker has it.
  const row = rendering({ currentClip: 2, totalClips: 4, clipPercent: 37 });
  const queued = row.clips.filter(c => c.state === 'Queued');
  assert.equal(queued.length, 2);
  for (const c of queued) {
    assert.equal(c.percent, '', 'no invented percentage');
    assert.match(c.barStyle, /width: 0%/, 'and an empty bar, not a full one');
  }
  // With no clipPercent at all — an older worker — the running clip says so
  // without claiming a figure.
  const noPct = rendering({ currentClip: 2, totalClips: 4 });
  assert.equal(noPct.clips[1].state, 'Rendering');
  assert.equal(noPct.clips[1].percent, '');
  assert.equal(noPct.clips[0].percent, '100%', 'a finished clip is genuinely finished');
});

test('the breakdown works from the stage text before the worker is rebuilt', () => {
  // The deployed worker announces "Rendering clip 2 of 4" in its stage but does
  // not send the fields. Reading the stage means this works without a redeploy.
  const row = rendering({});
  assert.equal(row.clipCount, 4);
  assert.deepEqual(row.clips.map(c => c.state), ['Done', 'Rendering', 'Queued', 'Queued']);
  assert.equal(row.clips[0].title, 'Clip 1', 'named by number when no plan was sent');
});

test('a lecture that is not rendering has no breakdown', () => {
  for (const stage of ['Transcribing audio', 'Importing the lecture', 'Finding and scoring clips']) {
    const row = rendering({ stage });
    assert.equal(row.hasClips, false, stage);
    assert.deepEqual(row.clips, []);
  }
});

test('a long clip list scrolls instead of pushing the page around', () => {
  assert.equal(rendering({ currentClip: 1, totalClips: 6 }).clipsScroll, false);
  assert.equal(rendering({ currentClip: 1, totalClips: 7 }).clipsScroll, true);
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const rule = /\.slc-list\.scroll \{[^}]*\}/.exec(html)[0];
  assert.match(rule, /overflow-y: auto/);
  assert.match(rule, /max-height/);
});

test('the clip list is remembered per surface, not per lecture', () => {
  // Home opens by default and the floating bar stays a bar. Keying on the title
  // alone meant opening it on Home silently opened it in the bar too.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  assert.match(html, /function clipKey\(r,onHome\)\{return \(onHome\?'home':'bar'\)\+'\|'\+r\.title\}/);
  assert.match(html, /const seen=clipsOpen\[clipKey\(r,onHome\)\]/);
  assert.match(html, /seen===undefined\?Boolean\(onHome\):seen/, 'Home defaults open, the bar closed');
  assert.match(html, /data-clips="\$\{esc\(clipKey\(r,onHome\)\)\}"/);
});

test('opening a clip list does not restart the spinners', () => {
  // Expansion changes the structure, so it has to be in the key — but the
  // running clip's percentage must not be, or every update rebuilds the list.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const key = /function liveKey\(rows,onHome\)\{[\s\S]*?\n    \}/.exec(html)[0];
  assert.match(key, /r\.clipCount\|\|0/);
  assert.match(key, /clipsAreOpen\(r,onHome\)\?1:0/);
  assert.doesNotMatch(key, /clipPercent|percent/, 'a moving number must not rebuild the list');
  // And the open list is updated in place.
  const paint = /function paintRows\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.match(paint, /querySelectorAll\('\.slc-row'\)/);
});

test('the import reports how much has actually downloaded', () => {
  // A percentage alone gives no sense of whether a slow-looking import is a
  // large file or a broken one.
  const row = (bytesDone, bytesTotal) => StudioAdapter.bindings({
    projects: [{ id: 'p', title: 'Talk', status: 'processing', stage: 'Importing', progress: 5, bytesDone, bytesTotal, submittedAt: Date.now() }],
    clips: [], tracks: [],
  }).liveAll[0];
  assert.equal(row(149_000_000, 398_000_000).transfer, '142 MB of 380 MB');
  assert.match(row(149_000_000, 398_000_000).meta, /Importing · 142 MB of 380 MB/);
  // A server that sends no Content-Length is common; it must not print "of 0".
  assert.equal(row(149_000_000, null).transfer, '142 MB');
  assert.equal(row(149_000_000, 0).transfer, '142 MB');
  // Absent entirely outside the import, rather than a frozen figure.
  assert.equal(row(null, null).transfer, '');
  assert.equal(row(undefined, undefined).meta, 'Importing');
});

test('download sizes are reported in units that match the file on disk', () => {
  const row = bytes => StudioAdapter.bindings({
    projects: [{ id: 'p', title: 'T', status: 'processing', stage: 'Importing', progress: 5, bytesDone: bytes, submittedAt: Date.now() }],
    clips: [], tracks: [],
  }).liveAll[0].transfer;
  assert.equal(row(900), '900 B');
  assert.equal(row(2048), '2 KB');
  assert.equal(row(5_242_880), '5 MB');
  assert.equal(row(3_221_225_472), '3.0 GB', 'a long import is the case this exists for');
});

test('an ETA is rendered in human units, and absent when unknown', () => {
  const at = Date.now();
  const etaFor = extra => StudioAdapter.bindings({
    projects: [Object.assign({ id: 'p', title: 'Talk', status: 'processing', submittedAt: at }, extra)],
    clips: [], tracks: [],
  }).liveAll[0].eta;
  // Minutes: an hour-long lecture mid-transcription.
  assert.match(etaFor({ stage: 'Transcribing', phase: 'transcribe', progress: 36, durationSec: 3600, clipsRequested: 3 }),
    /^\d+ min left$/);
  // Hours: a three-hour lecture with a big clip order, honestly.
  assert.match(etaFor({ stage: 'importing', phase: 'importing', progress: 3, durationSec: 10800, clipsRequested: 10 }),
    /^\d+ min left$|^\dh( \d+m)? left$/);
  // About a minute: the last clip nearly done.
  assert.equal(etaFor({ stage: 'Rendering clip 3 of 3', phase: 'render', progress: 97, durationSec: 3600,
    clipsRequested: 3, currentClip: 3, totalClips: 3, clipPercent: 95 }), 'about a minute left');
  // Unknown length: nothing rather than "NaN" or a fiction.
  assert.equal(etaFor({ stage: 'importing', phase: 'importing', progress: 3, durationSec: 0 }), '');
});

test('the queue expander appears only when more than one thing is running', () => {
  const one = StudioAdapter.bindings({
    projects: [{ id: 'p', title: 'Talk', status: 'processing', stage: 'Transcribing', progress: 10, submittedAt: Date.now() }],
    clips: [], tracks: [],
  });
  assert.equal(one.liveMore, false, 'one job needs no queue button');
  const many = StudioAdapter.bindings(BROKEN_STATE);
  if (many.liveCount > 1) {
    assert.equal(many.liveMore, true);
    assert.match(many.liveMoreLabel, /^\+\d+ more$/);
  }
});

test('a source the server refuses is reported, not silently swallowed', () => {
  // POST /api/videos answers 200 even when it refused the source; the reason is
  // per-URL inside results[]. Treating 200 as success closed the panel and
  // queued nothing, with no explanation.
  StudioAdapter.openJob({ url: 'https://youtu.be/x', title: 'Talk', durationSec: null });
  StudioAdapter.jobFailed('Music is required on every clip. Upload at least one nasheed first.');
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  assert.ok(StudioAdapter.ui.job, 'the panel stays open so the reason is visible');
  // genBusy gates the message row, NOT the button. Asserting it false here is
  // what kept the reason unrenderable: jobFailed clears `generating` in the
  // same call that sets the text, so the row unmounted before it could show.
  assert.equal(vals.genBusy, true, 'the row carrying the reason has to be mounted');
  assert.equal(vals.genLabel, 'Generate clips', 'and the button is usable again');
  assert.match(vals.genProgressLabel, /Upload at least one nasheed/);
});

test('the page checks results[] rather than trusting the status code', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const call = /StudioAdapter\.onGenerate\s*=[\s\S]*?'Lecture queued'/.exec(html)[0];
  assert.match(call, /results/, 'per-URL errors are inspected');
  assert.match(call, /throw new Error/, 'and surfaced');
});

// ── no dead controls ───────────────────────────────────────────────────────
// studio-runtime.js drops a handler that is not a function, silently: the element
// still renders, styled and cursor:pointer, with no listener. Nothing else
// catches that — design:check only validates top-level bindings, and these are
// loop-scoped item properties. So walk the rendered AST and assert every handler
// actually resolves.

const RICH_STATE = {
  user: { name: 'Y', email: 'y@x.com' },
  projects: [
    { id: 'p1', title: 'L', status: 'done', clipCount: 2, durationSec: 2400, submittedAt: Date.now(), progress: 100 },
    // In-flight work, so the live dock and its rows are actually exercised.
    // Without this the guard skipped them entirely and missed missing bindings.
    { id: 'p2', title: 'Running', status: 'processing', phase: 'render', stage: 'Rendering', progress: 40, startedAt: Date.now() },
  ],
  clips: [
    { id: 'c1', projectId: 'p1', title: 'C', status: 'waiting', score: 70, durationMs: 30000, transcript: 'a. b.', targets: [] },
    { id: 'c2', projectId: 'p1', title: 'D', status: 'scheduled', score: 60, durationMs: 30000, scheduledAt: Date.now() + 3600e3, targets: [{ provider: 'youtube', status: 'scheduled' }] },
    { id: 'c3', projectId: 'p1', title: 'Uploading', status: 'scheduled', score: 55, durationMs: 30000, scheduledAt: Date.now() + 7200e3, targets: [{ provider: 'youtube', status: 'publishing', progressPercent: 60, updatedAt: Date.now() }] },
  ],
  rerenderJobs: [{ id: 'r1', clipId: 'c1', status: 'processing', stage: 'Re-rendering', progress: 25, startedAt: Date.now() }],
  tracks: [{ id: 't1', name: 'N', durationSec: 120 }],
  templates: [{ id: 'x', name: 'X' }], selectedTemplate: { id: 'x', name: 'X' },
  clipSettings: { clipsPerVideo: 6, clipMinSeconds: 30, clipMaxSeconds: 45 },
  musicSettings: { volumePercent: 13 }, automationSettings: { skipQuotes: true },
  log: [{ level: 'info', message: 'm', at: Date.now() }],
  social: { providers: { youtube: { configured: true, connected: true, accounts: [{ id: 'a', name: 'A' }] } } },
  publishingSettings: { youtube: { enabled: true } },
  billing: { current: { plan: 'free' }, plans: [{ id: 'free', name: 'Free' }], tokenRatePerMinute: 1 },
};

// Nav hover is deliberately null: driving it from JS re-rendered the dashboard on
// mouseover and made every tab unclickable. Documented, tested, intentional.
const ALLOWED_NULL = new Set(['item.enter', 'item.leave']);

function deadControls() {
  const { evalValue } = globalThis.StudioRuntime._internals;
  const dead = new Set();
  for (const screen of ['home', 'queue', 'library', 'detail', 'schedule', 'templates', 'music', 'language', 'performance', 'tokens', 'editor']) {
    Object.assign(StudioAdapter.ui, {
      screen, edClipId: 'c1', connProvider: 'youtube', bellOpen: true, menuOpen: true, countsOpen: true, edTab: 'captions',
      sheet: { title: 't', subtitle: 's', options: ['A', 'B'], cb() {} },
      job: { url: 'u', title: 't', durationSec: 0, durationKnown: false, start: 0, end: 0 },
      playerClip: { title: 'p' },
    });
    const vals = StudioAdapter.bindings(RICH_STATE);
    (function walk(nodes, scope) {
      for (const n of nodes || []) {
        if (!n || typeof n === 'string') continue;
        let inner = scope;
        if (n.t === 'for') {
          const list = evalValue(n.l, scope);
          const arr = Array.isArray(list) ? list : [];
          // An empty list renders no rows, so its controls cannot be dead.
          // Walking into the body with the outer scope invents failures.
          if (!arr.length) continue;
          inner = Object.create(scope); inner[n.as] = arr[0];
        }
        if (n.on) {
          for (const [evt, expr] of Object.entries(n.on)) {
            const path = expr.p || JSON.stringify(expr);
            if (ALLOWED_NULL.has(path)) continue;
            if (typeof evalValue(expr, inner) !== 'function') dead.add(`${path} (${evt} on <${n.tag}>)`);
          }
        }
        walk(n.ch, inner);
      }
    })(STUDIO_TEMPLATE, vals);
  }
  return [...dead].sort();
}

test('every control in the template has a handler that resolves to a function', () => {
  assert.deepEqual(deadControls(), [], 'these render as normal buttons and do nothing');
});

test('every bound style resolves to something', () => {
  // The same silent-drop class as dead handlers, but for appearance: the Home
  // connection dots bound `heroDotStyle` while the adapter supplied `dotStyle`,
  // so the dot rendered with no style at all and never appeared once connected.
  const { evalValue } = globalThis.StudioRuntime._internals;
  const unstyled = new Set();
  for (const screen of ['home', 'queue', 'library', 'detail', 'schedule', 'templates', 'music', 'language', 'performance', 'tokens', 'editor']) {
    Object.assign(StudioAdapter.ui, {
      screen, edClipId: 'c1', connProvider: 'youtube', bellOpen: true, menuOpen: true, countsOpen: true, edTab: 'captions',
      sheet: { title: 't', subtitle: 's', options: ['A'], cb() {} },
      job: { url: 'u', title: 't', durationSec: 0, durationKnown: false, start: 0, end: 0 },
      playerClip: { title: 'p' },
    });
    const vals = StudioAdapter.bindings(RICH_STATE);
    (function walk(nodes, scope) {
      for (const n of nodes || []) {
        if (!n || typeof n === 'string') continue;
        let inner = scope;
        if (n.t === 'for') {
          const list = evalValue(n.l, scope);
          const arr = Array.isArray(list) ? list : [];
          if (!arr.length) continue;
          inner = Object.create(scope); inner[n.as] = arr[0];
        }
        if (n.st) {
          const value = evalValue(n.st, inner);
          if (value === undefined || value === null || value === '') unstyled.add(`${n.st.p || '?'} (style on <${n.tag}>)`);
        }
        walk(n.ch, inner);
      }
    })(STUDIO_TEMPLATE, vals);
  }
  assert.deepEqual([...unstyled].sort(), [], 'these render unstyled and are usually invisible');
});

test('no StudioAdapter hook is assigned twice', () => {
  // Two assignments meant last-write-wins, and the loser was the correct one:
  // onClipSettings shipped unmerged, so every clip-length change 400d with
  // "Clips per video must be between 1 and 30."
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const counts = {};
  for (const m of html.matchAll(/StudioAdapter\.(on[A-Za-z]+)\s*=/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const dupes = Object.entries(counts).filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dupes, [], 'a second assignment silently replaces the first');
});

test('generated CSS asset paths resolve from the site root', () => {
  // The design writes repo-relative paths; served from /, they 404.
  const css = fs.readFileSync(path.join(ROOT, 'src/public/studio-styles.generated.css'), 'utf8');
  assert.doesNotMatch(css, /url\(['"]?src\/public\//, 'repo-relative asset path would 404');
  assert.doesNotMatch(css, /@import url\("https:\/\/[^/"]+"\)/, 'a bare origin is a preconnect hint, not a stylesheet');
});

test('a finished lecture reads as ready, not stuck processing', () => {
  // The engine finishes a project as `done`; `ready` is a clip status. Matching
  // only `ready` left every completed lecture showing PROCESSING forever.
  Object.assign(StudioAdapter.ui, { screen: 'library', libFilter: 'all' });
  const vals = StudioAdapter.bindings({
    projects: [{ id: 'p', title: 'L', status: 'done', clipCount: 4, progress: 100, submittedAt: Date.now() }],
    clips: [], tracks: [],
  });
  assert.equal(vals.libraryItems[0].stateChip, 'Ready');
  assert.equal(vals.libTabs.find(t => t.label === 'Ready').count, 1);
  assert.equal(vals.libTabs.find(t => t.label === 'Processing').count, 0);
  assert.equal(vals.liveDock, false, 'a finished lecture must not stay pinned in the live dock');
});

test('the ETA is a stage model, and cannot balloon while the bar holds still', () => {
  // The old estimator extrapolated the whole job from the global percentage's
  // speed. The import holds 3% for minutes, so a customer watched "5 min left"
  // grow into "2h left" on a healthy job -- the exact number that makes someone
  // close the tab. The model reads source length, clip count and stage instead,
  // so a still bar changes nothing.
  Object.assign(StudioAdapter.ui, { screen: 'queue' });
  const rowFor = extra => StudioAdapter.bindings({
    projects: [Object.assign({
      id: 'p', title: 'L', status: 'processing', engine: 'remote',
      durationSec: 3600, clipsRequested: 3, submittedAt: Date.now(),
    }, extra)],
    clips: [], tracks: [],
  }).liveAll[0];

  // Importing at a motionless 3%: the answer is the whole pipeline's cost for
  // an hour-long lecture -- bounded, not a 2-hour hallucination.
  const importing = rowFor({ stage: 'importing', phase: 'importing', progress: 3 });
  assert.match(importing.text, /min left/, 'an ETA is shown');
  assert.doesNotMatch(importing.text, /h left|h \d+m left/, 'never hours for one lecture');
  // Ten minutes later, same 3%: the model does not learn despair from a clock.
  const later = rowFor({ stage: 'importing', phase: 'importing', progress: 3 });
  assert.equal(later.text, importing.text, 'a still bar does not grow the number');

  // Rendering clip 2 of 3 at 50%: half a clip and the tail remain.
  const rendering = rowFor({ stage: 'Rendering clip 2 of 3', phase: 'render', progress: 85,
    currentClip: 2, totalClips: 3, clipPercent: 50 });
  assert.match(rendering.text, /50% of this step/, 'the step percentage is visible');
  assert.match(rendering.text, /[1-5] min left/, 'minutes, not a guess');

  // Transcribing mid-band shows movement inside the step.
  const transcribing = rowFor({ stage: 'Transcribing', phase: 'transcribe', progress: 36 });
  assert.match(transcribing.text, /\d+% of this step/);

  // No known duration -> no invented countdown.
  const unknown = rowFor({ stage: 'importing', phase: 'importing', progress: 3, durationSec: 0 });
  assert.doesNotMatch(unknown.text, /left/, 'no number is better than a fiction');
});

test('dismissing a notification also clears the badge behind it', () => {
  // The badge counted failures straight off the data, so clearing every row
  // left "1 need you" over an empty list -- a notification that cannot be got
  // rid of, which is what dismissing exists to prevent.
  Object.assign(StudioAdapter.ui, { screen: 'home', bellOpen: true, activityAll: true, activityDetail: null });
  const data = {
    projects: [{ id: 'p', title: 'L', status: 'failed', error: 'This video is unavailable.',
                 submittedAt: Date.now(), updatedAt: Date.now() }],
    clips: [], tracks: [],
  };

  const before = StudioAdapter.bindings(data);
  assert.equal(before.activity.length, 1);
  assert.equal(before.activityUnread, 1, 'a fresh failure lights the bell');

  before.activity[0].dismiss({ stopPropagation() {}, preventDefault() {} });
  const after = StudioAdapter.bindings(data);
  assert.equal(after.activity.length, 0, 'the row is gone');
  assert.equal(after.activityUnread, 0, 'and so is the badge that pointed at it');
  // The header's own count is a second opinion that used to disagree: it read
  // failures straight off the data, so the popover said "1 need you" over an
  // empty list.
  assert.match(after.activityNeedsYou, /^0 need you/, 'the header agrees with the list');
  assert.equal(after.hasDismissed, true, 'but it can still be brought back');

  after.restoreActivity({ stopPropagation() {}, preventDefault() {} });
  const restored = StudioAdapter.bindings(data);
  assert.equal(restored.activity.length, 1, 'restoring returns the row');
  assert.equal(restored.activityUnread, 1, 'and the badge with it');

  restored.clearAllActivity({ stopPropagation() {}, preventDefault() {} });
  Object.assign(StudioAdapter.ui, { bellOpen: false, activityAll: false, activityDetail: null });
});

test('a failure explains itself, and a vendor outage is not blamed on the video', () => {
  // The bell used to show a truncated raw error and nothing else, so a customer
  // had no way to tell "this video is private" from "our supplier is down" --
  // two failures whose only sensible responses are opposites.
  Object.assign(StudioAdapter.ui, { screen: 'home', bellOpen: true, activityAll: true, activityDetail: null });
  const openFirst = error => {
    const data = {
      projects: [{ id: 'p', title: 'L', status: 'failed', error, submittedAt: Date.now(), updatedAt: Date.now() }],
      clips: [], tracks: [],
    };
    const row = StudioAdapter.bindings(data).activity[0];
    assert.ok(row, 'a failed lecture reaches the bell');
    Object.assign(StudioAdapter.ui, { activityDetail: row.id });
    return StudioAdapter.bindings(data);
  };

  const outage = openFirst('SocialKit accepted the job but never started delivering it (8m 00s with no progress).');
  assert.match(outage.activityDetailHeading, /import service is not responding/i);
  assert.match(outage.activityDetailCause, /outage on their side/i);
  assert.match(JSON.stringify(outage.activityDetailFixes), /Upload MP4/i,
    'the one path that still works must be the first thing offered');

  // The neighbouring cause must not be swallowed by the new pattern.
  const blocked = openFirst('Sign in to confirm you are not a bot.');
  assert.match(blocked.activityDetailHeading, /YouTube blocked our server/i);

  const gone = openFirst('This video is unavailable.');
  assert.match(gone.activityDetailHeading, /not available to download/i);

  Object.assign(StudioAdapter.ui, { bellOpen: false, activityAll: false, activityDetail: null });
});

test('a failed or cancelled lecture never reads as READY on home', () => {
  // Home collapsed lecState's three answers into processing-or-not, so the two
  // states a customer most needs to see -- failed and cancelled -- were both
  // labelled READY in green. The only hint was the "0 clips" beside it, which
  // reads as "no clips yet" rather than "this did not work".
  Object.assign(StudioAdapter.ui, { screen: 'home' });
  const chipFor = status => StudioAdapter.bindings({
    projects: [{ id: 'p', title: 'L', status, clipCount: 0, submittedAt: Date.now() }],
    clips: [], tracks: [],
  }).lectures[0];

  assert.equal(chipFor('failed').chip, 'Failed');
  assert.equal(chipFor('cancelled').chip, 'Cancelled');
  assert.equal(chipFor('done').chip, 'Ready');
  assert.equal(chipFor('processing').chip, 'Processing');
  // Green is the signal a customer scans for; a failure must not borrow it.
  assert.match(chipFor('failed').chipStyle, /#E27C7C/, 'a failure is not green');
  assert.doesNotMatch(chipFor('cancelled').chipStyle, /#7FD1A6/);
});

test('the pipeline rail follows the worker phase, in order', () => {
  Object.assign(StudioAdapter.ui, { screen: 'queue' });
  const at = phase => {
    const vals = StudioAdapter.bindings({
      projects: [{ id: 'p', title: 'L', status: 'processing', phase, stage: 'Working', progress: 50 }],
      clips: [], tracks: [],
    });
    return vals.stages.findIndex(s => /circle-notch/.test(s.icon));
  };
  assert.deepEqual(
    ['import', 'transcribe', 'score', 'render', 'verify'].map(at),
    [0, 1, 2, 3, 4],
    'every phase lights its own step',
  );
});

test('a record with no phase starts the rail rather than guessing from words', () => {
  Object.assign(StudioAdapter.ui, { screen: 'queue' });
  const vals = StudioAdapter.bindings({
    projects: [{ id: 'p', title: 'L', status: 'processing', stage: 'Verifying rendered clips', progress: 50 }],
    clips: [], tracks: [],
  });
  assert.equal(vals.stages.findIndex(s => /circle-notch/.test(s.icon)), 0);
});

test('a slider drag produces one write, not one per step', async () => {
  // Each write used to queue a re-render for every unposted clip, and each of
  // those re-downloads the whole source on a single-slot worker.
  let writes = 0;
  // In the editor a slider writes to the clip, not the shared style.
  StudioAdapter.onClipStyle = () => { writes += 1; };
  StudioAdapter.onTemplateField = () => { throw new Error('the editor must not write the shared template'); };
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'c1', edTab: 'captions', edStyleDraft: null, edStyleTimer: null });
  const state = { ...SAMPLE_STATE, templates: [{ id: 'x', name: 'X', captionFontSize: 96 }], selectedTemplate: { id: 'x', name: 'X', captionFontSize: 96 } };
  for (let i = 0; i < 25; i += 1) StudioAdapter.bindings(state).setSize({ target: { value: String(60 + i) } });
  assert.equal(writes, 0, 'nothing is sent while the pointer is still moving');
  await new Promise(r => setTimeout(r, 700));
  assert.equal(writes, 1, 'one write once it settles');
});

test('a slider on the Templates screen still writes the shared style', async () => {
  // The router must not send template edits to a clip: the Templates screen is
  // where a look is meant to change everywhere.
  let templateWrites = 0;
  let clipWrites = 0;
  StudioAdapter.onTemplateField = () => { templateWrites += 1; };
  StudioAdapter.onClipStyle = () => { clipWrites += 1; };
  Object.assign(StudioAdapter.ui, { screen: 'templates', edClipId: null, tplDraft: null, tplTimer: null });
  const state = { ...SAMPLE_STATE, templates: [{ id: 'x', name: 'X', captionFontSize: 96 }], selectedTemplate: { id: 'x', name: 'X', captionFontSize: 96 } };
  StudioAdapter.bindings(state).setSize({ target: { value: '70' } });
  await new Promise(r => setTimeout(r, 700));
  assert.equal(templateWrites, 1);
  assert.equal(clipWrites, 0, 'the Templates screen must not write a single clip');
  StudioAdapter.onClipStyle = () => {};
  StudioAdapter.onTemplateField = () => {};
});

test('a slider shows its new value immediately, before the write lands', () => {
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'c1', tplDraft: null, tplTimer: null });
  StudioAdapter.onTemplateField = () => {};
  const state = { ...SAMPLE_STATE, templates: [{ id: 'x', name: 'X', captionFontSize: 96 }], selectedTemplate: { id: 'x', name: 'X', captionFontSize: 96 } };
  StudioAdapter.bindings(state).setSize({ target: { value: '42' } });
  assert.equal(StudioAdapter.bindings(state).edSizeLabel, '42 px');
});

test('rejecting a clip is sent to the server, not just remembered locally', () => {
  let sent = null;
  StudioAdapter.onReject = id => { sent = id; };
  Object.assign(StudioAdapter.ui, { screen: 'queue', filter: 'review', pending: {} });
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  vals.queueClips[0].reject({ preventDefault() {} });
  assert.ok(sent, 'a reviewed batch has to survive a reload');
});

test('a clip the server marks rejected stays rejected', () => {
  Object.assign(StudioAdapter.ui, { screen: 'queue', filter: 'all', pending: {} });
  const vals = StudioAdapter.bindings({
    ...SAMPLE_STATE,
    clips: [{ id: 'r1', projectId: 'p1', title: 'Rejected one', status: 'rejected', score: 50, durationMs: 1000, targets: [] }],
  });
  assert.equal(vals.queueClips[0].stateChip, 'Rejected');
});

test('a clip scheduled in the past gets its own row instead of vanishing', () => {
  // The rail badge counted it, the grid rendered only forward from today, and
  // Home showed its time as if it were going out today.
  Object.assign(StudioAdapter.ui, { screen: 'schedule' });
  const vals = StudioAdapter.bindings({
    projects: [], tracks: [],
    clips: [{ id: 'a', title: 'Stranded', status: 'ready', scheduledAt: Date.now() - 3 * 86400000, targets: [{ provider: 'youtube', status: 'scheduled' }], musicVerified: true, renderVerified: true, templateId: 't', transcript: 'x' }],
  });
  assert.equal(vals.schedHasOverdue, true);
  assert.match(vals.schedOverdueLabel, /missed its slot/);
  assert.equal(vals.schedOverdueItems[0].caption, 'Stranded');
});

// The rail drew four full gold bars in the markup whatever the day held, and
// sat directly above the sentence counting the day. It read "2 of 4 scheduled
// today" over a meter showing four of four.
test('the daily meter fills to the number of posts actually scheduled today', () => {
  Object.assign(StudioAdapter.ui, { screen: 'schedule', schedAnchor: null });
  const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
  const filled = vals => vals.schedMeter.filter(p => /linear-gradient/.test(p.style)).length;
  const two = StudioAdapter.bindings({
    projects: [], tracks: [],
    clips: [
      { id: 'a', title: 'One', status: 'scheduled', scheduledAt: at(7), targets: [{ provider: 'youtube' }], musicVerified: true, renderVerified: true, templateId: 't', transcript: 'x' },
      { id: 'b', title: 'Two', status: 'scheduled', scheduledAt: at(12), targets: [{ provider: 'youtube' }], musicVerified: true, renderVerified: true, templateId: 't', transcript: 'x' },
    ],
  });
  assert.equal(two.schedMeter.length, 4, 'one bar per post the day can hold');
  assert.equal(filled(two), 2, 'two scheduled, two bars');
  assert.match(two.dailyLimitNote, /^2 of 4 scheduled today/, 'and the sentence agrees with the meter');

  const none = StudioAdapter.bindings({ projects: [], tracks: [], clips: [] });
  assert.equal(filled(none), 0, 'an empty day fills nothing');

  // A Studio account buys EIGHT windows a day. The meter, the sentence and the
  // header subline were three separate literal fours, so they could not follow
  // it -- the screen drew four bars and said "up to four posts a day" while
  // the scheduler filled eight. One number drives all three now, and this is
  // the assertion that keeps them together.
  const studio = StudioAdapter.bindings({
    projects: [], tracks: [], clips: [],
    postTimes: ['07:00', '08:15', '09:30', '12:00', '14:30', '17:00', '18:45', '20:30'],
  });
  assert.equal(studio.schedMeter.length, 8, 'eight windows, eight bars');
  assert.match(studio.dailyLimitNote, /^0 of 8 scheduled today/, 'and the sentence counts the same eight');
  assert.match(studio.subline, /Up to 8 posts a day/, 'and so does the header');
});

test('the calendar shows a day\'s whole capacity, and whose plan gave it', () => {
  // Youssef's own design: eight pips in two rows of four on Studio, and the
  // EMPTY ones in faint gold rather than grey, so the capacity the plan buys
  // reads as something you were given before anything fills it. Four grey
  // pips on an eight-post plan was the same lie the header was telling.
  Object.assign(StudioAdapter.ui, { screen: 'schedule', schedView: 'month', schedAnchor: null });
  const at = h => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
  const clip = (id, h) => ({
    id, title: 'A clip', status: 'scheduled', scheduledAt: at(h),
    targets: [{ provider: 'youtube' }], musicVerified: true, renderVerified: true,
    templateId: 't', transcript: 'x',
  });
  const EIGHT = ['07:00', '08:15', '09:30', '12:00', '14:30', '17:00', '18:45', '20:30'];

  const cellsOf = vals => vals.schedMonthWeeks.flatMap(w => Array.from(w.cells));
  const today = cells => cells.find(c => /rgba\(217,180,120,\.05\)|240,214,166/.test(c.style));

  const studio = StudioAdapter.bindings({
    projects: [], tracks: [], postTimes: EIGHT,
    billing: { current: { tier: 'studio', tierName: 'Studio', planName: 'Studio · monthly' } },
    clips: [clip('a', 7), clip('b', 12)],
  });
  const sCell = today(cellsOf(studio));
  assert.ok(sCell, 'the calendar draws today');
  assert.equal(sCell.pips.length, 8, 'eight pips for eight posts a day');
  // Two rows of four, positioned from their own styles so no generated class
  // is depended on -- a design re-import must not be able to flatten them.
  const tops = new Set(sCell.pips.map(p => (p.style.match(/top: (\d+)px/) || [])[1]));
  assert.equal(tops.size, 2, 'in two rows');
  assert.equal(sCell.pips.filter(p => /background: #D9B478/.test(p.style)).length, 2, 'two scheduled, two solid gold');
  assert.equal(sCell.pips.filter(p => /rgba\(217,180,120,\.26\)/.test(p.style)).length, 6, 'the rest faint gold, not grey');

  // Everyone else keeps the quiet grey, or the gold stops meaning anything.
  const pro = StudioAdapter.bindings({
    projects: [], tracks: [], postTimes: ['07:00', '12:00', '17:00', '20:30'],
    billing: { current: { tier: 'pro', tierName: 'Pro', planName: 'Pro · monthly' } },
    clips: [clip('a', 7)],
  });
  const pCell = today(cellsOf(pro));
  assert.equal(pCell.pips.length, 4, 'four pips on Pro');
  assert.equal(new Set(pCell.pips.map(p => (p.style.match(/top: (\d+)px/) || [])[1])).size, 1, 'in one row');
  assert.equal(pCell.pips.filter(p => /background: #212127/.test(p.style)).length, 3, 'and the empties stay grey');
});

test('a busy day keeps its "+N more" inside the cell', () => {
  // Measured at 1440x950: the cell is 101px and three chips plus the more-line
  // came to 112, so the count was pushed through the bottom border. The fix is
  // to show one chip fewer, not to clip -- clipping hides the number instead
  // of fitting it, which is not the same thing.
  Object.assign(StudioAdapter.ui, { screen: 'schedule', schedView: 'month', schedAnchor: null });
  const at = h => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
  const many = [7, 8, 9, 12, 14, 17, 18, 20].map((h, i) => ({
    id: 'm' + i, title: 'A very long clip title that would run past the edge of its day',
    status: 'scheduled', scheduledAt: at(h), targets: [{ provider: 'youtube' }],
    musicVerified: true, renderVerified: true, templateId: 't', transcript: 'x',
  }));
  const vals = StudioAdapter.bindings({ projects: [], tracks: [], clips: many, postTimes: [] });
  const cell = vals.schedMonthWeeks.flatMap(w => Array.from(w.cells))
    .find(c => c.hasMore);
  assert.ok(cell, 'a day with more clips than it can list');
  assert.equal(cell.chips.length, 2, 'two chips once there is a count to show');
  assert.equal(cell.moreLabel, '+6 more', 'and the count matches what is hidden');
  assert.match(cell.style, /overflow: hidden/, 'with a backstop against anything else escaping');

  // Three still fit when nothing has to be counted.
  const three = StudioAdapter.bindings({ projects: [], tracks: [], clips: many.slice(0, 3), postTimes: [] });
  const c3 = three.schedMonthWeeks.flatMap(w => Array.from(w.cells)).find(c => c.chips.length);
  assert.equal(c3.chips.length, 3);
  assert.equal(c3.moreLabel, '', 'and no count is drawn');
});

// A schedule with nowhere to post is a list of intentions, and every card can
// read "No channel on" while the rail explains nothing.
test('the rail says when nothing can post, and stops saying it once a channel is on', () => {
  Object.assign(StudioAdapter.ui, { screen: 'schedule' });
  const withPublishing = on => StudioAdapter.bindings({
    projects: [], tracks: [], clips: [],
    social: { providers: { youtube: { configured: true, connected: true, accounts: [{ id: 'y', name: 'D' }] } } },
    publishingSettings: { enabled: on, youtube: { enabled: on } },
    directPublishingEnabled: true,
  });
  assert.equal(withPublishing(false).schedNothingPosts, true);
  assert.equal(withPublishing(true).schedNothingPosts, false);
  const yt = withPublishing(true).schedOutlets.find(o => o.name === 'YouTube');
  assert.equal(yt.note, 'Posting');
  assert.match(yt.dotStyle, /#7FD1A6/, 'green only when it will actually post');
});

test('Post now is gated on the four checks', () => {
  const at = Date.now() + 3600e3;
  Object.assign(StudioAdapter.ui, { screen: 'schedule', schedAnchor: new Date(at).setHours(0, 0, 0, 0) });
  const unverified = StudioAdapter.bindings({
    projects: [], tracks: [],
    clips: [{ id: 'a', title: 'Not ready', status: 'scheduled', scheduledAt: at, targets: [{ provider: 'youtube' }], musicVerified: false, renderVerified: true, templateId: 't', transcript: 'x' }],
  });
  const item = unverified.schedDayItems[0];
  assert.equal(item.postLabel, 'Fix first');
  assert.equal(item.hasFailing, true);
  assert.match(item.statusLabel, /failing/);
});

// ── P2: nothing invented ───────────────────────────────────────────────────

test('Home "This week" reports measured numbers, not fixed ones', () => {
  // The design hardcoded 18 posted, 86 median, 4 held. Against a real account
  // that read 18 against 1, and a median of 86 when the best clip scored 72.
  Object.assign(StudioAdapter.ui, { screen: 'home' });
  const vals = StudioAdapter.bindings({
    projects: [], tracks: [], postTimes: ['07:00', '12:00', '17:00'],
    clips: [
      { id: 'a', status: 'posted', postedAt: Date.now() - 86400000, score: 70 },
      { id: 'b', status: 'waiting', score: 60 },
    ],
  });
  assert.equal(vals.weekPosted, '1');
  assert.equal(vals.weekMedian, '70');
  assert.equal(vals.weekHeld, '1');
  assert.equal(vals.weekWorker, '—', 'nothing records worker time, so it is not invented');
});

test('posting windows come from the account, and the label matches the time', () => {
  Object.assign(StudioAdapter.ui, { screen: 'schedule' });
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], postTimes: ['07:00', '12:00', '17:00', '20:30'] });
  assert.equal(vals.postWindow1, '07:00');
  assert.equal(vals.postWindowName1, 'Morning', 'a 07:00 slot cannot be labelled Midday');
  // Four configured times into three design rows: the last row carries the
  // remainder rather than dropping 20:30, which clips are genuinely posted at.
  assert.equal(vals.postWindow3, '17:00 · 20:30');
  assert.equal(vals.postWindowName3, 'Evening · Late');
});

test('the daily limit agrees with the schedule beside it', () => {
  Object.assign(StudioAdapter.ui, { screen: 'schedule' });
  const empty = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], postTimes: [] });
  assert.match(empty.dailyLimitNote, /^0 of 4 scheduled today/, 'it said "Today is full" beside empty days');
});

test('the bell is quiet on a brand-new account and reads as unread only for new activity', () => {
  const fresh = { projects: [], clips: [], tracks: [], log: [] };
  assert.equal(StudioAdapter.bindings(fresh).activityUnread, 0);
  const active = { ...fresh, log: [{ level: 'info', message: 'x', at: Date.now() }] };
  assert.equal(StudioAdapter.bindings(active).activityUnread, 1);
  StudioAdapter.bindings(active).markRead({ preventDefault() {} });
  assert.equal(StudioAdapter.bindings(active).activityUnread, 0, 'mark all read has to actually do something');
});

test('a select renders its chosen option, not the first one', () => {
  // A `value` attribute does not select an <option>; the Templates picker
  // therefore opened the wrong style and saving there missed the user's clips.
  const runtime = fs.readFileSync(path.join(ROOT, 'src/public/studio-runtime.js'), 'utf8');
  assert.match(runtime, /select\[value\]/, 'form values are applied as properties after render');
});

test('templates sharing a name stay individually selectable', () => {
  // The design renders <option value="{{ opt }}"> over strings, so selection is
  // keyed by name; two templates called the same thing were indistinguishable.
  Object.assign(StudioAdapter.ui, { screen: 'templates' });
  const templates = [{ id: 'a', name: 'Gold' }, { id: 'b', name: 'Gold' }, { id: 'c', name: 'Clean' }];
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates, selectedTemplate: templates[1] });
  assert.deepEqual(vals.tplList, ['Gold (1)', 'Gold (2)', 'Clean']);
  assert.equal(vals.activeTpl, 'Gold (2)', 'the active option must match one of the rendered labels');

  let picked = null;
  StudioAdapter.onSelectTemplate = id => { picked = id; };
  vals.setActiveTpl({ target: { value: 'Gold (2)' } });
  assert.equal(picked, 'b');
});

test('a single template keeps its plain name', () => {
  Object.assign(StudioAdapter.ui, { screen: 'templates' });
  const templates = [{ id: 'a', name: 'Gold' }, { id: 'c', name: 'Clean' }];
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates, selectedTemplate: templates[0] });
  assert.deepEqual(vals.tplList, ['Gold', 'Clean']);
  assert.equal(vals.activeTpl, 'Gold');
});

// ── tokens shop ────────────────────────────────────────────────────────────

const BILLING_STATE = {
  projects: [], clips: [], tracks: [],
  billing: {
    current: { plan: 'free' }, tokenRatePerMinute: 1,
    plans: {
      free: { id: 'free', tier: 'basic', name: 'Basic', interval: 'one-time', tokens: 40, description: 'Try it', enabled: true },
      pro_weekly: { id: 'pro_weekly', tier: 'pro', name: 'Pro Weekly', interval: 'weekly', tokens: 150, priceLabel: '£4', enabled: true, description: 'Pro' },
      pro_monthly: { id: 'pro_monthly', tier: 'pro', name: 'Pro Monthly', interval: 'monthly', tokens: 600, priceLabel: '£14', enabled: true, description: 'Pro' },
      pro_yearly: { id: 'pro_yearly', tier: 'pro', name: 'Pro Yearly', interval: 'yearly', tokens: 8000, priceLabel: '£140', enabled: true, description: 'Pro' },
      studio_weekly: { id: 'studio_weekly', tier: 'studio', name: 'Studio Weekly', interval: 'weekly', tokens: 300, priceLabel: '£9', enabled: true, description: 'Studio' },
      studio_monthly: { id: 'studio_monthly', tier: 'studio', name: 'Studio Monthly', interval: 'monthly', tokens: 1600, priceLabel: '£29', enabled: true, description: 'Studio' },
      studio_yearly: { id: 'studio_yearly', tier: 'studio', name: 'Studio Yearly', interval: 'yearly', tokens: 22000, priceLabel: '£290', enabled: true, description: 'Studio' },
    },
    trialDays: 3,
    freeIncludes: ['Publishing and scheduling', 'The editor'],
    tierAdds: { basic: [], pro: ['Remove the watermark', 'Every template'], studio: ['Ask DeenAI', 'Jump the render queue'] },
    topups: {
      boost100: { id: 'boost100', name: 'Quick boost', tokens: 100, priceLabel: '£5', enabled: true },
      boost300: { id: 'boost300', name: 'Creator boost', tokens: 300, priceLabel: '£12', enabled: true, badge: 'Most popular' },
    },
  },
};

test('all three tiers are on screen at once, whatever the period', () => {
  // The period buttons must never act as a FILTER. They did once -- planCards
  // was filtered by interval, so a customer saw one paid plan and had nothing
  // to weigh it against (Youssef, 28 Aug 2026: "the buttons for monthly and
  // yearly and etc idk how much I like it"). The toggle changes the price
  // basis; the three tiers stay side by side at every setting.
  for (const period of ['weekly', 'monthly', 'yearly']) {
    Object.assign(StudioAdapter.ui, { screen: 'tokens', billingPeriod: period });
    const cards = StudioAdapter.bindings(BILLING_STATE).tierCards;
    assert.deepEqual(cards.map(c => c.name), ['Basic', 'Pro', 'Studio'], period);
  }

  Object.assign(StudioAdapter.ui, { screen: 'tokens', billingPeriod: 'monthly' });
  const monthly = StudioAdapter.bindings(BILLING_STATE).tierCards;
  assert.deepEqual(monthly.map(c => c.price), ['Free', '£14', '£29']);
  assert.deepEqual(monthly.map(c => c.tokens), ['40 tokens', '600 tokens', '1,600 tokens']);

  Object.assign(StudioAdapter.ui, { screen: 'tokens', billingPeriod: 'yearly' });
  const yearly = StudioAdapter.bindings(BILLING_STATE).tierCards;
  assert.deepEqual(yearly.map(c => c.price), ['Free', '£140', '£290'], 'the toggle changes the price, not the tiers');
});

test('each tier lists what it ADDS, not the same list three times', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens', billingPeriod: 'monthly' });
  const [basic, pro, studio] = StudioAdapter.bindings(BILLING_STATE).tierCards;
  assert.match(basic.linesLabel, /Included/);
  assert.match(pro.linesLabel, /Everything in Basic/);
  assert.match(studio.linesLabel, /Everything in Pro/);
  assert.deepEqual(pro.lines.map(l => l.text), ['Remove the watermark', 'Every template']);
  assert.deepEqual(studio.lines.map(l => l.text), ['Ask DeenAI', 'Jump the render queue'],
    'Studio must not repeat Pro\'s lines -- that hides the difference being sold');
});

test('a subscriber on one of the three original plan ids is still marked current', () => {
  // Every customer who subscribed before tiers carries 'monthly', not
  // 'pro_monthly'. If the grid did not recognise it they would see Pro offered
  // to them as though they were not already paying for it.
  Object.assign(StudioAdapter.ui, { screen: 'tokens', billingPeriod: 'monthly' });
  const legacy = { ...BILLING_STATE, billing: { ...BILLING_STATE.billing, current: { plan: 'monthly', status: 'active' } } };
  const [, pro] = StudioAdapter.bindings(legacy).tierCards;
  assert.equal(pro.cta, 'Your plan');
  assert.equal(pro.tag, 'Your plan');
});

test('the balance bar is the real fraction, not a fixed width', () => {
  // The design shipped this bar as a hoisted class with a literal width: 41%,
  // so every customer saw the same gauge whatever they had left — an invented
  // number on the one screen where the numbers are the entire point.
  Object.assign(StudioAdapter.ui, { screen: 'tokens' });
  const withUsage = { ...BILLING_STATE, billing: { ...BILLING_STATE.billing,
    current: { plan: 'monthly', status: 'active', allowance: 500, remaining: 125 } } };
  assert.match(StudioAdapter.bindings(withUsage).tokenBarStyle, /width: 25%/);

  const empty = { ...BILLING_STATE, billing: { ...BILLING_STATE.billing,
    current: { plan: 'monthly', status: 'active', allowance: 500, remaining: 0 } } };
  assert.match(StudioAdapter.bindings(empty).tokenBarStyle, /width: 2%/,
    'an empty balance still needs a visible sliver, or the bar reads as broken');

  const owner = { ...BILLING_STATE, billing: { ...BILLING_STATE.billing, current: { unlimited: true } } };
  assert.match(StudioAdapter.bindings(owner).tokenBarStyle, /width: 100%/);
});

test('a subscriber is told how to change or cancel, on the screen', () => {
  // "I don't like how they control their subscriptions" — the only control was
  // a "Change" link beside a card number at the very bottom of the page.
  Object.assign(StudioAdapter.ui, { screen: 'tokens' });
  const subscribed = { ...BILLING_STATE, billing: { ...BILLING_STATE.billing,
    current: { plan: 'monthly', status: 'active', allowance: 500, remaining: 186,
      periodEndsInDays: 11, stripeSubscriptionId: 'sub_123' } } };
  const b = StudioAdapter.bindings(subscribed);
  // 'monthly' is the pre-tier id this subscriber still carries; it has to
  // resolve to the plan they are actually paying for, not fall through to Basic.
  assert.equal(b.planTitle, 'Pro Monthly');
  assert.match(b.planPriceLine, /£14 per monthly/);
  assert.equal(b.planState, 'Active');
  assert.match(b.manageLabel, /cancel/i, 'the word someone is looking for has to appear');
  assert.equal(typeof b.manageBilling, 'function');
  assert.match(b.manageHint, /Stripe/, 'and say where it goes before it goes there');
});

test('the plan state names a failed payment rather than burying it', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens' });
  const late = { ...BILLING_STATE, billing: { ...BILLING_STATE.billing,
    current: { plan: 'monthly', status: 'past_due', allowance: 500, remaining: 10 } } };
  const b = StudioAdapter.bindings(late);
  assert.match(b.planState, /payment failed/i);
  assert.match(b.planStateStyle, /E08770/, 'in the colour the rest of the app uses for trouble');
});

test('token packs render and can be bought on their own', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens' });
  const vals = StudioAdapter.bindings(BILLING_STATE);
  assert.equal(vals.packs.length, 2, 'the screen used to render no packs at all');
  assert.equal(vals.packs[0].price, '£5');
  let bought = null;
  StudioAdapter.onBuyTokens = id => { bought = id; };
  vals.packs[0].buy({ preventDefault() {} });
  assert.equal(bought, 'boost100');
});

test('a tier with no Stripe price says so rather than failing at checkout', () => {
  // Studio ships before its prices exist in Stripe, so the column has to be
  // honest rather than offering a button that cannot charge anyone.
  Object.assign(StudioAdapter.ui, { screen: 'tokens', billingPeriod: 'monthly' });
  const unpriced = {
    ...BILLING_STATE,
    billing: {
      ...BILLING_STATE.billing,
      plans: { ...BILLING_STATE.billing.plans, studio_monthly: { id: 'studio_monthly', tier: 'studio', name: 'Studio Monthly', tokens: 1600, enabled: false } },
    },
  };
  const studio = StudioAdapter.bindings(unpriced).tierCards[2];
  assert.equal(studio.cta, 'Opening soon');
  assert.match(studio.foot, /Not open for checkout/);
  assert.doesNotMatch(studio.btnStyle, /cursor: pointer/);
});

test('the connection dot is supplied under the name the Home row binds', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home' });
  const vals = StudioAdapter.bindings(SOCIAL_STATE);
  const yt = vals.connections.find(c => c.name === 'YouTube');
  assert.ok(yt.heroDotStyle, 'Home binds heroDotStyle; supplying only dotStyle left it invisible');
  assert.match(yt.heroDotStyle, /#7FD1A6/, 'connected and enabled reads green');
});

// ── the clip editor's captions ─────────────────────────────────────────────

const CAPTION_CLIP = {
  id: 'cap1', projectId: 'p1', title: 'C', status: 'waiting', durationMs: 8000, targets: [],
  transcript: 'Whoever wakes up safe. He has everything.',
  captionSegments: [
    { start: 0, end: 1.9, text: 'Whoever wakes up safe.' },
    { start: 2.8, end: 4.6, text: 'He has everything.' },
  ],
};
const CAPTION_STATE = { projects: [{ id: 'p1', title: 'L', status: 'done' }], clips: [CAPTION_CLIP], tracks: [] };

test('the timeline is chunked from real caption timings, not one giant block', () => {
  // The clip record carried only a flat transcript, so the whole clip was one
  // block and "click a caption block to edit its words" could not work.
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'cap1', edTab: 'captions', edBlock: 0, edBlockDraft: null });
  const vals = StudioAdapter.bindings(CAPTION_STATE);
  assert.equal(vals.edCapBlocks.length, 2);
  assert.equal(vals.edCapBlocks[0].text, 'Whoever wakes up safe.');
  assert.match(vals.edCapBlocks[0].time, /0:00 – 0:0\d/);
});

test('clicking a caption block loads its words into the editor', () => {
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'cap1', edBlock: 0, edBlockDraft: null });
  StudioAdapter.bindings(CAPTION_STATE).edCapBlocks[1].select({ preventDefault() {} });
  const vals = StudioAdapter.bindings(CAPTION_STATE);
  assert.equal(vals.edCapText, 'He has everything.', 'the box stayed empty before');
  assert.match(vals.edSelRange, /0:0\d – 0:0\d/);
});

test('editing one block rebuilds the whole transcript around it', () => {
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'cap1', edBlock: 1, edBlockDraft: null });
  let saved = null;
  StudioAdapter.onSaveClip = (id, fields) => { saved = fields; };
  const vals = StudioAdapter.bindings(CAPTION_STATE);
  vals.setCapText({ target: { value: 'He has been given the world.' } });
  StudioAdapter.bindings(CAPTION_STATE).saveEdit({ preventDefault() {} });
  assert.equal(saved.transcript, 'Whoever wakes up safe. He has been given the world.');
});

test('an unsaved edit echoes the block words with the draft geometry', () => {
  // Item 5 of Goal to Start: a slider must visibly move the caption the
  // instant it moves. While edits are unsaved the ghost echoes the current
  // block's words, sized by the draft style; saved and idle it is empty.
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'cap1', edBlock: 0, edBlockDraft: null, edDirty: false, edStyleDraft: null, edTime: 0 });
  let vals = StudioAdapter.bindings(CAPTION_STATE);
  assert.equal(vals.edCapWords.length, 0, 'idle: the render answers for the words');
  StudioAdapter.ui.edDirty = true;
  vals = StudioAdapter.bindings(CAPTION_STATE);
  assert.ok(vals.edCapWords.length > 0, 'dirty: the block words are echoed');
  assert.equal(vals.edCapWords.map(w => w.text).join(' '), 'Whoever wakes up safe.');
  assert.match(vals.edCapEchoStyle, /font-size: [\d.]+cqw/, 'the echo carries the draft size');
  assert.match(vals.edCapEchoStyle, /line-height: [\d.]+/, 'and the draft line-height');
  StudioAdapter.ui.edDirty = false;
  vals = StudioAdapter.bindings(CAPTION_STATE);
  assert.equal(vals.edCapWords.length, 0, 'saved: the echo ends');
});

test('a sixty-second clip reads as one minute, not sixty seconds', () => {
  // Math.round on the remainder alone turned 59.6s into "0:60" on cards.
  const vals = StudioAdapter.bindings({
    projects: [], tracks: [],
    clips: [{ id: 'd60', projectId: 'p1', title: 'Minute', status: 'waiting', score: 50, durationMs: 59600, targets: [] }],
  });
  const row = (vals.needsRows || vals.queue || vals.perfBoard || []).map(r => r.duration || '').join('|');
  assert.ok(!/0:60/.test(JSON.stringify(vals)), 'no surface renders 0:60');
});

test('the posting-today panel names the platform its targets carry', () => {
  // Targets store the destination under `provider`; this panel read
  // `platform` and said "Not connected" for every scheduled post while four
  // accounts sat connected. Three screens gave three different answers.
  const vals = StudioAdapter.bindings({
    projects: [], tracks: [],
    clips: [{
      id: 'sch1', projectId: 'p1', title: 'Scheduled clip', status: 'scheduled',
      score: 80, durationMs: 30000, scheduledAt: Date.now() + 3600e3,
      targets: [{ provider: 'youtube', status: 'scheduled' }],
    }],
  });
  assert.equal(vals.slots.length, 1);
  assert.equal(vals.slots[0].dest, 'YouTube', 'the provider names the destination');
});

test('a lecture that failed once and later succeeded leaves the bell', () => {
  // The error field survives recovery, so every lecture that failed on the
  // old import path and then imported fine sat as 'needs attention' forever.
  const vals = StudioAdapter.bindings({
    tracks: [], clips: [],
    projects: [
      { id: 'rec', title: 'Recovered lecture', status: 'done', error: 'old import error', clipCount: 3, submittedAt: Date.now() },
    ],
  });
  const texts = (vals.activityRows || vals.activity || []).map(r => r.text || '').join('|');
  assert.ok(!/Recovered lecture/.test(texts), 'a done lecture is not a call to action');
  assert.equal(vals.activityUnread, 0);
});

test('the activity feed keeps a week, not a history book', () => {
  // 45 stale failure rows greeted every open of the bell as if the product
  // were on fire today. Older than a week, they leave the feed (the owner
  // Health page keeps the full history).
  const DAY = 24 * 3600e3;
  const vals = StudioAdapter.bindings({
    tracks: [], clips: [],
    projects: [
      { id: 'fresh', title: 'Fresh failure', status: 'failed', error: 'x', submittedAt: Date.now() - DAY },
      { id: 'stale', title: 'Ancient failure', status: 'failed', error: 'y', submittedAt: Date.now() - 30 * DAY },
    ],
  });
  const texts = (vals.activityRows || vals.activity || []).map(r => r.text || '').join('|');
  assert.match(texts, /Fresh failure/, 'this week still shows');
  assert.ok(!/Ancient failure/.test(texts), 'last month does not');
  assert.equal(vals.activityUnread, 1, 'and only the fresh one counts');
});

test('a fresh wizard always opens on the lecture kind', () => {
  // The kind used to inherit the account's selected template, so an account
  // whose default style was the Quran one opened every new lecture pre-set
  // to scripture-only captions -- a lazy Continue then produced clips whose
  // lecture speech was silently uncaptioned (invariant 7).
  const QURAN_DEFAULT_STATE = {
    projects: [], clips: [], tracks: [],
    templates: [
      { id: 'quran-recitation', name: 'Quran Recitation', captionMode: 'quran', version: 1 },
      { id: 'clean-line', name: 'Clean Line', captionMode: 'phrase', version: 1 },
    ],
    selectedTemplate: { id: 'quran-recitation', name: 'Quran Recitation', captionMode: 'quran', version: 1 },
  };
  StudioAdapter.bindings(QURAN_DEFAULT_STATE); // paints, so openJob knows the template list
  StudioAdapter.openJob({ url: 'https://youtu.be/lect1', title: 'A lecture', durationSec: 600 });
  assert.equal(StudioAdapter.ui.jobTplId, 'clean-line', 'the wizard picked the first lecture style');
  const vals = StudioAdapter.bindings(QURAN_DEFAULT_STATE);
  assert.equal(vals.jobTypeQuran, false, 'the kind card shows lecture, not Quran');
  StudioAdapter.ui.job = null; StudioAdapter.ui.jobTplId = null;
});

test('a lecture submission carries the chosen scenery, not a forced own', () => {
  // The picture step offers scenery on every kind and the engine renders it
  // for every kind, but the submit used to force backgroundMode 'own' for
  // lectures -- the choice was silently discarded (invariant 8).
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const call = /StudioAdapter\.onGenerate\s*=[\s\S]*?'Lecture queued'/.exec(html)[0];
  assert.match(call, /body\.backgroundMode=StudioAdapter\.ui\.jobBgMode/, 'the chosen mode travels');
  assert.ok(!/backgroundMode=quranJob\?/.test(call), 'no kind gate discards it');
});

test('a clip with no persisted timings still yields editable blocks', () => {
  // Clips rendered before the worker persisted segments must not lose the editor.
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'old', edBlock: 0, edBlockDraft: null });
  const vals = StudioAdapter.bindings({
    projects: [{ id: 'p1', title: 'L', status: 'done' }], tracks: [],
    clips: [{ id: 'old', projectId: 'p1', title: 'C', status: 'waiting', durationMs: 8000, targets: [], transcript: 'One. Two.' }],
  });
  assert.equal(vals.edCapBlocks.length, 2);
  assert.equal(vals.edCapBlocks[0].time, '', 'no invented timings for a clip that has none');
});

// ── B-3, B-7, B-9 ──────────────────────────────────────────────────────────

test('the editor names the clip its own nasheed, not a placeholder', () => {
  // The timeline read "Nasheed · Tala al-Badru" on an account whose only track
  // was "Allah Allah (Muffled)" — a design placeholder presented as fact.
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'c' });
  const build = extra => StudioAdapter.bindings({
    projects: [{ id: 'p', title: 'L', status: 'done' }], tracks: [],
    clips: [{ id: 'c', projectId: 'p', title: 'C', status: 'waiting', durationMs: 8000, targets: [], transcript: 'x.', ...extra }],
  });
  assert.match(build({ musicName: 'Allah Allah (Muffled)', musicVerified: true }).edTrackName, /Allah Allah/);
  assert.equal(build({}).edTrackName, 'No nasheed mixed in', 'no invented track when none is mixed');
});

test('a clip shortfall is explained rather than left as a silent gap', () => {
  Object.assign(StudioAdapter.ui, { screen: 'library', libFilter: 'all' });
  const vals = StudioAdapter.bindings({
    tracks: [],
    projects: [{ id: 'p', title: 'L', status: 'done', clipsRequested: 4, submittedAt: Date.now() }],
    clips: [1, 2, 3].map(n => ({ id: `c${n}`, projectId: 'p', title: `C${n}`, status: 'waiting', score: 70, targets: [] })),
  });
  assert.match(vals.libraryItems[0].metric, /3 of 4 asked for/);
});

test('Post now says why it is unavailable instead of doing nothing', () => {
  const postAt = Date.now() + 3600e3;
  Object.assign(StudioAdapter.ui, { screen: 'schedule', schedAnchor: new Date(postAt).setHours(0, 0, 0, 0) });
  const clip = { id: 'a', title: 'C', status: 'scheduled', scheduledAt: postAt, targets: [{ provider: 'youtube' }], musicVerified: true, renderVerified: true, templateId: 't', transcript: 'x' };
  const base = {
    projects: [], tracks: [], clips: [clip],
    social: { providers: { youtube: { configured: true, connected: true, accounts: [{ id: 'a', name: 'A' }] } } },
    publishingSettings: { youtube: { enabled: true } },
  };
  const label = data => StudioAdapter.bindings(data).schedDayItems[0].postLabel;
  assert.equal(label({ ...base, directPublishingEnabled: true }), 'Post now');
  assert.equal(label({ ...base, directPublishingEnabled: false }), 'Publishing off');
  assert.equal(label({ ...base, directPublishingEnabled: true, publishingSettings: {} }), 'No channel on');
});

test('a submission carries an idempotency key so a 502 cannot charge twice', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const call = /StudioAdapter\.onGenerate\s*=[\s\S]*?'Lecture queued'/.exec(html)[0];
  assert.match(call, /idempotencyKey/, 'the key is sent with the submission');
  assert.match(call, /pendingJobKey=null/, 'and only cleared once it succeeds');
});

// ── rendering does not rebuild the page ────────────────────────────────────

test('every slider can reach the whole range its field accepts', async () => {
  // The design draws min/max as literals and they did not match the schema. The
  // caption's vertical position ran 20-88 against a field accepting 20-800, so
  // the control could only express the bottom tenth of its own range — and
  // touching it truncated a value the drag had set. Warmth ran 0-80 on a field
  // that is -100..100, so it could never be set cool at all.
  //
  // The bounds are READ from the schema rather than copied here. They were
  // copied, and captionFontSize going to 240 for the big stacked styles left
  // this test asserting a 140 ceiling the importer had already corrected --
  // a duplicated constant failing for being out of date, which says nothing
  // about whether a slider can reach its field.
  const template = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  const { NUMBER_RANGES } = await import('../src/templates.js');
  const fields = {
    edSize: 'captionFontSize', edCapPosY: 'captionMarginV',
    edGrain: 'grain', edWarm: 'warm',
  };
  for (const [binding, field] of Object.entries(fields)) {
    const [lo, hi] = NUMBER_RANGES[field];
    const re = new RegExp(`"type":"range","min":"(-?\\d+)","max":"(-?\\d+)","value":\\{"p":"${binding}"`);
    const found = re.exec(template);
    assert.ok(found, `${binding} is a range input`);
    assert.equal(Number(found[1]), lo, `${binding} min`);
    assert.equal(Number(found[2]), hi, `${binding} max`);
  }
});

test('the range correction is driven by the schema, so a re-import keeps it', () => {
  // Hand-patching the generated file would be undone by the next design pull.
  const importer = fs.readFileSync(path.join(ROOT, 'scripts/import-design.mjs'), 'utf8');
  assert.match(importer, /import \{ NUMBER_RANGES \} from '\.\.\/src\/templates\.js'/);
  assert.match(importer, /const RANGE_FIELDS = \{/);
  assert.match(importer, /setPosY: 'captionMarginV'/);
  assert.match(importer, /attrOut\.min = String\(lo\)/);
});

test('the preview caption is drawn in the font and case it will render in', () => {
  // "Preview" that ignores the font, the case and the colour is not previewing
  // the caption, only its position.
  const style = extra => {
    Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null });
    const t = { id: 'x', name: 'X', height: 1920, ...extra };
    return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t }).capStyle;
  };
  assert.match(style({ captionFont: 'Amiri' }), /font-family: Amiri/);
  assert.match(style({ captionFont: 'Open Sans' }), /font-family: "Open Sans"/);
  assert.match(style({ captionUppercase: true }), /text-transform: uppercase/);
  assert.doesNotMatch(style({ captionUppercase: false }), /text-transform: uppercase/);
  assert.match(style({ captionPrimary: '#D9B478' }), /color: #D9B478/);
});

test('the snap lines are the safe box the design actually draws', () => {
  // They were 10% and 90%, matching nothing on screen. The safe box is
  // top 8% / bottom 14% (.s8n), and a caption outside it is covered by the
  // platform's own chrome.
  const adapter = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  assert.match(adapter, /var SAFE_TOP = 0\.08;/);
  assert.match(adapter, /var SAFE_BOTTOM = 0\.86;/);
  const css = fs.readFileSync(path.join(ROOT, 'src/public/studio-styles.generated.css'), 'utf8');
  // Found by its geometry, not by a hoisted class name -- the importer
  // renumbers classes whenever the design gains or loses a node, and pinning
  // .s8n broke on an unrelated section being removed.
  const box = /\.[a-z0-9]+\{[^}]*top: 8%[^}]*bottom: 14%[^}]*\}/.exec(css);
  assert.ok(box, 'a class drawing the top-8% / bottom-14% safe box exists');
});

test('the caption cannot be dragged outside the safe box', () => {
  const height = 533;
  const at = f => dragOn({ clientX: 150, clientY: f * height });
  // Dropped below the frame entirely, it stops at the safe edge.
  const low = at(0.99);
  assert.equal(low.captionPosition, 'bottom');
  assert.equal(low.captionMarginV, Math.round(1920 * (1 - 0.86)), 'clamped to the safe bottom');
  const high = at(0.01);
  assert.equal(high.captionPosition, 'top');
  assert.equal(high.captionMarginV, Math.round(1920 * 0.08), 'clamped to the safe top');
});

test('each snap point has a name the preview can show', () => {
  const adapter = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  const points = /var SNAP_POINTS = \[([\s\S]*?)\];/.exec(adapter)[1];
  for (const name of ['Safe top', 'Upper third', 'Middle', 'Lower third', 'Safe bottom']) {
    assert.ok(points.includes(name), `${name} is named`);
  }
  // And the label only shows while a caption is actually being dragged.
  assert.match(adapter, /UI\.dragKind === 'caption' && UI\.dragSnapName/);
});

test('every text binding is given text, not an object', () => {
  // edSiblings was supplied as a list of clips and rendered as a text node, so
  // "[object Object],[object Object],[object Object]" sat under the preview on
  // every visit to the editor. The same mistake anywhere else would look the
  // same and be just as invisible to a suite that never reads the output.
  const template = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  const names = [...new Set([...template.matchAll(/"t":"txt","v":\{"p":"([^"]+)"\}/g)].map(m => m[1]))];
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'c1', tplDraft: null });
  const vals = StudioAdapter.bindings({
    projects: [{ id: 'p1', title: 'Lecture' }],
    clips: [{ id: 'c1', projectId: 'p1', title: 'One', transcript: 'a b c' }, { id: 'c2', projectId: 'p1', title: 'Two' }],
    tracks: [], templates: [{ id: 'x', name: 'X' }], selectedTemplate: { id: 'x', name: 'X' },
  });
  const objects = names.filter(n => vals[n] !== undefined && typeof vals[n] === 'object' && vals[n] !== null);
  assert.deepEqual(objects, [], `these render as [object Object]: ${objects.join(', ')}`);
});

test('the editor says how many other clips the lecture has', () => {
  const withSiblings = n => {
    Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'c1', tplDraft: null });
    const clips = [{ id: 'c1', projectId: 'p1', title: 'One', transcript: 'a' }];
    for (let i = 0; i < n; i += 1) clips.push({ id: `s${i}`, projectId: 'p1', title: `S${i}` });
    return StudioAdapter.bindings({
      projects: [{ id: 'p1', title: 'Lecture' }], clips, tracks: [],
      templates: [{ id: 'x', name: 'X' }], selectedTemplate: { id: 'x', name: 'X' },
    }).edSiblings;
  };
  assert.equal(withSiblings(0), 'The only clip from this lecture');
  assert.equal(withSiblings(1), '1 other clip from this lecture');
  assert.equal(withSiblings(4), '4 other clips from this lecture');
});

test('the caption panel is offered on Templates, not only inside a clip', () => {
  // The design draws a font row and two sliders inside the editor only, so the
  // shared style could not be given a font from the screen that exists to set
  // the shared style.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const anchor = /function hlAnchor\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.match(anchor, /screen!=='templates'\)return null/, 'Templates is handled, not fallen through');
  assert.match(anchor, /screen==='editor'/);
  assert.match(anchor, /Caption position/, 'anchored on a row the Templates screen always has');
  // saveStyle already routes per screen, so one block edits the right target.
  const adapter = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  assert.match(adapter, /function saveStyle\(patch\) \{[\s\S]*?screen === 'editor' && UI\.edClipId/);
});

test('the animation settings read back the way they will render', () => {
  const vals = extra => {
    Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null, pvPlaying: false, pvTime: 0 });
    const t = { id: 'x', name: 'X', height: 1920, ...extra };
    return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
  };
  const on = vals({ captionPopScale: 128, captionPopMs: 240, captionFadeMs: 200 });
  assert.equal(on.animPopLabel, '+28% pop');
  assert.equal(on.animPopMsLabel, '240 ms');
  assert.equal(on.animFadeLabel, '200 ms');
  assert.equal(on.animPopOn, true);
  // Off is stated as off, not as a number that happens to mean nothing.
  assert.equal(vals({ captionPopScale: 100 }).animPopLabel, 'Off');
  assert.equal(vals({ captionPopMs: 0 }).animPopMsLabel, 'Off');
  assert.equal(vals({ captionFadeMs: 0 }).animFadeLabel, 'None');
  // Either zero switches the pop off, matching what the renderer checks.
  assert.equal(vals({ captionPopScale: 128, captionPopMs: 0 }).animPopOn, false);
  assert.equal(vals({ captionPopScale: 100, captionPopMs: 240 }).animPopOn, false);
});

test('the new caption fields survive a per-clip override', async () => {
  // Three of these were already dropped at four separate layers once.
  const patch = {
    captionPopScale: 130, captionPopMs: 90, captionFadeMs: 250,
    captionHighlightFont: 'Open Sans', captionHighlightItalic: false, captionHighlightGlow: 9,
  };
  const templates = await import('../src/templates.js');
  const kept = templates.sanitiseClipStyle(patch);
  assert.deepEqual(kept, patch);
});

test('the output shape is a choice, and the renderer already honoured it', () => {
  // The pipeline has always been generic here -- every fit mode scales to
  // {width}:{height} and the subtitle canvas follows -- but the UI pinned it to
  // 9:16 and the button existed only to say the presets were fixed.
  const shape = (width, height) => {
    Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null, sheet: null });
    const t = { id: 'x', name: 'X', width, height };
    return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
  };
  assert.equal(shape(1080, 1920).safePresetLabel, 'Shorts + Reels · 9:16');
  assert.equal(shape(1080, 1080).safePresetLabel, 'Square · 1:1');
  assert.equal(shape(1920, 1080).safePresetLabel, 'Widescreen · 16:9');
  // The preview frame follows, or Fit and Blur letterbox against the wrong box.
  assert.equal(shape(1080, 1080).pvAspect, '1080 / 1080');
  // A size set by hand is reported rather than shown as the wrong preset.
  assert.equal(shape(1400, 900).safePresetLabel, '1400×900');
});

test('picking a shape offers the three platforms actually target', () => {
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null, sheet: null });
  const t = { id: 'x', name: 'X', width: 1080, height: 1920 };
  const state = { projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t };
  StudioAdapter.bindings(state).cyclePreset({ preventDefault() {} });
  assert.deepEqual(StudioAdapter.ui.sheet.options,
    ['Shorts + Reels · 9:16', 'Square · 1:1', 'Widescreen · 16:9']);
  StudioAdapter.ui.sheet = null;
});

test('the output shape stays a template setting, never a per-clip one', () => {
  // Resizing one clip would desync it from every sibling in the lecture, which
  // is why width and height are excluded from CLIP_STYLE_FIELDS.
  const kept = templatesModule.sanitiseClipStyle({ width: 1080, height: 1080, captionFontSize: 90 });
  assert.deepEqual(kept, { captionFontSize: 90 });
});

test('Templates scrolls its settings column, not the whole page', () => {
  // Scrolling the page meant the preview slid off-screen as soon as you reached
  // a control near the bottom of the column -- the preview being the point of
  // the screen.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const fn = /function paintTemplatesLayout\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.match(fn, /'overflow-y':'hidden'/, 'the page itself stops scrolling');
  assert.match(fn, /'overflow-y':'auto'/, 'the settings column takes over');
  // A flex child will not shrink below its content without this, so the
  // overflow never engages and nothing scrolls at all.
  assert.match(fn, /'min-height':'0'/);
  assert.match(fn, /screen!=='templates'.*clearTemplatesLayout/, 'and it is torn down elsewhere');
});

test('the layout finder does not walk past its own handiwork', () => {
  // Applying the fix sets the scroller to overflow-y: hidden, so a search for an
  // auto|scroll ancestor walked straight past it, failed, and tore the layout
  // down -- then the next paint re-applied it. Alternating like that is what
  // read as the page letting you scroll and yanking you back every two seconds.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const fn = /function paintTemplatesLayout\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.match(fn, /!scroller\.hasAttribute\('data-host-style'\)/,
    'a node it already claimed still counts as the scroller');
});

test('the patcher leaves host-owned styles on the design\'s own nodes', () => {
  // The generated source carries no style attribute for these, so syncing
  // blindly stripped them on every patch.
  const runtime = fs.readFileSync(path.join(ROOT, 'src/public/studio-runtime.js'), 'utf8');
  const fn = /function syncAttributes\(target, source\) \{[\s\S]*?\n  \}/.exec(runtime)[0];
  assert.match(fn, /hasAttribute\('data-host-style'\)/);
  assert.match(fn, /if \(hostStyled && attr\.name === 'style'\) continue/, 'not overwritten');
  assert.match(fn, /if \(hostStyled && name === 'style'\) continue/, 'and not removed');
  // The marker itself has to survive, or it is stripped on the first patch and
  // takes the protection with it.
  assert.match(fn, /name\.indexOf\('data-host'\) === 0\) continue/);
});

test('the layout is found structurally, not by generated class names', () => {
  // s8a/s8b are regenerated on every design import.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const fn = /function paintTemplatesLayout\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.doesNotMatch(fn, /\bs8a\b|\bs8b\b|\bs1m\b/);
  // The row is the common ancestor of the preview frame and the caption block.
  // Walking up from the frame alone stopped at the preview column's own flex
  // container, which is also a flex box with several children.
  assert.match(fn, /row\.contains\(frame\)/);
  assert.match(fn, /n\.contains\(hlEl\)/);
});

test('a host-owned node survives its screen being torn down', () => {
  // The patcher protects these from being paired against, but not from an
  // ancestor being replaced -- so changing screen and coming back left the
  // preview picture, the caption panel or the live section gone for good.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  assert.match(html, /function alive\(node\)\{\s*if\(node&&!node\.isConnected\)document\.body\.appendChild\(node\)/);
  for (const paint of ['paintPreviewPic', 'paintApplyLecture', 'paintHighlight', 'paintLiveWork']) {
    const fn = new RegExp(`function ${paint}\\(vals\\)\\{\\s*alive\\(`);
    assert.match(html, fn, `${paint} re-attaches before docking`);
  }
});

test('the animation sliders actually animate the preview', () => {
  // They moved numbers the preview never showed, which is indistinguishable
  // from their not working.
  const live = extra => {
    Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null, pvPlaying: true, pvTime: 1 });
    const t = { id: 'x', name: 'X', height: 1920, captionMode: 'dynamic-stack', ...extra };
    return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
  };
  const popped = live({ captionPopScale: 128, captionPopMs: 240 }).capWords.find(w => w.style);
  assert.match(popped.style, /animation: dcCapPop 240ms/);
  assert.match(popped.style, /--dc-pop: 1\.280/);
  // transform does nothing on an inline box.
  assert.match(popped.style, /display: inline-block/);
  // Either zero switches it off, matching what the renderer checks.
  assert.doesNotMatch(live({ captionPopScale: 100, captionPopMs: 240 }).capWords.find(w => w.style).style, /dcCapPop/);
  assert.doesNotMatch(live({ captionPopScale: 128, captionPopMs: 0 }).capWords.find(w => w.style).style, /dcCapPop/);
  // The fade is on the caption box, since the renderer fades the whole event.
  assert.match(live({ captionFadeMs: 200 }).capStyle, /animation: dcCapFade 200ms/);
  // And only while playing: a fade replaying on every idle repaint is a flicker.
  Object.assign(StudioAdapter.ui, { pvPlaying: false, pvTime: 0 });
  const idle = StudioAdapter.bindings({
    projects: [], clips: [], tracks: [],
    templates: [{ id: 'x', name: 'X', captionFadeMs: 200 }], selectedTemplate: { id: 'x', name: 'X', captionFadeMs: 200 },
  });
  assert.doesNotMatch(idle.capStyle, /dcCapFade/);
});

test('a pop below 100 grows the word in rather than doing nothing', () => {
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null, pvPlaying: true, pvTime: 1 });
  const t = { id: 'x', name: 'X', captionPopScale: 75, captionPopMs: 200, captionMode: 'dynamic-stack' };
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
  assert.equal(vals.animPopLabel, '25% grow-in');
  assert.equal(vals.animPopOn, true);
  assert.match(vals.capWords.find(w => w.style).style, /--dc-pop: 0\.750/);
});

test('the caption styles the renderer already honours are reachable', () => {
  // Seven fields read by clip_worker.py with nothing to set them: outline
  // colour and width, drop shadow, background colour and opacity, line height,
  // and words per line.
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null, pvPlaying: false, pvTime: 0 });
  const t = {
    id: 'x', name: 'X', captionOutline: '#112233', captionOutlineWidth: 8, captionShadow: 4,
    captionBackground: '#101014', captionBackgroundOpacity: 60, captionLineHeight: 1.2, captionMaxWords: 3,
  };
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
  for (const [binding, expected] of [
    ['capOutlineLabel', '#112233'], ['capOutlineWidthLabel', '8'], ['capShadowLabel', '4'],
    ['capBgLabel', '#101014'], ['capBgOpacityLabel', '60%'], ['capLineHeightLabel', '120%'],
    ['capMaxWordsLabel', '3 per line'],
  ]) assert.equal(vals[binding], expected, binding);
  // And the preview draws them.
  assert.match(vals.capStyle, /line-height: 1\.20/);
  assert.match(vals.capStyle, /background: rgba\(16,16,20,0\.60\)/);
  const shadows = vals.capStyle.match(/#112233/g) || [];
  assert.equal(shadows.length, 8, 'a ring of shadows, since a text-stroke thins the glyph');
});

test('an unset style says so rather than showing a bare zero', () => {
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null });
  const t = { id: 'x', name: 'X', captionOutlineWidth: 0, captionShadow: 0, captionBackgroundOpacity: 0 };
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
  assert.equal(vals.capOutlineWidthLabel, 'None');
  assert.equal(vals.capShadowLabel, 'None');
  assert.equal(vals.capBgOpacityLabel, 'Off');
  assert.doesNotMatch(vals.capStyle, /background: rgba/, 'no box when it is off');
});

// ── the sample plays ───────────────────────────────────────────────────────

function previewAt(seconds, extra = {}) {
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null, pvPlaying: true, pvTime: seconds });
  const t = { id: 'x', name: 'X', height: 1920, ...extra };
  return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
}

test('the sample caption advances as the preview plays', () => {
  // A still cannot show what a caption mode does: word-by-word and stacked
  // lines look identical until something moves.
  const seen = [0, 1, 2, 4, 6].map(t => previewAt(t, { captionMode: 'word' }).capPreviewText);
  assert.equal(new Set(seen).size, seen.length, `each moment shows a different word: ${seen.join(' ')}`);
  for (const word of seen) assert.equal(word.split(' ').length, 1);
});

test('each caption mode plays the way it renders', () => {
  const at = 1.0;
  assert.equal(previewAt(at, { captionMode: 'word' }).capWords.length, 1);
  assert.ok(previewAt(at, { captionMode: 'phrase' }).capWords.length > 4, 'a phrase holds the line');
  assert.equal(previewAt(at, { captionMode: 'dynamic-stack', captionStackMaxWords: 3 }).capWords.length, 3);
});

test('the live word carries the highlight, and only the live word', () => {
  const vals = previewAt(1.0, {
    captionMode: 'dynamic-stack', captionHighlight: '#D9B478',
    captionHighlightFont: 'Amiri', captionHighlightItalic: true, captionHighlightGlow: 14,
  });
  const lit = vals.capWords.filter(w => w.style);
  assert.equal(lit.length, 1, 'exactly one word is live');
  assert.match(lit[0].style, /color: #D9B478/);
  assert.match(lit[0].style, /font-family: Amiri/, 'its own face, not the caption\'s');
  assert.match(lit[0].style, /font-style: italic/);
  assert.match(lit[0].style, /text-shadow/, 'glow');
  assert.ok(vals.capWords.some(w => !w.style), 'the rest are left alone');
});

test('nothing is highlighted in the gap between lines', () => {
  // Between lines no word is being spoken, so highlighting one would be a lie
  // about what the render does.
  // The first line ends at 4.20s and the next starts at 4.70s.
  const gap = previewAt(4.4, { captionMode: 'phrase' });
  assert.ok(gap.capWords.length, 'the line is still held rather than blanking');
  assert.equal(gap.capWords.filter(w => w.style).length, 0);
});

test('the play control reports real time and stops at the end', () => {
  const mid = previewAt(3, {});
  assert.match(mid.pvTimeLabel, /^0:03 \/ 0:\d\d$/);
  assert.ok(mid.pvProgress > 0 && mid.pvProgress < 1);
  Object.assign(StudioAdapter.ui, { screen: 'templates', pvPlaying: true, pvTime: 0 });
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [{ id: 'x', name: 'X' }], selectedTemplate: { id: 'x', name: 'X' } });
  vals.setPreviewTime(9999);
  assert.equal(StudioAdapter.ui.pvPlaying, false, 'it stops rather than running past the end');
});

test('the play control is wired, since the design leaves it decorative', () => {
  // An icon, a bar and a hardcoded 0:14, with no handler on any of it.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const fn = /function paintPreviewPlayer\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.match(fn, /togglePreviewPlay/);
  assert.match(fn, /setPreviewTime/);
  assert.doesNotMatch(fn, /setInterval/, 'scheduled to the next word, not a fixed framerate');
});

test('the words are appended so the patcher cannot eat the drag handles', () => {
  // patch() skips host-owned nodes when pairing, so one at the front would shift
  // every generated sibling by one -- and this node has four handle spans.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const fn = /function paintCaptionWords\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.match(fn, /box\.appendChild\(span\)/);
  assert.doesNotMatch(fn, /insertBefore/);
  // And it is found through the handler table, not by matching the text that is
  // the very thing changing.
  assert.match(html, /STUDIO\.handlers\.indexOf\(handler\)/);
  // Sample words are the Templates preview's business. Without this guard they
  // were also written into the clip editor's caption overlay, so the picture
  // showed "He has the whole of the dunya" over the clip's own captions.
  assert.match(fn, /screen!=='templates'\)return/);
});

test('a handler node is matched on the whole index, not a prefix of it', () => {
  // data-dc-h is "evt=index" joined by ";", so a substring selector for
  // mousedown=1 also matches mousedown=12. That is how the Templates sample
  // caption found the editor's overlay: two different handlers, one selector.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const fn = /function nodeFor\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.doesNotMatch(fn, /data-dc-h\*=/, 'substring matching is the bug');
  assert.match(fn, /Number\(index\)===i/, 'compares the parsed index');

  // The parsing itself, on the runtime's real attribute format.
  const parse = (attr, evt, i) => attr.split(';').some(pair => {
    const [name, index] = pair.split('=');
    return name === evt && Number(index) === i;
  });
  assert.equal(parse('mousedown=12', 'mousedown', 1), false, 'a prefix must not match');
  assert.equal(parse('mousedown=12', 'mousedown', 12), true);
  assert.equal(parse('click=3;mousedown=1', 'mousedown', 1), true, 'finds it among several');
  assert.equal(parse('click=1', 'mousedown', 1), false, 'the event has to match too');
});

test('the sample caption is drawn the way the caption mode will draw it', () => {
  // The design bakes one phrase in, so picking "Word by word" changed the row's
  // label and nothing else -- on the one control whose entire meaning is what
  // the caption ends up looking like.
  const text = (captionMode, extra = {}) => {
    // pvTime is shared UI state; left where an earlier test parked it, this
    // reads a different moment of the script than it means to.
    Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null, pvPlaying: false, pvTime: 0 });
    const t = { id: 'x', name: 'X', height: 1920, captionMode, ...extra };
    return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t }).capPreviewText;
  };
  assert.equal(text('word').split(' ').length, 1, 'one word at a time means one word');
  assert.ok(text('phrase').split(' ').length > 4, 'a phrase is a phrase');
  assert.equal(text('dynamic-stack', { captionStackMaxWords: 3 }).split(' ').length, 3,
    'stacked lines show as many words as the template stacks');
  assert.equal(text('dynamic-stack', { captionStackMaxWords: 6 }).split(' ').length, 6);
  // The three are genuinely different, which is the whole point.
  assert.equal(new Set([text('word'), text('phrase'), text('dynamic-stack')]).size, 3);
});

test('the preview shows what each clip layout actually does', () => {
  // The design bakes a finished vertical reel into the frame's class, so the
  // preview could not answer the question it exists for. A 9:16 still also makes
  // Fit, Blur and Fill identical: they only differ when the source is wider than
  // the output, which every lecture is.
  const style = fitMode => {
    Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null });
    const t = { id: 'x', name: 'X', height: 1920, fitMode, frameBackground: '#101014' };
    return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
  };
  assert.match(style('crop').pvImgStyle, /background-size: cover/, 'Fill crops to the frame');
  assert.match(style('contain').pvImgStyle, /background-size: contain/, 'Fit letterboxes');
  assert.match(style('contain').pvImgStyle, /background-color: #101014/, 'onto the frame colour');
  assert.match(style('blur').pvImgStyle, /background-size: contain/);
  assert.match(style('blur').pvBackStyle, /filter: blur/, 'over a blurred copy');
  assert.equal(style('crop').pvBackStyle, 'display: none;', 'and only for Blur');
});

test('the preview grades itself with the numbers the renderer uses', () => {
  // filter_values() in clip_worker.py. Approximated, not invented: ffmpeg's
  // brightness is an additive offset where CSS's is a multiplier, so it is
  // applied as 1 + b.
  const look = filterPreset => {
    Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null });
    const t = { id: 'x', name: 'X', height: 1920, filterPreset };
    return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t }).pvImgStyle;
  };
  assert.match(look('natural'), /brightness\(1\.000\) contrast\(1\.000\) saturate\(1\.000\)/);
  assert.match(look('monochrome'), /saturate\(0\.000\)/, 'monochrome is genuinely grey');
  assert.match(look('cinematic'), /brightness\(0\.985\) contrast\(1\.130\) saturate\(0\.880\)/);
  assert.match(look('crisp'), /contrast\(1\.090\)/);
});

test('the preview shows the same picture to every account', () => {
  // Youssef, 1 Sept 2026: "that's the photo going to be for the template at all
  // times." It used to be the newest lecture's own thumbnail when there was
  // one and a grey illustration when there was not, so the screen that teaches
  // what a template does looked different on every account -- and emptiest on
  // the brand-new one that most needs to see it.
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, edClipId: null });
  const t = { id: 'x', name: 'X', height: 1920 };
  const withLecture = StudioAdapter.bindings({
    projects: [{ id: 'p', sourceThumbUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' }],
    clips: [], tracks: [], templates: [t], selectedTemplate: t,
  });
  const empty = StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t });
  assert.equal(withLecture.pvSrc, '/preview-sample.webp');
  assert.equal(empty.pvSrc, withLecture.pvSrc, 'an imported lecture no longer changes the picture');
  // Served from this origin, so the studio's CSP covers it and it survives a
  // deploy -- a remote thumbnail did neither.
  assert.ok(fs.existsSync(path.join(ROOT, 'src/public/preview-sample.webp')), 'the file is in the repo');
  assert.match(empty.pvImgStyle, /preview-sample\.webp/, 'the frame paints it');
});

test('the adapter\'s own refresh repaints the host layers too', () => {
  // setRefresh re-rendered only the design's template, so every host-owned layer
  // -- live work, the second save button, the preview picture -- went stale the
  // moment a control changed something, which is exactly when they matter.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  // Coalesced to one paint per animation frame, but still a full paintStudio:
  // the adapter refreshes from pointer handlers, which fire faster than the
  // screen updates, and a render per mousemove forced a reflow each time.
  const refresh = /StudioAdapter\.setRefresh\(\(\)=>\{[\s\S]*?\n    \}\);/.exec(html)[0];
  assert.match(refresh, /requestAnimationFrame/);
  assert.match(refresh, /paintStudio\(\)/);
  assert.match(refresh, /if\(paintQueued\)return/, 'a queued paint is not queued twice');
  const paint = /function paintStudio\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  for (const fn of ['paintLiveWork', 'paintApplyLecture', 'paintPreviewPic']) {
    assert.match(paint, new RegExp(`${fn}\\(vals\\)`), `${fn} runs on every paint`);
  }
});

test('a delegated handler is told which element it was bound to', () => {
  // Events are delegated from the mount, so e.currentTarget is #studio and not
  // the element the binding was written against. Every drag measures the
  // preview frame it sits inside; handed the whole dashboard, all three of them
  // (template caption, watermark, editor caption) silently did nothing.
  const runtime = fs.readFileSync(path.join(ROOT, 'src/public/studio-runtime.js'), 'utf8');
  const invoke = /Studio\.prototype\.invoke = function[\s\S]*?\n  \};/.exec(runtime)[0];
  assert.match(invoke, /e\.dcTarget = el/, 'the bound element travels with the event');
  assert.match(invoke, /fn\.call\(el, e\)/, 'and is the handler\'s `this`');
  // The adapter must prefer it, and must not be fooled by sloppy-mode `this`.
  const adapter = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  assert.match(adapter, /e\.dcTarget \|\| \(this && this\.nodeType === 1 \? this : null\) \|\| e\.currentTarget/);
});

test('the patcher leaves host-injected nodes where the host put them', () => {
  // The live-work section is docked *inside* a generated column. patch() pairs
  // children by index, so an unguarded foreign node at index 0 gets compared
  // against the generated node at index 0, replaced, and every sibling after it
  // shifts by one — silently corrupting the column the moment its HTML changes.
  const runtime = fs.readFileSync(path.join(ROOT, 'src/public/studio-runtime.js'), 'utf8');
  assert.match(runtime, /function hostOwned\(/, 'host-owned nodes are recognised');
  assert.match(runtime, /hasAttribute\('data-host-owned'\)/);
  const fn = /function patch\(target, source\) \{[\s\S]*?\n  \}\n/.exec(runtime)[0];
  assert.match(fn, /if \(!hostOwned\(target\.childNodes\[k\]\)\) oldNodes\.push/,
    'they are skipped when pairing');
  assert.doesNotMatch(fn, /var oldNodes = target\.childNodes;/,
    'pairing against the live child list is what caused this');
  // And the element must actually carry the attribute, or the guard is inert.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  assert.match(html, /<section id="studioLiveHome"[^>]*data-host-owned/);
});

test('live work is repainted in place so its spinner keeps turning', () => {
  // Rewriting innerHTML every render destroyed each row and restarted the CSS
  // animation from frame zero, so the spinner never visibly turned.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const paint = /function paintRows\([\s\S]*?\n    }\n/.exec(html)[0];
  assert.match(paint, /dataset\.liveKey!==key/, 'the structure is only rebuilt when the jobs change');
  assert.match(paint, /textContent!==r\.meta/, 'otherwise the numbers are written into the existing nodes');
  assert.match(paint, /setAttribute\('style',r\.barStyle\)/);
});

test('the renderer patches rather than replacing, and skips identical renders', () => {
  // Replacing innerHTML on every render destroyed and rebuilt the whole tree:
  // scroll reset, CSS animations restarted from frame zero, and the screen
  // visibly flashed — every two seconds while a job runs, changed or not.
  const runtime = fs.readFileSync(path.join(ROOT, 'src/public/studio-runtime.js'), 'utf8');
  assert.match(runtime, /function patch\(/, 'a DOM patcher exists');
  assert.match(runtime, /html === this\.lastHtml/, 'an identical render touches nothing');
  // The only innerHTML write left is the first paint, where there is nothing
  // to patch against.
  const writes = runtime.match(/\.innerHTML = /g) || [];
  assert.equal(writes.length, 2, 'first paint and the detached staging node only');
});

test('a re-render never overwrites the field being typed in', () => {
  // Patching runs on a timer; without this guard a poll mid-keystroke would
  // reset the caret or the value under the user.
  const runtime = fs.readFileSync(path.join(ROOT, 'src/public/studio-runtime.js'), 'utf8');
  const guards = runtime.match(/document\.activeElement/g) || [];
  assert.ok(guards.length >= 2, 'both the attribute sync and the value pass skip the focused field');
});

// ── where live work and toasts sit on screen ──────────────────────────────

test('Home gets the docked section and every other screen gets the bar', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const paint = /function paintLiveWork\([\s\S]*?\n    }\n/.exec(html)[0];
  assert.match(paint, /screen==='home'/, 'placement is decided by the screen');
  // Never both at once: the collision originally reported was a floating bar and
  // a section on the same page.
  assert.match(paint, /bar\.classList\.toggle\('hide',!\(!onHome&&any\)\)/,
    'the floating bar is for other screens, and only when something is running');
  assert.match(paint, /if\(!any\)\{liveEls\.home\.classList\.add\('hide'\);return\}/,
    'the section never shows off Home');
  assert.match(paint, /vals\.liveAll\.map/, 'the section lists everything, not a slice');
});

test('the Home section stays put when nothing is running', () => {
  // It is meant to be stable. Hiding it whenever liveCount hit zero made it read
  // as missing entirely, since idle is the normal state.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const paint = /function paintLiveWork\([\s\S]*?\n    }\n/.exec(html)[0];
  assert.match(paint, /toggle\('hide',!any&&!docked\)/,
    'idle still shows, as long as there is a column to sit in');
  assert.match(paint, /toggle\('slh-idle',!any\)/);
  assert.match(paint, /slh-empty">\$\{esc\(vals\.liveHeadline\)\}/, 'and it says so');
  // A pulsing "live" dot with nothing live is a lie.
  assert.match(html, /#studioLiveHome\.slh-idle \.slb-dot \{[^}]*animation: none/);
});

test('the idle section does not float over a page with no column to sit in', () => {
  // A brand-new account has no library heading to anchor to. Floating "Nothing
  // is processing" over the middle of the page is worse than showing nothing.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const paint = /function paintLiveWork\([\s\S]*?\n    }\n/.exec(html)[0];
  assert.match(paint, /const docked=liveEls\.home\.classList\.contains\('slh-docked'\)/);
  assert.match(paint, /dockLiveHome\(liveEls\.home\);[\s\S]*const docked=/,
    'docking runs first, so the check reflects this render');
});

test('the idle state reports what the adapter says, not an invented string', () => {
  const vals = StudioAdapter.bindings({ projects: [], clips: [], tracks: [] });
  assert.equal(vals.liveCount, 0);
  assert.equal(vals.liveHeadline, 'Nothing is processing right now');
});

test('the Home section sits at the top of the library column, not the activity aside', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const dock = /function dockLiveHome\([\s\S]*?\n    }\n/.exec(html)[0];
  assert.match(dock, /My library/, 'anchored on the heading, not a generated class name');
  assert.doesNotMatch(dock, /Needs your review/, 'the right-hand aside is the activity column');
  // The column's parent is a two-item flex row (library | activity). Inserting a
  // sibling there would add a third column, so this must go *inside*.
  assert.match(dock, /col\.insertBefore\(el,col\.firstElementChild\)/);
  assert.match(dock, /getBoundingClientRect\(\)\.x\)===x/,
    'the column is found by geometry, which survives a re-import');
  assert.match(dock, /classList\.toggle\('slh-docked',Boolean\(col\)\)/,
    'falls back to floating rather than vanishing if the heading moves');
});

test('the docked section takes the column width and the site card treatment', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const rule = /#studioLiveHome\.slh-docked \{[^}]*\}/.exec(html)[0];
  assert.match(rule, /position: static/, 'it is in the page flow, not floating over it');
  assert.match(rule, /width: auto/, 'so it stops where the library column stops');
  assert.match(rule, /background: #121214/, "the site's own card background");
  assert.match(rule, /box-shadow: none/);
});

test('the spinner actually spins outside #studio', () => {
  // #studioLiveHome and #studioLiveBar are siblings of #studio, so the sheet's
  // `#studio .ph-circle-notch` rule never reached them and the icon sat still.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const rule = /#studioLiveHome \.ph-circle-notch, #studioLiveBar \.ph-circle-notch \{[^}]*\}/.exec(html);
  assert.ok(rule, 'the spin rule is scoped to reach both');
  assert.match(rule[0], /animation: dcSpin/);
  assert.match(rule[0], /display: inline-block/, 'a rotate on an inline box does nothing');
  // And the row must carry the inline style too, since it is what the design
  // uses for the per-kind animation.
  const row = /function liveRowHtml\([\s\S]*?\n    }\n/.exec(html)[0];
  assert.match(row, /style="\$\{esc\(r\.iconStyle\|\|''\)\}"/, 'iconStyle was being dropped');
});

test('the bar opens the queue when more than one thing is running', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const paint = /function paintLiveWork\([\s\S]*?\n    }\n/.exec(html)[0];
  assert.match(paint, /vals\.liveMore\?/, 'the expander is conditional on there being more');
  assert.match(paint, /id="slbToggle"/);
  assert.match(paint, /liveOpen\?`<div class="slb-list">/, 'expanding lists the whole queue');
  assert.match(paint, /id="slbHome"/, 'and there is a way back to the full view');
  // Both buttons must be wired; an unwired button is the dead-control bug again.
  assert.match(paint, /\$\('#slbToggle'\); if\(t\)t\.onclick=/);
  assert.match(paint, /\$\('#slbHome'\); if\(h\)h\.onclick=/);
});

test('toasts sit bottom-right, clear of the live bar', () => {
  // They were centred at the bottom, directly on top of the floating bar.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const rule = /body\.studio-active \.toasts \{[^}]*\}/.exec(html)[0];
  assert.match(rule, /right: 18px/);
  assert.match(rule, /left: auto/);
  assert.match(rule, /transform: none/, 'the design centres them with a transform');
});

// ── the editor's remaining verbs ───────────────────────────────────────────

// The frame is found by computed aspect-ratio, so a drag can be exercised
// headlessly by standing up the two DOM calls it makes.
function dragOn({ clientX, clientY, inlineFrameOnly = false } = {}) {
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, tplTimer: null });
  StudioAdapter.onTemplateField = () => {};
  const state = {
    projects: [], clips: [], tracks: [],
    templates: [{ id: 'x', name: 'X', height: 1920 }],
    selectedTemplate: { id: 'x', name: 'X', height: 1920 },
  };
  const frame = { nodeType: 1, parentElement: null, getBoundingClientRect: () => ({ top: 0, left: 0, width: 300, height: 533 }) };
  const target = { nodeType: 1, parentElement: frame, closest: sel => (/aspect-ratio/.test(sel) ? frame : null) };
  const saved = {
    add: globalThis.addEventListener, remove: globalThis.removeEventListener, computed: globalThis.getComputedStyle,
  };
  // The drag's own listeners, captured so the release can be fired. The style
  // is written once, on mouseup -- writing it on every move meant a debounced
  // PATCH landing mid-drag and the reply snapping the caption back under the
  // cursor -- so a drag that is never released now writes nothing, exactly
  // like the real one.
  const dragListeners = {};
  globalThis.addEventListener = (name, fn) => { dragListeners[name] = fn; };
  globalThis.removeEventListener = () => {};
  // The real page hoists the frame's aspect-ratio into a class, so it is only
  // ever visible through computed style. inlineFrameOnly drops that to prove the
  // fallback still finds it.
  globalThis.getComputedStyle = inlineFrameOnly ? undefined : node => ({ aspectRatio: node === frame ? '9 / 16' : 'auto' });
  try {
    StudioAdapter.bindings(state).dragCaption({ currentTarget: target, preventDefault() {}, clientX, clientY });
    if (dragListeners.mouseup) dragListeners.mouseup();
  } finally {
    globalThis.addEventListener = saved.add;
    globalThis.removeEventListener = saved.remove;
    globalThis.getComputedStyle = saved.computed;
  }
  return StudioAdapter.ui.tplDraft;
}

test('dragging a caption writes fields that reach the render', () => {
  // Vertical is a real margin (captionMarginV, 20-800 in the schema); horizontal
  // snaps to the three alignments the renderer supports, because there is no
  // free-form X to write to.
  const draft = dragOn({ clientX: 260, clientY: 460 });
  assert.equal(draft.captionHorizontal, 'right');
  assert.equal(draft.captionPosition, 'bottom');
  assert.ok(draft.captionMarginV >= 20 && draft.captionMarginV <= 800, 'within the schema range');
});

test('the drag finds the frame through a class, not only an inline style', () => {
  // The whole reason dragging did nothing: the lookup was
  // closest('[style*="aspect-ratio"]'), and the importer hoists static styles
  // into classes, so it matched nothing and makeDrag returned silently.
  const viaClass = dragOn({ clientX: 150, clientY: 100 });
  assert.ok(viaClass, 'a class-styled frame is found');
  assert.equal(viaClass.captionPosition, 'top');
  // And the inline case still works, for anywhere the frame does carry one.
  const viaInline = dragOn({ clientX: 150, clientY: 100, inlineFrameOnly: true });
  assert.ok(viaInline, 'the inline fallback still resolves');
  assert.equal(viaInline.captionPosition, 'top');
});

test('the caption snaps to the lines the label promises', () => {
  // "Drag freely — it snaps to thirds, halves and the safe-zone edges."
  const height = 533;
  const at = fraction => dragOn({ clientX: 150, clientY: fraction * height });
  // The upper third, snapped from just below it, measured down from the top.
  assert.equal(at(0.34).captionPosition, 'top');
  assert.equal(at(0.34).captionMarginV, Math.round(1920 / 3), 'the upper third');
  // The safe box's own top edge, which is 8% — not the 10% this once guessed.
  assert.equal(at(0.095).captionMarginV, Math.round(1920 * 0.08), 'the safe-zone edge');
  // The lower third, measured up from the bottom.
  assert.equal(at(0.65).captionPosition, 'bottom');
  assert.equal(at(0.65).captionMarginV, Math.round(1920 * (1 - 2 / 3)), 'the lower third');
  // Well away from a line it stays where it was put, so it is still free.
  const free = at(0.78).captionMarginV;
  assert.equal(at(0.78).captionPosition, 'bottom');
  assert.ok(Math.abs(free - 1920 * 0.22) < 12, 'lands where it was dropped');
  assert.notEqual(free, Math.round(1920 * 0.1));
});

test('the caption margin is measured from the edge it is anchored to', () => {
  // ASS MarginV is relative to the alignment's own edge (alignment_for in
  // clip_worker.py). Measuring always from the bottom put a top-aligned caption
  // at the wrong height in the export while looking right in the preview.
  const height = 533;
  const top = dragOn({ clientX: 150, clientY: 0.15 * height });
  assert.equal(top.captionPosition, 'top');
  assert.ok(Math.abs(top.captionMarginV - 1920 * 0.15) < 30, 'measured down from the top');
  const bottom = dragOn({ clientX: 150, clientY: 0.85 * height });
  assert.equal(bottom.captionPosition, 'bottom');
  assert.ok(Math.abs(bottom.captionMarginV - 1920 * 0.15) < 30, 'measured up from the bottom');
});

test('dead centre snaps to middle, which is the one place it belongs', () => {
  const mid = dragOn({ clientX: 150, clientY: 0.5 * 533 });
  assert.equal(mid.captionPosition, 'middle');
  assert.equal(mid.captionMarginV, undefined, 'MarginV is ignored for middle alignments');
});

test('the caption follows the cursor across the whole frame', () => {
  // Anchoring to thirds left the middle third dead: a middle alignment ignores
  // MarginV, so everything from 34% to 66% collapsed onto one fixed spot and
  // the caption stopped moving across a third of the preview. Anchoring to the
  // nearer edge instead makes every height reachable.
  const height = 533;
  const at = f => dragOn({ clientX: 150, clientY: f * height });
  const seen = [];
  // Inside the safe box, since the drag is clamped to it.
  for (const f of [0.12, 0.18, 0.25, 0.4, 0.45, 0.55, 0.6, 0.72, 0.78, 0.83]) {
    const d = at(f);
    seen.push(`${d.captionPosition}:${d.captionMarginV}`);
  }
  assert.equal(new Set(seen).size, seen.length, `every drop is distinct: ${seen.join(' ')}`);
  // Either side of the middle anchors to its nearer edge.
  assert.equal(at(0.45).captionPosition, 'top');
  assert.equal(at(0.55).captionPosition, 'bottom');
  // And near-centre is reachable, which needs the 960 cap: 800 left a band
  // around the middle that could not be reached from either side.
  assert.ok(at(0.45).captionMarginV > 800, 'the old cap would have clamped this');
});

test('the preview shows where the caption actually is', () => {
  // capStyle ignored captionMarginV, so the box only ever jumped between three
  // fixed spots — dragging looked broken even once the drag worked, because the
  // preview could not show the result.
  const style = extra => {
    Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null });
    const t = { id: 'x', name: 'X', height: 1920, ...extra };
    return StudioAdapter.bindings({ projects: [], clips: [], tracks: [], templates: [t], selectedTemplate: t }).capStyle;
  };
  assert.match(style({ captionMarginV: 192, captionPosition: 'bottom' }), /bottom: 10\.00%/);
  assert.match(style({ captionMarginV: 192, captionPosition: 'top' }), /top: 10\.00%/, 'anchored to its own edge');
  // Middle ignores the margin and stays centred, as the renderer does.
  assert.match(style({ captionMarginV: 192, captionPosition: 'middle' }), /top: 50%/);
  // The schema's own floor (captionMarginV 20 of a 1920 frame) shows true:
  // 20/1920 = 1.04%, exactly where the render puts it.
  assert.match(style({ captionMarginV: 20, captionPosition: 'bottom' }), /bottom: 1\.04%/);
});

test('the editor offers to spread a look across the lecture, sized to it', () => {
  const state = {
    projects: [{ id: 'p1', title: 'Lecture' }], tracks: [], templates: [], selectedTemplate: null,
    clips: [
      { id: 'c1', projectId: 'p1', title: 'One', transcript: 'a' },
      { id: 'c2', projectId: 'p1', title: 'Two' },
      { id: 'c3', projectId: 'p1', title: 'Three' },
      { id: 'c4', projectId: 'p1', title: 'Posted', status: 'posted' },
      { id: 'other', projectId: 'p2', title: 'Different lecture' },
    ],
  };
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'c1' });
  // Two siblings: not itself, not the posted one, and not the other lecture's.
  assert.equal(StudioAdapter.bindings(state).edLectureOthers, 2);
  Object.assign(StudioAdapter.ui, { edClipId: 'other' });
  assert.equal(StudioAdapter.bindings(state).edLectureOthers, 0, 'a lone clip has nothing to spread to');
});

test('the second save button is only offered when it would do something', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const paint = /function paintApplyLecture\([\s\S]*?\n    \}\n/.exec(html)[0];
  assert.match(paint, /toggle\('hide',!\(inEditor&&others>0\)\)/);
  assert.match(paint, /Save to all \$\{others \+ 1\} clips/, 'the label counts this clip too');
  assert.match(paint, /save\.parentElement\.insertBefore\(applyEl,save\)/, 'docked beside Save clip');
  assert.match(html, /<button id="studioApplyLecture"[^>]*data-host-owned/, 'the patcher must leave it alone');
});

test('spreading a look flushes the pending edit first', () => {
  // The style panel debounces by 450ms and the server is the source the spread
  // copies from, so without a flush the siblings would be given the look from
  // before the last half-second — leaving the clip being edited the odd one out.
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const fn = /StudioAdapter\.onApplyToLecture=[\s\S]*?renderAll\(\)\}\)\};/.exec(html)[0];
  assert.match(fn, /await StudioAdapter\.flushClipStyle\(\)/);
  assert.match(fn, /scope:'lecture'/);
  const adapter = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  assert.match(adapter, /flushClipStyle: function \(\)/);
  assert.match(adapter, /clearTimeout\(UI\.edStyleTimer\)/, 'the debounce is cancelled, not raced');
});

test('the editor save writes to that clip and never to the shared style', () => {
  // This is the whole point of per-clip overrides: editing one clip used to
  // change every clip built on the same style.
  Object.assign(StudioAdapter.ui, {
    screen: 'editor', edClipId: 'cap1', edBlock: 0, edBlockDraft: null,
    edStyleDraft: { captionFontSize: 48 }, edStyleTimer: null, edSaving: false,
  });
  let styledClip = null; let stylePatch = null; let savedClip = null;
  let templateWrites = 0;
  StudioAdapter.onSaveTemplate = () => { templateWrites += 1; };
  StudioAdapter.onClipStyle = (id, patch) => { styledClip = id; stylePatch = patch; };
  StudioAdapter.onSaveClip = (id) => { savedClip = id; };
  StudioAdapter.bindings(CAPTION_STATE).saveEdit({ preventDefault() {} });
  assert.equal(styledClip, 'cap1');
  assert.deepEqual(stylePatch, { captionFontSize: 48 });
  assert.equal(savedClip, 'cap1');
  assert.equal(templateWrites, 0, 'the editor must never write the shared style');
  StudioAdapter.onSaveTemplate = () => {};
});

test('a pending slider change is flushed by save, not dropped', () => {
  // The debounce holds the last ~450ms of movement. Saving before it fires used
  // to lose whatever the user had just adjusted.
  Object.assign(StudioAdapter.ui, {
    screen: 'editor', edClipId: 'cap1', edBlock: 0, edBlockDraft: null,
    edStyleDraft: null, edStyleTimer: null, edSaving: false,
  });
  let patch = null;
  StudioAdapter.onClipStyle = (id, p) => { patch = p; };
  StudioAdapter.onSaveClip = () => {};
  StudioAdapter.bindings(CAPTION_STATE).setSize({ target: { value: '55' } });
  StudioAdapter.bindings(CAPTION_STATE).saveEdit({ preventDefault() {} });
  assert.deepEqual(patch, { captionFontSize: 55 }, 'the in-flight change reaches the server');
});

test('the editor save button says what it does', () => {
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'cap1', edSaving: false });
  assert.equal(StudioAdapter.bindings(CAPTION_STATE).edSaveLabel, 'Save clip');
});

test('the timeline playhead follows where the bar was clicked', () => {
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'cap1', edPlayhead: 0 });
  const bar = { getBoundingClientRect: () => ({ left: 0, width: 400 }) };
  StudioAdapter.bindings(CAPTION_STATE).seek({ currentTarget: bar, clientX: 200 });
  const vals = StudioAdapter.bindings(CAPTION_STATE);
  assert.match(vals.edPlayHeadStyle, /left: 50\.00%/);
  assert.equal(vals.edProgressLabel, '0:04', 'the readout follows the head on an 8s clip');
});

test('Recut clips uses the endpoint that exists rather than claiming to be unavailable', () => {
  Object.assign(StudioAdapter.ui, { screen: 'detail', openProject: 'p1' });
  let asked = null;
  StudioAdapter.onPickOption = (title, options, cb) => { asked = options; cb('Cut 4 more clips'); };
  let requested = null;
  StudioAdapter.onMoreClips = (projectId, n) => { requested = { projectId, n }; };
  StudioAdapter.bindings(CAPTION_STATE).recutClips({ preventDefault() {} });
  assert.ok(asked, 'it offers a choice');
  assert.deepEqual(requested, { projectId: 'p1', n: 4 });
});

const TPL_STATE = {
  projects: [], clips: [], tracks: [],
  templates: [{ id: 'x', name: 'X', height: 1920, captionFontSize: 96, filterPreset: 'natural' }],
  selectedTemplate: { id: 'x', name: 'X', height: 1920, captionFontSize: 96, filterPreset: 'natural' },
};

function templatesScreen(extra = {}) {
  Object.assign(StudioAdapter.ui, {
    screen: 'templates', tplDraft: null, tplDirty: false, tplTimer: null,
    tplPast: [], tplFuture: [], tplReplaying: false, ...extra,
  });
  StudioAdapter.onTemplateField = () => {};
  StudioAdapter.onResetTemplate = () => {};
  return StudioAdapter.bindings(TPL_STATE);
}

test('Undo discards unsaved template edits when there is no history', () => {
  templatesScreen({ tplDraft: { captionFontSize: 42 }, tplDirty: true });
  StudioAdapter.bindings(TPL_STATE).undoEdit({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.tplDraft, null);
  assert.equal(StudioAdapter.ui.tplDirty, false);
});

test('Undo steps back through edits, and Redo puts them back', () => {
  // Redo was a button whose entire behaviour was explaining that it did nothing.
  templatesScreen();
  // Two real edits through the same path every control uses.
  StudioAdapter.bindings(TPL_STATE).setSize({ target: { value: '120' } });
  assert.equal(StudioAdapter.ui.tplDraft.captionFontSize, 120);
  assert.equal(StudioAdapter.ui.tplPast.length, 1, 'the step was recorded');

  StudioAdapter.bindings(TPL_STATE).undoEdit({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.tplDraft.captionFontSize, 96, 'back to where it started');
  assert.equal(StudioAdapter.ui.tplPast.length, 0);
  assert.equal(StudioAdapter.ui.tplFuture.length, 1);

  StudioAdapter.bindings(TPL_STATE).redoEdit({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.tplDraft.captionFontSize, 120, 'and forward again');
  assert.equal(StudioAdapter.ui.tplFuture.length, 0);
  assert.equal(StudioAdapter.ui.tplPast.length, 1);
});

test('replaying a step does not record its own inverse', () => {
  // Without the guard, undo pushes the reverse onto the past and the two buttons
  // fight each other -- Undo then Undo lands back where it started.
  templatesScreen();
  StudioAdapter.bindings(TPL_STATE).setSize({ target: { value: '120' } });
  StudioAdapter.bindings(TPL_STATE).undoEdit({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.tplPast.length, 0, 'the undo did not become a new step');
});

test('a fresh edit drops anything that was undone past', () => {
  templatesScreen();
  StudioAdapter.bindings(TPL_STATE).setSize({ target: { value: '120' } });
  StudioAdapter.bindings(TPL_STATE).undoEdit({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.tplFuture.length, 1);
  StudioAdapter.bindings(TPL_STATE).setSize({ target: { value: '64' } });
  assert.equal(StudioAdapter.ui.tplFuture.length, 0, 'the abandoned branch is gone');
});

test('a change that changes nothing is not recorded', () => {
  // Every control writes on each input event, so re-selecting the current value
  // would otherwise fill the history with steps that do nothing.
  templatesScreen();
  StudioAdapter.bindings(TPL_STATE).setSize({ target: { value: '96' } });
  assert.equal(StudioAdapter.ui.tplPast.length, 0);
});

test('Preview on a real clip opens one, when the template has produced any', () => {
  // It was a message even when the account had clips built on the very template
  // being edited.
  const withClip = {
    ...TPL_STATE,
    clips: [
      { id: 'old', templateId: 'x', title: 'Older', thumbUrl: '/t/old.jpg', readyAt: 1000 },
      { id: 'new', templateId: 'x', title: 'Newest', thumbUrl: '/t/new.jpg', readyAt: 9000 },
      { id: 'other', templateId: 'y', title: 'Different template', thumbUrl: '/t/o.jpg', readyAt: 9999 },
    ],
  };
  Object.assign(StudioAdapter.ui, { screen: 'templates', playerClip: null, tplDraft: null, tplPast: [], tplFuture: [] });
  StudioAdapter.bindings(withClip).previewClip({ preventDefault() {} });
  assert.ok(StudioAdapter.ui.playerClip, 'the player opens');
  assert.equal(StudioAdapter.ui.playerClip.id, 'new', 'the newest clip on this template');
});

test('Preview says nothing has been rendered yet rather than opening nothing', () => {
  Object.assign(StudioAdapter.ui, { screen: 'templates', playerClip: null });
  const said = [];
  StudioAdapter.onToast = m => said.push(m);
  StudioAdapter.bindings(TPL_STATE).previewClip({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.playerClip, null);
  assert.match(said[0], /No clip has been rendered with this template yet/);
});

test('Redo says so when there is nothing to redo', () => {
  templatesScreen();
  const said = [];
  StudioAdapter.onToast = m => said.push(m);
  StudioAdapter.bindings(TPL_STATE).redoEdit({ preventDefault() {} });
  assert.deepEqual(said, ['Nothing to redo.']);
});

test('every configured posting time is shown, even past the design\'s three rows', () => {
  // The design draws three window rows; the default schedule has four. The
  // fourth used to disappear from the panel while clips were visibly scheduled
  // into it.
  Object.assign(StudioAdapter.ui, { screen: 'schedule' });
  const vals = StudioAdapter.bindings({ ...SAMPLE_STATE, postTimes: ['07:00', '12:00', '17:00', '20:30'] });
  const shown = [vals.postWindow1, vals.postWindow2, vals.postWindow3].join(' ');
  for (const time of ['07:00', '12:00', '17:00', '20:30']) {
    assert.ok(shown.includes(time), `${time} must appear somewhere in the panel`);
  }
  assert.equal(vals.postWindowName3, 'Evening · Late', 'names line up with the times beside them');
});

test('a three-slot schedule still renders one time per row', () => {
  Object.assign(StudioAdapter.ui, { screen: 'schedule' });
  const vals = StudioAdapter.bindings({ ...SAMPLE_STATE, postTimes: ['08:00', '13:00', '19:30'] });
  assert.equal(vals.postWindow3, '19:30');
  assert.equal(vals.postWindowName3, 'Late');
});

// ── dead-control guard ─────────────────────────────────────────────────────
// studio-runtime.js skips any `on` binding that does not resolve to a function.
// The element still renders -- styled, cursor:pointer, indistinguishable from a
// live control -- with no listener. Every dead control in this dashboard shipped
// that way, and `npm run design:check` cannot catch it because it only validates
// top-level binding names, not loop-scoped item properties like `opt.pick`.
//
// This asserts the whole dashboard wires up. If it fails, the named binding is
// in the template and missing from studio-adapter.js.

const EVERY_SCREEN = ['home', 'queue', 'library', 'detail', 'schedule', 'templates',
  'music', 'language', 'performance', 'editor', 'tokens'];

// The nav rail's hover handlers are deliberately null. Driving hover from JS
// re-rendered the whole dashboard through innerHTML, which replaced the element
// under the pointer -- and a browser only fires `click` when mousedown and
// mouseup land on the same element, so nothing was clickable. Hover is CSS now.
const INTENTIONALLY_UNWIRED = new Set(['mouseenter', 'mouseleave']);

test('no screen renders a control the adapter never wired', () => {
  const dead = [];
  for (const screen of EVERY_SCREEN) {
    const { missing } = renderScreen(screen, { edClipId: 'c1', openProject: 'p1' });
    for (const m of missing) {
      if (INTENTIONALLY_UNWIRED.has(m.event)) continue;
      const entry = `${screen}: <${m.tag} ${m.event}> -> ${m.binding}`;
      if (!dead.includes(entry)) dead.push(entry);
    }
  }
  assert.deepEqual(dead, [], 'these controls render but do nothing when clicked');
});

test('the guard actually detects a dead control', () => {
  // Without this, a change that silently stopped populating `missing` would make
  // the test above pass forever while dead controls shipped again.
  const ast = [{ t: 'el', tag: 'button', on: { click: { p: 'notSupplied' } }, ch: ['x'] }];
  const { missing, handlers } = render(ast, { somethingElse: () => {} });
  assert.equal(handlers.length, 0, 'nothing was wired');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].binding, 'notSupplied');
  assert.equal(missing[0].event, 'click');
});

test('a loop-scoped item binding is caught too, not just top-level names', () => {
  // `opt.pick` was exactly this shape: design:check saw `sheetOptions` supplied
  // and passed, while every option row inside the loop had no listener.
  const ast = [{
    t: 'for', l: { p: 'rows' }, as: 'row',
    ch: [{ t: 'el', tag: 'a', on: { click: { p: 'row.choose' } }, ch: ['r'] }],
  }];
  const { missing } = render(ast, { rows: [{ label: 'a' }, { label: 'b' }] });
  assert.equal(missing.length, 2, 'one per rendered row');
  assert.equal(missing[0].binding, 'row.choose');
});

// ── the new-job range picker ───────────────────────────────────────────────
const JOB_STATE = { ...SAMPLE_STATE, tracks: [{ id: 't1', name: 'N' }] };
const LECTURE = { url: 'https://youtu.be/x', title: 'E68', durationSec: 5242, durationKnown: true, start: 0, end: 5242 };

test('the range handles address the whole lecture, not its first 100 seconds', () => {
  // The design's inputs are min=0 max=100 -- a percentage. They were fed and
  // read as seconds, so on an 87-minute talk the entire slider covered under
  // two minutes.
  Object.assign(StudioAdapter.ui, { screen: 'home', job: { ...LECTURE } });
  const vals = StudioAdapter.bindings(JOB_STATE);
  assert.equal(vals.jobStart, 0);
  assert.equal(vals.jobEnd, 100, 'a full selection puts the end handle at the far end');

  // Dragging the end handle to the middle must select half the lecture.
  vals.setJobEnd({ target: { value: '50' } });
  assert.equal(Math.round(StudioAdapter.ui.job.end), 2621, 'half of 5242 seconds');
});

test('the handles cannot cross or select less than the server allows', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home', job: { ...LECTURE, start: 0, end: 5242 } });
  const vals = StudioAdapter.bindings(JOB_STATE);
  vals.setJobStart({ target: { value: '100' } });
  const gap = StudioAdapter.ui.job.end - StudioAdapter.ui.job.start;
  assert.ok(gap >= 30, `the 30s minimum is kept, got ${gap}`);
});

test('the panel states the real length instead of the design placeholder', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home', job: { ...LECTURE } });
  const vals = StudioAdapter.bindings(JOB_STATE);
  assert.match(vals.jobRangeHint, /87:22/, 'every lecture used to claim to be 42:11 long');
  assert.doesNotMatch(vals.jobRangeHint, /42:11/);
});

test('an unknown length offers no range rather than a fake one', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home', job: { ...LECTURE, durationKnown: false, durationSec: null } });
  const vals = StudioAdapter.bindings(JOB_STATE);
  assert.equal(vals.jobRangeHint, '');
  assert.equal(vals.jobStart, 0);
  assert.equal(vals.jobEnd, 100);
});

test('the job poster shows the video, not a baked-in marketing image', () => {
  // The design hardcoded reel-kaaba-a.webp into this element's style, and the
  // URL was repo-relative so it 404'd as well — every lecture previewed with
  // the same empty box.
  Object.assign(StudioAdapter.ui, {
    screen: 'home',
    job: { ...LECTURE, thumbnail: 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg' },
  });
  const vals = StudioAdapter.bindings(JOB_STATE);
  assert.match(vals.jobPosterStyle, /i\.ytimg\.com\/vi\/abc123/);
  assert.doesNotMatch(vals.jobPosterStyle, /reel-kaaba/);
  assert.doesNotMatch(vals.jobPosterStyle, /src\/public/, 'no repo-relative URL can reach the browser');
  assert.match(vals.jobPosterStyle, /aspect-ratio: 16 \/ 9/, 'the design\'s framing is preserved');
});

test('a source with no thumbnail degrades to the plain frame', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home', job: { ...LECTURE, thumbnail: '' } });
  const vals = StudioAdapter.bindings(JOB_STATE);
  assert.doesNotMatch(vals.jobPosterStyle, /url\(/, 'no broken image request');
  assert.match(vals.jobPosterStyle, /aspect-ratio/);
});

test('a thumbnail URL cannot break out of the style attribute', () => {
  Object.assign(StudioAdapter.ui, {
    screen: 'home',
    job: { ...LECTURE, thumbnail: 'https://x/y.jpg") ; background: url("evil' },
  });
  const vals = StudioAdapter.bindings(JOB_STATE);
  assert.doesNotMatch(vals.jobPosterStyle, /background: url\("evil/);
});

test('a missing maxres thumbnail falls through to one that always exists', () => {
  // YouTube serves a 404 page for maxresdefault on uploads that never got one,
  // which painted the poster as an empty black box.
  Object.assign(StudioAdapter.ui, {
    screen: 'home',
    job: { ...LECTURE, url: 'https://www.youtube.com/watch?v=MaXPMQ7vJzo', thumbnail: 'https://i.ytimg.com/vi/MaXPMQ7vJzo/maxresdefault.jpg' },
  });
  const vals = StudioAdapter.bindings(JOB_STATE);
  assert.match(vals.jobPosterStyle, /maxresdefault/);
  assert.match(vals.jobPosterStyle, /hqdefault/, 'a second layer shows through when the first 404s');
  assert.ok(vals.jobPosterStyle.indexOf('maxresdefault') < vals.jobPosterStyle.indexOf('hqdefault'),
    'the sharper image is tried first');
});

test('both range handles sit on one track', () => {
  // The design put one at top:2px and the other at bottom:2px, which read as
  // two separate sliders.
  Object.assign(StudioAdapter.ui, { screen: 'home', job: { ...LECTURE } });
  const vals = StudioAdapter.bindings(JOB_STATE);
  for (const style of [vals.jobRangeStartStyle, vals.jobRangeEndStyle]) {
    assert.match(style, /top: 50%/, 'both handles share a vertical position');
    assert.match(style, /pointer-events: none/, 'the input must not swallow clicks meant for the other handle');
    assert.doesNotMatch(style, /bottom: 2px/);
  }
  assert.notEqual(vals.jobRangeStartStyle, vals.jobRangeEndStyle, 'the two handles stay visually distinct');
});

test('opening a job keeps the thumbnail the probe returned', () => {
  // openJob rebuilt the job object field by field and dropped `thumbnail`, so
  // the poster had nothing to show however it was wired.
  StudioAdapter.openJob({
    url: 'https://www.youtube.com/watch?v=abc123',
    title: 'A lecture',
    durationSec: 2400,
    thumbnail: 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg',
  });
  assert.equal(StudioAdapter.ui.job.thumbnail, 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg');

  Object.assign(StudioAdapter.ui, { screen: 'home' });
  const vals = StudioAdapter.bindings(JOB_STATE);
  assert.match(vals.jobPosterStyle, /background-image/, 'the poster actually paints something');
  assert.match(vals.jobPosterStyle, /abc123/);
});

test('sign-in entries collapse to the newest and never light the unread dot', () => {
  const state = JSON.parse(JSON.stringify(SAMPLE_STATE));
  const now = Date.now();
  state.log = [
    { level: 'info', message: 'Signed in someone@example.com with email.', at: now - 1000 },
    { level: 'info', message: 'Signed in someone@example.com with email.', at: now - 2000 },
    { level: 'info', message: 'Signed in someone@example.com with email.', at: now - 3000 },
    { level: 'info', message: 'Rendered "Clip one"', at: now - 4000 },
  ];
  const vals = StudioAdapter.bindings(state);
  const signIns = vals.activity.filter((row) => /^Signed in /.test(row.text));
  assert.equal(signIns.length, 1, 'only the newest sign-in survives');
  assert.ok(vals.activity.some((row) => /Rendered/.test(row.text)), 'real activity stays');
});

test('the chosen nasheed travels with the job', () => {
  const state = JSON.parse(JSON.stringify(SAMPLE_STATE));
  state.tracks = [{ id: 't1', name: 'Nasheed one' }, { id: 't2', name: 'Nasheed two' }];
  StudioAdapter.openJob({ url: 'https://youtu.be/x', title: 'Talk', durationSec: 600 });
  StudioAdapter.ui.jobTrackId = 't2';
  let sent = null;
  StudioAdapter.onGenerate = (url, range, opts) => { sent = opts; };
  StudioAdapter.bindings(state).runGenerate({ preventDefault() {} });
  assert.equal(sent.musicTrackId, 't2');
  StudioAdapter.ui.generating = false;
  StudioAdapter.ui.jobTrackId = null;
  StudioAdapter.onGenerate = () => {};
});

test('the editor previews the render itself, not a browser imitation of it', () => {
  // CLAUDE.md: one timeline origin. The editor used to play the uncaptioned
  // source with CSS captions drawn over it -- a second rendering engine that
  // could never agree with libass on line breaking, spacing, outline or word
  // timing, and whose clip-local overlay drifted against a whole-lecture
  // video. It plays the rendered clip now.
  const state = JSON.parse(JSON.stringify(SAMPLE_STATE));
  const clip = state.clips[0];
  StudioAdapter.ui.screen = 'editor';
  StudioAdapter.ui.edClipId = clip.id;
  StudioAdapter.ui.edSourceFallback = false;
  const vals = StudioAdapter.bindings(state);
  assert.match(vals.edVideoUrl, /\/video\?rv=/, 'the rendered clip, cache-busted by render version');
  assert.doesNotMatch(vals.edVideoUrl, /source-preview/);
  assert.equal(vals.edStartSec, 0, 'the render IS the clip: no offset arithmetic');
  assert.equal(vals.edCapWords.length, 0, 'no CSS captions are drawn over the render');
  assert.equal(vals.edSourceNote, '', 'nothing to warn about while the render plays');

  // The fallback stays, and says what it is.
  StudioAdapter.ui.edSourceFallback = true;
  const fallback = StudioAdapter.bindings(state);
  assert.match(fallback.edVideoUrl, /source-preview/);
  assert.match(fallback.edSourceNote, /uncaptioned source/i, 'labelled, never passed off as the clip');
  assert.equal(fallback.edStartSec, Number(clip.startSec) || 0, 'only this path needs the offset');
  StudioAdapter.ui.edSourceFallback = false;
  StudioAdapter.ui.screen = 'home';
  StudioAdapter.ui.edClipId = null;
});

test('the caption overlay is a positioning ghost, loud only while dragging', () => {
  const state = JSON.parse(JSON.stringify(SAMPLE_STATE));
  StudioAdapter.ui.screen = 'editor';
  StudioAdapter.ui.edClipId = state.clips[0].id;
  const idle = StudioAdapter.bindings(state).edCapOverlayStyle;
  assert.match(idle, /dashed/, 'a faint handle at rest');
  assert.doesNotMatch(idle, /font-family/, 'it carries no type from the template');
  StudioAdapter.ui.dragKind = 'caption';
  const dragging = StudioAdapter.bindings(state).edCapOverlayStyle;
  assert.match(dragging, /solid rgba\(240,214,166/, 'and fills while the drag is live');
  StudioAdapter.ui.dragKind = null;
  StudioAdapter.ui.screen = 'home';
  StudioAdapter.ui.edClipId = null;
});

test('a new account gets the guided tour, and it can be reopened', () => {
  const fresh = JSON.parse(JSON.stringify(SAMPLE_STATE));
  fresh.projects = [];
  fresh.clips = [];
  // Tours are per screen now, so a step belongs to a screen: tourHere and
  // startTour both set the pair together. Setting only `screen` reads as
  // navigating away, which correctly abandons whatever tour was running.
  StudioAdapter.ui.screen = 'home';
  StudioAdapter.ui.tourScreen = 'home';
  StudioAdapter.ui.tourStep = 0;
  // A tour never starts on top of another layer, so nothing else may be open.
  Object.assign(StudioAdapter.ui, { job: null, playerClip: null, sheet: null, connProvider: null });
  const vals = StudioAdapter.bindings(fresh);
  assert.equal(vals.tourOn, true, 'the design ships the tour; it must actually run');
  // Not a magic number: the count and the dots must simply agree with each
  // other and with the steps that actually have an anchor on screen.
  const total = vals.tourDots.length;
  assert.ok(total >= 3, 'Home walks through the whole pipeline');
  assert.match(vals.tourCount, new RegExp(`Step 1 of ${total}`));
  assert.ok(vals.tourTitle.length > 0 && vals.tourBody.length > 0, 'a step says something');
  assert.doesNotMatch(vals.tourVeilStyle, /display: none/, 'the page dims behind it');

  // Every step must point at an anchor the markup actually carries, or the
  // spotlight highlights nothing.
  const page = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  for (const anchor of ['paste', 'start', 'rail']) {
    assert.ok(page.includes(`"data-tour":"${anchor}"`), `the ${anchor} anchor exists in the template`);
  }

  // Last step commits, and the tour is repeatable from the account menu.
  StudioAdapter.ui.tourScreen = 'home';
  StudioAdapter.ui.tourStep = total - 1;
  const last = StudioAdapter.bindings(fresh);
  assert.equal(last.tourNextLabel, 'Start clipping');
  assert.equal(typeof last.startTour, 'function', 'a first-run-only tour would be a dead end');

  StudioAdapter.ui.tourStep = -1;
  const off = StudioAdapter.bindings(fresh);
  assert.equal(off.tourOn, false);
  assert.match(off.tourCardStyle, /display: none/);
  StudioAdapter.ui.screen = 'home';
});

test('the setup celebration cannot fire before all five steps are genuinely done', () => {
  // The list is derived from account data rather than a "dismissed" flag, and
  // the congratulation has to be derived the same way -- a popup that fires
  // because someone visited a screen congratulates them for nothing.
  // Shapes read off the adapter, not guessed: tracks live at DATA.tracks, a
  // clip counts as approved when its status is in SETTLED, and `connected`
  // comes from DATA.social.providers.<key>.connected.
  const soon = Date.now() + 86400000;
  const done = {
    tracks: [{ id: 't', name: 'nasheed' }],
    projects: [{ id: 'p', title: 'lecture', status: 'done' }],
    clips: [{ id: 'c', projectId: 'p', status: 'approved', scheduledAt: soon }],
    social: { providers: { youtube: { connected: true, accounts: [{ id: 'a', name: 'ch' }] } } },
  };
  assert.equal(StudioAdapter.bindings({}).setupComplete, false, 'an empty account has done nothing');

  // Every step removed in turn must hold the celebration back.
  const withoutMusic = StudioAdapter.bindings({ ...done, tracks: [] });
  assert.equal(withoutMusic.setupComplete, false, 'no nasheed');

  const withoutProject = StudioAdapter.bindings({ ...done, projects: [] });
  assert.equal(withoutProject.setupComplete, false, 'no lecture');

  const withoutApproval = StudioAdapter.bindings({
    ...done,
    clips: [{ id: 'c', projectId: 'p', status: 'waiting', scheduledAt: soon }],
  });
  assert.equal(withoutApproval.setupComplete, false, 'nothing approved');

  const withoutConnection = StudioAdapter.bindings({ ...done, social: { providers: {} } });
  assert.equal(withoutConnection.setupComplete, false, 'nowhere to post');

  // A clip that was never given a time is the one that holds the step back.
  const neverSlotted = StudioAdapter.bindings({
    ...done,
    clips: [{ id: 'c', projectId: 'p', status: 'approved' }],
  });
  assert.equal(neverSlotted.setupComplete, false, 'no clip has been given a time');

  // A lapsed slot DOES count, and this assertion used to say the opposite.
  // "Give a clip a time" is an action someone performed, not a state that
  // expires: reading it as expiring un-ticked the step hours later and brought
  // the whole checklist back to tell a working account it was not set up.
  const pastSlotOnly = StudioAdapter.bindings({
    ...done,
    clips: [{ id: 'c', projectId: 'p', status: 'approved', scheduledAt: Date.now() - 86400000 }],
  });
  assert.equal(pastSlotOnly.setupComplete, true, 'a slot that has come and gone was still a slot');

  // And the case that made it worst: succeeding. A posted clip leaves the
  // scheduled list entirely, so the step used to un-tick after every post.
  const posted = StudioAdapter.bindings({
    ...done,
    clips: [{ id: 'c', projectId: 'p', status: 'posted', scheduledAt: Date.now() - 86400000, postedAt: Date.now() - 3600000 }],
  });
  assert.equal(posted.setupComplete, true, 'publishing is more than scheduling, never less');
  assert.equal(posted.startListOn, false, 'and the checklist does not come back after a post');

  // And it must agree with the list it is celebrating: the list hides itself
  // at exactly the moment the celebration is allowed to fire.
  const all = StudioAdapter.bindings(done);
  assert.equal(all.setupComplete, true, 'all five done');
  assert.equal(all.startListOn, false, 'the checklist stands down at the same moment');
});

// ── the vanishing edit ──────────────────────────────────────────────────────
// Three bugs made a typed caption look like it had been thrown away. The edit
// was usually saved; the user watched it disappear anyway and concluded the
// product loses work.

const EDIT_STATE = {
  ...SAMPLE_STATE,
  clips: [{
    id: 'c1', title: 'Whoever wakes safe', status: 'waiting', score: 92,
    durationMs: 38000, projectId: 'p1', targets: [],
    captionSegments: [
      { start: 0, end: 2, text: 'first line here' },
      { start: 2, end: 4, text: 'second line here' },
    ],
  }],
};

const openEditor = (patch = {}) => {
  Object.assign(StudioAdapter.ui, {
    screen: 'editor', edClipId: 'c1', edBlock: 0, edBlockDraft: null,
    edDirty: false, tplPast: [], tplFuture: [], tplHistCtx: null, capTextStepAt: 0,
    bellOpen: false, menuOpen: false, railOpen: true,
  }, patch);
  return StudioAdapter.bindings(EDIT_STATE);
};

test('the caption box shows the draft, not the stored words', () => {
  const vals = openEditor({ edBlockDraft: 'my corrected words' });
  assert.equal(vals.edSelText, 'my corrected words',
    'bound to the stored text, this box visibly reverted the moment it lost focus');
});

test('with no draft the caption box still shows the real text', () => {
  const vals = openEditor();
  assert.equal(vals.edSelText, 'first line here');
});

test('typing a caption is undoable', () => {
  const vals = openEditor();
  vals.setCapText({ target: { value: 'first line HERE' } });
  assert.equal(StudioAdapter.ui.edBlockDraft, 'first line HERE');
  assert.equal(StudioAdapter.ui.tplPast.length, 1, 'a caption edit must record a step');
  assert.equal(StudioAdapter.ui.tplPast[0].kind, 'text');

  StudioAdapter.bindings(EDIT_STATE).undoEdit({ preventDefault() {}, stopPropagation() {} });
  assert.equal(StudioAdapter.ui.edBlockDraft, 'first line here', 'undo must put the original words back');
});

test('a burst of typing is one undo step, not one per keystroke', () => {
  const vals = openEditor();
  for (const value of ['f', 'fi', 'fix', 'fixe', 'fixed']) {
    vals.setCapText({ target: { value } });
  }
  assert.equal(StudioAdapter.ui.tplPast.length, 1,
    'fifty steps to walk back one word is the same as having no undo');
  assert.equal(StudioAdapter.ui.tplPast[0].redo.draft, 'fixed');
  assert.equal(StudioAdapter.ui.tplPast[0].undo.draft, 'first line here');
});

test('undoing a caption does not lose the unsaved flag', () => {
  const vals = openEditor();
  vals.setCapText({ target: { value: 'changed' } });
  StudioAdapter.bindings(EDIT_STATE).undoEdit({ preventDefault() {}, stopPropagation() {} });
  assert.equal(StudioAdapter.ui.edDirty, true,
    'the clip still differs from what is rendered, so Save must stay offered');
});

// ── getting the file out ────────────────────────────────────────────────────
// A customer's only route to their own MP4 used to be publishing it to a
// connected platform. The download route was built, tested, and called by
// nothing in the shell people actually use.

test('the editor offers a real download, not a settings readout', () => {
  const vals = openEditor({ edTool: 'export' });
  assert.equal(typeof vals.downloadClip, 'function', 'the Export tab must hand over the file');
  const { missing } = render(STUDIO_TEMPLATE, vals);
  assert.ok(!missing.includes('downloadClip'), `download button is dead: ${JSON.stringify(missing)}`);
});

test('the resolution line is read from the template, never printed as a literal', () => {
  const vals = openEditor({ edTool: 'export' });
  assert.match(vals.edResolution, /^\d+ × \d+$/);
});

test('selecting clips offers a download that keeps the selection', () => {
  Object.assign(StudioAdapter.ui, {
    screen: 'queue', selClips: { c1: true }, bellOpen: false, menuOpen: false, railOpen: true,
  });
  const vals = StudioAdapter.bindings(EDIT_STATE);
  assert.equal(typeof vals.selDownload, 'function');
  const asked = [];
  const prev = StudioAdapter.onDownloadClips;
  StudioAdapter.onDownloadClips = ids => asked.push(...ids);
  vals.selDownload({ preventDefault() {}, stopPropagation() {} });
  StudioAdapter.onDownloadClips = prev;
  assert.deepEqual(asked, ['c1']);
  assert.deepEqual(StudioAdapter.ui.selClips, { c1: true },
    'taking a copy of your own files is not a decision that should empty the tray');
});

// ── upload silence and the retry that was promised ──────────────────────────

test('an upload in flight reports a real percentage', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home', generating: false, jobError: '' });
  StudioAdapter.setUploadProgress(37, 370 * 1024 * 1024, 1000 * 1024 * 1024);
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  assert.match(vals.genProgressLabel, /Uploading 37%/, 'a multi-GB upload used to move in total silence');
  assert.match(vals.genProgressLabel, /of 1000 MB|of 1\.0 GB/, 'and it should say how much of how much');
  assert.match(vals.genBarStyle, /width: 37%/, 'the bar must track the bytes, not sweep meaninglessly');
  assert.equal(vals.genBusy, true, 'the panel has to be mounted for any of this to be visible');
  StudioAdapter.setUploadProgress(null);
  assert.equal(StudioAdapter.bindings(SAMPLE_STATE).genProgressLabel, '');
});

test('a refused source shows its reason instead of unmounting the panel', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home', generating: false, jobError: '' });
  StudioAdapter.jobFailed('That link is a playlist, not a video.');
  const vals = StudioAdapter.bindings(SAMPLE_STATE);
  assert.equal(vals.genBusy, true,
    'the error was bound to a node that had already unmounted, so nobody ever saw it');
  assert.match(vals.genProgressLabel, /playlist/);
  StudioAdapter.ui.jobError = '';
});

test('a failed lecture offers Retry; a healthy one does not', () => {
  const failedState = {
    ...SAMPLE_STATE,
    projects: [{ id: 'pF', title: 'Broken import', status: 'failed', clipCount: 0, durationSec: 600, submittedAt: Date.now() }],
  };
  Object.assign(StudioAdapter.ui, { screen: 'library', bellOpen: false, menuOpen: false, railOpen: true });
  const offered = [];
  const prev = StudioAdapter.onPickOption;
  StudioAdapter.onPickOption = (title, options) => offered.push(...options);
  StudioAdapter.bindings(failedState).libraryItems[0].more({ preventDefault() {}, stopPropagation() {} });
  assert.ok(offered.includes('Retry this lecture'),
    `the app tells people to "press Retry"; it must exist. Got ${JSON.stringify(offered)}`);

  offered.length = 0;
  StudioAdapter.bindings(SAMPLE_STATE).libraryItems[0].more({ preventDefault() {}, stopPropagation() {} });
  StudioAdapter.onPickOption = prev;
  assert.ok(!offered.includes('Retry this lecture'), 'a lecture that worked has nothing to retry');
});

// ── saying what happened with the money ─────────────────────────────────────
// The server computed trial state, renewal dates, low-token and payment-failed
// notices on every request and shipped them to a browser that read none of it.

const billingState = current => ({ ...SAMPLE_STATE, billing: { current, notices: current.__notices || [] } });

test('an ended free trial is announced and cannot be dismissed away', () => {
  Object.assign(StudioAdapter.ui, { screen: 'home', blockerDismissed: true, bellOpen: false, menuOpen: false, railOpen: true });
  const vals = StudioAdapter.bindings(billingState({
    plan: 'free', remaining: 0, unlimited: false, freeTrial: { expired: true, daysLeft: 0, endsAt: 1 },
    __notices: [{ kind: 'free_ended', title: 'Your free trial has ended', message: 'Choose a plan to keep making clips.', action: 'Choose plan', blocking: true }],
  }));
  assert.equal(vals.blockersOn, true,
    'this is the reason nothing works — dismissing it would leave the account silently dead');
  assert.match(vals.blockerText, /free trial has ended/i);
  assert.equal(vals.blockerCta, 'Choose plan');
});

test('a failed payment is visible instead of silent', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens', bellOpen: false, menuOpen: false, railOpen: true });
  const vals = StudioAdapter.bindings(billingState({
    plan: 'monthly', status: 'past_due', remaining: 120, unlimited: false, periodEndsInDays: 12,
  }));
  assert.match(vals.planNote, /payment failed/i, 'a declined card produced no in-app signal at all');
});

test('a trial explains why the wallet is small', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens', bellOpen: false, menuOpen: false, railOpen: true });
  const vals = StudioAdapter.bindings(billingState({
    plan: 'yearly', status: 'trialing', remaining: 40, unlimited: false,
    trial: { active: true, daysLeft: 2 },
  }));
  assert.match(vals.planNote, /Trial/i);
  assert.match(vals.planNote, /full allowance/i,
    'someone who just bought 6000 tokens and sees 40 needs to be told why');
});

test('the owner is not told their unlimited plan renews in 0 days', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens', bellOpen: false, menuOpen: false, railOpen: true });
  const vals = StudioAdapter.bindings(billingState({ plan: 'admin', unlimited: true, periodEndsInDays: 0 }));
  assert.match(vals.planNote, /no limit and no renewal/i);
  assert.ok(!/Renews in 0/.test(vals.planNote));
});

// ── mobile ─────────────────────────────────────────────────────────────────
// The generated stylesheet had exactly one media query in it and it was
// prefers-reduced-motion — not a single width breakpoint, while the marketing
// site that sells the product has three.

test('the app ships a mobile stylesheet, kept out of the generated bundle', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/public/studio-responsive.css'), 'utf8');
  const widthQueries = (css.match(/@media[^{]*max-width/g) || []).length;
  assert.ok(widthQueries >= 3, `expected several breakpoints, found ${widthQueries}`);

  const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  assert.match(host, /studio-responsive\.css/, 'the page must load it');
  assert.ok(host.indexOf('studio-responsive.css') > host.indexOf('studio-styles.generated.css'),
    'it has to come after the generated bundle to win the cascade');

  const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  assert.match(server, /'\/studio-responsive\.css'/,
    'static assets are on an explicit allowlist; an unlisted file 404s');
});

test('mobile rules cannot touch the desktop layout', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/public/studio-responsive.css'), 'utf8');
  // Every declaration must sit inside a max-width query. A stray top-level rule
  // is how a mobile fix silently becomes a desktop regression.
  const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g, '');
  assert.ok(!/\{[^}]*:[^}]*\}/.test(outside),
    `every rule must live inside a media query; found loose rules: ${outside.replace(/\/\*[\s\S]*?\*\//g, '').trim().slice(0, 200)}`);
});

test('the hooks the mobile CSS targets exist in the generated template', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  // Hashed class names are regenerated on every design import, so the mobile
  // rules hang off ids added to the design source instead. If an id is renamed
  // there, the layout silently reverts — this is the tripwire for that.
  for (const id of ['dcTopbar', 'dcSearchBox', 'dcSetupChip', 'dcTokenChip', 'dcAccountBtn', 'dcAccountEmail', 'dcBlocker', 'dcHeroFloaters']) {
    assert.match(tpl, new RegExp(id), `${id} is gone from the template; the mobile rule targeting it is now dead`);
  }
});

test('the balance line is computed, not the designer’s placeholder', () => {
  const vals = renderScreen('tokens').vals;
  assert.ok(vals.balanceMeans, 'the line under the balance must be bound');
  assert.ok(!/20 hours of lecture processing, or about 62/.test(vals.balanceMeans),
    'the same sentence used to show under 6000 tokens and under 2');
});

// ── trim ───────────────────────────────────────────────────────────────────
// The render pipeline learned to cut in v3.2.0 and nothing ever asked it to:
// the only writer of cutsSec was the internal preview lane, so a finished and
// tested cut engine sat behind no control at all.

const TRIM_STATE = {
  ...SAMPLE_STATE,
  clips: [{
    id: 'c1', title: 'A clip', status: 'waiting', score: 92, durationMs: 60000,
    projectId: 'p1', targets: [], startSec: 10, endSec: 70,
    captionSegments: [{ start: 0, end: 3, text: 'first' }, { start: 3, end: 6, text: 'second' }],
  }],
};

const openTrim = (patch = {}) => {
  Object.assign(StudioAdapter.ui, {
    screen: 'editor', edClipId: 'c1', edBlock: 0, edBlockDraft: null, edTrim: null,
    edDirty: false, edSaving: false, edTime: 0, bellOpen: false, menuOpen: false, railOpen: true,
  }, patch);
  return StudioAdapter.bindings(TRIM_STATE);
};

test('an untrimmed clip says so and offers handles at both ends', () => {
  const vals = openTrim();
  assert.match(vals.edTrimLabel, /whole clip is kept/i);
  assert.match(vals.edTrimStartStyle, /left: 0\.00%/);
  assert.match(vals.edTrimEndStyle, /left: 100\.00%/);
  assert.equal(typeof vals.dragTrimStart, 'function');
  assert.equal(typeof vals.dragTrimEnd, 'function');
});

test('a trim reads in the same geometry as the playhead (invariant 4)', () => {
  const vals = openTrim({ edTrim: { from: 15, to: 45 }, edTime: 15 });
  // 15s of a 60s clip is 25%. The handle and the playhead must agree exactly,
  // because a trim that disagreed with the ruler is worse than no trim.
  assert.match(vals.edTrimStartStyle, /left: 25\.00%/);
  assert.match(vals.edPlayHeadStyle, /left: 25\.00%/);
  assert.match(vals.edTrimEndStyle, /left: 75\.00%/);
});

test('a trim states what survives, and offers a way back', () => {
  const vals = openTrim({ edTrim: { from: 15, to: 45 } });
  assert.match(vals.edTrimLabel, /Keeping 0:30 of 1:00/);
  assert.match(vals.edTrimLabel, /Save to render/i, 'the cut is not on the video until Save');
  vals.resetTrim({ preventDefault() {}, stopPropagation() {} });
  assert.equal(StudioAdapter.ui.edTrim, null);
});

test('saving sends the kept range, and an untouched clip sends no cuts at all', () => {
  const sent = [];
  const prev = StudioAdapter.onSaveClip;
  StudioAdapter.onSaveClip = (id, payload) => sent.push(payload);

  openTrim({ edTrim: { from: 12, to: 48 } }).saveEdit({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(sent[0].cutsSec, [[12, 48]]);

  sent.length = 0;
  openTrim().saveEdit({ preventDefault() {}, stopPropagation() {} });
  StudioAdapter.onSaveClip = prev;
  assert.ok(!('cutsSec' in sent[0]),
    'a clip nobody trimmed must not acquire a cut just by being saved');
});

test('a saved trim reopens where it was left', () => {
  const withCut = { ...TRIM_STATE, clips: [{ ...TRIM_STATE.clips[0], cutsSec: [[6, 54]] }] };
  Object.assign(StudioAdapter.ui, { screen: 'editor', edClipId: 'c1', edTrim: null, bellOpen: false, menuOpen: false, railOpen: true });
  const vals = StudioAdapter.bindings(withCut);
  assert.match(vals.edTrimStartStyle, /left: 10\.00%/);
  assert.match(vals.edTrimLabel, /Keeping 0:48/);
});

// ── showing the working ────────────────────────────────────────────────────

test('a clip says why it scored what it did', () => {
  const scored = {
    ...SAMPLE_STATE,
    clips: [{ id: 'c1', title: 'A clip', status: 'waiting', score: 92, durationMs: 40000, projectId: 'p1', targets: [],
      scoreReasons: ['complete ending', 'question hook', 'clear speaking pace'] }],
  };
  const vals = renderScreen('queue');
  const withReasons = StudioAdapter.bindings(scored);
  const card = withReasons.queueClips ? withReasons.queueClips[0] : null;
  assert.ok(card, 'expected a clip card');
  assert.match(card.scoreWhy, /complete ending/,
    'the worker has always explained itself and nothing rendered it');
  assert.ok(!/display: none/.test(card.scoreWhyStyle));
  assert.ok(vals);
});

test('a clip with no stored reasons shows no empty line', () => {
  const bare = {
    ...SAMPLE_STATE,
    clips: [{ id: 'c1', title: 'A clip', status: 'waiting', score: 70, durationMs: 40000, projectId: 'p1', targets: [] }],
  };
  const card = StudioAdapter.bindings(bare).queueClips[0];
  assert.equal(card.scoreWhy, '');
  assert.match(card.scoreWhyStyle, /display: none/);
});

test('the crop override writes 0-1, not a percentage', () => {
  // The classic shell wrote 0-100 into a field the schema clamps to [0,1], so
  // any non-zero setting pinned the crop against the right or bottom edge.
  const written = [];
  const vals = openTrim();
  const prev = StudioAdapter.onClipStyle;
  StudioAdapter.onClipStyle = (id, patch) => written.push(patch);
  vals.setCropX({ target: { value: '75' } });
  StudioAdapter.onClipStyle = prev;
  const patch = written.find(p => 'cropPositionX' in p) || StudioAdapter.ui.edStyleDraft || {};
  assert.ok(patch.cropPositionX <= 1, `expected 0-1, got ${patch.cropPositionX}`);
  assert.ok(Math.abs(patch.cropPositionX - 0.75) < 0.001);
});

test('the crop controls follow the fit mode', () => {
  // There is no crop window to move unless the frame is actually cropped.
  const cropped = openTrim({ edStyleDraft: { fitMode: 'crop' } });
  assert.ok(!/display: none/.test(cropped.edCropRowStyle),
    'a cropped frame must offer the override — audit #45');
  const blurred = openTrim({ edStyleDraft: { fitMode: 'blur' } });
  assert.match(blurred.edCropRowStyle, /display: none/,
    'blur shows the whole source, so there is nothing to reposition');
});

// ── the phone tab bar ──────────────────────────────────────────────────────
// The left rail took 67-140px of the only dimension a phone is short of, and
// everything beside it was crushed: three-word buttons wrapping to three lines,
// a failure message reading one word per line with a button printed over it.

test('every nav item carries a short name and knows if it belongs in the tab bar', () => {
  const vals = renderScreen('home').vals;
  const items = [].concat(vals.navHome, vals.navProduce, vals.navSetup);
  assert.ok(items.length >= 6);
  for (const item of items) {
    assert.ok(item.short, `${item.label} has no short name for the tab bar`);
    assert.ok(item.short.length <= 9,
      `"${item.short}" will not fit a fifth of a 375px screen`);
    assert.match(item.mobileClass, /dc-nav-(primary|secondary)/);
  }
});

test('exactly five destinations are primary — the most a tab bar can carry', () => {
  const vals = renderScreen('home').vals;
  const items = [].concat(vals.navHome, vals.navProduce, vals.navSetup);
  const primary = items.filter(i => i.mobileClass === 'dc-nav-primary');
  assert.equal(primary.length, 5,
    `expected 5 tabs, got ${primary.length}: ${primary.map(p => p.short).join(', ')}`);
  assert.deepEqual(primary.map(p => p.short), ['Home', 'Library', 'Review', 'Schedule', 'Styles']);
});

test('what comes off the tab bar is still reachable from the account menu', () => {
  const vals = renderScreen('home').vals;
  for (const hook of ['goMusic', 'goPerformance', 'goOwner']) {
    assert.equal(typeof vals[hook], 'function',
      `${hook} is missing — a screen reachable from exactly one place, and that place hidden, is not reachable`);
  }
  const { missing } = render(STUDIO_TEMPLATE, vals);
  for (const hook of ['goMusic', 'goPerformance', 'goOwner']) {
    assert.ok(!missing.includes(hook), `${hook} is a dead control: ${JSON.stringify(missing)}`);
  }
});

test('the mobile rules never widen a column container into a second column', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/public/studio-responsive.css'), 'utf8');
  // flex-basis:100% on a column container sizes the HEIGHT, and with wrapping
  // on it breaks into a second column and throws children out sideways. That
  // put a plan card's button 147px outside the card it belongs to.
  const risky = css.match(/^[^\n@}]*(flex-wrap: wrap|flex: 1 1 100%)/gm) || [];
  const rules = css.split('}').filter(block => /flex-wrap: wrap|flex: 1 1 100%/.test(block));
  for (const rule of rules) {
    const selector = rule.split('{')[0];
    if (!/\[style\*=/.test(selector)) continue;
    assert.match(selector, /:not\(\[style\*="flex-direction: column"\]\)/,
      `a style-attribute selector that wraps must exclude column containers:\n${selector.trim()}`);
  }
  assert.ok(risky.length >= 0);
});

test('the DeenAI screen never sells a plan that would not unlock it', () => {
  // The two halves of DeenAI sit behind different gates -- insights are
  // `deenai` (Pro), asking is `deenaiAsk` (Studio) -- and ONE binding served
  // both call-to-action buttons, so the Ask box told a free account to buy Pro
  // for the one half Pro does not include. A billing button naming the wrong
  // plan is the worst copy fault this product can ship: the customer pays and
  // the thing they paid for is still locked.
  //
  // Youssef, 1 Sept 2026: "it should be unlock with studio."
  const deenai = (features) => {
    Object.assign(StudioAdapter.ui, { screen: 'deenai', bellOpen: false, menuOpen: false, railOpen: true });
    const vals = StudioAdapter.bindings({
      ...SAMPLE_STATE,
      billing: { current: { plan: 'free', remaining: 0, unlimited: false, features } },
    });
    return { ...render(STUDIO_TEMPLATE, vals), vals };
  };

  // A free account sees both gates. Neither may name Pro as the way through.
  const basic = deenai({});
  assert.equal(basic.vals.aiLocked, true, 'the demo banner is up');
  assert.equal(basic.vals.aiAskGate, true, 'the ask is gated');
  assert.equal(basic.vals.aiGateCta, 'Unlock with Studio');
  assert.ok(!/Unlock with Pro/.test(basic.html), 'no button offers Pro as the way in');
  // The banner sentence used to promise that Pro "answers your questions",
  // which is exactly what Pro does not do.
  assert.ok(!/On Pro, DeenAI[^.]*answers your questions/.test(basic.html));
  // Pro is still mentioned -- it genuinely turns the figures real -- just not
  // on a button. Saying nothing about it would oversell Studio.
  assert.match(basic.vals.aiDemoNote, /Pro turns the figures real/);
  assert.match(basic.html, /Pro turns the figures/, 'and it reaches the screen');

  // A Pro account has real insights and is pointed at Studio for the asking.
  const pro = deenai({ deenai: true });
  assert.equal(pro.vals.aiLocked, false, 'no demo banner once the figures are real');
  assert.equal(pro.vals.aiAskGate, true, 'asking is still shut');
  assert.equal(pro.vals.aiGateCta, 'Upgrade to Studio');

  // Studio has both, so no gate is drawn at all.
  const studio = deenai({ deenai: true, deenaiAsk: true });
  assert.equal(studio.vals.aiLocked, false);
  assert.equal(studio.vals.aiAskGate, false);
  assert.ok(!/Unlock with|Upgrade to Studio/.test(studio.html), 'nothing is sold to someone who already bought it');

  // The banner's button was a LITERAL in the design export, which is how it
  // drifted from the binding beside it. It is a text override now
  // (design/text-overrides.json), so the plan name has one source.
  const tpl = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  assert.ok(!tpl.includes('Unlock with Pro'), 'no hardcoded plan name survives in the export');
});
