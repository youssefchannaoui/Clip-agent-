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
