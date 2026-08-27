import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// worker/clip_worker.py has read clip.cutsSec since v3.2.0 and the only thing
// that ever wrote it was the internal preview lane -- a finished, tested cut
// engine behind no control at all.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-trim-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'clip-trim-test-secret-long-enough';

const agent = await import('../src/agent.js');
const { state } = await import('../src/store.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

let seq = 0;
function makeClip(fields = {}) {
  const id = `clip_${++seq}`;
  const clip = {
    id, userId: 'user_admin', projectId: 'p1', title: 'A clip',
    startSec: 10, endSec: 70, transcript: 'words', status: 'waiting', ...fields,
  };
  state.clips.push(clip);
  return clip;
}

test('a trim is stored as clip-local ranges to keep', () => {
  const clip = makeClip();
  agent.updateClip(clip.id, { cutsSec: [[12, 48]] });
  assert.deepEqual(clip.cutsSec, [[12, 48]]);
  assert.equal(clip.stylePending, true, 'the file on disk no longer matches the edit');
});

test('a backwards drag is stored the right way round', () => {
  const clip = makeClip();
  agent.updateClip(clip.id, { cutsSec: [[40, 20]] });
  assert.deepEqual(clip.cutsSec, [[20, 40]],
    'the worker should never have to defend itself against a reversed range');
});

test('a range past the end of the clip is clamped to it', () => {
  const clip = makeClip();
  agent.updateClip(clip.id, { cutsSec: [[-5, 900]] });
  // 10s..70s is a 60-second clip, so the whole span is 0..60 in clip-local time.
  assert.equal(clip.cutsSec, undefined, 'a range covering everything is no cut at all');
});

test('keeping the whole clip removes the cut rather than storing a full-width one', () => {
  const clip = makeClip({ cutsSec: [[10, 30]] });
  agent.updateClip(clip.id, { cutsSec: [] });
  assert.equal(clip.cutsSec, undefined,
    'an empty list makes the worker skip the pre-cut plate entirely');
});

test('a mis-drag of a few frames is ignored, not rendered', () => {
  const clip = makeClip();
  agent.updateClip(clip.id, { cutsSec: [[10, 10.1]] });
  assert.equal(clip.cutsSec, undefined,
    'concatenating a tenth of a second produces noise, not an edit');
});

test('several ranges survive, in order — a split is two ranges, a deletion is the gap', () => {
  const clip = makeClip();
  agent.updateClip(clip.id, { cutsSec: [[30, 45], [5, 20]] });
  assert.deepEqual(clip.cutsSec, [[5, 20], [30, 45]]);
});

test('saving the same trim again does not mark the clip out of date', () => {
  const clip = makeClip({ cutsSec: [[5, 25]] });
  clip.stylePending = false;
  agent.updateClip(clip.id, { cutsSec: [[5, 25]] });
  assert.equal(clip.stylePending, false,
    'an unchanged trim must not queue a pointless re-render');
});

test('rubbish in the list is dropped rather than reaching the worker', () => {
  const clip = makeClip();
  agent.updateClip(clip.id, { cutsSec: [['x', null], [5, 25], 'nope'] });
  assert.deepEqual(clip.cutsSec, [[5, 25]]);
});
