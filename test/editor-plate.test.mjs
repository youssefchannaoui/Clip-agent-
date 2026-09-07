import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// The editor's live-preview plate (v3.140.0). The editor used to play the
// finished RENDER, so a slider changed a number and never the picture -- which
// is what "zero of those buttons work" meant. It now plays a PLATE (the clip
// window, untouched) cut on the quick lane and draws captions, framing, grade,
// fx, watermark and nasheed over it live from the same object the sliders
// write. These tests pin the queue record, the landing, and the adapter's
// live layers -- executed output, never a grep of the source.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-plate-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'plate-test-secret-long-enough-yes-yes';

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

function seed() {
  const src = path.join(dataDir, 'source.mp4');
  fs.writeFileSync(src, 'x');
  state.authUsers.push({ id: 'user_admin', email: 'a@a', role: 'owner', providers: {}, createdAt: Date.now() });
  state.projects.push({ id: 'p1', userId: 'user_admin', title: 'L', status: 'done', engine: 'self-hosted',
    sourceFile: src, templateIdUsed: 'clean-line',
    templateSnapshot: { id: 'clean-line', name: 'Clean Line', version: 1, builtIn: true } });
  state.clips.push({ id: 'c1', projectId: 'p1', userId: 'user_admin', title: 'C', status: 'waiting',
    templateId: 'clean-line', startSec: 5, endSec: 24.55, durationMs: 19550 });
  // Deliberately NO music library: a plate waives the nasheed, a render does not.
}
seed();

test('a plate queues on the quick lane, waives the nasheed, and lands on its own slot', () => {
  const job = engine.queueClipRerender('c1', 'clean-line', { plate: true });
  assert.equal(job.plate, true);
  assert.equal(job.priority, 0, 'someone is watching a loading screen');
  const payload = JSON.parse(fs.readFileSync(job.jobFile, 'utf8'));
  assert.equal(payload.clipIdOverride, 'c1-plate', 'a fixed id overwrites the last plate rather than collecting them');
  assert.equal(payload.lane, 'quick');
  assert.equal(payload.clip.plate, true);
  assert.equal(payload.clip.startSec, 5);
  assert.equal(payload.clip.endSec, 24.55);
  assert.equal(payload.settings.musicEnabled, false, 'no nasheed is mixed into a plate');

  const clip = state.clips.find(c => c.id === 'c1');
  engine.importRerenderResultObjectForTests(job, { clips: [{
    id: 'c1-plate', clipFile: '/tmp/p.mp4', thumbFile: '/tmp/p.jpg', startSec: 5, endSec: 24.55,
    musicEnabled: false, musicVerified: false, renderVerified: true, plate: true,
  }] });
  assert.equal(job.status, 'done');
  assert.equal(job.stage, 'Live preview ready');
  assert.equal(clip.plate.clipFile, '/tmp/p.mp4');
  assert.equal(clip.plate.startSec, 5);
  assert.equal(clip.plate.endSec, 24.55);
  assert.ok(clip.plate.at > 0);
  assert.equal(clip.clipFile, undefined, 'the clip\'s own render is untouched');
  assert.equal(clip.renderVersion, undefined);
});

test('a queued plate and a queued render for one clip never replace each other', () => {
  // The renders below need a nasheed; the plate above proved it does not.
  const musicDir = path.join(dataDir, 'music');
  fs.mkdirSync(musicDir, { recursive: true });
  fs.writeFileSync(path.join(musicDir, 't1.mp3'), 'x');
  fs.writeFileSync(path.join(musicDir, 'library.json'), JSON.stringify([
    { id: 't1', userId: 'user_admin', shared: false, name: 'T', filename: 't1.mp3', durationSec: 60 },
  ]));
  // The single slot is held by the first test's job, so these queue.
  const render = engine.queueClipRerender('c1', 'clean-line', {});
  const plate = engine.queueClipRerender('c1', 'clean-line', { plate: true });
  const render2 = engine.queueClipRerender('c1', 'clean-line', {});
  const byId = id => state.rerenderJobs.find(j => j.id === id);
  assert.equal(byId(plate.id).status, 'queued', 'a newer render does not supersede the plate');
  assert.equal(byId(render.id).status, 'superseded', 'but it does supersede the older render');
  assert.equal(byId(render2.id).status, 'queued');
  const plate2 = engine.queueClipRerender('c1', 'clean-line', { plate: true });
  assert.equal(byId(plate.id).status, 'superseded', 'a newer plate supersedes the older plate');
  assert.equal(byId(render2.id).status, 'queued', 'and leaves the render alone');
  assert.equal(byId(plate2.id).status, 'queued');
});

