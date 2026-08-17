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
  assert.match(vals.jobTokenLabel, /confirmed before processing/i);
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
  // reading "No channel on".
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

test('an ETA is rendered in human units, and absent when unknown', () => {
  const at = Date.now();
  const withEta = sec => StudioAdapter.bindings({
    projects: [{ id: 'p', title: 'Talk', status: 'processing', stage: 'Transcribing', progress: 40, etaSec: sec, submittedAt: at }],
    clips: [], tracks: [],
  }).liveAll[0].eta;
  assert.equal(withEta(20), 'about a minute left');
  assert.equal(withEta(420), '7 min left');
  assert.equal(withEta(5400), '1h 30m left');
  assert.equal(withEta(null), '', 'an unknown ETA shows nothing rather than "NaN"');
  assert.equal(withEta(undefined), '');
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
  assert.equal(vals.genBusy, false, 'the button is usable again');
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
  assert.equal(vals.scheduleDays[0].day, 'Overdue');
  assert.match(vals.scheduleDays[0].countLabel, /missed its slot/);
  assert.equal(vals.scheduleDays[0].items[0].caption, 'Stranded');
});

test('Post now is gated on the four checks', () => {
  Object.assign(StudioAdapter.ui, { screen: 'schedule' });
  const unverified = StudioAdapter.bindings({
    projects: [], tracks: [],
    clips: [{ id: 'a', title: 'Not ready', status: 'scheduled', scheduledAt: Date.now() + 3600e3, targets: [{ provider: 'youtube' }], musicVerified: false, renderVerified: true, templateId: 't', transcript: 'x' }],
  });
  const item = unverified.scheduleDays.flatMap(d => d.items)[0];
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
      free: { id: 'free', name: 'Free', interval: 'one-time', tokens: 40 },
      weekly: { id: 'weekly', name: 'Weekly', interval: 'week', tokens: 150, priceLabel: '£4', enabled: true },
      monthly: { id: 'monthly', name: 'Monthly', interval: 'month', tokens: 600, priceLabel: '£14', enabled: true },
      yearly: { id: 'yearly', name: 'Annual', interval: 'year', tokens: 8000, priceLabel: '£140', enabled: true },
    },
    topups: {
      boost100: { id: 'boost100', name: 'Quick boost', tokens: 100, priceLabel: '£5', enabled: true },
      boost300: { id: 'boost300', name: 'Creator boost', tokens: 300, priceLabel: '£12', enabled: true, badge: 'Most popular' },
    },
  },
};

test('the billing period tabs change the prices, not just the highlight', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens' });
  const at = period => {
    StudioAdapter.ui.planPeriod = period;
    return StudioAdapter.bindings(BILLING_STATE).planCards.map(c => `${c.name} ${c.price} ${c.tokens}`);
  };
  assert.ok(at('week').some(c => c.includes('Weekly £4 150 tokens')));
  assert.ok(at('month').some(c => c.includes('Monthly £14 600 tokens')));
  assert.ok(at('year').some(c => c.includes('Annual £140 8000 tokens')));
  assert.ok(!at('week').some(c => c.includes('Monthly')), 'a period shows only its own plans');
});

