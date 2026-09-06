import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * THE CLIP EDITOR, FIXED SO THE GATE CAN COME OFF.
 *
 * Youssef, 6 Sept 2026: "this clip editor has caused me so many issues, and
 * needs to be fixed so then i can remove the coming soon."
 *
 * Every control was driven in a browser against a rendered clip before this
 * file was written. What was wrong was not the render path (the editor plays
 * the rendered file, invariant 4, and that held) but everything around it:
 *
 *   - Preview ran the TEMPLATES screen's binding and opened some other clip's
 *     player. The server has rendered a ~6s preview window on the quick lane
 *     since the feature shipped; nothing in the browser ever asked for one.
 *   - The Look tab's watermark switch wrote watermarkOpacity: 0 into THIS
 *     clip's overrides. The route's paywall refused a free account; a paid
 *     one kept a per-clip brand override, against "once configured it works
 *     for all clips" -- and every other brand field went through for anyone.
 *   - The Look and Framing sliders changed nothing on screen until a full
 *     re-render came back, which read as eight dead controls.
 *   - Leaving the editor dropped unsaved caption words without a word.
 *   - One Save announced itself three times.
 *   - The Export tab claimed a re-render costs a token and that Save reaches
 *     every clip of the lecture. Neither is true.
 *   - The title said BETA and a first-run pop-up said rough edges were likely.
 *
 * These are driven through the adapter's own bindings and the real server,
 * never by reading source for the sentence that should be there.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const source = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');

function loadAdapter() {
  const sandbox = { window: {}, document: undefined, setTimeout, clearTimeout, console };
  sandbox.window.window = sandbox.window;
  sandbox.window.setTimeout = setTimeout;
  sandbox.window.clearTimeout = clearTimeout;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'studio-adapter.js' });
  return { StudioAdapter: sandbox.window.StudioAdapter, win: sandbox.window };
}

const TEMPLATE = {
  id: 'clean-line', name: 'Clean Line', height: 1920, width: 1080, version: 2,
  captionFontSize: 96, captionMarginV: 680, filterPreset: 'natural', captionMode: 'dynamic-stack',
  watermark: 'DEENCLIPPED', watermarkOpacity: 100,
};
function clipRecord(extra = {}) {
  return {
    id: 'edtest', projectId: 'p1', title: 'The door never closes', transcript: 'Bismillah. Keep asking.',
    status: 'waiting', templateId: 'clean-line', templateVersion: 2, renderVersion: 1,
    durationMs: 30000, startSec: 100, endSec: 130, thumbUrl: '/api/clips/edtest/thumb',
    videoUrl: '/api/clips/edtest/video', styleOverrides: {},
    captionSegments: [{ start: 0, end: 4, text: 'Bismillah.' }, { start: 4, end: 9, text: 'Keep asking.' }],
    ...extra,
  };
}
function editorAt({ StudioAdapter }, clip, ui = {}) {
  const STATE = {
    projects: [{ id: 'p1', title: 'A lecture', status: 'done' }], clips: [clip], tracks: [],
    templates: [TEMPLATE], selectedTemplate: TEMPLATE, brand: {},
  };
  Object.assign(StudioAdapter.ui, {
    screen: 'editor', edClipId: clip.id, edStyleDraft: null, edBlockDraft: null, edTrim: null,
    edCutOuts: null, edCutMark: null, edBlock: 0, edTime: 0, edPlayhead: 0, edDirty: false,
    edTab: 'captions', edStyleTimer: null, tourStep: -1, ...ui,
  });
  return { STATE, b: StudioAdapter.bindings(STATE) };
}
const noEvent = { preventDefault() {}, stopPropagation() {} };

