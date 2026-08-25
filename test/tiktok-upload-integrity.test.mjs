import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-tt-'));
process.env.SOCIAL_TOKEN_KEY = 'social-test-key-that-is-definitely-long-enough';
process.env.PUBLIC_BASE_URL = 'https://app.test';

const social = await import('../src/social.js');
const { tiktokChunks } = social.__test;

const MB = 1024 * 1024;

test('a small file is one chunk', () => {
  const plan = tiktokChunks(10 * MB);
  assert.equal(plan.count, 1);
  assert.deepEqual(plan.lengths, [10 * MB]);
});

test('every chunk but the last stays inside TikTok 5-64MB rule', () => {
  for (const size of [65 * MB, 100 * MB, 130 * MB, 640 * MB, 641 * MB, 1024 * MB]) {
    const { lengths } = tiktokChunks(size);
    assert.equal(lengths.reduce((a, b) => a + b, 0), size, `chunks must cover ${size} exactly`);
    lengths.slice(0, -1).forEach(length => {
      assert.ok(length >= 5 * MB && length <= 64 * MB, `${size}: middle chunk ${length} out of range`);
    });
    assert.ok(lengths.at(-1) <= 128 * MB, `${size}: final chunk too large`);
  }
});

test('an empty file is refused rather than uploaded', () => {
  assert.throws(() => tiktokChunks(0), /empty video/);
  assert.throws(() => tiktokChunks(NaN), /empty video/);
});

test('an absurd file is refused before a thousand requests are made', () => {
  assert.throws(() => tiktokChunks(100 * 1024 * MB), /too many/);
});

test('the chunk plan never leaves a gap or an overlap', () => {
  const { lengths } = tiktokChunks(300 * MB);
  let offset = 0;
  for (const length of lengths) {
    assert.ok(length > 0);
    offset += length;
  }
  assert.equal(offset, 300 * MB);
});
