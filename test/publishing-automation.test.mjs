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

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('a strong clip is automatically scheduled and then posted to YouTube', async () => {
  // Automation is off by default, so this has to ask for it: the test is about
  // what automation does once an account has chosen to turn it on.
  store.setAutomationSettings({ id: USER }, { enabled: true });
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

test('one misconfigured platform never blocks the others from scheduling', async () => {
  // Instagram sat enabled with no account selected, and every approval bounced
  // back to waiting: setTargets validated ALL platforms and threw on the first
  // broken one, so a half-connected Meta login silently stopped healthy
  // YouTube posts for two days. A broken platform is skipped and logged; the
  // healthy ones post.
  const settings = store.publishingSettings(USER);
  store.setPublishingSettings(USER, {
    ...settings,
    enabled: true,
    instagram: { ...(settings.instagram || {}), enabled: true, accountId: 'ig-account-that-does-not-exist' },
  });
  const clip = {
    id: 'clip_igblock', projectId: 'p_igblock', userId: USER, ownedBy: USER,
    title: 'Healthy despite Instagram', status: 'approved', approvedBy: 'manual', approvedAt: Date.now(),
    score: 90, musicVerified: true, renderVerified: true, renderQuality: 'final',
    templateId: 'deenclipped-gold', durationMs: 30000, transcript: 'words', targets: [],
  };
  store.state.clips.push(clip);
  const scheduled = agent.scheduleApprovedClip(clip);
  assert.equal(scheduled.status, 'scheduled', 'the clip schedules despite the broken platform');
  const providers = scheduled.targets.map(t => t.provider);
  assert.ok(providers.includes('youtube'), 'the healthy platform is targeted');
  assert.ok(!providers.includes('instagram'), 'the broken platform is skipped, not fatal');
});

test('a save that only disables a platform is never rejected by another broken one', () => {
  // With Instagram AND Facebook both enabled-without-accounts, switching
  // either off was refused because the validator re-checked the other. The
  // account was wedged: no save could pass. Disabling must always be allowed.
  const settings = store.publishingSettings(USER);
  store.setPublishingSettings(USER, {
    ...settings,
    enabled: true,
    instagram: { ...(settings.instagram || {}), enabled: true, accountId: 'missing-ig' },
    facebook: { ...(settings.facebook || {}), enabled: true, accountId: 'missing-fb' },
  });
  const wedged = store.publishingSettings(USER);
  const next = { ...wedged, instagram: { ...wedged.instagram, enabled: false } };
  // validatePublishingSettings throws SocialError when refused.
  assert.doesNotThrow(() => social.validatePublishingSettings(next, { id: USER }));
});