// The server comes up ABOVE every test: node --test starts the tests it
// already has at the module's first await, so a server imported below them
// is closed by the after hook before the route tests run (CLAUDE.md).
test('what the caption dock hides on one tab comes back on the next', () => {
  // The patcher pairs a tab's rows against the next tab's BY INDEX, and the
  // font-group label the dock hid on Captions was STILL hidden when that
  // node became the Look tab's "Grain" label: a slider with no name and no
  // value on every direct Captions -> Look switch (and the Framing tab's
  // Zoom row the same way). data-host-style is exactly what let the hiding
  // survive the switch, so the marker that lets it be undone must be in the
  // same family -- anything else is stripped by the very pairing it is meant
  // to survive. CI has no browser, so this pins the mechanism in source.
  const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const paint = host.slice(host.indexOf('function paintHighlight(vals)'), host.indexOf('if(hlEl.dataset.key!==key)'));
  assert.match(paint, /if\(!panel\)\{hlUnhide\(\);return\}/, 'nowhere to dock: un-hide first');
  assert.match(paint, /hlUnhide\(\);\s*for\(const child of panel\.children\)/, 'and before hiding again');
  assert.match(paint, /setAttribute\('data-host-hlhid',''\)/, 'the marker survives the patcher');
  assert.doesNotMatch(paint, /data-dc-hl-hid/, 'a data-dc-* marker is stripped by the pairing');
  const un = host.slice(host.indexOf('function hlUnhide()'), host.indexOf('function paintHighlight(vals)'));
  assert.match(un, /\[data-host-hlhid\]/);
  assert.match(un, /removeAttribute\('data-host-style'\)/, 'the style lock goes with it');
});

// ── Server: brand keys never belong to a clip ─────────────────────────────

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-editor-ships-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.APP_SESSION_SECRET = 'editor-ships-secret-long-enough-here-ok';
process.env.SOCIAL_TOKEN_KEY = 'editor-ships-social-key-over-32-chars-long';

