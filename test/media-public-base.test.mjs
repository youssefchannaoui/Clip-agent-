import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// R2's pub-*.r2.dev endpoint is a development URL: Cloudflare rate-limits it
// (five consecutive GET 503s were measured in one live editor session, which
// is what "the preview never loads" was) and it sends no CORS headers. When
// MEDIA_PUBLIC_BASE names a custom domain bound to the same bucket, every
// stored r2.dev URL must leave the server rewritten to it -- the redirect the
// player follows, and every URL the state view hands the page. Tested over
// HTTP because a rewrite helper with a unit test protected nothing when a
// route forgot to call it.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-mediabase-'));
const port = 39000 + Math.floor(Math.random() * 900);
process.env.DATA_DIR = dataDir;
process.env.AUTH_REQUIRED = 'false';
process.env.PORT = String(port);
process.env.MEDIA_PUBLIC_BASE = 'https://media.example.com';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { state, save } = await import('../src/store.js');

test.after(() => new Promise(resolve => server.close(resolve)));

for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

const USER = 'user_admin';

function seed() {
  state.projects = [{ id: 'lec-m', title: 'Lecture', userId: USER, ownedBy: USER, status: 'done' }];
  state.clips = [{
    id: 'clip-m1', projectId: 'lec-m', userId: USER, ownedBy: USER, title: 'clip', status: 'waiting',
    score: 90, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold',
    durationMs: 30000, targets: [],
    clipUrl: 'https://pub-abc123.r2.dev/clips/lec-m/clip-m1.mp4?x=1',
    thumbUrl: 'https://pub-abc123.r2.dev/clips/lec-m/clip-m1.jpg',
    stylePreview: { url: 'https://pub-abc123.r2.dev/clips/pv/clip-m1-preview.mp4', at: 123 },
  }];
  save();
}

test('the video redirect points at the custom domain, never r2.dev', async () => {
  seed();
  const res = await fetch(`${base}/api/clips/clip-m1/video`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'https://media.example.com/clips/lec-m/clip-m1.mp4?x=1');
});

test('the thumb redirect is rewritten too', async () => {
  seed();
  const res = await fetch(`${base}/api/clips/clip-m1/thumb`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'https://media.example.com/clips/lec-m/clip-m1.jpg');
});

test('the state view never exposes an r2.dev URL', async () => {
  seed();
  const body = await fetch(`${base}/api/state`).then(r => r.json());
  const clip = body.clips.find(c => c.id === 'clip-m1');
  assert.equal(clip.videoUrl, 'https://media.example.com/clips/lec-m/clip-m1.mp4?x=1');
  assert.equal(clip.thumbUrl, 'https://media.example.com/clips/lec-m/clip-m1.jpg');
  assert.equal(clip.stylePreview.url, 'https://media.example.com/clips/pv/clip-m1-preview.mp4');
  assert.equal(JSON.stringify(clip).includes('r2.dev'), false);
});

test('non-R2 URLs pass through untouched', async () => {
  seed();
  state.clips[0].clipUrl = 'https://cdn.elsewhere.com/v.mp4';
  save();
  const res = await fetch(`${base}/api/clips/clip-m1/video`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), 'https://cdn.elsewhere.com/v.mp4');
});
