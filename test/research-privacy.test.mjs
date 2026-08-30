/*
 * The research module refuses before it invents.
 *
 * This exists so that when there IS enough data to publish something about
 * what happens to long lectures, the analysis is already written and already
 * privacy-checked -- rather than being improvised under the pressure of
 * wanting something to publish. That pressure is exactly when a sample of
 * eleven clips becomes "a study", and one of those would cost more credibility
 * than any link it earned.
 *
 * So the thresholds are tested as behaviour, not as constants.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as research from '../src/research.js';

const clipsOf = (n, opts = {}) => Array.from({ length: n }, (_, i) => ({
  status: opts.allApproved ? 'approved' : (i % 4 ? 'approved' : 'rejected'),
  startSec: 0,
  endSec: 20 + (i % 70),
  // Deliberately present, and deliberately never read by the module.
  title: `A lecture title that identifies someone ${i}`,
  transcript: 'words that must never reach a published figure',
  userId: `user_${i % 40}`,
}));

test('a thin sample is refused, with the number that is missing', () => {
  const thin = research.report({ clips: clipsOf(11), accounts: 40 });
  assert.equal(thin.ready, false);
  assert.equal(thin.have, 11);
  assert.equal(thin.need, research.MIN_SAMPLE);
  // The refusal has to be legible, or someone reads `ready: false` as a bug
  // and works around it.
  assert.match(thin.reason, /Needs 500 clips/);
});

test('a big sample from a handful of accounts is still refused', () => {
  // This is the failure mode that looks like success: 5,000 clips is plenty
  // of arithmetic, and if they came from three accounts it describes three
  // workflows. Publishing it as though it described the practice would be a
  // lie of framing rather than of arithmetic, which is harder to spot.
  const narrow = research.report({ clips: clipsOf(5000), accounts: 3 });
  assert.equal(narrow.ready, false);
  assert.match(narrow.reason, /accounts/);
  assert.match(narrow.reason, /one workflow, not a finding/);
});

test('with enough data it computes, and every number is derived', () => {
  const full = research.report({
    clips: clipsOf(600),
    projects: Array.from({ length: 60 }, () => ({ durationSec: 3600 })),
    accounts: 40,
  });
  assert.equal(full.ready, true);
  assert.equal(full.sample.clips, 600);
  // 3 of every 4 approved, so a keep rate of 75 and not a rounded guess.
  assert.equal(full.keepRate, 75);
  assert.ok(full.clipLength.medianSec > 0);
  assert.ok(full.sourceLength.medianMin > 0);
});

test('a bucket that describes one person is dropped, and the loss is reported', () => {
  // 400 clips at 30s and 6 unusual ones. The band holding six is a handful of
  // records and must not be published; silently dropping it would understate
  // the total, so the count of dropped records travels with the result.
  const clips = [
    ...Array.from({ length: 400 }, () => ({ status: 'approved', startSec: 0, endSec: 30 })),
    ...Array.from({ length: 6 }, () => ({ status: 'approved', startSec: 0, endSec: 200 })),
    ...Array.from({ length: 120 }, () => ({ status: 'rejected', startSec: 0, endSec: 30 })),
  ];
  const out = research.report({ clips, accounts: 40 });
  assert.equal(out.ready, true);
  assert.ok(!('over 90s' in out.clipLength.distribution), 'a six-record band must not be reported');
  assert.equal(out.clipLength.droppedForPrivacy, 6, 'what was dropped has to be visible');
});

test('nothing identifying can reach the result', () => {
  // The fixtures carry titles, transcripts and user ids on purpose. If any of
  // them appears in the output, the module read a field it must never read.
  const out = research.report({
    clips: clipsOf(600),
    projects: Array.from({ length: 60 }, () => ({ durationSec: 3600, title: 'Shaykh So-and-so on patience' })),
    accounts: 40,
  });
  const bytes = JSON.stringify(out);
  for (const leak of ['lecture title', 'transcript', 'user_', 'Shaykh', 'words that must never']) {
    assert.ok(!bytes.includes(leak), `"${leak}" reached the result`);
  }
});

test('a published result carries its own caveats', () => {
  // The limits travel in the payload, not only in a comment, so a caller
  // cannot present this as more than it is.
  const out = research.report({ clips: clipsOf(600), accounts: 40 });
  assert.ok(out.caveats.length >= 3);
  assert.ok(out.caveats.some(line => /computed from DeenClipped records only/.test(line)));
  assert.ok(out.caveats.some(line => /not short-form video in general/.test(line)));
});

test('the module is not wired to any route yet', async () => {
  // Deliberate: nothing may serve this until there is something true to serve.
  // The day that changes, this test changes with it and someone has to think
  // about it.
  const server = await import('node:fs').then(fs =>
    fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8'));
  assert.ok(!server.includes('research.js'),
    'research.js is exposed on a route; check MIN_SAMPLE is genuinely met before publishing');
});
