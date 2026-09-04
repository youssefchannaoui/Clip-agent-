import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// ── Pro is exactly two things ──────────────────────────────────────────────
// Every badge this product shows has to correspond to a gate the server
// actually enforces. A badge on anything else is a promise the code breaks.

test('every feature the table sells is enforced server-side, tier by tier', () => {
  const billing = read('src/billing.js');
  const table = billing.match(/export const FEATURES = Object\.freeze\(\{([\s\S]*?)\n\}\);/)[1];
  const rows = [...table.matchAll(/^  (\w+): Object\.freeze\(\{ tier: '(\w+)'/gm)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows.map(([key]) => key).sort(),
    ['deenai', 'deenaiAsk', 'extraSlots', 'moreTokens', 'priorityRender', 'templates', 'watermark'],
    'adding a feature means adding its gate and its place in the pricing grid too');
  assert.deepEqual(Object.fromEntries(rows), {
    watermark: 'pro', templates: 'pro', deenai: 'pro',
    deenaiAsk: 'pro', priorityRender: 'studio', extraSlots: 'studio', moreTokens: 'studio',
  }, 'the tier each feature belongs to is a pricing promise, not an implementation detail');

  // Each one refused by the server, not merely hidden by the interface.
  const server = read('src/server.js');
  assert.match(server, /Removing the DeenClipped watermark is a Pro feature/);
  assert.match(server, /is a Pro template/);
  assert.match(server, /DeenAI is a Pro feature/);
  assert.match(server, /Asking DeenAI is a Studio feature/);
  // The two Studio features that are not a route read DIFFERENT tiers, and the
  // difference is whether anyone else pays for it.
  //
  // The render queue reads the PAID tier: a single worker slot is zero-sum, so
  // the operator jumping it costs a paying customer their place.
  assert.match(read('src/local-engine.js'), /paysForAtLeast\(owner, 'studio'\)/);
  // The posting windows read the FEATURE tier, so the operator gets Studio's
  // eight like every other perk (Youssef, 1 Sept 2026: "for admin account
  // should be like studio with all perks"). Extra windows widen one account's
  // own day and take nothing from anybody.
  assert.match(read('src/agent.js'), /atLeast\(owner, 'studio'\)/);
  assert.ok(!/paysForAtLeast\(owner, 'studio'\)/.test(read('src/agent.js')),
    'and the paid check is gone from the scheduler, not merely joined');
});

test('scheduling, publishing and automation stay free', () => {
  const billing = read('src/billing.js');
  const free = billing.match(/export const FREE_INCLUDES = Object\.freeze\(\[([\s\S]*?)\]\);/)[1];
  assert.match(free, /Publishing straight to/);
  assert.match(free, /Scheduling and automation/);
  assert.match(free, /As many clips per lecture/);
});

// ── the gates are reachable from every picker ──────────────────────────────

test('every template picker marks Pro styles, not only the job panel', () => {
  const adapter = read('src/public/studio-adapter.js');
  // The header dropdown on Templates, and the Clip Style select in Library.
  for (const binding of ['tplList:', 'tplNames:']) {
    const at = adapter.indexOf(binding);
    assert.ok(at > 0, binding + ' still exists');
    const body = adapter.slice(at, at + 400);
    assert.match(body, /planAllowsProTemplates/,
      binding + ' must mark Pro entries — an unmarked one applies, then fails');
  }
});

test('picking a Pro style on a free plan is refused before any request', () => {
  const adapter = read('src/public/studio-adapter.js');
  // Anchored on the binding name, not a substring of it: plain indexOf finds
  // resetTpl before setTpl and cheerfully asserts against the wrong function.
  for (const name of ['setActiveTpl', 'setTpl']) {
    const at = adapter.search(new RegExp('(?<![A-Za-z])' + name + ': function'));
    assert.ok(at > 0, name + ' still exists');
    const body = adapter.slice(at, at + 700);
    assert.match(body, /is a Pro style/, name + ' must say so instead of round-tripping a 400');
  }
});

test('the re-render route checks the plan, like the selection routes do', () => {
  const server = read('src/server.js');
  const at = server.indexOf('rerenderClip[1]');
  assert.ok(at > 0);
  const body = server.slice(at - 400, at + 600);
  assert.match(body, /assertTemplateAllowed/,
    're-render used to accept a Pro template and silently render the default');
});

// ── a review decision must be reversible ───────────────────────────────────

test('rejecting a clip does not destroy it', () => {
  const host = read('src/public/index.html');
  const at = host.indexOf('StudioAdapter.onReject=');
  assert.ok(at > 0);
  const line = host.slice(at, at + 260);
  assert.doesNotMatch(line, /method:'DELETE'/,
    'the X on a review card destroyed the clip and its render, with no undo');
  assert.match(line, /status:'rejected'/);
  assert.match(host, /StudioAdapter\.onRestore=/, 'and there is a way back');
});

// ── the prerequisite is said where it can be read ──────────────────────────

test('the blocker banner is not trapped on the review queue', () => {
  const design = read('design/studio-dashboard.dc.html');
  const banner = design.indexOf('{{ blockerText }}');
  assert.ok(banner > 0);
  // Whatever sc-if most recently opened before the banner must not be a screen
  // gate: a new account has no clips, so it can never reach the queue to read
  // the one sentence explaining why it has no clips.
  const before = design.slice(0, banner);
  const opens = [...before.matchAll(/<sc-if value="\{\{ (\w+) \}\}"/g)].map(m => m[1]);
  assert.notEqual(opens[opens.length - 1], 'isQueue',
    'the banner belongs above every screen, not on one that needs clips to reach');
});

test('an MP4 upload checks for a nasheed before it sends the file', () => {
  const host = read('src/public/index.html');
  const at = host.indexOf('StudioAdapter.onUploadFile=');
  assert.ok(at > 0);
  // The whole handler, not a fixed byte window. This used to slice 900
  // characters, so adding upload-progress reporting pushed templateId past the
  // end and failed a test about something the change never touched.
  const nextHook = host.indexOf('StudioAdapter.on', at + 20);
  const body = host.slice(at, nextHook > at ? nextHook : at + 2000);
  const guard = body.indexOf('Upload a nasheed first');
  const presign = body.indexOf('/api/uploads/presign');
  assert.ok(guard > 0 && guard < presign,
    'the whole file used to upload and only then be refused');
  assert.match(body, /templateId:/, 'and the picked Clip Style travels with it');
});

test('the upload route passes the template through, like the URL route', () => {
  const server = read('src/server.js');
  const at = server.indexOf('if (body.objectKey) {');
  assert.ok(at > 0);
  const body = server.slice(at, at + 1200);
  assert.match(body, /templateId: String\(body\.templateId/,
    'an uploaded MP4 ignored the Clip Style and used the account default');
});

test('a clip that waived music can still be re-rendered', () => {
  const engine = read('src/local-engine.js');
  const at = engine.indexOf('const waivesMusic');
  assert.ok(at > 0, 'the editor was inert for anyone who turned the nasheed off');
  const body = engine.slice(at, at + 400);
  assert.match(body, /clip\.musicEnabled === false/);
});

// ── every tour step must be able to point at something ─────────────────────
// A spotlight is drawn from its anchor's rectangle. An anchor that does not
// exist produces a card floating over a dimmed screen, highlighting nothing --
// and nothing else in the suite would notice.

test('the walkthrough is ONE ordered list, not a tour per tab', () => {
  // Youssef, 4 Sept 2026: "It should go to different tabs alone. Not each tab
  // has a different demo." What was here was a map keyed by SCREEN, so the
  // product was explained in six unconnected lectures that each began when you
  // happened to arrive, in whatever order you wandered -- and nothing ever
  // said what to do first.
  const adapter = read('src/public/studio-adapter.js');
  assert.ok(!/var TOURS = \{/.test(adapter), 'the per-screen map is gone');
  assert.match(adapter, /var TOUR = \[/, 'one ordered list');

  const block = adapter.slice(adapter.indexOf('var TOUR = ['), adapter.indexOf('\n  ];', adapter.indexOf('var TOUR = [')));
  const keys = [...block.matchAll(/key: '([^']+)'/g)].map(m => m[1]);
  // CONNECTING COMES FIRST. "the first thing should realistically be is they
  // should connect themselves to a social media." A clip with nowhere to go is
  // the one thing this product cannot finish, and it was the step people
  // skipped.
  assert.equal(keys[0], 'connect', 'the walkthrough opens on connecting a channel');
  // `style` joined it in v3.124.2 and sits BEFORE the import: the caption
  // style is applied when the clips are cut, so choosing it afterwards means
  // re-rendering. test/walkthrough.test.mjs pins the order on its own.
  assert.deepEqual(keys, ['connect', 'nasheed', 'style', 'import', 'review', 'schedule', 'finish'],
    'and runs the pipeline in the order somebody actually does it');

  // Every step names the tab it belongs to, which is what lets it steer.
  const screens = [...block.matchAll(/screen: '([^']+)'/g)].map(m => m[1]);
  assert.equal(screens.length, keys.length, 'every step names its screen');
  assert.ok(new Set(screens).size > 1, 'and they are not all one tab');
});

test('it steers the screen itself, and only when the step changes', () => {
  const adapter = read('src/public/studio-adapter.js');
  const driver = adapter.slice(adapter.indexOf('IT GOES TO THE TAB ITSELF'), adapter.indexOf('AND IT MOVES ON WHEN YOU HAVE ACTUALLY DONE IT'));
  assert.match(driver, /UI\.screen = tourStep\.screen/, 'the walkthrough changes tab');
  // Guarded, or it would drag you back every time you clicked another tab
  // while the card was up -- a walkthrough holding you hostage.
  assert.match(driver, /UI\.tourNavAt !== tourIndex/, 'only on the paint the step changes');
});

test('an interactive step waits for the thing to be DONE, not for the button', () => {
  // "you have to go through them, let them do it. And then once they do it, it
  // goes." Advancing on the press would be the old behaviour with a better
  // label on it.
  const adapter = read('src/public/studio-adapter.js');
  const next = adapter.slice(adapter.indexOf('tourNext: function (e) {'), adapter.indexOf('tourBack: function'));
  assert.match(next, /step\.does\(\)/, 'the button performs the step');
  assert.match(next, /UI\.tourAwait = tourIndex/, 'and marks the walkthrough as waiting on it');
  // The FIRST press must not advance an unfinished interactive step. The
  // second one must -- every gated step was otherwise a wall, and review,
  // schedule and finish were unreachable in a first sitting; that half is
  // DRIVEN in test/walkthrough.test.mjs rather than read here.
  const guard = next.slice(next.indexOf('if (step && step.does && step.done'));
  assert.ok(guard.indexOf('return;') < guard.indexOf('setUI({ tourStep: tourIndex + 1'),
    'it returns before advancing');
  assert.match(guard, /UI\.tourAwait !== tourIndex/, 'and only waits once');

  // Completion is read from the account's own records, so a step already
  // satisfied is ticked rather than re-taught.
  const block = adapter.slice(adapter.indexOf('var TOUR = ['), adapter.indexOf('\n  ];', adapter.indexOf('var TOUR = [')));
  assert.match(block, /done: function \(data\)[\s\S]*?providers/, 'connecting is read from the connections');
  assert.match(block, /done: function \(data\) \{ return \(\(\(data \|\| \{\}\)\.tracks\) \|\| \[\]\)\.length > 0; \}/,
    'the nasheed step from the library');
});

test('it shares the percentage rather than counting its own', () => {
  // "it works with the percentage system as well." Two numbers describing one
  // person's progress would eventually disagree -- this app has shipped that
  // bug more than once -- so the card reads DATA.tasks, the same one the rail
  // ring reads.
  const adapter = read('src/public/studio-adapter.js');
  const count = adapter.slice(adapter.indexOf('tourCount: (function () {'), adapter.indexOf('tourNextLabel:'));
  assert.match(count, /DATA\.tasks/, 'the percentage comes from the task ladder');
  assert.match(count, /ringPercent/, 'the same field the rail card draws');
  assert.ok(!/tourDone\.filter/.test(count), 'and is not recounted from the tour steps');
});

test('the walkthrough is remembered ONCE, and the old per-screen keys still count', () => {
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /var TOUR_KEY = 'dcTour:walkthrough'/, 'one key for the whole product');
  const seen = adapter.slice(adapter.indexOf('function tourSeen'), adapter.indexOf('function markTourSeen'));
  // Anyone who already went round the product must not be started on a new
  // walkthrough because the storage key changed underneath them.
  assert.match(seen, /dcTourSeen/, 'the oldest flag still counts as seen');
  assert.match(seen, /TOUR_OLD/, 'and so do the per-screen keys it replaced');
});

test('the connections dialog counts as a layer, or the walkthrough veils it', () => {
  // FOUND BY DRIVING IT, not by reading. Step one opens the connections
  // dialog -- and `UI.connProvider` is only set when a single platform is
  // being shown, so the dialog opened with it still null: the tour veil stayed
  // up and the card floated over a dialog nobody could reach. Measured in the
  // browser at 1440x950, the dialog full-viewport and fully dimmed underneath.
  //
  // Two overlays at once is the exact failure the tour already refused to
  // cause for the job panel; the host-rendered dialog simply was not on the
  // list of layers.
  const adapter = read('src/public/studio-adapter.js');
  const block = adapter.slice(adapter.indexOf('var connDialogOpen = false;'), adapter.indexOf('var otherLayerOpen') + 200);
  assert.match(block, /getElementById\('studioConn'\)/, 'the host dialog is checked');
  assert.match(block, /classList\.contains\('hide'\)/, 'by the class it actually keeps its state in');
  assert.match(block, /otherLayerOpen = Boolean\([^)]*connDialogOpen\)/, 'and it counts as a layer');
  // Guarded: bindings() runs with no document under test, and an unguarded
  // read there would throw on every single test in this suite.
  assert.match(block, /if \(global\.document\)/, 'guarded for the no-document case');
});

test('every walkthrough step anchors on something the page actually carries', () => {
  const adapter = read('src/public/studio-adapter.js');
  const page = read('src/public/studio-template.generated.js');
  const host = read('src/public/index.html');

  const block = adapter.slice(adapter.indexOf('var TOUR = ['), adapter.indexOf('\n  ];', adapter.indexOf('var TOUR = [')));
  // An anchor may be a LIST, tried in order: the review step wants the deck's
  // Approve button but falls back to the queue's tab row, because an account
  // walking this for the first time has no clips yet.
  const anchors = [
    ...[...block.matchAll(/anchor: '([^']+)'/g)].map(m => m[1]),
    ...[...block.matchAll(/anchor: \[([^\]]+)\]/g)]
      .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])),
  ];
  assert.ok(anchors.length >= 6, 'the steps that point at something name it');

  for (const anchor of anchors) {
    if (/^[#.[]/.test(anchor)) {
      const id = anchor.match(/#([A-Za-z0-9_-]+)/);
      if (id) assert.ok(page.includes(id[1]) || host.includes(id[1]), `${anchor} resolves to real markup`);
      continue;
    }
    assert.ok(page.includes(`"data-tour":"${anchor}"`),
      `the ${anchor} anchor is missing — its step would spotlight nothing`);
  }
});

// ── the retired starter list, and saying what Pro adds ─────────────────────

test('the five-step starter list is retired, and nothing it taught was lost', () => {
  // Youssef, on the live Home screen: "remove the getting start and improve
  // this one cause i already had it." The Create -> Review -> Publish strip
  // had been built beside this checklist, which is two onboarding systems on
  // one screen telling one person two different things about where they are.
  //
  // This test used to assert the list EXISTED, and it passed on a source
  // string -- so it went on passing after the list stopped being shown. It
  // asserts the retirement now, and the far more important half: that the
  // prerequisites it carried still reach the customer somewhere.
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /startListOn: false/,
    'one binding gates BOTH the Home card and the header chip, so false removes both with no re-import');

  // Everything the list checked, folded into the strip's copy. Each is the
  // ONE thing whose absence stalls that step.
  const onboarding = read('src/onboarding.js');
  assert.match(onboarding, /nasheed/i, 'the nasheed prerequisite must survive — nothing finishes without one');
  assert.match(onboarding, /Connect a channel/, 'and connecting somewhere to post');
  assert.match(onboarding, /Give your approved clip a time/, 'and giving a clip a time');

  // The phone carried its own copy of the card and must not still draw it.
  const mobile = read('src/public/studio-mobile.js');
  assert.ok(!/'Getting set up'/.test(mobile), 'the phone must not still render the retired card');
  assert.ok(!/startSteps/.test(mobile), 'nor decorate a list nothing draws');
});

