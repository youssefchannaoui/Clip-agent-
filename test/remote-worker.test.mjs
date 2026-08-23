import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-remote-worker-'));
process.env.DATA_DIR = dataDir;
process.env.WORKER_BASE_URL = 'https://worker.test';
process.env.WORKER_SHARED_SECRET = 'worker-test-secret-at-least-thirty-two-characters';
process.env.WORKER_REQUEST_TIMEOUT_MS = '5000';
process.env.OBJECT_STORAGE_ENDPOINT = 'https://s3.test';
process.env.OBJECT_STORAGE_REGION = 'auto';
process.env.OBJECT_STORAGE_BUCKET = 'deenclipped';
process.env.OBJECT_STORAGE_ACCESS_KEY = 'access-key';
process.env.OBJECT_STORAGE_SECRET_KEY = 'secret-key';

const videoImport = await import('../src/video-import.js');
const worker = await import('../src/worker-client.js');
const storage = await import('../src/object-storage.js');
const originalFetch = global.fetch;

test.afterEach(() => { global.fetch = originalFetch; });
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('YouTube validation accepts individual videos and rejects playlists and lookalikes', () => {
  assert.equal(videoImport.parseYouTubeUrl('https://youtu.be/Abc_123-xyZ').videoId, 'Abc_123-xyZ');
  assert.equal(videoImport.parseYouTubeUrl('https://www.youtube.com/shorts/Abc_123-xyZ').canonicalUrl, 'https://www.youtube.com/watch?v=Abc_123-xyZ');
  assert.throws(() => videoImport.parseYouTubeUrl('https://youtube.com.attacker.test/watch?v=Abc_123-xyZ'), /Only YouTube/i);
  assert.throws(() => videoImport.parseYouTubeUrl('https://youtube.com/watch?v=Abc_123-xyZ&list=PL123'), /Playlists/i);
});

test('worker job creation is signed and secrets never enter the JSON body', async () => {
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ id: 'project_1', status: 'queued' }), { status: 202, headers: { 'content-type': 'application/json' } });
  };
  const payload = { id: 'project_1', source: { type: 'youtube', url: 'https://youtu.be/Abc_123-xyZ' } };
  const result = await worker.createJob(payload);
  assert.equal(result.status, 'queued');
  assert.equal(captured.url, 'https://worker.test/jobs');
  assert.doesNotMatch(captured.options.body, /worker-test-secret/);
  const timestamp = captured.options.headers['x-deenclipped-timestamp'];
  const expected = crypto.createHmac('sha256', process.env.WORKER_SHARED_SECRET).update(`${timestamp}\nPOST\n/jobs\n${captured.options.body}`).digest('hex');
  assert.equal(captured.options.headers['x-deenclipped-signature'], expected);
});

test('worker progress and provider failures are returned without losing the stage', async () => {
  global.fetch = async () => new Response(JSON.stringify({ id: 'project_1', status: 'transcribing', stage: 'transcribing', progress: 42 }), { status: 200 });
  assert.deepEqual(await worker.getJob('project_1'), { id: 'project_1', status: 'transcribing', stage: 'transcribing', progress: 42 });

  global.fetch = async () => new Response(JSON.stringify({ error: 'Managed import failed.', code: 'provider_failed' }), { status: 502 });
  await assert.rejects(() => worker.createJob({ id: 'project_2' }), error => error.code === 'provider_failed' && /Managed import/.test(error.message));
});

test('network failures become actionable worker unavailable errors', async () => {
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(() => worker.createJob({ id: 'project_3' }), error => error.code === 'worker_unavailable');
});

test('direct uploads receive a signed S3 PUT without exposing credentials', () => {
  // The caller no longer supplies a content type: it is derived from the
  // extension, so a video cannot be declared text/html and stored as a live
  // page on the media domain.
  const result = storage.createUpload('user_1', 'lecture.mp4');
  assert.equal(result.contentType, 'video/mp4');
  assert.match(result.key, /^uploads\/user_1\//);
  const url = new URL(result.uploadUrl);
  assert.equal(url.hostname, 's3.test');
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.ok(url.searchParams.get('X-Amz-Signature'));
  assert.doesNotMatch(result.uploadUrl, /secret-key/);
});

// ── the per-clip breakdown reaches the browser ─────────────────────────────
// Three separate fields have now been threaded worker -> service -> engine ->
// server -> adapter, and each time a layer in the middle quietly dropped them.
// This asserts the two ends of the chain that a UI test cannot see.

const engine = await import('../src/local-engine.js');

test('the clip breakdown is sanitised on its way in', () => {
  const record = {};
  engine.applyClipBreakdown(record, {
    currentClip: 2, totalClips: 4, clipPercent: 37,
    clipPlan: [{ index: 1, title: '  On patience  ' }, { index: 2, title: 'x'.repeat(400) }],
  });
  assert.equal(record.currentClip, 2);
  assert.equal(record.totalClips, 4);
  assert.equal(record.clipPercent, 37);
  assert.equal(record.clipPlan[0].title, 'On patience', 'trimmed');
  assert.equal(record.clipPlan[1].title.length, 120, 'and capped — this reaches the page');
});

test('a percentage outside 0-100 cannot widen the bar past its track', () => {
  const record = {};
  engine.applyClipBreakdown(record, { clipPercent: 240 });
  assert.equal(record.clipPercent, 100);
  engine.applyClipBreakdown(record, { clipPercent: -5 });
  assert.equal(record.clipPercent, 0);
  engine.applyClipBreakdown(record, { clipPercent: 'nonsense' });
  assert.equal(record.clipPercent, null);
});

test('absent fields leave what is already known alone', () => {
  // Every non-render phase sends progress events with none of these. Clearing
  // them would make the list blink out between clips.
  const record = { currentClip: 2, totalClips: 4, clipPercent: 37, clipPlan: [{ index: 1, title: 'a' }] };
  engine.applyClipBreakdown(record, { stage: 'Verifying rendered clips', progress: 90 });
  assert.equal(record.currentClip, 2);
  assert.equal(record.totalClips, 4);
  assert.equal(record.clipPercent, 37);
  assert.equal(record.clipPlan.length, 1);
});

test('a clip plan is capped so a runaway worker cannot flood the page', () => {
  const record = {};
  engine.applyClipBreakdown(record, {
    clipPlan: Array.from({ length: 500 }, (_, i) => ({ index: i + 1, title: 'Clip ' + i })),
  });
  assert.equal(record.clipPlan.length, 40);
});

test('the server publishes the breakdown to the browser', () => {
  // The layer that has silently dropped a field three times running.
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  for (const field of ['currentClip', 'totalClips', 'clipPercent', 'clipPlan']) {
    assert.match(server, new RegExp(`${field}: project\\.${field}`), `${field} is published`);
  }
});

test('an upload cannot declare its own content type', () => {
  // Whatever a caller passes, the type comes from the validated extension.
  const sneaky = storage.createUpload('user_1', 'promo.mp4', 'text/html');
  assert.equal(sneaky.contentType, 'video/mp4', 'a video stays a video');
  assert.throws(() => storage.createUpload('user_1', 'page.html'), /MP4, MOV/);
  assert.throws(() => storage.createUpload('user_1', 'shell.svg'), /MP4, MOV/);
});
