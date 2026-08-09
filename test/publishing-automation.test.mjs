import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-publish-auto-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_TOKEN_KEY = 'automation-social-token-key-over-32-characters';
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.GOOGLE_AUTH_BASE = 'https://accounts.test';
process.env.GOOGLE_TOKEN_URL = 'https://google.test/token';
process.env.YOUTUBE_API_BASE = 'https://google.test';

const store = await import('../src/store.js');
const social = await import('../src/social.js');
const agent = await import('../src/agent.js');

const USER = 'user_publish_auto_1';

store.state.authUsers.push({
  id: USER, email: 'publisher@deenclipped.test', role: 'creator', createdAt: Date.now(),
  billing: {
    plan: 'monthly', status: 'active', tokensUsed: 0, tokensReserved: 0,
    periodStart: Date.now(), periodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
  },
});

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('a strong clip is automatically scheduled and then posted to YouTube', async () => {
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text === 'https://google.test/token') return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    if (text.includes('/youtube/v3/channels')) return json({ items: [{ id: 'channel-auto', snippet: { title: 'Auto Channel' } }] });
    if (text.includes('/upload/youtube/v3/videos') && options.method === 'POST') return new Response('', { status: 200, headers: { location: 'https://upload.test/auto-youtube' } });
    if (text === 'https://upload.test/auto-youtube' && options.method === 'PUT') return json({ id: 'posted-video-id' }, 201);
    throw new Error(`Unexpected fetch ${options.method || 'GET'} ${text}`);
  };

  const start = social.oauthStartUrl('youtube', USER);
  const oauthState = new URL(start).searchParams.get('state');
  await social.completeOAuth('youtube', new URL(`https://app.test/auth/youtube/callback?code=ok&state=${encodeURIComponent(oauthState)}`));
  store.setPublishingSettings({ id: USER }, {
    enabled: true,
    youtube: { enabled: true, accountId: 'channel-auto', privacy: 'private', categoryId: '22' },
  });

  const clipFile = path.join(dataDir, 'clips', 'auto.mp4');
  fs.mkdirSync(path.dirname(clipFile), { recursive: true });
  fs.writeFileSync(clipFile, Buffer.alloc(2048, 3));
  store.state.projects.push({ id: 'project-auto', title: 'Lecture', userId: USER });
  store.state.clips.push({
    id: 'clip-auto', projectId: 'project-auto', userId: USER, title: 'Strong reminder', description: 'Caption', hashtags: '#deen',
    status: 'waiting', score: 94, quality: { overall: 90 }, musicVerified: true, renderVerified: true,
    templateId: 'deenclipped-gold', reviewRequired: false, clipFile, durationMs: 30_000, targets: [],
  });

  await agent.tick();
  const clip = store.state.clips[0];
  assert.equal(clip.status, 'scheduled');
  assert.equal(clip.approvedBy, 'automation');
  assert.equal(clip.targets[0].provider, 'youtube');

  clip.scheduledAt = Date.now() - 1;
  clip.targets[0].nextTryAt = Date.now() - 1;
  await agent.tick();
  assert.equal(clip.status, 'posted');
  assert.equal(clip.targets[0].postId, 'posted-video-id');
  assert.equal(clip.targets[0].postUrl, 'https://youtu.be/posted-video-id');
});

test('the publishing engine refuses a free-trial social post before mutation', async () => {
  const freeUser = {
    id: 'user_publish_free', email: 'free@deenclipped.test', role: 'creator', createdAt: Date.now(),
    billing: { plan: 'free', status: 'free', tokensUsed: 0, tokensReserved: 0, periodStart: Date.now() },
  };
  store.state.authUsers.push(freeUser);
  const clip = {
    id: 'clip-free-post', projectId: 'project-free-post', userId: freeUser.id, title: 'Free trial clip',
    status: 'waiting', musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', targets: [],
  };
  store.state.projects.push({ id: clip.projectId, title: 'Free lecture', userId: freeUser.id });
  store.state.clips.push(clip);
  await assert.rejects(
    () => agent.publishNow(clip.id),
    error => error.code === 'publishing_requires_premium',
  );
  assert.equal(clip.status, 'waiting');
  assert.deepEqual(clip.targets, []);
});