test('each tier card says what it adds, from the server\'s own lists', () => {
  const adapter = read('src/public/studio-adapter.js');
  const at = adapter.indexOf('var tierCards =');
  assert.ok(at > 0, 'the pricing grid still builds its cards here');
  const body = adapter.slice(at, at + 3400);
  assert.match(body, /freeIncludes/, 'the Basic column lists what it already does');
  assert.match(body, /tierAdds/, 'the paid columns name what they add');

  // Read from the server's own lists so a card and the gate that enforces it
  // can never disagree -- and those lists are DERIVED from the one feature
  // table rather than written out a second time.
  const billing = read('src/billing.js');
  assert.match(billing, /proFeatures: PRO_FEATURES/);
  assert.match(billing, /freeIncludes: FREE_INCLUDES/);
  assert.match(billing, /pro: Object\.values\(PRO_FEATURES\)/);
  assert.match(billing, /studio: Object\.values\(STUDIO_FEATURES\)/);
  assert.match(billing, /export const PRO_FEATURES = Object\.freeze\(Object\.fromEntries\(/,
    'the Pro list is computed from FEATURES, not maintained beside it');
});

// ── no dead controls (CLAUDE.md invariant 8) ───────────────────────────────
// Seven controls could not reach any outcome. Each was either deleted or
// replaced by the statement it was standing in for. This guards the shape of
// the failure, not the specific seven: a control whose only behaviour is to
// explain that it does nothing.

test('no control exists only to say it does nothing', () => {
  const adapter = read('src/public/studio-adapter.js');
  for (const gone of [
    'duplicateTpl',        // both duplicate paths refuse: one template per kind
    'archiveSources',      // never built
    'editWindows',         // posting times are server config, no write route
    'toggleDuck',          // ducking is always on
    'toggleRot',           // every uploaded nasheed is in rotation
  ]) {
    assert.ok(!adapter.includes(gone + ':'), `${gone} is a binding that could not act`);
  }
  const design = read('design/studio-dashboard.dc.html');
  for (const gone of ['{{ duplicateTpl }}', '{{ archiveSources }}', '{{ editWindows }}', '{{ toggleDuck }}']) {
    assert.ok(!design.includes(gone), `${gone} is still wired to a control`);
  }
});

test('the performance range tabs change the numbers', () => {
  const adapter = read('src/public/studio-adapter.js');
  // They set UI.perfRange and nothing read it: three tabs over one answer.
  assert.match(adapter, /PERF_WINDOW/, 'the range is applied');
  const tiles = adapter.slice(adapter.indexOf('perfTiles:'), adapter.indexOf('perfBoard:'));
  assert.match(tiles, /perfClips/, 'the tiles count the filtered set');
  assert.doesNotMatch(tiles, /String\(clips\.length\)/, 'not the whole account regardless of range');
});

test('the dead duplicate route is gone, and the guard behind it stays', () => {
  const server = read('src/server.js');
  assert.doesNotMatch(server, /\/duplicate\$/, 'the route only ever returned its own refusal');
  const templates = read('src/templates.js');
  assert.match(templates, /export function duplicateTemplate/,
    'the guard against minting templates stays, and its test with it');
});

test('posting windows say where they come from instead of offering an edit', () => {
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /postWindowNote:/);
  assert.match(adapter, /Set on the server/);
});

// ── a tour must never make the page unusable ───────────────────────────────

test('the tour card is clamped on both axes', () => {
  const adapter = read('src/public/studio-adapter.js');
  const at = adapter.indexOf('tourCardStyle:');
  const body = adapter.slice(at, at + 1800);
  // It was clamped horizontally only, so placing above an anchor near the top
  // pushed the card off the top of the screen: the reader saw a paragraph
  // ending mid-sentence and a Next button, with the title gone.
  assert.match(body, /Math\.max\(16, Math\.min\(top/, 'the vertical position is clamped');
  assert.match(body, /max-height: calc\(100vh - 32px\); overflow: auto/,
    'and a long step can never be taller than the screen');
});

test('a tour never opens on top of another layer, and the veil is a way out', () => {
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /otherLayerOpen/, 'nothing starts while a dialog owns the screen');
  // It PUTS IT AWAY rather than ending it: clicking the dim used to write the
  // seen key, so one slip spent the walkthrough for ever. Driven in
  // test/walkthrough.test.mjs.
  assert.match(adapter, /tourDismiss:/, 'the dimmed area is a way out');
  const design = read('design/studio-dashboard.dc.html');
  assert.match(design, /onClick="\{\{ tourDismiss \}\}" style="\{\{ tourVeilStyle \}\}"/,
    'a veil with nothing to dismiss it is an unusable page');
});

test('the old dashboard tour is gone, so a new browser gets one tour', () => {
  const host = read('src/public/index.html');
  for (const gone of ['tourModal', 'maybeOpenTour', 'deenTourSeen', 'TOUR_INDEX']) {
    assert.ok(!host.includes(gone),
      `${gone} belongs to the old six-step modal, which stacked under the studio tour`);
  }
});

test('setup progress is visible from every screen', () => {
  const design = read('design/studio-dashboard.dc.html');
  const header = design.slice(design.indexOf('<header'), design.indexOf('</header>'));
  assert.match(header, /\{\{ startDoneLabel \}\}/,
    'seen only on Home, a new user cannot tell anything is outstanding');
});
