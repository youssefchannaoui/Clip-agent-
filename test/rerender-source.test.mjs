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
  // A private or deleted video fails the same way on every client; walking the
  // list just makes the user wait longer for the same answer.
  assert.match(providers, /if not _looks_blocked\(message\) or attempt == len\(YOUTUBE_CLIENTS\) - 1:/);
  assert.match(providers, /"http error 403", "forbidden"/);
});

test('the failure names what was tried and what usually fixes it', () => {
  // "HTTP Error 403" alone reads as a broken product. An out-of-date yt-dlp is
  // the usual cause and a rebuild is the usual fix.
  for (const [name, source] of [['import_providers', providers], ['clip_worker', worker]]) {
    assert.match(source, /rebuild the worker to pick up the current/, name);
    assert.match(source, /Attempts: /, `${name} lists the clients tried`);
  }
});

test('cancelling still wins over retrying', () => {
  // Otherwise a cancelled job walks all five clients before stopping.
  const loop = /for attempt, client in enumerate\(YOUTUBE_CLIENTS\):[\s\S]*?raise ImportProviderError\(_download_failure/.exec(providers)[0];
  assert.match(loop, /if cancelled\(\):/);
  assert.match(loop, /"cancelled" in message\.lower\(\)/);
});
