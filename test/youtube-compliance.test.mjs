import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The YouTube API Services ToS Violations Report of 13 Aug 2026. Each test is
// named for the policy it keeps, so a future change that breaks compliance
// fails with the policy number attached rather than a vague assertion.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-yt-compliance-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'youtube-compliance-secret-long-enough';

const retention = await import('../src/youtube-retention.js');
const store = await import('../src/store.js');
const marketing = fs.readFileSync(path.join(process.cwd(), 'src/marketing.js'), 'utf8');
const engine = fs.readFileSync(path.join(process.cwd(), 'src/local-engine.js'), 'utf8');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const DAY = 24 * 60 * 60 * 1000;

test('III.E.4: cached video metadata is cleared after 30 days', () => {
  const now = Date.now();
  store.state.projects.length = 0;
  store.state.projects.push(
    { id: 'old', url: 'https://youtu.be/abc', sourceTitle: 'A lecture', sourceThumbUrl: 'https://i.ytimg.com/x.jpg', sourceDurationSec: 600, youtubeDataAt: now - 31 * DAY },
    { id: 'fresh', url: 'https://youtu.be/def', sourceTitle: 'Still current', sourceThumbUrl: 'https://i.ytimg.com/y.jpg', sourceDurationSec: 400, youtubeDataAt: now - 3 * DAY },
  );
  const cleared = retention.sweepYouTubeData({ now });
  assert.equal(cleared.projects, 1);
  const old = store.state.projects.find(p => p.id === 'old');
  assert.equal(old.sourceTitle, null, 'the title is gone');
  assert.equal(old.sourceThumbUrl, null, 'the thumbnail URL is gone');
  // Inside the window nothing is touched: the rule is a maximum age, not a
  // reason to throw away data the customer is actively using.
  const fresh = store.state.projects.find(p => p.id === 'fresh');
  assert.equal(fresh.sourceTitle, 'Still current');
});

test('III.E.4: an uploaded file keeps its own title, which is not API Data', () => {
  const now = Date.now();
  store.state.projects.length = 0;
  // Stored the way submitVideo stores an upload: the url field carries a
  // display string, and sourceKind says where it came from.
  store.state.projects.push({ id: 'upload', url: 'Uploaded file · khutbah-recording.mp4', sourceKind: 'object_storage', sourceTitle: 'khutbah-recording.mp4', sourceDurationSec: 1800, youtubeDataAt: now - 90 * DAY });
  retention.sweepYouTubeData({ now });
  assert.equal(store.state.projects[0].sourceTitle, 'khutbah-recording.mp4',
    "the customer's own filename came from them, not from YouTube");
  assert.equal(store.state.projects[0].sourceDurationSec, 1800);
});

test('III.E.4: a stale channel name is cleared but the connection survives', () => {
  const now = Date.now();
  // The shape tenancy.setConnection writes: one object per provider, per user.
  store.state.socialConnections = {
    user_1: { youtube: { provider: 'youtube', accountId: 'UC123', name: 'The Masjid Channel', avatar: 'https://yt3.ggpht.com/a.jpg', youtubeDataAt: now - 40 * DAY } },
  };
  const cleared = retention.sweepYouTubeData({ now });
  assert.equal(cleared.connections, 1);
  const account = store.state.socialConnections.user_1.youtube;
  assert.equal(account.name, '');
  assert.equal(account.avatar, '');
  // The channel id is where publishing is addressed, not a description of a
  // YouTube resource. Clearing it would break the connection itself.
  assert.equal(account.accountId, 'UC123');
});

test('III.E.4: data with no stamp is treated as expired', () => {
  const now = Date.now();
  store.state.projects.length = 0;
  store.state.projects.push({ id: 'legacy', url: 'https://youtu.be/ghi', sourceTitle: 'Cached before the rule existed' });
  retention.sweepYouTubeData({ now });
  assert.equal(store.state.projects[0].sourceTitle, null,
    'unknown age is treated as too old; re-fetching costs one call');
});