// ── The adapter's live layers ────────────────────────────────────────────

function loadAdapter() {
  const src = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  const sandbox = {
    window: {}, document: { addEventListener() {}, createElement: () => ({ style: {} }), getElementById: () => null, querySelector: () => null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { language: 'en' }, console, setTimeout, clearTimeout, requestAnimationFrame: undefined,
    Intl, Date, Math, JSON, Number, String, Array, Object, isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.StudioAdapter;
}
const SA = loadAdapter();

const SEGS = [
  { start: 1, end: 3.82, text: 'The door does not close because you',
    words: ['The', 'door', 'does', 'not', 'close', 'because', 'you'].map((w, i) => ({ word: w, start: 1 + i * 0.4, end: 1.4 + i * 0.4 })) },
  { start: 3.82, end: 6, text: 'walked through it yesterday. He is' },
];

function tpl(extra = {}) {
  return { id: 'clean-line', name: 'Clean Line', captionMode: 'cards', captionMaxWords: 5, captionStackMaxWords: 4,
    captionFontSize: 62, captionPrimary: '#FFFFFF', captionHighlight: '#F0D6A6', captionMarginV: 680, captionAlign: 'center',
    watermark: 'DEENCLIPPED', watermarkOpacity: 100, watermarkPosition: 'top-center', ...extra };
}

function open({ plate = true, captionMode = 'cards', time = 1.5 } = {}) {
  const c = { id: 'c1', projectId: 'p1', title: 'A clip', status: 'waiting', score: 80, durationMs: 19550, startSec: 5, endSec: 24.55,
    transcript: SEGS.map(s => s.text).join(' '), captionSegments: SEGS, templateId: 'clean-line', renderQuality: 'final',
    musicVerified: true, renderVerified: true, targets: [], clipUrl: '/api/clips/c1/video',
    ...(plate ? { plate: { url: '/api/clips/c1/plate', thumbUrl: '/api/clips/c1/plate-thumb', startSec: 5, endSec: 24.55, at: 123 } } : {}),
    stylePending: true };
  Object.assign(SA.ui, { screen: 'editor', edClipId: 'c1', edTrim: null, edCutOuts: null, edCutMark: null, edTime: time,
    edDirty: false, edBlockDraft: null, edStyleDraft: null, edPlateFailed: false, edTplId: 'clean-line', edBlock: 0 });
  const t = tpl({ captionMode });
  return SA.bindings({ clips: [c], projects: [{ id: 'p1', title: 'L', status: 'done' }], templates: [t], selectedTemplate: t,
    social: {}, publishingSettings: {}, billing: {}, jobs: [], music: { tracks: [] }, musicSettings: {} });
}

const words = b => (b.edCapWords || []).map(w => (w.style ? '*' : '') + w.text).join(' ');

test('with a plate the editor is live: it plays the plate and draws the caption itself', () => {
  const b = open();
  assert.equal(b.edLive, true);
  assert.match(b.edVideoUrl, /\/api\/clips\/c1\/plate\?pl=123/, 'the plate, keyed on when it was cut');
  assert.equal(b.edRenderNotice, '', 'no "saved, not rendered" banner over a picture that IS current');
  assert.equal(b.edCapHandle, 'display: none;', 'no dashed handles around a real caption');
  assert.match(b.edLiveLabel, /Save clip renders/);
});

test('without a plate the editor falls back to the render and says so', () => {
  const b = open({ plate: false });
  assert.equal(b.edLive, false);
  assert.equal(b.edPlateWanted, true, 'and asks for one');
  assert.notEqual(b.edRenderNotice, '');
});

test('cards advance with the playhead and break where the render breaks them', () => {
  // captionMaxWords is 5, so the seven-word block is two cards; the second
  // block breaks on the full stop the way caption_cards does.
  assert.equal(words(open({ time: 1.5 })), 'The door does not close');
  assert.equal(words(open({ time: 3.5 })), 'because you');
  assert.equal(words(open({ time: 4.5 })), 'walked through it yesterday.');
  assert.equal(words(open({ time: 5.8 })), 'He is');
});

test('word mode lights the word being said inside its group', () => {
  // The render redraws the SAME group once per word with the live one lit.
  assert.equal(words(open({ captionMode: 'word', time: 1.5 })), 'The *door does not close');
  assert.equal(words(open({ captionMode: 'word', time: 3.5 })), 'because *you');
  assert.equal(words(open({ captionMode: 'cards', time: 1.5 })).includes('*'), false, 'a card is cut, never lit');
});
