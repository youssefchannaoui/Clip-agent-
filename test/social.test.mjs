import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-social-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_TOKEN_KEY = 'social-test-key-that-is-definitely-long-enough';
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.GOOGLE_AUTH_BASE = 'https://accounts.test';
process.env.GOOGLE_TOKEN_URL = 'https://google.test/token';
process.env.YOUTUBE_API_BASE = 'https://google.test';
process.env.META_APP_ID = 'meta-app';
process.env.META_APP_SECRET = 'meta-secret';
process.env.META_GRAPH_BASE = 'https://meta.test';
process.env.META_DIALOG_BASE = 'https://facebook.test';
process.env.TIKTOK_CLIENT_KEY = 'tiktok-key';
process.env.TIKTOK_CLIENT_SECRET = 'tiktok-secret';
process.env.TIKTOK_AUTH_BASE = 'https://tiktok.test';
process.env.TIKTOK_API_BASE = 'https://tiktok-api.test';

const social = await import('../src/social.js');
const store = await import('../src/store.js');
const USER = 'user_creator_1';
const mediaFile = path.join(dataDir, 'clip.mp4');
fs.writeFileSync(mediaFile, Buffer.alloc(1024, 7));

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function stateFrom(url) {
  return new URL(url).searchParams.get('state');
}

test('TikTok chunk plan obeys whole-file and multi-chunk rules', () => {
  const MB = 1024 * 1024;
  const small = social.__test.tiktokChunks(4 * MB);
  assert.equal(small.count, 1);
  assert.equal(small.chunkSize, 4 * MB);
  const medium = social.__test.tiktokChunks(100 * MB);
  assert.ok(medium.count >= 2);
  assert.equal(medium.lengths.reduce((sum, value) => sum + value, 0), 100 * MB);
  assert.ok(medium.lengths.slice(0, -1).every(value => value >= 5 * MB && value <= 64 * MB));
  assert.ok(medium.lengths.at(-1) <= 128 * MB);
});

test('YouTube OAuth, connection check and resumable upload complete', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    const text = String(url);
    if (text === 'https://google.test/token') return json({ access_token: 'yt-access', refresh_token: 'yt-refresh', expires_in: 3600, scope: 'youtube.upload' });
    if (text.includes('/youtube/v3/channels')) return json({ items: [{ id: 'channel-1', snippet: { title: 'Deen Channel', thumbnails: { default: { url: 'https://img.test/y.jpg' } } } }] });
    if (text.includes('/upload/youtube/v3/videos') && (options.method || 'GET') === 'POST') return new Response('', { status: 200, headers: { location: 'https://upload.test/youtube-session' } });
    if (text === 'https://upload.test/youtube-session' && options.method === 'PUT') return json({ id: 'youtube-video-1' }, 201);
    throw new Error(`Unexpected fetch ${options.method || 'GET'} ${text}`);
  };

  const start = social.oauthStartUrl('youtube', USER);
  await social.completeOAuth('youtube', new URL(`https://app.test/auth/youtube/callback?code=abc&state=${encodeURIComponent(stateFrom(start))}`));
  const checked = await social.testConnection('youtube', '', USER);
  assert.equal(checked.accountId, 'channel-1');

  const target = { userId: USER, provider: 'youtube', accountId: 'channel-1', settings: { privacy: 'private', categoryId: '22' }, providerState: {} };
  const result = await social.publishTarget({ id: 'clip-1', userId: USER, title: 'Reminder', description: 'A useful reminder', hashtags: '#Islam' }, target, mediaFile);
  assert.equal(result.postId, 'youtube-video-1');
  assert.equal(result.postUrl, 'https://youtu.be/youtube-video-1');
  assert.equal(target.providerState.stage, 'completed');
  assert.ok(calls.some(call => call.url.includes('uploadType=resumable')));
});

test('Meta OAuth supports Instagram and Facebook publishing paths', async () => {
  let instagramStatusChecks = 0;
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    const method = options.method || 'GET';
    if (text.includes('/oauth/access_token') && text.includes('code=meta-code')) return json({ access_token: 'user-short' });
    if (text.includes('/oauth/access_token') && text.includes('fb_exchange_token=')) return json({ access_token: 'user-long' });
    if (text.includes('/me/accounts')) return json({ data: [{ id: 'page-1', name: 'Deen Page', access_token: 'page-token', instagram_business_account: { id: 'ig-1', username: 'deenclips', profile_picture_url: '' } }] });
    if (text.includes('/page-1?fields=id,name')) return json({ id: 'page-1', name: 'Deen Page' });
    if (text.includes('/ig-1/media_publish') && method === 'POST') return json({ id: 'ig-post-1' });
    if (text.includes('/ig-1/media') && method === 'POST') return json({ id: 'ig-container-1' });
    if (text.includes('/ig-container-1?fields=status_code')) { instagramStatusChecks++; return json({ status_code: 'FINISHED' }); }
    if (text.includes('/ig-post-1?fields=permalink')) return json({ permalink: 'https://instagram.test/p/ig-post-1' });
    if (text.includes('/page-1/video_reels') && text.includes('upload_phase=start')) return json({ video_id: 'fb-video-1', upload_url: 'https://upload.test/facebook' });
    if (text === 'https://upload.test/facebook' && method === 'POST') return json({ success: true });
    if (text.includes('/page-1/video_reels') && text.includes('upload_phase=finish')) return json({ success: true });
    if (text.includes('/fb-video-1?fields=permalink_url')) return json({ permalink_url: 'https://facebook.test/reel/fb-video-1' });
    throw new Error(`Unexpected fetch ${method} ${text}`);
  };

  const start = social.oauthStartUrl('meta', USER);
  await social.completeOAuth('meta', new URL(`https://app.test/auth/meta/callback?code=meta-code&state=${encodeURIComponent(stateFrom(start))}`));
  const checked = await social.testConnection('meta', '', USER);
  assert.equal(checked.accounts[0].pageId, 'page-1');

  const igTarget = { userId: USER, provider: 'instagram', accountId: 'ig-1', settings: { shareToFeed: true }, providerState: {} };
  const igClip = { id: 'clip-ig', userId: USER, title: 'IG Reminder', description: 'Caption', hashtags: '#deen' };
  const pending = await social.publishTarget(igClip, igTarget, mediaFile);
  assert.equal(pending.pending, true);
  const igResult = await social.pollTarget(igClip, igTarget);
  assert.equal(igResult.postId, 'ig-post-1');
  assert.equal(igResult.postUrl, 'https://instagram.test/p/ig-post-1');
  assert.equal(instagramStatusChecks, 1);

  const fbTarget = { userId: USER, provider: 'facebook', accountId: 'page-1', settings: {}, providerState: {} };
  const fbResult = await social.publishTarget({ id: 'clip-fb', userId: USER, title: 'FB Reminder', description: 'Caption', hashtags: '#deen', durationMs: 30_000 }, fbTarget, mediaFile);
  assert.equal(fbResult.postId, 'fb-video-1');
  assert.equal(fbResult.postUrl, 'https://facebook.test/reel/fb-video-1');
  assert.equal(fbTarget.providerState.stage, 'published');
});