test('III.E.4: the stamp is written when the metadata is cached', () => {
  // Without this the sweep would clear everything on its first run, every run.
  assert.match(engine, /youtubeDataAt: sourceMeta \? Date\.now\(\) : null/);
});

test('III.A.2d: the privacy policy lists the API Data actually accessed', () => {
  // Google's finding was that the policy did not explain what user information,
  // including API Data, the client accesses, collects, stores and uses.
  for (const item of [
    'Channel identifier, channel name and channel profile image',
    'Video title, duration and thumbnail image URL',
    'video identifier of a clip DeenClipped uploaded',
    'youtube.upload',
    'youtube.readonly',
  ]) {
    assert.ok(marketing.includes(item), `the policy must state: ${item}`);
  }
});

test('III.A.2d: the policy states the retention period and the statistics position', () => {
  assert.match(marketing, /deleted after 30 days/);
  assert.match(marketing, /not<\/strong> request, store or display YouTube statistics/);
  // Revocation through Google itself, not only through this app.
  assert.match(marketing, /myaccount\.google\.com\/permissions/);
});

test('the claim that no statistics are read stays true in the code', () => {
  // The policy says no view, like or comment counts are retrieved. That is only
  // honest while the API request asks for snippet and contentDetails alone.
  const requests = engine.match(/youtube\/v3\/videos\?part=[^&`]*/g) || [];
  assert.ok(requests.length > 0, 'the metadata request should still exist');
  for (const request of requests) {
    assert.doesNotMatch(request, /statistics/, 'asking for statistics would make the privacy policy false');
  }
});

test('the YouTube mark is unmodified, uncontained and at least 20px', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  // Official colours only: YouTube red on white, no currentColor tinting.
  assert.match(page, /fill='%23FF0000'/, 'the official red');
  assert.match(page, /fill='%23FFFFFF'/, 'the official white triangle');
  assert.doesNotMatch(page, /i\.ph-youtube-logo\{[^}]*color:\s*(?!transparent)/,
    'the glyph must never inherit the dashboard palette');
  // Their stated 20px minimum, not 1em (which is 17px in the posting row).
  assert.match(page, /i\.ph-youtube-logo\{[^}]*min-height:22px/);
  // No tile chrome around the mark: a bordered rounded box restates its shape.
  assert.match(page, /:has\(> i\.ph-youtube-logo\)\{[^}]*border-color:transparent/);
});

test('the privacy policy names the API calls, the retention and the way out', async () => {
  const marketing = await import('../src/marketing.js');
  const html = marketing.privacy({ base: 'https://deenclipped.online', currentUser: null });
  for (const needle of [
    'channels.list', 'videos.list',                     // what is called
    'encrypted OAuth access and refresh tokens',        // what is stored
    'automatically deleted after 30 days',              // how long
    'https://policies.google.com/privacy',              // Google's own policy
    'https://myaccount.google.com/permissions',         // how to revoke
    'does <strong>not</strong> request, store or display YouTube statistics',
  ]) {
    assert.ok(html.includes(needle), `privacy policy must state: ${needle}`);
  }
});

test('the URL-processing section describes production, not the local-mode path', async () => {
  // This section goes to Google as part of a ToS response, so it must match
  // the running configuration: WORKER_BASE_URL is set in production, which
  // makes processingMode "remote". Since 26 Aug 2026 the production worker
  // downloads through yt-dlp and the configured Webshare residential pool.
  const marketing = await import('../src/marketing.js');
  const html = marketing.privacy({ base: 'https://deenclipped.online', currentUser: null });
  const section = html.slice(html.indexOf('YouTube URL processing'), html.indexOf('Security and storage'));
  assert.match(section, /yt-dlp/, 'names the downloader production actually calls');
  assert.match(section, /Webshare/, 'names the proxy network production may call');
  assert.match(section, /No Google credentials are sent/i);
  assert.doesNotMatch(section, /SocialKit|Vizard/,
    'retired providers must not be presented as the current production path');
});
