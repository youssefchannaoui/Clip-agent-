import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

/**
 * A cancelled lecture is told how to go again, never to wait.
 *
 * Youssef, 5 Sept 2026, with Home showing both lectures CANCELLED and a toast
 * reading "Wait for the lecture to finish processing before generating more
 * clips.": "i cancled but look at the erorr".
 *
 * He had cancelled two imports during a pair of worker deploys four minutes
 * apart (each restarts the box and sends a running job back to its start),
 * then pressed the one button the lecture offered -- Re-cut clips -- and was
 * told to wait for a lecture that will never finish. Three things were true:
 *
 *   - queueMoreClips answered every non-finished status with the WAIT
 *     sentence, cancelled and failed included;
 *   - the retry route has accepted a cancelled project all along
 *     (retryProject: ['failed', 'cancelled']), but the studio offered Retry
 *     for `failed` only -- so the one action that helps was never on screen;
 *   - the library filed a cancelled lecture as "Archived" while Home said
 *     "Cancelled" -- two screens disagreeing about one lecture, the shape the
 *     5 Sept audit fixed for `failed` one state over.
 *
 * The engine half is driven by CALLING queueMoreClips; the studio half by
 * computing the real bindings over a cancelled project and pressing the
 * card's menu and the detail's primary action.
 */

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const HOUR = 3600000;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-cancelled-lecture-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'cancelled-lecture-secret-long-enough';
process.env.SOCIAL_TOKEN_KEY = 'social-token-key-at-least-thirty-two-chars';
process.env.PUBLIC_BASE_URL = 'https://app.test';

const { state, save } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

function seedEngine() {
  state.authUsers = [{ id: 'u1', email: 'c@test', name: 'C', role: 'creator', providers: {}, createdAt: Date.now(), billing: { plan: 'pro', status: 'active' } }];
  state.projects = [
    { id: 'p-cancelled', userId: 'u1', status: 'cancelled', engine: 'remote', url: 'https://youtu.be/abc', title: 'Surah an-Nisa', submittedAt: Date.now() - HOUR, progress: 13 },
    { id: 'p-failed', userId: 'u1', status: 'failed', engine: 'remote', url: 'https://youtu.be/def', title: 'Khutbah', submittedAt: Date.now() - HOUR, error: 'Processing engine failed: x' },
    { id: 'p-processing', userId: 'u1', status: 'processing', engine: 'remote', url: 'https://youtu.be/ghi', title: 'Lecture', submittedAt: Date.now() - HOUR, progress: 40 },
  ];
  state.clips = [];
  save();
}

/* ── The engine: the sentence names the way forward ── */
test('Re-cut on a cancelled lecture names Retry instead of telling you to wait', () => {
  seedEngine();
  assert.throws(() => engine.queueMoreClips('p-cancelled'), error => {
    assert.match(error.message, /cancelled/i, 'says what happened to it');
    assert.match(error.message, /Retry this lecture/, 'and what to press');
    assert.doesNotMatch(error.message, /Wait for the lecture/, 'a cancelled lecture never finishes, so "wait" has no end');
    return true;
  });
});

test('and a failed lecture is answered the same way', () => {
  seedEngine();
  assert.throws(() => engine.queueMoreClips('p-failed'), error => {
    assert.match(error.message, /never finished|failed/i);
    assert.match(error.message, /Retry this lecture/);
    assert.doesNotMatch(error.message, /Wait for the lecture/);
    return true;
  });
});

test('a lecture still processing keeps the honest wait', () => {
  seedEngine();
  assert.throws(() => engine.queueMoreClips('p-processing'), /Wait for the lecture to finish processing/);
});

test('the offer and the acceptance agree: the retry route takes exactly failed and cancelled', () => {
  // The studio may only offer Retry where the server accepts it, and the
  // server's condition is this one line. If it ever changes, the card menu
  // and the detail's primary action below have to move with it.
  const source = read('src/local-engine.js');
  const at = source.indexOf('export function retryProject(');
  assert.ok(at > 0);
  assert.match(source.slice(at, at + 900), /\['failed', 'cancelled'\]\.includes\(project\.status\)/);
});

/* ── The studio: the adapter loaded the way audit-fixes.test.mjs loads it ── */
function bindings(over, ui) {
  const src = read('src/public/studio-adapter.js');
  const sandbox = {
    console, Date, Math, JSON, Intl, setTimeout, clearTimeout, isNaN, parseInt, parseFloat, Number, String, Boolean, Array, Object, RegExp,
    localStorage: { getItem: k => (/dcTour/.test(String(k)) ? '1' : null), setItem: () => {}, removeItem: () => {} },
    innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {}, contains: () => false } }, documentElement: { classList: { add() {}, remove() {}, contains: () => false } }, addEventListener() {} },
    navigator: { userAgent: '' }, location: { href: '', search: '', hash: '' }, history: { replaceState() {} },
    requestAnimationFrame: fn => fn(), addEventListener() {}, removeEventListener() {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const DATA = Object.assign({
    clips: [], projects: [], music: [], tracks: [], postTimes: [],
    social: { providers: {} }, billing: { notices: [], current: {} },
    onboarding: null, user: { id: 'u1' }, templates: [], clipSettings: {},
  }, over);
  if (ui) Object.assign(sandbox.StudioAdapter.ui, ui);
  return { v: sandbox.StudioAdapter.bindings(DATA), A: sandbox.StudioAdapter, DATA };
}
const cancelled = () => ({ id: 'p1', userId: 'u1', status: 'cancelled', submittedAt: Date.now() - HOUR, title: 'Surah an-Nisa', url: 'https://youtu.be/abc', progress: 13 });
const fakeEvent = () => ({ preventDefault() {}, stopPropagation() {} });

