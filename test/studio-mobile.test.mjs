import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * The phone dashboard (studio-mobile.js + studio-mobile.css), 2 Sept 2026.
 *
 * Two laws, each of which was a way this could have shipped broken:
 *
 *  1. The desktop is untouched. Every rule in the stylesheet sits inside the
 *     820px query and the shell never mounts at a wider width, so a desktop
 *     render is byte-for-byte what it was. (Measured too: the desktop was
 *     pixel-diffed before and after at 1280, 1440 and 1920.)
 *  2. Nothing is lost. The mobile template is rendered with the REAL adapter
 *     bindings and the REAL runtime, and every screen the desktop has is
 *     reachable, every control it draws resolves to a handler, and every rail
 *     destination appears in the More sheet.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// ── a sandbox holding the runtime, the adapter and the mobile module ─────────
function makeSandbox() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'test' }, location: { hash: '', search: '' },
    innerWidth: 390,
    // No document, no matchMedia: the module must load without either and
    // report itself inactive.
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src('src/public/studio-runtime.js'), sandbox);
  vm.runInContext(src('src/public/studio-adapter.js'), sandbox);
  vm.runInContext(src('src/public/studio-mobile.js'), sandbox);
  return sandbox;
}

const clip = (id, score, status, extra = {}) => ({
  id, title: 'Clip ' + id, status, score, durationMs: 57_000, templateName: 'Bold Stack', projectId: 'p1',
  thumbUrl: '/thumb/' + id + '.jpg', videoUrl: '/api/clips/' + id + '/video', transcript: 'some words here',
  scoreReasons: ['complete ending', 'question hook'], createdAt: Date.now() - 3600e3, ...extra,
});
const DATA = () => ({
  clips: [
    clip('c1', 92, 'waiting'), clip('c2', 88, 'waiting', { reviewRequired: true }),
    clip('c3', 71, 'approved', { approvedAt: Date.now() - 7200e3, scheduledAt: Date.now() + 3600e3, targets: [{ provider: 'youtube', status: 'scheduled' }] }),
    clip('c4', 64, 'rejected'), clip('c5', 80, 'posted', { postedAt: Date.now() - 3600e3, targets: [{ provider: 'youtube', status: 'posted' }] }),
  ],
  projects: [
    { id: 'p1', title: 'A lecture on patience', status: 'completed', url: 'https://youtube.com/watch?v=x', durationSec: 2280, submittedAt: Date.now() - 7200e3, clipCount: 5 },
    { id: 'p2', title: 'Tafsir part 3', status: 'processing', progress: 42, stage: 'transcribe', submittedAt: Date.now() - 600e3 },
  ],
  reviewGate: true, templates: [{ id: 'clean-line', name: 'Clean Line' }], selectedTemplate: { id: 'clean-line', name: 'Clean Line' },
  user: { name: 'Yusuf Ali', email: 'y@x.com', role: 'creator' },
  billing: { current: { planName: 'Basic', plan: 'free', tokens: 40, features: {} }, plans: [] },
  postTimes: ['09:00', '12:00', '17:00', '20:00'], activity: [], emailNotifs: true,
});

// Render a template with the runtime's own renderer and return the HTML plus
// the bindings that resolved to nothing -- the "dead control" list.
function render(sandbox, template, vals) {
  const R = new sandbox.StudioRuntime._internals.Renderer();
  const out = [];
  R.render(template, vals, out);
  return { html: out.join(''), missing: R.missing, handlers: R.handlers.length };
}

// ── law 1: the desktop is untouched ─────────────────────────────────────────

test('every rule in studio-mobile.css lives inside the 820px query', () => {
  const css = src('src/public/studio-mobile.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // Walk the top level: the only blocks allowed there are the phone query.
  let depth = 0, start = -1;
  const tops = [];
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') { if (depth === 0) start = css.lastIndexOf('}', i) + 1; depth++; }
    else if (ch === '}') { depth--; if (depth === 0) tops.push(css.slice(start, i + 1).trim()); }
  }
  assert.ok(tops.length >= 1, 'the sheet has at least one top-level block');
  for (const block of tops) {
    assert.match(block, /^@media \(max-width: 820px\), \(pointer: coarse\) and \(max-height: 500px\) \{/, 'a top-level block that is not the phone query: ' + block.slice(0, 80));
  }
  // And nothing at all outside the blocks (a stray selector would apply everywhere).
  const outside = css.replace(/@media \(max-width: 820px\), \(pointer: coarse\) and \(max-height: 500px\) \{[\s\S]*\}\s*$/m, '').trim();
  assert.equal(outside, '', 'CSS outside the phone query: ' + outside.slice(0, 120));
  // The seam is the one studio-responsive.css already cuts at, so no device
  // changes regime.
  assert.match(src('src/public/studio-responsive.css'), /@media \(max-width: 820px\)/);
});

