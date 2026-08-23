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

test('only the watermark and templates are Pro, and both are enforced server-side', () => {
  const billing = read('src/billing.js');
  const features = billing.match(/export const PRO_FEATURES = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
  const keys = [...features.matchAll(/^\s*(\w+):/gm)].map(m => m[1]).sort();
  assert.deepEqual(keys, ['templates', 'watermark'],
    'adding a third Pro feature means adding its gate and its badge too');

  const server = read('src/server.js');
  assert.match(server, /Removing the DeenClipped watermark is a Pro feature/);
  assert.match(server, /is a Pro template/);
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
  const body = host.slice(at, at + 900);
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

test('every tour step anchors on something the page actually carries', () => {
  const adapter = read('src/public/studio-adapter.js');
  const page = read('src/public/studio-template.generated.js');
  const host = read('src/public/index.html');

  const block = adapter.slice(adapter.indexOf('var TOURS = {'), adapter.indexOf('  };', adapter.indexOf('var TOURS = {')));
  const anchors = [...block.matchAll(/anchor: '([^']+)'/g)].map(m => m[1]);
  assert.ok(anchors.length >= 15, 'the tours cover the product, not one screen');

  for (const anchor of anchors) {
    if (/^[#.[]/.test(anchor)) {
      // A CSS selector: at least its distinguishing id must exist somewhere.
      const id = anchor.match(/#([A-Za-z0-9_-]+)/);
      if (id) {
        assert.ok(page.includes(id[1]) || host.includes(id[1]), `${anchor} resolves to real markup`);
      }
      continue;
    }
    assert.ok(page.includes(`"data-tour":"${anchor}"`),
      `the ${anchor} anchor is missing — its step would spotlight nothing`);
  }
});

test('every screen with a nav entry has a tour', () => {
  const adapter = read('src/public/studio-adapter.js');
  const block = adapter.slice(adapter.indexOf('var TOURS = {'), adapter.indexOf('  };', adapter.indexOf('var TOURS = {')));
  const covered = [...block.matchAll(/^    (\w+): \[/gm)].map(m => m[1]);
  for (const screen of ['home', 'queue', 'schedule', 'templates', 'music', 'library', 'performance', 'tokens', 'editor']) {
    assert.ok(covered.includes(screen), `${screen} has no tour`);
  }
});

test('a tour is remembered per screen, not once for the whole product', () => {
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /'dcTour:' \+ screen/, 'each screen remembers its own');
  // Anyone who already finished the old single tour must not be shown one on
  // every screen the next time they sign in.
  const seen = adapter.slice(adapter.indexOf('function tourSeen'), adapter.indexOf('function markTourSeen'));
  assert.match(seen, /dcTourSeen/, 'the legacy flag still counts as seen');
});

// ── the starter list, and saying what Pro adds ─────────────────────────────

test('the starter list is proved from account data, not a dismissed flag', () => {
  const adapter = read('src/public/studio-adapter.js');
  const at = adapter.indexOf('startSteps:');
  assert.ok(at > 0, 'a new account gets a starter list');
  const body = adapter.slice(at, at + 2200);
  // Each item must be answered by real state, so it cannot tick itself just
  // because someone visited the screen.
  for (const proof of ['tracks.length > 0', 'projects.length > 0', 'connectedCount > 0']) {
    assert.ok(body.includes(proof), `an item is proved by ${proof}`);
  }
  assert.match(adapter, /startListOn:/, 'and it goes away once finished');
});

test('the plans screen says what Pro adds and what free already includes', () => {
  const adapter = read('src/public/studio-adapter.js');
  const at = adapter.indexOf('planCards:');
  assert.ok(at > 0);
  const body = adapter.slice(at, at + 1800);
  assert.match(body, /freeIncludes/, 'the free card lists what it already does');
  assert.match(body, /proFeatures/, 'the paid card names the two things it adds');
  // Read from the server's own lists so a badge and a plan card can never
  // disagree with the gate that enforces them.
  const billing = read('src/billing.js');
  assert.match(billing, /proFeatures: PRO_FEATURES/);
  assert.match(billing, /freeIncludes: FREE_INCLUDES/);
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
  assert.match(adapter, /tourDismiss:/, 'the dimmed area ends the tour');
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
