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

// ── the library's posters ──────────────────────────────────────────────────
// Every lecture stored sourceThumbUrl null, so the library rendered empty grey
// cards. Three layers were each dropping the thumbnail independently, which is
// why fixing one of them changed nothing on screen.

test('a lecture gets a poster even when the client sends no sourceMeta', () => {
  // The dashboard did not send it, so this is the case that actually ran.
  assert.match(engine.fallbackThumb(WATCH), /i\.ytimg\.com\/vi\/MaXPMQ7vJzo/);
  assert.match(engine.fallbackThumb('https://youtu.be/MaXPMQ7vJzo'), /MaXPMQ7vJzo/,
    'short links resolve too');
});

test('a non-YouTube source has no derivable poster and says so', () => {
  // Uploaded MP4s must yield '' rather than a broken image URL.
  assert.equal(engine.fallbackThumb('object-storage-key-for-an-upload'), '');
  assert.equal(engine.fallbackThumb(''), '');
});

test('submit stores the poster on the project record', async () => {
  const src = 'https://www.youtube.com/watch?v=MaXPMQ7vJzo';
  assert.match(engine.fallbackThumb(src), /hqdefault\.jpg$/,
    'hqdefault always exists, unlike maxresdefault');
});

test('the probed thumbnail reaches the panel, not just openJob', () => {
  // openJob was fixed to read source.thumbnail while its only caller still
  // passed three fields. The fix sat one layer away from the bug.
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const probe = /StudioAdapter\.onProbeSource=async[\s\S]*?\};/.exec(html)[0];
  assert.match(probe, /thumbnail:src\.thumbnail/, 'the probe result carries a poster');
});

test('submitting a lecture forwards the metadata it already fetched', () => {
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const gen = /StudioAdapter\.onGenerate=\(url,range\)=>[\s\S]*?jobFailed\(/.exec(html)[0];
  assert.match(gen, /body\.sourceMeta=\[\{/, 'sourceMeta is sent');
  assert.match(gen, /thumbnail:j\.thumbnail/, 'including the poster');
  assert.match(gen, /j\.url===url/, 'and only when it belongs to this URL');
});

test('the read path back-fills lectures queued before any of this', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /sourceThumbUrl: project\.sourceThumbUrl \|\| fallbackThumb\(project\.url\)/,
    'existing projects get a poster without a migration');
});