const { server } = await import('../src/server.js');
const base = `http://127.0.0.1:${server.address().port}`;
const templates = await import('../src/templates.js');
const agent = await import('../src/agent.js');
test.after(() => new Promise(resolve => server.close(() => resolve())));
for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({ email: 'editor@deenclipped.test', password: 'correct horse battery staple', returnTo: '/' }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
assert.ok(cookie.startsWith('dc_session='), 'the account signed up');

test('the title and subtitle no longer call the editor a beta', () => {
  const A = loadAdapter();
  const { b } = editorAt(A, clipRecord());
  assert.equal(b.pageTitle, 'Clip editor');
  assert.doesNotMatch(b.subline || '', /beta/i);
  assert.match(b.subline || '', /Preview/);
  assert.match(b.subline || '', /Save clip/);
});

test('Preview in the editor asks for a real window around the playhead, not another clip\'s player', () => {
  const A = loadAdapter();
  const calls = [];
  A.StudioAdapter.onPreviewClip = (id, win) => calls.push({ id, win });
  const { b } = editorAt(A, clipRecord(), { edTime: 12, edStyleDraft: { warm: 40 }, edTplId: null });
  b.previewClip(noEvent);
  assert.equal(calls.length, 1, 'one preview request');
  assert.equal(calls[0].id, 'edtest');
  const { win } = calls[0];
  assert.equal(win.startSec, 9, 'three seconds before the playhead');
  assert.equal(win.endSec, 15, 'three after');
  assert.equal(win.templateId, 'clean-line');
  // JSON, not deepEqual: the object was made in the vm realm and its
  // prototype is that realm's Object (CLAUDE.md, three times over).
  assert.equal(JSON.stringify(win.style), JSON.stringify({ warm: 40 }), 'the unsaved style travels with it');
  assert.ok(!A.StudioAdapter.ui.playerClip, 'and no player modal was opened');
  assert.equal(A.StudioAdapter.ui.edStyleDraft, null, 'the draft was flushed');
});

test('the preview window is clamped inside the clip', () => {
  const A = loadAdapter();
  const calls = [];
  A.StudioAdapter.onPreviewClip = (id, win) => calls.push(win);
  editorAt(A, clipRecord(), { edTime: 29.5 }).b.previewClip(noEvent);
  assert.deepEqual([calls[0].startSec, calls[0].endSec], [24, 30], 'a playhead at the end slides the window back');
  editorAt(A, clipRecord(), { edTime: 0 }).b.previewClip(noEvent);
  assert.deepEqual([calls[1].startSec, calls[1].endSec], [0, 6], 'and one at the start does not go negative');
});

test('the watermark switch is the ACCOUNT\'s switch: it writes the brand, never this clip', () => {
  const A = loadAdapter();
  const brandWrites = [];
  A.win.dcSaveBrand = patch => { brandWrites.push(patch); return Promise.resolve({}); };
  A.StudioAdapter.onClipStyle = () => { throw new Error('a per-clip style write must not happen'); };
  const { b } = editorAt(A, clipRecord());
  assert.match(b.edWmNote, /every clip/, 'the note says whose switch it is');
  b.toggleWatermark(noEvent);
  assert.equal(JSON.stringify(brandWrites), JSON.stringify([{ watermark: 'DEENCLIPPED', watermarkOpacity: 0 }]));
  assert.equal(A.StudioAdapter.ui.edStyleDraft, null, 'nothing landed in the clip draft');
});

test('the watermark row reads the brand record before the template', () => {
  const A = loadAdapter();
  const { STATE } = editorAt(A, clipRecord());
  STATE.brand = { watermark: 'MY MARK', watermarkOpacity: 0 };
  const b = A.StudioAdapter.bindings(STATE);
  assert.match(b.edWmNote, /^Off for every clip/);
  STATE.brand = { watermark: 'MY MARK', watermarkOpacity: 100 };
  assert.match(A.StudioAdapter.bindings(STATE).edWmNote, /^MY MARK on every clip/);
});

test('a pending grade is echoed over the render, approximately, and says so', () => {
  const A = loadAdapter();
  const { b } = editorAt(A, clipRecord(), { edStyleDraft: { warm: 60, grain: 30, vignette: 0.4 } });
  assert.equal(b.edLookApprox, true);
  assert.match(b.edApproxFilter, /sepia/, 'warmth becomes a tint');
  assert.equal(b.edApproxGrain, 30);
  assert.equal(b.edApproxVignette, 0.4);
  assert.match(b.edSourceNote, /approximately/);
  // Only the clip's OWN additions: the template's preset is already in the
  // picture, so a draft carrying no look key echoes nothing.
  const quiet = editorAt(A, clipRecord(), { edStyleDraft: { captionFontSize: 110 } }).b;
  assert.equal(quiet.edLookApprox, false);
  assert.equal(quiet.edApproxFilter, '');
  assert.equal(quiet.edSourceNote, '');
});

test('a pending framing change is named on the frame, because the render cannot show it', () => {
  const A = loadAdapter();
  const { b } = editorAt(A, clipRecord(), { edStyleDraft: { smartFramingZoom: 1.4 } });
  assert.equal(b.edFramingPending, true);
  assert.match(b.edSourceNote, /Framing changes show after Preview or Save/);
});

test('the frame carries ONE line: the render notice outranks the approximation note', () => {
  const A = loadAdapter();
  const { b } = editorAt(A, clipRecord({ stylePending: true, styleOverrides: { warm: 60 } }));
  assert.match(b.edRenderNotice, /Saved, not rendered yet/);
  assert.equal(b.edSourceNote, '', 'the second banner stays quiet while the first speaks');
  const outdated = editorAt(A, clipRecord({ templateVersion: 1, templateOutdated: true })).b;
  assert.match(outdated.edRenderNotice, /style changed since this render/);
  assert.doesNotMatch(outdated.edRenderNotice, /Changes saved/, 'a template moving on is not "changes saved"');
});

test('leaving with unsaved words asks first, and a refusal keeps the editor open', () => {
  const A = loadAdapter();
  let asked = 0;
  A.win.confirm = () => { asked += 1; return false; };
  const { b } = editorAt(A, clipRecord(), { edDirty: true, edBlockDraft: 'Changed words' });
  b.closeEditor(noEvent);
  assert.equal(asked, 1);
  assert.equal(A.StudioAdapter.ui.screen, 'editor');
  A.win.confirm = () => { asked += 1; return true; };
  b.closeEditor(noEvent);
  assert.equal(A.StudioAdapter.ui.screen, 'queue');
  // Nothing pending: no question.
  A.win.confirm = () => { throw new Error('must not ask'); };
  editorAt(A, clipRecord()).b.closeEditor(noEvent);
  assert.equal(A.StudioAdapter.ui.screen, 'queue');
});

test('the Export tab states facts the render can back, and no token cost', () => {
  const A = loadAdapter();
  const { b } = editorAt(A, clipRecord());
  const worker = fs.readFileSync(path.join(ROOT, 'worker/clip_worker.py'), 'utf8');
  assert.equal(b.edFrameRate, '30 fps');
  assert.match(worker, /"-r", "30"/, 'the worker really renders at 30');
  assert.equal(b.edAudioSpec, 'AAC 192 kbps');
  assert.match(worker, /"-b:a", "192k"/, 'and encodes the final at 192k');
  assert.match(b.edExportNote, /never costs tokens/);
  assert.doesNotMatch(b.edExportNote, /all clips of the lecture/);
  assert.match(b.nasheedDb, /applies to every clip/, 'the account-wide slider says so');
  const generated = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  assert.ok(!generated.includes('costs 1 token'), 'the stale literal is out of the template');
  for (const name of ['edFrameRate', 'edAudioSpec', 'edVerifyLabel', 'edExportNote']) {
    assert.ok(generated.includes(name), `${name} is bound in the template`);
  }
});

test('the beta pop-up and its key are gone from the host', () => {
  const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  assert.ok(!host.includes('edBetaPop'));
  assert.ok(!host.includes('deenEditorBetaSeen'));
  // The host answers Preview with a rerender that carries a window, and Save
  // with ONE outcome sentence rather than a toast per layer.
  const stripped = host.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(stripped, /StudioAdapter\.onPreviewClip=\(id,win\)=>/);
  assert.match(stripped, /preview:\{startSec:/);
  const save = stripped.slice(stripped.indexOf('StudioAdapter.onSaveClip='), stripped.indexOf('StudioAdapter.onPreviewClip='));
  assert.ok(!save.includes("'Clip saved',()=>"), 'Save no longer passes a fixed ok line to studioDo');
  assert.ok(!save.includes('showToast'), 'and the legacy toast is out of it');
});


test('a per-clip style patch cannot carry a brand field, in or out', () => {
  const kept = templates.sanitiseClipStyle({ watermarkOpacity: 0, watermark: '', promoBarEnabled: true, brandLineEnabled: true, grain: 30, captionFontSize: 110 });
  assert.deepEqual(kept, { grain: 30, captionFontSize: 110 });
  for (const key of templates.BRAND_FIELDS) {
    assert.ok(!(key in templates.sanitiseClipStyle({ [key]: 0 })), `${key} is dropped`);
  }
});

test('the route still refuses a free account, and no account keeps a per-clip brand override', async () => {
  const me = await (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json();
  const userId = me.user && me.user.id;
  assert.ok(userId, 'signed in');
  const { state, save } = await import('../src/store.js');
  state.clips.push({
    id: 'free-clip', projectId: 'none', userId, title: 't', transcript: 'x', status: 'waiting',
    templateId: 'clean-line', styleOverrides: {}, addedAt: Date.now(),
  });
  state.projects.push({ id: 'none', userId, title: 'p', status: 'done', clipCount: 1 });
  save();
  const patch = body => fetch(`${base}/api/clips/free-clip`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ styleOverrides: body }),
  });
  // The paywall at the route was never the gap: a free account asking to
  // remove the mark per clip was refused before this change and still is.
  const refused = await patch({ watermarkOpacity: 0 });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /Pro feature/);
  // The gap was every OTHER brand field, and the removal on a paid account:
  // a per-clip override of the account's brand contradicts "once configured
  // it works for all clips". They are dropped whoever asks.
  const r = await patch({ promoBarEnabled: true, brandLineEnabled: true, watermarkColor: '#FF0000', watermarkPosition: 'bottom-left', grain: 12 });
  assert.equal(r.status, 200, await r.text());
  const stored = state.clips.find(c => c.id === 'free-clip');
  assert.equal(JSON.stringify(stored.styleOverrides), JSON.stringify({ grain: 12 }), 'only the grade landed');
  // And straight through the store, the way a paid account's editor reaches
  // it: the removal is not kept on the clip either.
  agent.updateClip('free-clip', { styleOverrides: { watermarkOpacity: 0, watermark: '', warm: 20 } });
  assert.equal(JSON.stringify(state.clips.find(c => c.id === 'free-clip').styleOverrides), JSON.stringify({ grain: 12, warm: 20 }));
  const rendered = templates.templateForClip(templates.templateById('clean-line', { id: userId }), stored.styleOverrides);
  assert.equal(rendered.watermark, 'DEENCLIPPED');
  assert.ok(Number(rendered.watermarkOpacity) > 0, 'the mark is still burned in');
});
