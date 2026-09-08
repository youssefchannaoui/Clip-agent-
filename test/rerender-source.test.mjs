import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Re-rendering a clip from a lecture that was imported from a link failed with
// "The uploaded video reference is invalid" — a message about uploads, on a job
// that never involved one. Both the re-render and more-clips payloads hardcoded
// an object_storage source, and sourceObjectKey is only ever set for uploads.

const engine = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');

test('a remote job picks its source rather than assuming an upload', () => {
  const fn = /function remoteSourceFor\(project\) \{[\s\S]*?\n\}/.exec(engine)[0];
  assert.match(fn, /project\?\.sourceObjectKey/, 'an upload is used when there is one');
  assert.match(fn, /type: 'youtube', url/, 'and the link otherwise');
  // Neither available is a real dead end and must say so plainly.
  assert.match(fn, /no source left to work from/);
});

test('neither payload hardcodes an object_storage source any more', () => {
  const hardcoded = engine.match(/source: \{ type: 'object_storage', objectKey: project\.sourceObjectKey/g) || [];
  assert.deepEqual(hardcoded, [], 'both call sites go through the helper');
  assert.equal((engine.match(/source: remoteSourceFor\(project\)/g) || []).length, 2,
    're-render and more-clips');
});

test('an upload is preferred over re-downloading the link', () => {
  // The upload is the exact bytes the clips were cut from; a re-download can
  // differ if the video was re-encoded or replaced.
  const fn = /function remoteSourceFor\(project\) \{[\s\S]*?\n\}/.exec(engine)[0];
  const uploadAt = fn.indexOf('sourceObjectKey');
  const linkAt = fn.indexOf("type: 'youtube'");
  assert.ok(uploadAt > -1 && linkAt > uploadAt, 'the upload branch comes first');
});

test('a lecture with a link is no longer refused before it starts', () => {
  // The guards required an upload, so they rejected exactly the lectures the
  // helper can now handle.
  assert.match(engine, /project\.engine === 'remote' && \(project\.sourceObjectKey \|\| project\.url\)/);
  assert.equal((engine.match(/\(project\.sourceObjectKey \|\| project\.url\)/g) || []).length, 2,
    'both guards');
});

// ── YouTube refusing the download ──────────────────────────────────────────

const providers = fs.readFileSync(new URL('../worker/import_providers.py', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker/clip_worker.py', import.meta.url), 'utf8');

test('a 403 is retried against other clients rather than surfaced', () => {
  // YouTube rejects the media URLs some clients hand out. A 403 on the video
  // data means "not from that client", not "no video".
  for (const [name, source] of [['import_providers', providers], ['clip_worker', worker]]) {
    assert.match(source, /YOUTUBE_CLIENTS = \[None, "android_vr", "ios", "web_safari", "tv"\]/, name);
    assert.match(source, /player_client/, `${name} passes the client through`);
  }
});

test('only a block is retried, not a video that is simply gone', () => {
  // A private or deleted video fails the same way on every client, in every
  // round; walking the list just makes the user wait longer for the same
  // answer -- and once the rotation gained a backoff, waiting through it too.
  //
  // THIS PINNED THE EXPRESSION, NOT THE PROPERTY, and went red against a
  // refactor that changed no behaviour: the one condition
  // `not _looks_blocked(message) or attempt == last` became two branches when
  // rounds were added, because a block and an exhausted rotation now do
  // different things. Thirteenth time in this repo. What it protects is
  // DRIVEN in test/test_import_retry.py, which asserts a gone video costs
  // exactly one attempt and no wait at all; this keeps the cheap structural
  // half CI can see without a fake yt-dlp.
  assert.match(providers, /if not _looks_blocked\(message\):/,
    'a non-block is decided on its own, separately from the rotation ending');
  assert.match(providers, /"http error 403", "forbidden"/);
});

test('the failure names what was tried and what to do about it', () => {
  // "HTTP Error 403" alone reads as a broken product. Every client failing is
  // the signature of a blocked IP, so the advice is a proxy, cookies, or
  // uploading — not another rebuild, which is where this pointed until a
  // rebuild had already been done and changed nothing.
  for (const [name, source] of [['import_providers', providers], ['clip_worker', worker]]) {
    assert.match(source, /VIDEO_IMPORT_PROXY/, `${name} offers a way past a block`);
    assert.match(source, /Uploading the MP4|Uploading the MP4 avoids/, `${name} offers the way round YouTube`);
    assert.match(source, /Attempts: /, `${name} lists the clients tried`);
  }
});

test('cancelling still wins over retrying', () => {
  // Otherwise a cancelled job walks all five clients before stopping -- and
  // now also sleeps through the backoff between rounds, holding a worker slot
  // the app has already given back.
  //
  // Bounded to the attempt loop itself. It used to run to the final
  // `raise ImportProviderError(_download_failure`, which moved OUT of the loop
  // when rounds were added -- so the window silently grew to most of the
  // function and the two assertions below became trivially true of it.
  const loop = /for attempt, client in enumerate\(YOUTUBE_CLIENTS\):[\s\S]*?if attempt == len\(YOUTUBE_CLIENTS\) - 1:/.exec(providers);
  assert.ok(loop, 'the attempt loop is still findable');
  assert.match(loop[0], /if cancelled\(\):/);
  assert.match(loop[0], /"cancelled" in message\.lower\(\)/);
  // And the wait between rounds is cancellable, which is where a cancel now
  // spends most of its time.
  assert.match(providers, /def _wait_before_retry/);
  assert.match(providers, /if not _wait_before_retry\(delay, cancelled\):/);
});
