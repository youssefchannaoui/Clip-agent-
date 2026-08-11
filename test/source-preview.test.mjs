import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Rewritten 12 Aug. The previous version of this file grepped the source
// preview route for specific identifiers (`project?.sourceObjectKey`,
// `sourceObjectKey.split('/')`) and for the exact shape of the editor's
// video.onerror handler. That made the tests fail the moment the same
// behaviour moved into a named function, while a genuine behaviour change
// would have slipped through — which is precisely the failure mode recorded
// in WORKER-HANDOVER.md ("test executed output, not source strings").
//
// These tests now execute resolveCleanSource() against stubbed state and
// assert what it returns.

const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const editorSource = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

const slice = (from, to) => {
  const start = serverSource.indexOf(from);
  const end = serverSource.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `could not slice ${from} .. ${to}`);
  return serverSource.slice(start, end);
};

// Build a runnable copy of the resolver with its three dependencies injected.
function makeResolver({ projects = [], existingFiles = [], storageConfigured = true } = {}) {
  const body = slice('function resolveCleanSource(clip) {', '\nfunction publicClip(');
  return new Function(
    'state', 'fs', 'objectStorage',
    `${body}\nreturn resolveCleanSource;`,
  )(
    { projects },
    { existsSync: path => existingFiles.includes(path) },
    { configured: () => storageConfigured },
  );
}

const KEY = 'projects/job_1/source.mp4';

test('a clip whose own source file is on disk resolves to that file', () => {
  const resolve = makeResolver({ existingFiles: ['/data/a.mp4'] });
  assert.deepEqual(resolve({ id: 'c1', projectId: 'p1', sourceFile: '/data/a.mp4' }), { kind: 'file', file: '/data/a.mp4' });
});

test('a clip with no file of its own falls back to its project file', () => {
  const resolve = makeResolver({ projects: [{ id: 'p1', sourceFile: '/data/p.mp4' }], existingFiles: ['/data/p.mp4'] });
  assert.deepEqual(resolve({ id: 'c1', projectId: 'p1' }), { kind: 'file', file: '/data/p.mp4' });
});

test('a stored object key is preferred over a legacy public source URL', () => {
  // Order matters: the persisted sourceUrl is a bucket address, not always a
  // fetchable one, so redirecting to it first reported a missing file even
  // though the object existed.
  const resolve = makeResolver({ projects: [{ id: 'p1', sourceObjectKey: KEY, sourceUrl: 'https://legacy.example/s.mp4' }] });
  assert.deepEqual(resolve({ id: 'c1', projectId: 'p1' }), { kind: 'object', key: KEY });
});

test('a legacy public source URL is still honoured when there is no object key', () => {
  const resolve = makeResolver({ projects: [{ id: 'p1', sourceUrl: 'https://legacy.example/s.mp4' }] });
  assert.deepEqual(resolve({ id: 'c1', projectId: 'p1' }), { kind: 'url', url: 'https://legacy.example/s.mp4' });
});

test('object keys outside the clean project source path are refused', () => {
  for (const key of [
    'clips/job_1/c1.mp4',
    'projects/job_1/../../etc/passwd',
    'projects/job_1/source.mp4.exe',
    '../source.mp4',
  ]) {
    const resolve = makeResolver({ projects: [{ id: 'p1', sourceObjectKey: key }] });
    assert.equal(resolve({ id: 'c1', projectId: 'p1' }), null, `${key} must not resolve`);
  }
});

test('an object key resolves to nothing when storage is not configured', () => {
  // Reporting cleanSource:true here would promise the editor a plate the
  // preview route cannot actually serve.
  const resolve = makeResolver({ projects: [{ id: 'p1', sourceObjectKey: KEY }], storageConfigured: false });
  assert.equal(resolve({ id: 'c1', projectId: 'p1' }), null);
});

test('a clip with no surviving source anywhere resolves to null', () => {
  // The Vizard path: a third party returns finished, already-captioned clips
  // and there is no clean plate to be had.
  const resolve = makeResolver({ projects: [{ id: 'p1' }] });
  assert.equal(resolve({ id: 'c1', projectId: 'p1' }), null);
});

