import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-vizard-'));
process.env.VIZARD_API_KEY = 'test-vizard-key';
process.env.VIZARD_API_BASE_URL = 'https://vizard.test/open-api/v1';

const vizard = await import('../src/vizard.js');
const originalFetch = global.fetch;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

test.afterEach(() => { global.fetch = originalFetch; });

test('recognises standard YouTube URL forms without accepting lookalike hosts', () => {
  assert.equal(vizard.isYouTubeUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(vizard.isYouTubeUrl('https://youtu.be/abc'), true);
  assert.equal(vizard.isYouTubeUrl('https://m.youtube.com/shorts/abc'), true);
  assert.equal(vizard.isYouTubeUrl('https://youtube.com.attacker.test/watch?v=abc'), false);
  assert.equal(vizard.isYouTubeUrl('not a url'), false);
});

test('submits YouTube clipping with private server authentication and clean output settings', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return json({ code: 2000, projectId: 17861706, shareLink: 'https://vizard.ai/project?id=1' });
  };
  const result = await vizard.createProject({ videoUrl: 'https://youtu.be/abc', projectName: 'My lecture', maxClips: 6 });
  assert.equal(result.projectId, '17861706');
  assert.equal(request.url, 'https://vizard.test/open-api/v1/project/create');
  assert.equal(request.options.headers.VIZARDAI_API_KEY, 'test-vizard-key');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.preferLength, [0]);
  assert.equal(body.videoType, 2);
  assert.equal(body.maxClipNumber, 6);
  assert.equal(body.subtitleSwitch, 0);
  assert.equal(body.headlineSwitch, 0);
});

test('polling distinguishes processing from completed output', async () => {
  const responses = [
    { code: 1000, projectId: 123, videos: [] },
    { code: 2000, projectId: 123, projectName: 'Ready', videos: [{ videoId: 9, videoUrl: 'https://cdn-video.vizard.ai/clip.mp4' }] },
  ];
  global.fetch = async () => json(responses.shift());
  assert.equal((await vizard.queryProject('123')).status, 'processing');
  const ready = await vizard.queryProject('123');
  assert.equal(ready.status, 'complete');
  assert.equal(ready.projectName, 'Ready');
  assert.equal(ready.videos[0].videoId, 9);
});

test('provider errors become safe actionable messages', async () => {
  global.fetch = async () => json({ code: 4007, errMsg: '' });
  await assert.rejects(() => vizard.createProject({ videoUrl: 'https://youtube.com/watch?v=abc' }), /enough processing minutes/i);
});

test('only HTTPS Vizard clip download hosts are trusted', () => {
  assert.equal(vizard.assertTrustedClipUrl('https://cdn-video.vizard.ai/export/a.mp4'), 'https://cdn-video.vizard.ai/export/a.mp4');
  assert.throws(() => vizard.assertTrustedClipUrl('https://example.com/a.mp4'), /untrusted/i);
  assert.throws(() => vizard.assertTrustedClipUrl('http://cdn-video.vizard.ai/a.mp4'), /untrusted/i);
});
