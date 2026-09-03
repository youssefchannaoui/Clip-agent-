import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * The watermark-free copy TikTok requires, on a REMOTE worker (v3.114.0).
 *
 * The local engine has rendered this copy since the feature existed; the
 * remote path -- which is production -- returned early and only ever refused,
 * so with every template carrying the DeenClipped mark by default (v3.72.8)
 * EVERY TikTok post was refused by this app before TikTok was contacted.
 *
 * These drive the real functions against a faked worker rather than reading
 * the source: the whole bug was a path that was never taken.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-cleancopy-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'tiktok-clean-copy-secret-long-enough';
process.env.WORKER_BASE_URL = 'https://worker.test';
process.env.WORKER_SHARED_SECRET = 'worker-test-secret-at-least-thirty-two-characters';
process.env.WORKER_REQUEST_TIMEOUT_MS = '5000';
process.env.WORKER_POLL_INTERVAL_MS = '5';
process.env.OBJECT_STORAGE_PUBLIC_URL = 'https://media.test';
// The worker fetches nasheed tracks over HTTP, so a remote job refuses to be
// built without this. Production always sets it.
process.env.PUBLIC_BASE_URL = 'https://app.test';

const engine = await import('../src/local-engine.js');
const { state, save } = await import('../src/store.js');

const originalFetch = global.fetch;
test.after(() => {
  global.fetch = originalFetch;
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

let seq = 0;
/** A remote lecture with one rendered, watermarked clip on it. */
function seedClip({ watermark = 'DEENCLIPPED', renderVersion = 1, status = 'scheduled' } = {}) {
  const n = ++seq;
  const userId = `u-${n}`;
  state.authUsers.push({
    id: userId, email: `${userId}@test`, name: userId, role: 'creator', providers: {},
    createdAt: Date.now(), billing: { plan: 'free', status: 'free' },
  });
  const project = {
    id: `p-${n}`, userId, title: `Lecture ${n}`, status: 'done', engine: 'remote',
    url: 'https://www.youtube.com/watch?v=Abc_123-xyZ', sourceObjectKey: `sources/p-${n}.mp4`,
    transcriptObjectKey: `transcripts/p-${n}.json`, submittedAt: Date.now(), clipCount: 1,
  };
  const clip = {
    id: `c-${n}`, userId, projectId: project.id, projectTitle: project.title,
    title: `Clip ${n}`, description: 'A clip.', transcript: 'Some words.',
    startSec: 0, endSec: 30, score: 80, scoreReasons: [], status, renderVersion,
    // Waived rather than seeded: a nasheed is a file on disk, and this test is
    // about which VIDEO is handed to TikTok.
    musicEnabled: false, musicVerified: false, renderVerified: true, renderQuality: 'final',
    clipUrl: `https://media.test/clips/c-${n}.mp4`, addedAt: Date.now(),
    templateSnapshot: {
      id: `tpl-${n}`, name: 'Clean Line', builtIn: true, userId,
      watermark, watermarkOpacity: 100, watermarkPosition: 'top-center', brandLineEnabled: false,
      captionMode: 'phrase', captionFontSize: 62, captionOutlineWidth: 5,
    },
  };
  state.projects.push(project);
  state.clips.push(clip);
  save();
  return { clip, project, userId };
}

/** The worker: one queued poll, then a completed job carrying `result`. */
function fakeWorker(result, { fail = '' } = {}) {
  const seen = { created: [], polls: 0 };
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/jobs') && options.method === 'POST') {
      seen.created.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: seen.created.at(-1).id, status: 'queued' }), { status: 202, headers: { 'content-type': 'application/json' } });
    }
    if (/\/jobs\//.test(target)) {
      seen.polls += 1;
      const body = fail
        ? { status: 'failed', error: fail }
        : { status: 'completed', stage: 'done', progress: 100, result };
      return new Response(JSON.stringify({ id: 'job', ...body }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // The finished copy being fetched for upload.
    return new Response(new Blob(['fake-mp4-bytes']).stream(), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '15' } });
  };
  return seen;
}

const renderedCopy = (clipId, url) => ({
  clips: [{
    id: `${clipId}-tiktok-safe`, clipUrl: url, clipObjectKey: `clips/${clipId}-tiktok-safe.mp4`,
    renderVerified: true, musicEnabled: false, musicVerified: false, templateName: 'Clean Line · TikTok safe',
  }],
});