test('the preview route and publicClip read the same resolver', () => {
  // If these ever diverge, the editor is told a plate exists and then gets a
  // 404 for it, which is how the baked-caption confusion started.
  const route = slice('const sourcePreview = pathname.match', 'const clipVideo = pathname.match');
  assert.match(route, /resolveCleanSource\(clip\)/);
  assert.match(serverSource, /cleanSource: Boolean\(resolveCleanSource\(clip\)\)/);
});

test('editor fallback message does not falsely claim the stored file is missing', () => {
  assert.doesNotMatch(editorSource, /The original lecture file is unavailable/);
});

test('the editor picks its preview source up front rather than after a load error', () => {
  // Previously the editor always requested the clean plate, waited for the
  // <video> element to fail, and only then swapped to the rendered export —
  // so it spent its first seconds in a state it already knew was wrong.
  const fn = editorSource.slice(editorSource.indexOf('function editorSourceUrl(clip){'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /editorHasCleanSource\(clip\)/, 'the source choice must consult the server flag');
  assert.match(body, /source-preview/);
  assert.match(body, /\/video/);
});

test('a clip with baked captions gets no draggable caption box', () => {
  // The bug this replaces: the export already has captions painted into its
  // pixels, so a live overlay on top showed two sets of words, only one of
  // which responded to the controls. The other could never be exported,
  // because with no clean plate there is nothing to re-render from.
  const fn = editorSource.slice(editorSource.indexOf('function bindCaptionDrag(){'));
  const guard = fn.slice(0, fn.indexOf('let drag=null'));
  assert.match(guard, /if\(!editorHasCleanSource\(currentClip\(\)\)\)return;/);
});

test('a clean-source claim that fails still leaves a playable canvas', () => {
  // Shipped and immediately regressed on 12 Aug. Moving the decision up front
  // was right, but the error path was deleted along with the old fallback, so a
  // cleanSource:true clip whose plate could not actually be fetched left a dead
  // <video> and an editor with nothing in it.
  //
  // cleanSource is a claim, not a guarantee: the server can verify that a
  // storage key is well-formed and that storage is configured, but not that the
  // object is still there or that presigning will succeed. The failure path has
  // to degrade to the rendered export — and must enter baked mode as it does,
  // or it recreates the two-sets-of-captions bug it was written to fix.
  const fn = editorSource.slice(editorSource.indexOf('function bindVideo(clip){'));
  const handler = fn.slice(fn.indexOf('video.onerror=()=>{'));
  const body = handler.slice(0, handler.indexOf('\n  };'));
  assert.match(body, /\/api\/clips\/\$\{encodeURIComponent\(clip\.id\)\}\/video/, 'it must fall back to the export');
  assert.match(body, /video\.src=exportUrl/);
  assert.match(body, /bg\.src=exportUrl/);
  assert.match(body, /editor\.bakedPreview=true/, 'falling back must record that captions are now baked');
  assert.match(body, /dc-editor-baked-preview/);
  assert.match(body, /renderEditorTool\(\)/, 'the caption panel must be rebuilt for the new answer');
});

test('a failed clean-source verdict survives later re-renders', () => {
  // Without this the editor retries the missing plate on every re-render,
  // flickering between states forever.
  const fn = editorSource.slice(editorSource.indexOf('function editorHasCleanSource(clip){'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /editor\.bakedPreview/);
  assert.match(body, /editor\.clipId===clip\.id/, 'the verdict must be scoped to the clip it was proven on');
  // And bindVideo must not clear it, or the verdict never survives anything.
  const bind = editorSource.slice(editorSource.indexOf('function bindVideo(clip){'));
  const head = bind.slice(0, bind.indexOf('const start='));
  assert.doesNotMatch(head, /editor\.bakedPreview=false/);
});

test('the baked-preview state hides the caption overlay rather than outlining it', () => {
  const css = fs.readFileSync(new URL('../src/public/studio-v6.css', import.meta.url), 'utf8');
  const start = css.indexOf('body.dc-editor-baked-preview #dcCaptionOverlay');
  assert.ok(start >= 0, 'the baked-preview overlay rule must exist');
  const rule = css.slice(start, css.indexOf('}', start));
  assert.match(rule, /display:\s*none/);
});
