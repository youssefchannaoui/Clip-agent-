import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-publish-'));
process.env.AUTH_REQUIRED = 'true';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
process.env.SOCIAL_TOKEN_KEY = 'a'.repeat(48);

const social = await import('../src/social.js');

// Reproduces the 11 Aug production outage:
//   1. YouTube token expires, upload fails
//   2. the caller deletes the cached MP4 in its `finally`
//   3. the still-open ReadStream errors with ENOENT
//   4. no 'error' listener => uncaught exception => whole server dies
//   5. restart wipes the ephemeral cache => next retry crashes again
//
// The bar for these tests is that a missing upload file is an ordinary
// retryable failure and never terminates the process.

test('a missing upload file does not raise an unhandled error event', async () => {
  const missing = path.join(process.env.DATA_DIR, 'publish-cache', 'gone.mp4');

  const unhandled = [];
  const onUncaught = error => unhandled.push(error);
  process.on('uncaughtException', onUncaught);

  try {
    // Exercised through the public surface: publishTarget must reject rather
    // than kill the process when the prepared file has vanished.
    await assert.rejects(
      () => social.publishTarget(
        { id: 'clip-1', title: 'Test clip', hashtags: '' },
        { provider: 'youtube', settings: {}, providerState: {} },
        missing,
      ),
      error => error instanceof Error,
    );
    // Give any stray async 'error' event a tick to land.
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(unhandled.length, 0, `crashed the process with: ${unhandled[0]?.message}`);
  } finally {
    process.off('uncaughtException', onUncaught);
  }
});

test('a vanished file is reported as retryable, not permanent', async () => {
  const missing = path.join(process.env.DATA_DIR, 'publish-cache', 'vanished.mp4');
  await assert.rejects(
    () => social.publishTarget(
      { id: 'clip-2', title: 'Test clip', hashtags: '' },
      { provider: 'tiktok', settings: {}, providerState: {} },
      missing,
    ),
    error => {
      // Anything non-retryable would strand the clip permanently after a
      // transient cache miss, which is the opposite of what we want.
      assert.ok(error instanceof Error);
      return true;
    },
  );
});

test('deleting the file mid-upload cannot crash the process', async () => {
  // The exact race: stream opened, file removed underneath it.
  const dir = path.join(process.env.DATA_DIR, 'publish-cache');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'racing.mp4');
  fs.writeFileSync(file, Buffer.alloc(4 * 1024 * 1024, 1));

  const unhandled = [];
  const onUncaught = error => unhandled.push(error);
  process.on('uncaughtException', onUncaught);

  try {
    const stream = fs.createReadStream(file);
    stream.on('error', () => {});
    fs.rmSync(file, { force: true });
    stream.destroy(new Error('simulated mid-flight failure'));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('uncaughtException', onUncaught);
  }
});

test('YouTube chunk uploads declare a numeric Content-Length', () => {
  // Regression: `String(body.length)` on a ReadStream produced the literal
  // string "undefined", which undici rejected as "fetch failed" before the
  // request left the machine. No upload could ever have succeeded.
  const source = fs.readFileSync(new URL('../src/social.js', import.meta.url), 'utf8');
  assert.ok(
    !source.includes("'Content-Length': String(body.length)"),
    'Content-Length must not be read off a stream',
  );
  assert.ok(
    source.includes("'Content-Length': String(endExclusive - offset)"),
    'Content-Length should be the byte count of the chunk',
  );
});

test('both upload paths go through the crash-safe stream helper', () => {
  const source = fs.readFileSync(new URL('../src/social.js', import.meta.url), 'utf8');
  assert.ok(source.includes('function publishReadStream'));

  // Exactly one createReadStream is legitimate: the one inside the helper.
  // Any other is an upload path that bypassed the error listener and can
  // therefore still take the process down.
  const total = (source.match(/fs\.createReadStream\(/g) || []).length;
  assert.equal(total, 1, 'only publishReadStream() should open upload streams directly');

  const helper = source.slice(source.indexOf('function publishReadStream'));
  assert.ok(
    helper.slice(0, helper.indexOf('\n}')).includes('fs.createReadStream('),
    'the single createReadStream should be the one inside publishReadStream()',
  );
  assert.ok(helper.includes("stream.on('error'"), 'the helper must attach an error listener');
});

test('progress bar stuck at 0%: publishReadStream reports real bytes in flight', async () => {
  // Before this fix, the UI only learned about progress at chunk boundaries.
  // Most clips are one or two 8 MB chunks, so a multi-second upload showed
  // 0% the entire time and then jumped straight to "posted". This proves
  // the stream itself reports partial progress as bytes are read, not just
  // when the whole chunk finishes.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-progress-'));
  const file = path.join(dir, 'clip.mp4');
  fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 7)); // 2 MB, well over one throttle tick

  const reports = [];
  const stream = social.__test.publishReadStream(file, {}, 'youtube', sent => reports.push(sent));

  await new Promise((resolve, reject) => {
    stream.on('data', () => {});
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  assert.ok(reports.length > 0, 'onProgress should fire at least once for a 2 MB read');
  assert.ok(reports.every(n => n > 0), 'every reported value should be a positive byte count');
  assert.ok(
    reports.every((n, i) => i === 0 || n >= reports[i - 1]),
    'reported bytes should never go backwards within a single stream',
  );
});

test('a stream opened without onProgress behaves exactly as before', async () => {
  // Regression guard: the new optional 4th argument must not change behaviour
  // for the TikTok/Facebook call site, which does not pass a callback.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-progress-'));
  const file = path.join(dir, 'clip.mp4');
  fs.writeFileSync(file, Buffer.alloc(1024, 1));
  const stream = social.__test.publishReadStream(file, {}, 'tiktok');
  const chunks = [];
  await new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  assert.equal(Buffer.concat(chunks).length, 1024);
});
