import assert from 'node:assert/strict';
import test from 'node:test';
import { silenceSpans, wordsForClip } from '../src/captions.js';

test('clip captions retain exact Whisper word timings and trim the clip edges', () => {
  const segments = [{ words: [
    { start: 9.8, end: 10.2, word: 'Before' },
    { start: 10.4, end: 10.8, word: 'Allah' },
    { start: 12.1, end: 12.5, word: 'After' },
  ] }];
  assert.deepEqual(wordsForClip(segments, 10, 12.3), [
    { start: 0, end: 0.1999999999999993, word: 'Before' },
    { start: 0.40000000000000036, end: 0.8000000000000007, word: 'Allah' },
    { start: 2.0999999999999996, end: 2.3000000000000007, word: 'After' },
  ]);
});

test('silence spans cover every gap where captions must disappear', () => {
  const words = [
    { start: 0.2, end: 0.5, word: 'One' },
    { start: 0.58, end: 0.9, word: 'two' },
    { start: 1.6, end: 1.9, word: 'three' },
  ];
  assert.deepEqual(silenceSpans(words, 2.5, 0.35), [
    { start: 0.9, end: 1.6 },
    { start: 1.9, end: 2.5 },
  ]);
});