test('the shell never mounts at a desktop width', () => {
  const sandbox = makeSandbox();
  assert.equal(sandbox.StudioMobile.active(), false, 'no matchMedia at all: inactive');
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {} });
  sandbox.document = { body: { classList: { contains: () => true } } };
  assert.equal(sandbox.StudioMobile.active(), false, 'a wide viewport: inactive');
  sandbox.matchMedia = () => ({ matches: true, addEventListener() {} });
  assert.equal(sandbox.StudioMobile.active(), true, 'a phone viewport with the studio up: active');
  sandbox.document = { body: { classList: { contains: () => false } } };
  assert.equal(sandbox.StudioMobile.active(), false, 'a phone viewport before the studio is up: inactive');
  assert.equal(sandbox.StudioMobile.query, '(max-width: 820px), (pointer: coarse) and (max-height: 500px)');
});

test('index.html and the server carry the shell, and nothing else about the desktop changed shape', () => {
  const html = src('src/public/index.html');
  assert.match(html, /<link rel="stylesheet" href="\/studio-mobile\.css">/);
  assert.match(html, /<script src="\/studio-mobile\.js"><\/script>/);
  assert.match(html, /window\.paintMobile\)window\.paintMobile\(vals,DATA\)/, 'paintStudio ends by painting the shell');
  const server = src('src/server.js');
  assert.match(server, /'\/studio-mobile\.css': \{ file: studioAsset\('studio-mobile\.css'\)/);
  assert.match(server, /'\/studio-mobile\.js': \{ file: studioAsset\('studio-mobile\.js'\)/);
  // The library aside painter is scoped to the desktop tree: the shell carries
  // the same data-tour anchor for the tour, and the first cut of this mounted
  // the desktop stats panel inside the phone's "Add a lecture" button.
  assert.match(html, /querySelector\('#studio \[data-tour="lib-add"\]'\)/);
  // The mobile stylesheet names no hashed class from the design export.
  assert.doesNotMatch(src('src/public/studio-mobile.css'), /\.s[0-9a-z]{1,3}\b\s*[{,>]/, 'a hashed .sNN class in the mobile sheet');
});

test('the overlay order the shell stamps matches the template', () => {
  const sandbox = makeSandbox();
  vm.runInContext(src('src/public/studio-template.generated.js'), sandbox);
  const tpl = sandbox.STUDIO_TEMPLATE;
  const rootChildren = tpl[0].ch;
  const mainAt = rootChildren.findIndex(n => n.t === 'el' && n.tag === 'main');
  assert.ok(mainAt > 0, 'the template root holds <main>');
  const flags = rootChildren.slice(mainAt + 1).filter(n => n.t === 'if').map(n => n.c.p);
  assert.deepEqual(flags, sandbox.StudioMobile.OVERLAYS.map(pair => pair[1]),
    'the root overlays after <main>, in order, are what stampOverlays assumes');
});

// ── law 2: nothing is lost ──────────────────────────────────────────────────

function screenRender(sandbox, screen, setup) {
  const A = sandbox.StudioAdapter;
  A.ui.screen = screen; A.ui.openProject = 'p1'; A.ui.menuOpen = false; A.ui.bellOpen = false;
  if (setup) setup(A.ui);
  const data = DATA();
  const vals = A.bindings(data);
  const mv = sandbox.StudioMobile.vals(vals, data);
  return { ...render(sandbox, sandbox.StudioMobile.template(), mv), vals, mv };
}

test('every screen renders through the real bindings with no dead control', () => {
  const sandbox = makeSandbox();
  for (const screen of ['home', 'queue', 'library', 'detail', 'schedule', 'templates', 'music', 'language', 'performance', 'editor', 'tokens', 'owner', 'deenai', 'help']) {
    const r = screenRender(sandbox, screen);
    // Array.from: the renderer's list is the vm realm's Array, and a strict
    // deepEqual rejects it on the prototype alone.
    assert.deepEqual(Array.from(r.missing), [], screen + ': a bound handler resolved to nothing');
    assert.ok(r.handlers > 8, screen + ': the shell has live controls');
    const owned = sandbox.StudioMobile.OWNED.includes(screen);
    assert.equal(Boolean(r.mv.m.own), owned, screen + ': ownership');
    // The tab bar and header are always there.
    assert.match(r.html, /class="dcm-tabs"/); assert.match(r.html, /class="dcm-head"/);
    for (const label of ['Home', 'Clips', 'Create', 'Schedule', 'More']) assert.ok(r.html.includes('>' + label + '<'), screen + ': tab ' + label);
  }
});

test('Home carries the create form, the setup list, review, schedule, lectures, the week and activity', () => {
  const sandbox = makeSandbox();
  const r = screenRender(sandbox, 'home');
  for (const needle of ['Paste a YouTube link', 'Start job', 'Upload MP4', 'Posting to', 'Happening now', 'id="dcmLiveSlot"',
    'Needs your review', 'Scheduled next', 'Continue working', 'This week', 'clips posted', 'held for review', 'median score', 'worker time', 'Recent activity',
    'data-tour="paste"', 'data-tour="start"', 'data-tour="rail"']) {
    assert.ok(r.html.includes(needle), 'home is missing: ' + needle);
  }
  // The review preview is the same list the desktop draws, with its approve.
  assert.equal(r.vals.reviewPreview.length, 2);
  assert.equal((r.html.match(/>Approve</g) || []).length >= 2, true);
});

test('the queue draws a card per clip with approve, reject, edit and select, and the chips select the same filters', () => {
  const sandbox = makeSandbox();
  const r = screenRender(sandbox, 'queue', ui => { ui.filter = 'review'; });
  assert.equal(r.vals.queueClips.length, 2);
  assert.equal((r.html.match(/class="dcm-clip /g) || []).length, 2);
  assert.equal((r.html.match(/aria-label="Reject"/g) || []).length, 2);
  assert.equal((r.html.match(/aria-label="Open in editor"/g) || []).length, 2);
  assert.equal((r.html.match(/aria-label="Select"/g) || []).length, 2);
  assert.ok(r.html.includes('Quote review'), 'the scripture flag is drawn');
  assert.ok(r.html.includes('data-tour="queue-tabs"'));
  assert.ok(r.html.includes('data-tour="queue-decide"'));
  for (const tab of r.vals.qTabs) assert.ok(r.html.includes('>' + tab.label + '<'), 'filter chip ' + tab.label);
  assert.equal(r.vals.qTabs.filter(t => t.on).length, 1, 'exactly one chip is on');
  // Bulk actions appear once something is selected.
  const sel = screenRender(sandbox, 'queue', ui => { ui.selClips = { c1: true }; });
  for (const needle of [' selected', '>Approve<', '>Reject<', '>Download<', '>Clear<']) assert.ok(sel.html.includes(needle), 'bulk bar: ' + needle);
  sandbox.StudioAdapter.ui.selClips = {};
});

test('the focused review shows the clip, its reasons and transcript, and walks the list', () => {
  const sandbox = makeSandbox();
  const M = sandbox.StudioMobile.state;
  M.review = { id: 'c2', from: 'queue', idx: 1 };
  const r = screenRender(sandbox, 'queue', ui => { ui.filter = 'review'; });
  assert.equal(r.mv.m.rvOn, true);
  assert.equal(r.mv.m.rv.pos, '2 of 2');
  assert.equal(r.mv.m.rv.hasTranscript, true);
  assert.equal(r.mv.m.rv.flagged, true, 'c2 needs quote review');
  for (const needle of ['id="dcmRvVideo"', '>Reject<', '>Edit<', '>Approve<', 'Why the worker scored it', 'Transcript', 'Clip c2']) {
    assert.ok(r.html.includes(needle), 'review sheet: ' + needle);
  }
  // A clip that leaves the list advances the review to what is now in its
  // place, the way the desktop deck does; an empty list closes it.
  M.review = { id: 'c1', from: 'queue', idx: 0 };
  sandbox.StudioAdapter.ui.pending = { c1: 'approved' };
  const r2 = screenRender(sandbox, 'queue', ui => { ui.filter = 'review'; });
  assert.equal(r2.mv.m.rv.id, 'c2', 'moved on to the next waiting clip');
  sandbox.StudioAdapter.ui.pending = { c1: 'approved', c2: 'rejected' };
  const r3 = screenRender(sandbox, 'queue', ui => { ui.filter = 'review'; });
  assert.equal(r3.mv.m.rvOn, false, 'nothing left to review: the sheet closes');
  sandbox.StudioAdapter.ui.pending = {}; M.review = null;
});

test('the library draws every lecture with open, more and select, the stats, storage and an add button', () => {
  const sandbox = makeSandbox();
  const r = screenRender(sandbox, 'library', ui => { ui.libFilter = 'all'; });
  assert.equal(r.vals.libraryItems.length, 2);
  assert.equal((r.html.match(/class="dcm-lec"/g) || []).length, 2);
  assert.equal((r.html.match(/>Open clips</g) || []).length, 2);
  assert.equal((r.html.match(/>More</g) || []).length >= 2, true);
  for (const needle of ['data-tour="lib-tabs"', 'data-tour="lib-add"', 'Add a lecture', 'Storage', 'Source videos', 'Rendered clips', 'Transcripts', 'Your lectures, counted']) {
    assert.ok(r.html.includes(needle), 'library: ' + needle);
  }
  for (const tab of r.vals.libTabs) assert.ok(r.html.includes('>' + tab.label + '<'), 'library chip ' + tab.label);
});

test('a lecture\'s detail keeps back, play source, re-cut, the bulk action and its clip cards', () => {
  const sandbox = makeSandbox();
  const r = screenRender(sandbox, 'detail');
  for (const needle of ['Play source', 'Re-cut clips', 'A lecture on patience', 'class="dcm-back"']) assert.ok(r.html.includes(needle), 'detail: ' + needle);
  assert.equal((r.html.match(/class="dcm-clip /g) || []).length, r.vals.detailClips.length);
  assert.ok(r.html.includes(r.vals.bulkLabel), 'the bulk action carries its label');
});

test('the schedule keeps its three views, the meter, waiting, outlets and windows', () => {
  const sandbox = makeSandbox();
  const month = screenRender(sandbox, 'schedule', ui => { ui.schedView = 'month'; });
  for (const needle of ['data-tour="sched-views"', 'data-tour="sched-ready"', 'data-tour="sched-outlets"', 'Ready to schedule', 'Where it posts', 'Posting windows', 'class="dcm-month"', 'Next out']) {
    assert.ok(month.html.includes(needle), 'schedule month: ' + needle);
  }
  assert.equal((month.html.match(/class="dcm-cell /g) || []).length, month.vals.schedMonthWeeks.reduce((n, w) => n + w.cells.length, 0));
  const week = screenRender(sandbox, 'schedule', ui => { ui.schedView = 'week'; });
  assert.ok(week.html.includes('class="dcm-week"'));
  assert.equal(week.mv.m.week.length, 7, 'seven days');
  assert.equal(week.mv.m.week[0].slots.length, week.vals.schedWeekRows.length, 'every posting window is a slot on every day');
  const day = screenRender(sandbox, 'schedule', ui => { ui.schedView = 'day'; });
  assert.ok(day.html.includes('class="dcm-post ') || day.html.includes('Nothing is scheduled'), 'the day view lists posts or says it is empty');
  assert.ok(day.html.includes('Schedule an approved clip') || !day.vals.schedDayCanAdd);
  sandbox.StudioAdapter.ui.schedView = 'month';
});

test('the More sheet reaches every rail destination, connections, billing, account, the tour and sign out', () => {
  const sandbox = makeSandbox();
  sandbox.StudioMobile.state.sheet = 'more';
  const r = screenRender(sandbox, 'home');
  const rail = [].concat(r.vals.navProduce, r.vals.navSetup).map(i => i.label);
  assert.ok(rail.length >= 6, 'the rail has its destinations');
  for (const label of rail) {
    if (['Review queue', 'Schedule'].includes(label)) continue; // those are tabs
    assert.ok(r.html.includes('>' + label + '<'), 'More is missing the rail item: ' + label);
  }
  for (const needle of ['Publishing connections', 'Tokens &amp; billing', 'Account settings', 'Take the tour', 'Back to main website', 'Sign out']) {
    assert.ok(r.html.includes(needle), 'More: ' + needle);
  }
  sandbox.StudioMobile.state.sheet = null;
});

test('the activity, account, search and create sheets carry the desktop dropdowns\' controls', () => {
  const sandbox = makeSandbox();
  const S = sandbox.StudioMobile.state;
  S.sheet = 'activity';
  let r = screenRender(sandbox, 'home');
  for (const needle of ['Mark all read', 'Clear all', 'Desktop notifications', 'Email notifications', 'in total']) assert.ok(r.html.includes(needle), 'activity: ' + needle);
  S.sheet = 'account';
  r = screenRender(sandbox, 'home');
  for (const needle of ['Yusuf Ali', 'y@x.com', 'Tokens &amp; billing', 'Account settings', 'Help &amp; guides', 'Sign out']) assert.ok(r.html.includes(needle), 'account: ' + needle);
  assert.ok(!r.html.includes('>Owner<'), 'a creator sees no Owner entry');
  S.sheet = 'search';
  sandbox.StudioAdapter.ui.query = 'patience';
  r = screenRender(sandbox, 'home');
  assert.ok(r.mv.m.search.length >= 1, 'search finds the lecture');
  assert.ok(r.html.includes('A lecture on patience'));
  sandbox.StudioAdapter.ui.query = '';
  S.sheet = 'create';
  r = screenRender(sandbox, 'home');
  assert.ok(r.html.includes('Create clips') && r.html.includes('Upload MP4'));
  // The create sheet steps aside the moment the job panel is up.
  sandbox.StudioAdapter.ui.job = { step: 0 };
  r = screenRender(sandbox, 'home');
  assert.equal(S.sheet, null, 'the create sheet closed for the job panel');
  sandbox.StudioAdapter.ui.job = null;
});

test('the mobile template names every desktop screen flag it owns and no hashed class', () => {
  const sandbox = makeSandbox();
  const tpl = JSON.stringify(sandbox.StudioMobile.template());
  for (const flag of ['isHome', 'isQueue', 'isLibrary', 'isDetail', 'isSchedule', 'isTemplates', 'isMusic', 'isPerf', 'isTokens', 'isDeenai']) assert.ok(tpl.includes('"p":"' + flag + '"'), flag);
  assert.doesNotMatch(tpl, /"class":"s[0-9a-z]{1,3}"/, 'a hashed design class in the mobile template');
});

/*
 * Night is the phone's own look and paper is a CHOICE. Youssef, 2 Sept 2026,
 * on the first cut of the new look: "um why is it white??!?!?! if you want you
 * can do dark mode on settings" -- so dark is the default, light lives behind
 * one control, and every palette value is a token so that one class swaps the
 * whole design without a single layout rule moving.
 */
test('the phone is night by default and paper only behind body.dcm-light', () => {
  const sandbox = makeSandbox();
  const css = src('src/public/studio-mobile.css');
  // The default palette is declared on :root, the paper one only on the class.
  const root = css.slice(css.indexOf('  :root {'), css.indexOf('  body.dcm-light {'));
  assert.ok(/--dcm-paper:\s*#100E0B/i.test(root), 'the default ground is night');
  const light = css.slice(css.indexOf('  body.dcm-light {'));
  assert.ok(/--dcm-paper:\s*#F4EFE4/i.test(light.slice(0, 2000)), 'the paper ground is behind the class');
  // Every token the light block redefines must already exist in the default,
  // or a value would fall back to nothing in one theme and not the other.
  const names = t => [...t.matchAll(/(--dcm-[a-z0-9-]+):/g)].map(m => m[1]);
  const rootNames = new Set(names(root));
  for (const n of names(light.slice(0, light.indexOf('\n  }')))) {
    assert.ok(rootNames.has(n), n + ' is set for paper and never for night');
  }
  // The one setting, and its default.
  const tpl = JSON.stringify(sandbox.StudioMobile.template());
  assert.ok(tpl.includes('m.themeDark') && tpl.includes('m.themeLight'), 'the appearance control is in the account sheet');
  const vals = sandbox.StudioAdapter.bindings(DATA());
  const mv = sandbox.StudioMobile.vals(vals, DATA());
  assert.equal(mv.m.themeDarkCls, 'on', 'night with nothing stored');
  assert.equal(mv.m.themeLightCls, '');
});