test('TikTok OAuth, creator check, upload and publish polling complete', async () => {
  let initBody = null;
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    const method = options.method || 'GET';
    if (text.endsWith('/v2/oauth/token/')) return json({ access_token: 'tt-access', refresh_token: 'tt-refresh', expires_in: 86400, open_id: 'tt-user', scope: 'user.info.basic,video.publish' });
    if (text.includes('/v2/user/info/')) return json({ data: { user: { open_id: 'tt-user', display_name: 'Deen TikTok', avatar_url: '' } }, error: { code: 'ok' } });
    if (text.includes('/creator_info/query/')) return json({ data: { privacy_level_options: ['SELF_ONLY'], comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 180 }, error: { code: 'ok' } });
    if (text.includes('/video/init/')) { initBody = JSON.parse(String(options.body)); return json({ data: { publish_id: 'tt-publish-1', upload_url: 'https://upload.test/tiktok' }, error: { code: 'ok' } }); }
    if (text === 'https://upload.test/tiktok' && method === 'PUT') return new Response('', { status: 201 });
    if (text.includes('/status/fetch/')) return json({ data: { status: 'PUBLISH_COMPLETE', publicly_available_post_id: ['tt-post-1'] }, error: { code: 'ok' } });
    throw new Error(`Unexpected fetch ${method} ${text}`);
  };

  const start = social.oauthStartUrl('tiktok', USER);
  await social.completeOAuth('tiktok', new URL(`https://app.test/auth/tiktok/callback?code=tt-code&state=${encodeURIComponent(stateFrom(start))}`));
  const checked = await social.testConnection('tiktok', '', USER);
  assert.equal(checked.accountId, 'tt-user');

  const target = { userId: USER, provider: 'tiktok', accountId: 'tt-user', settings: { privacy: 'SELF_ONLY', allowComments: true, allowDuet: false, allowStitch: false }, providerState: {} };
  const ttClip = { id: 'clip-tt', userId: USER, title: 'TikTok Reminder', description: 'Caption', hashtags: '#deen', durationMs: 30_000 };
  const pending = await social.publishTarget(ttClip, target, mediaFile);
  assert.equal(pending.pending, true);
  assert.equal(initBody.post_info.privacy_level, 'SELF_ONLY');
  assert.equal(initBody.post_info.disable_stitch, true);
  const result = await social.pollTarget(ttClip, target);
  assert.equal(result.postId, 'tt-post-1');
});

test('OAuth state is one-time use', async () => {
  global.fetch = async url => {
    const text = String(url);
    if (text === 'https://google.test/token') return json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    if (text.includes('/youtube/v3/channels')) return json({ items: [{ id: 'channel-2', snippet: { title: 'Second' } }] });
    throw new Error(`Unexpected fetch ${text}`);
  };
  const start = social.oauthStartUrl('youtube', USER);
  const callback = new URL(`https://app.test/auth/youtube/callback?code=abc&state=${encodeURIComponent(stateFrom(start))}`);
  await social.completeOAuth('youtube', callback);
  await assert.rejects(() => social.completeOAuth('youtube', callback), /already used|expired/i);
});

test('a connection started by one account cannot be finished as another', async () => {
  global.fetch = async url => {
    const text = String(url);
    if (text === 'https://google.test/token') return json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    if (text.includes('/youtube/v3/channels')) return json({ items: [{ id: 'channel-3', snippet: { title: 'Third' } }] });
    throw new Error(`Unexpected fetch ${text}`);
  };
  const start = social.oauthStartUrl('youtube', 'user_a');
  await social.completeOAuth('youtube', new URL(`https://app.test/auth/youtube/callback?code=abc&state=${encodeURIComponent(stateFrom(start))}`));
  const statusA = social.connectionStatus('user_a');
  const statusB = social.connectionStatus('user_b');
  assert.equal(statusA.providers.youtube.connected, true);
  assert.equal(statusB.providers.youtube.connected, false);
});

test('publishing refuses a target that belongs to a different account than the clip', async () => {
  const clip = { id: 'clip-mismatch', userId: 'user_a' };
  const target = { userId: 'user_b', provider: 'youtube', accountId: 'channel-x', settings: {}, providerState: {} };
  await assert.rejects(() => social.publishTarget(clip, target, mediaFile), /different account/i);
});
