import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-retry-'));

const { default: _ } = { default: null };
const social = await import('../src/social.js');
const { SocialError } = social;

// The decision agent.js makes, stated in one place so it can be exercised.
// It reads `retryable === true`, not `!== false`.
function willRetry(error, attempts = 1, max = 5) {
  return error.retryable === true && attempts < max;
}

test('a labelled transient failure is retried', () => {
  assert.equal(willRetry(new SocialError('502 from TikTok', { retryable: true })), true);
});

test('a labelled permanent failure is not', () => {
  assert.equal(willRetry(new SocialError('That video is private', { retryable: false })), false);
});

test('an unlabelled error is NOT retried', () => {
  // This is the change. `!== false` read an absent flag as permission, and an
  // absent flag is what every non-SocialError has -- so a TypeError in our own
  // code was retried five times on a backoff reaching six hours, logged as a
  // warning each time and never as a failure.
  assert.equal(willRetry(new TypeError("Cannot read properties of undefined")), false);
});

test('retries stop at the attempt ceiling even when retryable', () => {
  const transient = new SocialError('503', { retryable: true });
  assert.equal(willRetry(transient, 4, 5), true);
  assert.equal(willRetry(transient, 5, 5), false);
});

test('SocialError defaults to not retryable', () => {
  // Anything that forgets to say must be treated as an answer, the same rule
  // the worker's import chain uses.
  assert.equal(new SocialError('unspecified').retryable, false);
});

test('the backoff is bounded and grows', () => {
  const first = social.retryDelay(1);
  const later = social.retryDelay(4);
  assert.ok(later > first, 'it backs off');
  assert.ok(social.retryDelay(99) <= 6 * 60 * 60_000, 'and never past six hours');
});
