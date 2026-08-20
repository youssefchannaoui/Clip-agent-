import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// "Save to all clips" in the editor: one clip's look copied onto the rest of the
// SAME lecture, and nothing else.
//
// Editing a clip writes only that clip, which is correct -- one clip's crop must
// not move every clip in the lecture. But the usual next step after getting a
// clip right is "now do that to the rest of this video", and nothing did it. The
// existing promote-style endpoint writes the shared template, so it reaches every
// other lecture too and refuses outright on a built-in style.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-apply-style-'));
const port = 39000 + Math.floor(Math.random() * 900);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { state, save } = await import('../src/store.js');

test.after(() => new Promise(resolve => server.close(resolve)));

for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

const USER = 'user_admin';
const LOOK = { captionFont: 'Amiri', captionFontSize: 132, captionPosition: 'bottom' };

function clip(id, projectId, extra = {}) {
  return {
    id, projectId, userId: USER, ownedBy: USER, title: id, status: 'waiting',
    score: 90, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold',
    durationMs: 30000, targets: [], ...extra,
  };
}

function seed() {
  state.projects = [
    { id: 'lec-1', title: 'Lecture one', userId: USER, ownedBy: USER, status: 'done' },
    { id: 'lec-2', title: 'Lecture two', userId: USER, ownedBy: USER, status: 'done' },
  ];
  state.clips = [
    clip('one-a', 'lec-1', { styleOverrides: { ...LOOK } }),
    clip('one-b', 'lec-1'),
    clip('one-c', 'lec-1'),
    clip('two-a', 'lec-2'),
    clip('two-b', 'lec-2'),
  ];
  save();
}

const apply = (id, body = { scope: 'lecture' }) => fetch(`${base}/api/clips/${id}/apply-style`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const byId = id => state.clips.find(c => c.id === id);

test('the look lands on every other clip in the same lecture', async () => {
  seed();
  const response = await apply('one-a');
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.applied, 2, 'both siblings, not the clip itself');
  assert.deepEqual(byId('one-b').styleOverrides, LOOK);
  assert.deepEqual(byId('one-c').styleOverrides, LOOK);
  assert.deepEqual(byId('one-a').styleOverrides, LOOK, 'the clip being edited is unchanged');
});

test('clips from other lectures are not touched', async () => {
  // The whole point of scoping it to the lecture. promote-style could not do
  // this: it writes the shared template, which every lecture reads.
  seed();
  await apply('one-a');
  assert.equal(byId('two-a').styleOverrides, undefined);
  assert.equal(byId('two-b').styleOverrides, undefined);
  assert.ok(!byId('two-a').stylePending);
});

test('the siblings are marked as needing a new render', async () => {
  seed();
  await apply('one-a');
  assert.equal(byId('one-b').stylePending, true);
  assert.equal(byId('one-c').stylePending, true);
});

test('a sibling that cannot be re-rendered still gets the style', async () => {
  // Source files may legitimately have been cleaned up. Rolling the style back
  // because the video cannot be rebuilt right now would make the whole action
  // silently do nothing; stylePending already means "video is out of date".
  seed();
  const payload = await (await apply('one-a')).json();
  assert.equal(payload.applied, 2);
  assert.equal(payload.queued + payload.pending, payload.applied, 'every clip is accounted for');
  assert.deepEqual(byId('one-b').styleOverrides, LOOK, 'stored even when no render could start');
});

test('a sibling\'s own earlier tweaks are replaced, not merged under', async () => {
  // They are meant to end up looking the same. Merging would leave one clip
  // with a stale font that the others do not have.
  seed();
  byId('one-b').styleOverrides = { captionFont: 'Inter', vignette: 0.8 };
  save();
  await apply('one-a');
  assert.deepEqual(byId('one-b').styleOverrides, LOOK);
  assert.equal(byId('one-b').styleOverrides.vignette, undefined, 'the old tweak is gone');
});

test('an already posted clip is left alone', async () => {
  // Restyling a video that has gone out is not a style change.
  seed();
  byId('one-b').status = 'posted';
  save();
  const payload = await (await apply('one-a')).json();
  assert.equal(payload.applied, 1);
  assert.equal(byId('one-b').styleOverrides, undefined);
  assert.deepEqual(byId('one-c').styleOverrides, LOOK);
});

test('a clip with nothing of its own to spread is a no-op, not an error', async () => {
  // The button shows whenever sibling clips exist, so pressing it with no
  // changes must not toast an error at the user.
  seed();
  const response = await apply('one-b');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.applied, 0);
  assert.equal(body.queued, 0);
  // And the no-op wrote nothing to the clip itself.
  assert.equal(byId('one-b').styleOverrides, undefined);
});

test('an unknown scope is refused rather than guessed at', async () => {
  seed();
  const response = await apply('one-a', { scope: 'everything' });
  assert.equal(response.status, 400);
  // And nothing was written on the way to refusing.
  assert.equal(byId('one-b').styleOverrides, undefined);
});

test('another account cannot restyle this lecture', async () => {
  seed();
  for (const c of state.clips) { c.userId = 'someone_else'; c.ownedBy = 'someone_else'; }
  save();
  const response = await apply('one-a');
  assert.ok(response.status >= 400, 'refused');
  assert.equal(byId('one-b').styleOverrides, undefined);
});