/** Run the queue until every social-variant job for this clip has settled. */
async function settle(clipId, limit = 60) {
  for (let i = 0; i < limit; i += 1) {
    await engine.pump();
    await new Promise(resolve => setTimeout(resolve, 15));
    const jobs = state.rerenderJobs.filter(j => j.clipId === clipId && j.socialVariant);
    if (jobs.length && jobs.every(j => !['queued', 'processing'].includes(j.status))) return jobs;
  }
  throw new Error('the copy never settled');
}

test('a marked clip is no longer refused: the copy is queued instead', async () => {
  const { clip } = seedClip();
  fakeWorker(renderedCopy(clip.id, `https://media.test/clips/${clip.id}-safe.mp4`));

  const error = await engine.socialPublishFile(clip.id, 'tiktok').then(() => null, e => e);
  assert.ok(error, 'the first attempt cannot post yet');
  assert.equal(error.pendingRender, true, 'and says it is WAITING, not that it failed');
  assert.doesNotMatch(error.message, /paid feature|TikTok-safe template/i,
    'nobody is told to buy or choose their way past this any more');

  const job = state.rerenderJobs.find(j => j.clipId === clip.id && j.socialVariant === 'tiktok');
  assert.ok(job, 'a copy was queued');
  assert.equal(job.engine, 'remote', 'through the remote worker, which is the path that was missing');
  assert.equal(job.forRenderVersion, 1, 'stamped with the render it was built from');
});

test('the job sent to the worker carries a template with nothing of ours on the frame', async () => {
  const { clip } = seedClip();
  const seen = fakeWorker(renderedCopy(clip.id, `https://media.test/clips/${clip.id}-safe.mp4`));
  await engine.socialPublishFile(clip.id, 'tiktok').catch(() => {});
  await settle(clip.id);

  const sent = seen.created.find(job => String(job.clipIdOverride || '').includes('tiktok-safe'));
  assert.ok(sent, 'the worker was actually asked');
  assert.equal(sent.template.watermark, '', 'no watermark text');
  assert.equal(sent.template.watermarkOpacity, 0, 'and not an invisible one left switched on');
  assert.equal(sent.template.brandLineEnabled, false);
  assert.equal(sent.template.promoBarEnabled, false, 'the promo bar is our mark too');
  assert.equal(sent.settings.renderQuality, 'final', 'never a draft: this file goes to a platform');
  // The customer's own template is untouched -- only the copy differs.
  assert.equal(clip.templateSnapshot.watermark, 'DEENCLIPPED');
});

test('once the copy lands it is used, and the clip itself is unchanged', async () => {
  const { clip } = seedClip();
  const cleanUrl = `https://media.test/clips/${clip.id}-safe.mp4`;
  fakeWorker(renderedCopy(clip.id, cleanUrl));
  await engine.socialPublishFile(clip.id, 'tiktok').catch(() => {});
  await settle(clip.id);

  assert.equal(clip.socialVariants?.tiktok?.clipUrl, cleanUrl, 'the copy is recorded on the clip');
  assert.equal(clip.clipUrl, `https://media.test/clips/${clip.id}.mp4`, 'the clip still plays its own render');
  assert.equal(state.clips.filter(c => c.projectId === clip.projectId).length, 1,
    'and the copy never joins the library as a second clip');

  const file = await engine.socialPublishFile(clip.id, 'tiktok');
  assert.match(path.basename(file), /tiktok-safe/, 'the second attempt posts the clean copy');
  assert.ok(fs.existsSync(file));

  // Every other platform still gets the branded clip.
  const youtube = await engine.socialPublishFile(clip.id, 'youtube');
  assert.doesNotMatch(path.basename(youtube), /tiktok-safe/, 'YouTube is unaffected');
});

test('a clip with no mark on it needs no copy at all', async () => {
  const { clip } = seedClip({ watermark: '' });
  fakeWorker(renderedCopy(clip.id, 'https://media.test/unused.mp4'));
  const file = await engine.socialPublishFile(clip.id, 'tiktok');
  assert.doesNotMatch(path.basename(file), /tiktok-safe/, 'the clip itself is already clean');
  assert.equal(state.rerenderJobs.filter(j => j.clipId === clip.id && j.socialVariant).length, 0,
    'so no render is spent on it');
});

test('a zero-width watermark is not a watermark', async () => {
  // U+200B renders as nothing, so TikTok has no objection and neither should
  // we -- the same NO_INK rule the paywall reads (v3.51.0).
  const { clip } = seedClip({ watermark: '​' });
  fakeWorker(renderedCopy(clip.id, 'https://media.test/unused.mp4'));
  const file = await engine.socialPublishFile(clip.id, 'tiktok');
  assert.doesNotMatch(path.basename(file), /tiktok-safe/);
});