test('a cancelled lecture reads Cancelled on the library card and in its tab', () => {
  const { v } = bindings({ projects: [cancelled()] });
  const card = v.libraryItems[0];
  assert.equal(card.stateChip, 'Cancelled', 'was "Archived" while Home said "Cancelled"');
  assert.match(String(card.metric), /cancelled/i, 'the metric says what happened, not "no clips yet"');
  const tab = v.libTabs.find(t => t.key === 'archived');
  assert.equal(tab.label, 'Cancelled');
  assert.equal(tab.count, 1);
});

test('its card menu offers Retry, which the route has accepted all along', () => {
  const { v, A } = bindings({ projects: [cancelled()] });
  let offered = null;
  A.onPickOption = (title, options) => { offered = options; };
  v.libraryItems[0].more(fakeEvent());
  assert.ok(Array.isArray(offered), 'the menu opened');
  assert.ok(offered.includes('Retry this lecture'), 'Retry offered: ' + JSON.stringify(offered));
});

test('its detail screen says so and leads with Retry', () => {
  const { v: d, A } = bindings({ projects: [cancelled()] }, { screen: 'detail', openProject: 'p1' });
  assert.match(String(d.subline), /^Cancelled/, 'the subline names the state, as "Import failed" does for a failure');
  assert.equal(d.bulkLabel, 'Retry this lecture', 'was "Approve all remaining" on a lecture that was stopped');
  assert.match(String(d.detailHint), /cancelled/i);
  assert.match(String(d.detailHint), /Retry/);
  assert.doesNotMatch(String(d.detailHint), /Approving one queues it/);
  let retried = null;
  A.onRetryProject = id => { retried = id; };
  d.bulkAction(fakeEvent());
  assert.equal(retried, 'p1', 'the primary action retries this lecture');
});

test('a finished lecture is untouched by any of this', () => {
  const done = { id: 'p2', userId: 'u1', status: 'done', submittedAt: Date.now() - HOUR, title: 'Done', url: 'https://youtu.be/x', clipCount: 3 };
  const { v } = bindings({ projects: [done] }, { screen: 'detail', openProject: 'p2' });
  assert.equal(v.libraryItems[0].stateChip, 'Ready');
  assert.equal(v.bulkLabel, 'Approve all remaining');
  assert.doesNotMatch(String(v.detailHint), /cancelled/i);
});

/* ── A retry ADDS to the clips a stopped run already made ── */
test('existingRangesFor lists the moments a lecture already holds, in the worker’s shape', () => {
  seedEngine();
  state.clips = [
    { id: 'k-1', userId: 'u1', projectId: 'p-cancelled', startSec: 30, endSec: 75, status: 'approved' },
    { id: 'k-2', userId: 'u1', projectId: 'p-cancelled', startSec: 200, endSec: 245, status: 'waiting' },
    { id: 'other', userId: 'u1', projectId: 'p-failed', startSec: 1, endSec: 2 },
  ];
  save();
  const ranges = Array.from(engine.existingRangesFor('p-cancelled'), r => ({ ...r }));
  assert.deepEqual(ranges, [
    { id: 'k-1', startSec: 30, endSec: 75 },
    { id: 'k-2', startSec: 200, endSec: 245 },
  ], 'exactly this lecture’s clips, id and both edges');
  assert.deepEqual(Array.from(engine.existingRangesFor('p-processing')), [], 'a lecture with nothing is an empty list, never undefined');
});

test('the remote run and the local retry both carry those ranges to the worker', () => {
  // The worker's own guard (remove_existing_moments) only ever ran on the
  // more-clips path, so a retry re-picked the same moments under new ids.
  // Source pins, because the remote run needs a live worker to drive; the
  // helper above is the executed half.
  const source = read('src/local-engine.js');
  const run = source.slice(source.indexOf('async function runRemoteProject('), source.indexOf('async function runRemoteAux('));
  assert.match(run, /payload\.existingRanges = existingRangesFor\(project\.id\);/, 'the remote payload carries them, read at run time');
  const retry = source.slice(source.indexOf('export function retryProject('), source.indexOf('export function cancelWork('));
  assert.match(retry, /job\.existingRanges = existingRangesFor\(projectId\);/, 'and so does the local retry’s job file');
  const done = source.slice(source.indexOf('function importResultObject('), source.indexOf('function importResultObject(') + 4000);
  assert.match(done, /project\.clipCount = state\.clips\.filter\(clip => clip\.projectId === project\.id\)\.length;/,
    'a completion counts every clip the lecture holds, not only the ones this run added');
  assert.doesNotMatch(done, /project\.clipCount = imported\.length;/);
});
