import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-srcinfo-'));
// The bug only exists on the remote path, which is what production runs.
process.env.PROCESSING_MODE = 'remote';
process.env.WORKER_BASE_URL = 'https://worker.invalid';
process.env.WORKER_SHARED_SECRET = 'source-info-test-secret-at-least-32-chars';

const engine = await import('../src/local-engine.js');
const realFetch = global.fetch;
test.after(() => { global.fetch = realFetch; });

const WATCH = 'https://www.youtube.com/watch?v=MaXPMQ7vJzo';

// A cut-down watch page carrying the fields the HTML lookup reads.
function watchPage({ seconds = 2531, title = 'E68 The Meaning of Sabr' } = {}) {
  return `<!doctype html><html><head>
    <meta property="og:title" content="${title}">
    <meta property="og:image" content="https://i.ytimg.com/vi/MaXPMQ7vJzo/maxresdefault.jpg">
  </head><body><script>
    var ytInitialPlayerResponse = {"videoDetails":{"title":"${title}","lengthSeconds":"${seconds}"}};
  </script></body></html>`;
}

test('remote mode reads the real length instead of giving up immediately', async () => {
  // It used to return durationSec:null without trying, which left the range
  // picker dead and the panel showing the design's placeholder length.
  global.fetch = async () => new Response(watchPage(), { status: 200, headers: { 'content-type': 'text/html' } });
  const info = await engine.sourceInfo(WATCH);
  assert.equal(info.durationKnown, true, 'the length must be discovered before the worker runs');
  assert.equal(info.durationSec, 2531);
  assert.match(info.title, /Sabr/, 'the lecture is named, not called by its URL');
});

test('remote mode still degrades honestly when the lookup fails', async () => {
  global.fetch = async () => { throw new Error('blocked from this network'); };
  const info = await engine.sourceInfo(WATCH);
  assert.equal(info.durationKnown, false);
  assert.equal(info.durationSec, null);
  assert.ok(info.thumbnail.includes('MaXPMQ7vJzo'), 'the video thumbnail is still offered');
  assert.match(info.warning || '', /blocked from this network/, 'the reason is recorded, not swallowed');
});

test('a non-YouTube link is rejected before any lookup', async () => {
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not be reached'); };
  await assert.rejects(() => engine.sourceInfo('https://example.com/video.mp4'));
  assert.equal(called, false);
});