test('a copy of an older render is never posted', async () => {
  const { clip } = seedClip();
  const stale = `https://media.test/clips/${clip.id}-stale.mp4`;
  fakeWorker(renderedCopy(clip.id, stale));
  await engine.socialPublishFile(clip.id, 'tiktok').catch(() => {});
  await settle(clip.id);
  assert.equal(clip.socialVariants.tiktok.clipUrl, stale);

  // The clip is re-rendered: different bytes, different captions. The copy
  // made from the old one must not go out beside them.
  clip.renderVersion = 2;
  const error = await engine.socialPublishFile(clip.id, 'tiktok').then(() => null, e => e);
  assert.equal(error?.pendingRender, true, 'a fresh copy is made instead of posting the stale one');
  assert.equal(
    state.rerenderJobs.filter(j => j.clipId === clip.id && j.socialVariant && j.forRenderVersion === 2).length, 1,
    'exactly one, for the render that is actually current');
});

test('waiting does not queue a second copy on every attempt', async () => {
  const { clip } = seedClip();
  // No worker: the job stays queued, which is what a busy box looks like.
  global.fetch = async () => new Response(JSON.stringify({ error: 'nope' }), { status: 503 });
  for (let i = 0; i < 4; i += 1) await engine.socialPublishFile(clip.id, 'tiktok').catch(() => {});
  const jobs = state.rerenderJobs.filter(j => j.clipId === clip.id && j.socialVariant);
  assert.equal(jobs.length, 1, 'four attempts, one render');
});

test('a copy that cannot be rendered fails loudly rather than waiting forever', async () => {
  const { clip } = seedClip();
  fakeWorker(null, { fail: 'The render ran out of memory.' });
  await engine.socialPublishFile(clip.id, 'tiktok').catch(() => {});
  await settle(clip.id);

  const error = await engine.socialPublishFile(clip.id, 'tiktok').then(() => null, e => e);
  assert.ok(error, 'it does not silently succeed');
  assert.ok(!error.pendingRender, 'and it stops waiting');
  assert.match(error.message, /could not be rendered/i);
  assert.match(error.message, /ran out of memory/i, 'the worker’s own reason reaches the customer');
});

test('a clip already posted elsewhere can still have its TikTok copy made', async () => {
  // One destination refusing does not make the clip untouchable: a clip live
  // on YouTube with a failed TikTok leg is exactly the case this has to serve.
  const { clip } = seedClip({ status: 'posted' });
  fakeWorker(renderedCopy(clip.id, `https://media.test/clips/${clip.id}-safe.mp4`));
  const error = await engine.socialPublishFile(clip.id, 'tiktok').then(() => null, e => e);
  assert.equal(error?.pendingRender, true, 'queued rather than refused as "a posted video cannot be changed"');
  await settle(clip.id);
  assert.ok(clip.socialVariants?.tiktok?.clipUrl);
  assert.equal(clip.status, 'posted', 'and the clip itself is still posted');
});

test('a free account still carries its attribution, in the caption', async () => {
  // THE TRADE, stated rather than hidden. TikTok will not take our mark, so a
  // free account's TikTok video has none burned in -- the same shape as the
  // scripture exemption, where the platform's rule outranks the paywall. What
  // makes it honest is that the attribution MOVES rather than disappearing:
  // `postCredit` puts the poster's own invite link in the caption, and that is
  // read from the same FEATURES entry the watermark gate reads.
  const social = await import('../src/social.js');
  const { clip } = seedClip();
  clip.description = 'A reminder about patience.';
  const caption = social.captionTextFor(clip, 2100);
  assert.match(caption, /deenclipped/i, 'the free plan is still credited');
  assert.match(caption, /\/r\//, 'and it is the poster\'s own invite link, not a bare advert');
});

test('the copy is machinery, so it is not a second row on any screen', () => {
  // One piece of work, one row. The publish target already says
  // "Clip -> TikTok - Rendering a copy TikTok will accept"; a render row
  // beside it would read "Editing clip" at somebody who edited nothing, and a
  // failure row would read "Edit failed" beside the publish failure that
  // carries the real guidance.
  const adapter = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  const guards = adapter.match(/if \(j\.socialVariant\) return;/g) || [];
  assert.equal(guards.length, 2, 'both the live list and the failures list skip it');

  // And the clip's own render status never reports it either, or the editor
  // would spin for work the customer cannot see.
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const at = server.indexOf('function latestRerender');
  assert.match(server.slice(at, at + 700), /!job\.socialVariant/,
    'a copy is not the clip re-rendering');
});