test('the free plan stays visible on every period', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens' });
  for (const period of ['week', 'month', 'year']) {
    StudioAdapter.ui.planPeriod = period;
    assert.ok(StudioAdapter.bindings(BILLING_STATE).planCards.some(c => c.name === 'Free'), period);
  }
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

test('a plan with no Stripe price says so rather than failing at checkout', () => {
  Object.assign(StudioAdapter.ui, { screen: 'tokens', planPeriod: 'month' });
  const vals = StudioAdapter.bindings({
    ...BILLING_STATE,
    billing: { ...BILLING_STATE.billing, plans: { monthly: { id: 'monthly', name: 'Monthly', interval: 'month', tokens: 600, enabled: false } } },
  });
  const card = vals.planCards.find(c => c.name === 'Monthly');
  assert.equal(card.cta, 'Not available');
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
  Object.assign(StudioAdapter.ui, { screen: 'schedule' });
  const clip = { id: 'a', title: 'C', status: 'scheduled', scheduledAt: Date.now() + 3600e3, targets: [{ provider: 'youtube' }], musicVerified: true, renderVerified: true, templateId: 't', transcript: 'x' };
  const base = {
    projects: [], tracks: [], clips: [clip],
    social: { providers: { youtube: { configured: true, connected: true, accounts: [{ id: 'a', name: 'A' }] } } },
    publishingSettings: { youtube: { enabled: true } },
  };
  const label = data => StudioAdapter.bindings(data).scheduleDays.flatMap(d => d.items)[0].postLabel;
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
  // Exactly one of the two is ever visible: the collision the user reported was
  // both a floating bar and a section on the same page.
  assert.match(paint, /home\.classList\.toggle\('hide',!\(onHome&&any\)\)/);
  assert.match(paint, /bar\.classList\.toggle\('hide',!\(!onHome&&any\)\)/);
  assert.match(paint, /vals\.liveAll\.map/, 'the section lists everything, not a slice');
});

test('the Home section docks above the review card rather than covering content', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  const dock = /function dockLiveHome\([\s\S]*?\n    }\n/.exec(html)[0];
  // Anchoring on the parent put this in the main column and shoved My library
  // sideways; the fix is the *smallest* element containing the text.
  assert.match(dock, /Needs your review/);
  assert.match(dock, /sort\(\(a,b\)=>a\.querySelectorAll\('\*'\)\.length-b\.querySelectorAll\('\*'\)\.length\)/,
    'the smallest matching element wins');
  assert.match(dock, /insertBefore/);
  assert.doesNotMatch(dock, /card\.parentElement\.parentElement/);
  assert.match(dock, /classList\.toggle\('slh-docked',Boolean\(card\)\)/,
    'falls back to floating rather than vanishing if a re-import moves the card');
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

test('dragging a caption writes fields that reach the render', () => {
  // These were no-ops. Vertical is continuous (captionMarginV, 20-800 in the
  // schema); horizontal snaps to the three alignments the renderer supports,
  // because there is no free-form X to write to.
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: null, tplTimer: null });
  StudioAdapter.onTemplateField = () => {};
  const state = { projects: [], clips: [], tracks: [], templates: [{ id: 'x', name: 'X', height: 1920 }], selectedTemplate: { id: 'x', name: 'X', height: 1920 } };
  const frame = { getBoundingClientRect: () => ({ top: 0, left: 0, width: 300, height: 533 }) };
  const evt = { currentTarget: { closest: () => frame }, preventDefault() {}, clientX: 260, clientY: 460 };
  const original = { add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  try {
    StudioAdapter.bindings(state).dragCaption(evt);
  } finally {
    globalThis.addEventListener = original.add; globalThis.removeEventListener = original.remove;
  }
  const draft = StudioAdapter.ui.tplDraft;
  assert.equal(draft.captionHorizontal, 'right');
  assert.equal(draft.captionPosition, 'bottom');
  assert.ok(draft.captionMarginV >= 20 && draft.captionMarginV <= 800, 'within the schema range');
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

test('Undo discards unsaved template edits instead of only refetching', () => {
  Object.assign(StudioAdapter.ui, { screen: 'templates', tplDraft: { captionFontSize: 42 }, tplDirty: true, tplTimer: null });
  StudioAdapter.onResetTemplate = () => {};
  const state = { projects: [], clips: [], tracks: [], templates: [{ id: 'x', name: 'X' }], selectedTemplate: { id: 'x', name: 'X' } };
  StudioAdapter.bindings(state).undoEdit({ preventDefault() {} });
  assert.equal(StudioAdapter.ui.tplDraft, null);
  assert.equal(StudioAdapter.ui.tplDirty, false);
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
