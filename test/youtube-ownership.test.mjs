import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// config.js reads the environment ONCE, at first import, so every value this
// file depends on is set before anything is imported. A static import is
// hoisted above these lines; an awaited one is not.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-yt-own-'));
process.env.DATA_DIR = dataDir;
process.env.YOUTUBE_DATA_API_KEY = 'test-data-api-key';
process.env.APP_SESSION_SECRET = 'youtube-ownership-test-secret-long-enough';
// Remote mode, so a link takes the production path rather than the local
// engine's Vizard branch -- the gate sits above both, and the record test
// below needs the project to actually be created.
process.env.WORKER_BASE_URL = 'http://127.0.0.1:19999';
process.env.WORKER_SHARED_SECRET = 'youtube-ownership-test-worker-secret';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.test';

const own = await import('../src/youtube-ownership.js');
const { config } = await import('../src/config.js');
const { state } = await import('../src/store.js');

const MINE = 'UC_my_channel';
const THEIRS = 'UC_someone_else';
const LINK = 'https://www.youtube.com/watch?v=abcdefghijk';

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* harmless */ }
});

/** Answer videos.list with one item on `channelId`, or a failure. */
function stubYouTube({ channelId = MINE, title = 'My channel', items = null, ok = true, throws = false } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    if (throws) throw new Error('network down');
    const body = items !== null ? { items } : { items: [{ snippet: { channelId, channelTitle: title } }] };
    return { ok, status: ok ? 200 : 403, json: async () => (ok ? body : { error: { message: 'quotaExceeded' } }) };
  };
  return () => { globalThis.fetch = real; };
}

function connect(userId, channels) {
  state.socialConnections = state.socialConnections || {};
  state.socialConnections[userId] = { youtube: channels.map(id => ({ provider: 'youtube', accountId: id, name: `Channel ${id}` })) };
}

test('a link on a connected channel is allowed, and names the channel it authorised', async () => {
  connect('u1', [MINE]);
  const restore = stubYouTube({ channelId: MINE });
  try {
    const found = await own.assertOwnsVideo({ id: 'u1' }, LINK);
    assert.equal(found.channelId, MINE);
  } finally { restore(); }
});

test('a link on somebody else’s channel is refused, and the message names the way out', async () => {
  connect('u1', [MINE]);
  const restore = stubYouTube({ channelId: THEIRS, title: 'Another Channel' });
  try {
    await assert.rejects(() => own.assertOwnsVideo({ id: 'u1' }, LINK), error => {
      // The channel it IS on, so a mis-pasted link is obvious at a glance,
      // and both ways forward.
      assert.match(error.message, /Another Channel/);
      assert.match(error.message, /Connect it/i);
      assert.match(error.message, /Upload MP4/i);
      // It has to FIT the notification dock's three lines, or the actionable
      // half is the half that gets cut (the v3.169.0 fault).
      assert.ok(error.message.length <= 125, `too long for the dock: ${error.message.length}`);
      return true;
    });
  } finally { restore(); }
});

test('an account with no connected channel cannot import a link at all', async () => {
  connect('u2', []);
  const restore = stubYouTube({ channelId: MINE });
  try {
    await assert.rejects(() => own.assertOwnsVideo({ id: 'u2' }, LINK), /Connect the YouTube channel/i);
  } finally { restore(); }
});

test('a blank account id is never a wildcard', async () => {
  // A record written before multi-channel carries a blank accountId, and the
  // PUBLISH path honours that as "the only connection". Here it would match
  // every video on YouTube, which is the whole hole this module closes.
  state.socialConnections.u3 = { youtube: [{ provider: 'youtube', accountId: '', name: 'Legacy' }] };
  assert.deepEqual(own.connectedChannelIds({ id: 'u3' }), []);
  const restore = stubYouTube({ channelId: MINE });
  try {
    await assert.rejects(() => own.assertOwnsVideo({ id: 'u3' }, LINK), /Connect the YouTube channel/i);
  } finally { restore(); }
});

test('it fails CLOSED when the lookup cannot answer', async () => {
  connect('u1', [MINE]);
  for (const [label, stub] of [
    ['a network error', { throws: true }],
    ['an API error', { ok: false }],
    ['a video that is private or deleted', { items: [] }],
    ['a response with no channel on it', { channelId: '' }],
  ]) {
    const restore = stubYouTube(stub);
    try { await assert.rejects(() => own.assertOwnsVideo({ id: 'u1' }, LINK), Error, label); }
    finally { restore(); }
  }
});

test('a re-run needs the authorising channel to still be connected', () => {
  connect('u1', [MINE]);
  const project = { sourceKind: 'link', url: LINK, sourceChannelId: MINE };
  assert.doesNotThrow(() => own.assertStillOwns({ id: 'u1' }, project));

  connect('u1', [THEIRS]);
  assert.throws(() => own.assertStillOwns({ id: 'u1' }, project), /no longer connected/i);
});

test('a link project imported before the channel was recorded cannot be re-run', () => {
  connect('u1', [MINE]);
  assert.throws(
    () => own.assertStillOwns({ id: 'u1' }, { sourceKind: 'link', url: LINK, sourceChannelId: null }),
    /Paste the link again/i,
  );
});

test('uploads are untouched by any of it', () => {
  connect('u1', []);
  // No connection, no channel recorded, and it still passes: a file the
  // customer already holds does not come through YouTube.
  assert.doesNotThrow(() => own.assertStillOwns({ id: 'u1' }, { sourceKind: 'upload', url: 'Uploaded file · khutbah.mp4' }));
  assert.doesNotThrow(() => own.assertStillOwns({ id: 'u1' }, { sourceKind: 'object_storage', url: 'Uploaded file · khutbah.mp4' }));
  assert.equal(own.isYouTubeLink('Uploaded file · khutbah.mp4'), false);
  assert.equal(own.isYouTubeLink(LINK), true);
});

test('with no Data API key it refuses rather than waving links through', async () => {
  connect('u1', [MINE]);
  const key = config.youtubeDataApiKey;
  config.youtubeDataApiKey = '';
  const restore = stubYouTube({ channelId: MINE });
  try {
    await assert.rejects(() => own.assertOwnsVideo({ id: 'u1' }, LINK), error => {
      // Not "try again" -- the deployment cannot verify ownership at all, so
      // the message names the only route that needs no verification.
      assert.match(error.message, /unavailable on this deployment/i);
      assert.match(error.message, /Upload MP4/i);
      assert.ok(error.message.length <= 125, `too long for the dock: ${error.message.length}`);
      return true;
    });
  } finally { restore(); config.youtubeDataApiKey = key; }
});

test('the ENGINE refuses the submit, not just the module', async () => {
  // A perfect gate that nothing calls is not a gate. This drives the real
  // submitVideo, which is the one funnel every link passes through.
  const engine = await import('../src/local-engine.js');
  connect('u1', [MINE]);
  const restore = stubYouTube({ channelId: THEIRS, title: 'Another Channel' });
  try {
    await assert.rejects(() => engine.submitVideo(LINK, 'A', 'u1', {}), /which you have not connected/i);
  } finally { restore(); }
});

test('the engine records the channel that authorised an import', async () => {
  const engine = await import('../src/local-engine.js');
  connect('u1', [MINE]);
  const restore = stubYouTube({ channelId: MINE });
  try {
    const projectId = await engine.submitVideo(LINK, 'A', 'u1', {});
    const project = state.projects.find(item => item.id === projectId);
    // A re-run reads this instead of asking YouTube again.
    assert.equal(project.sourceChannelId, MINE);
  } finally { restore(); }
});
