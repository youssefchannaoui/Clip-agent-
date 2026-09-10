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

test.after(() => {
  // Guarded: a leftover temp directory on a CI runner is harmless; a red
  // branch from a cleanup race is not. See admin-page.test.mjs for the race.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

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
    'video identifier of a clip DeenClipped uploaded',
    'youtube.upload',
    'youtube.readonly',
  ]) {
    assert.ok(marketing.includes(item), `the policy must state: ${item}`);
  }
});

test('III.A.2d: the policy says the API is used only for the customer\'s own channel', () => {
  // This is the sentence Google's reviewer needs to find, and it has to stay
  // true of the code -- the two tests above are what keep it true.
  assert.match(marketing, /limited to <strong>your own channel<\/strong>/);
  assert.match(marketing, /does not use the YouTube API to search, browse, list, or retrieve/);
  assert.match(marketing, /read from that video's own public watch page/);
});

test('III.A.2d: the policy states the retention period and the statistics position', () => {
  assert.match(marketing, /deleted after 30 days/);
  assert.match(marketing, /not<\/strong> request, store or display YouTube statistics/);
  // Revocation through Google itself, not only through this app.
  assert.match(marketing, /myaccount\.google\.com\/permissions/);
});

test('ToS 5a: no YouTube API call is made about a video this account does not own', () => {
  // Google refused the data-access verification on 8 Sept 2026 citing API ToS
  // section 5a, "Content Accessible Through our APIs", over clipping arbitrary
  // third-party videos. Section 5a governs what is reached THROUGH a Google
  // API -- so the answer is not to restrict which links a customer may paste,
  // it is to stop asking Google about them. A pasted link's title, length and
  // thumbnail come from the video's own public watch page instead.
  //
  // This is the law that keeps it true. The ONLY youtube/v3/videos endpoint
  // permitted anywhere in src/ is the resumable UPLOAD, which sends the
  // customer's own finished clip to their own channel.
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    for (const call of text.match(/[a-zA-Z/`${}.\w-]*youtube\/v3\/videos[^`'"\s]*/g) || []) {
      if (!call.includes('upload/youtube/v3/videos')) offenders.push(`${file}: ${call}`);
    }
  }
  assert.deepEqual(offenders, [], 'reading a third-party video through the YouTube API is what ToS 5a refuses');
});

test('ToS 5a: every channels read is scoped to the connected account itself', () => {
  // channels.list is the other half of the surface, and mine=true is what
  // makes it a question about the customer rather than about YouTube at
  // large. Without it this would be a way to look up any channel by id.
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    for (const call of text.match(/youtube\/v3\/channels[^`'"\s]*/g) || []) {
      assert.match(call, /mine=true/, `${file} reads channels without mine=true: ${call}`);
    }
  }
});

test('no API key is configured for the YouTube Data API', () => {
  // An unread key in config is how a videos.list call quietly comes back. The
  // OAuth calls that remain need a token, not a key, so there is nothing a
  // key could legitimately be for.
  const cfg = fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8');
  assert.doesNotMatch(cfg, /^\s*youtubeDataApiKey\s*:/m,
    'a YouTube Data API key has no use in this product and invites one back');
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
  // ":first-child" is what separates a tile from a row -- a tile holds the
  // mark and nothing before it, while a schedule row ENDS with the mark and
  // its top hairline is a divider, not a box. Stripping that too was making
  // the YouTube row the only row in "Next up" drawn without a divider.
  assert.match(page, /:has\(> i\.ph-youtube-logo:first-child\)\{[^}]*border-color:transparent/);
});

test('the privacy policy names the connected-channel API use, retention and the way out', async () => {
  const marketing = await import('../src/marketing.js');
  const html = marketing.privacy({ base: 'https://deenclipped.online', currentUser: null });
  for (const needle of [
    'channels.list',                                    // what is called
    'encrypted OAuth access and refresh tokens',        // what is stored
    'automatically deleted after 30 days',              // how long
    'https://policies.google.com/privacy',              // Google's own policy
    'https://myaccount.google.com/permissions',         // how to revoke
    'does <strong>not</strong> request, store or display YouTube statistics',
  ]) {
    assert.ok(html.includes(needle), `privacy policy must state: ${needle}`);
  }
});

test('the source-content section makes the production upload-only boundary explicit', async () => {
  const marketing = await import('../src/marketing.js');
  const html = marketing.privacy({ base: 'https://deenclipped.online', currentUser: null });
  const section = html.slice(html.indexOf('Source content'), html.indexOf('Security and storage'));
  assert.match(section, /original video files uploaded by the creator/);
  assert.match(section, /must confirm that they own the source or have permission to repurpose it/);
  assert.match(section, /does not import, download or retrieve audiovisual source files from public YouTube URLs/);
  assert.doesNotMatch(section, /yt-dlp|Webshare|SocialKit|Vizard/,
    'retired URL-import providers must not be presented as the production workflow');
});
