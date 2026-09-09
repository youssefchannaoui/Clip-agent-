/**
 * Pressing Start job does something immediately.
 *
 * Youssef, 9 Sept 2026: "it takes a little bit more time for it to pop up. So
 * either add a loading screen, like a pop up loading screen, or that same page
 * that pops up, but in a loading screen or something just to know that
 * something is loading."
 *
 * The wait is real and is not a fault: since v3.182.0 the title, length and
 * thumbnail are read by the BOX -- yt-dlp through the residential pool --rather
 * than by asking Google's API about somebody else's video, which is what the
 * data-access refusal was about. It is also the same request the download will
 * make, so a link the box cannot reach is refused here instead of at the front
 * of the queue. What was wrong is that the panel waited for it in silence.
 *
 * The first step is the brief, which does not depend on the source at all, so
 * this is the panel arriving usable rather than a spinner in front of one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

await import('../src/public/studio-runtime.js');
await import('../src/public/studio-template.generated.js');
await import('../src/public/safe-zones.js');
await import('../src/public/studio-adapter.js');
const { StudioAdapter } = globalThis;

const DATA = { projects: [], clips: [], tracks: [], templates: [] };
const view = () => StudioAdapter.bindings(DATA);
const URL_A = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const URL_B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';

test('the panel is open and named before the box has answered', () => {
  StudioAdapter.beginJob(URL_A);
  const v = view();
  assert.equal(v.jobOpen, true, 'the panel opens on the press, not on the answer');
  assert.equal(v.jobProbing, true);
  assert.match(v.jobSourceLabel, /Reading the link/,
    'it says it is reading rather than showing the raw URL as a title');
  assert.equal(v.jobStepNumber ?? v.jobStep ?? 1, 1);
  // "Whole lecture" is a decision; nothing has been decided yet.
  assert.doesNotMatch(v.jobRangeLabel, /Whole lecture/);
});

test('the answer fills the panel in and leaves the customer alone', () => {
  StudioAdapter.beginJob(URL_A);
  // Somebody is already typing a brief on step 1 while the lookup runs. That
  // is the whole reason the panel opens early, so the answer must not reset
  // it: openJob clears the brief, the step and every choice, which is right
  // for a NEW job and wrong for a lookup coming back.
  StudioAdapter.ui.jobBrief = 'the parts about repentance';
  StudioAdapter.ui.jobStep = 2;

  StudioAdapter.resolveJob({ url: URL_A, title: 'A lecture', durationSec: 1800, thumbnail: 'https://i/x.jpg' });
  const v = view();
  assert.equal(v.jobProbing, false);
  assert.equal(v.jobSourceLabel, 'A lecture');
  assert.equal(StudioAdapter.ui.jobBrief, 'the parts about repentance', 'the typing survives');
  assert.equal(StudioAdapter.ui.jobStep, 2, 'the step survives');
  assert.match(v.jobRangeLabel, /0:00/, 'the range picker opens against the real length');
});

test('a stale answer cannot reopen or overwrite', () => {
  // Pasted, then closed. An answer arriving afterwards must not put a panel
  // back in front of somebody who dismissed it.
  StudioAdapter.beginJob(URL_A);
  StudioAdapter.jobDone();
  StudioAdapter.resolveJob({ url: URL_A, title: 'Too late', durationSec: 60 });
  assert.equal(view().jobOpen, false);

  // Pasted, then a SECOND link pasted while the first was still being read.
  StudioAdapter.beginJob(URL_A);
  StudioAdapter.beginJob(URL_B);
  StudioAdapter.resolveJob({ url: URL_A, title: 'The first link', durationSec: 60 });
  assert.match(view().jobSourceLabel, /Reading the link/, 'the second link is still the one being read');
  StudioAdapter.resolveJob({ url: URL_B, title: 'The second link', durationSec: 120 });
  assert.equal(view().jobSourceLabel, 'The second link');
});

test('a link that could not be read closes the panel', () => {
  StudioAdapter.beginJob(URL_A);
  StudioAdapter.failJob(URL_A);
  assert.equal(view().jobOpen, false, 'the panel does not sit on a lecture that does not exist');
  // And a failure for a link nobody is waiting on any more leaves the current
  // one alone.
  StudioAdapter.beginJob(URL_B);
  StudioAdapter.failJob(URL_A);
  assert.equal(view().jobOpen, true);
  StudioAdapter.jobDone();
});

test('the host opens the panel BEFORE it waits on the network', async () => {
  // A source test on purpose, and for the reason `dc-nav-tail` and
  // `overflow-anchor` are: CI has no browser, and this is exactly the shape
  // that is invisible when it breaks. Move the call below the await and the
  // app renders, the suite stays green, and pressing Start job goes back to
  // doing nothing for several seconds.
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const at = page.indexOf('StudioAdapter.onProbeSource=');
  assert.ok(at > -1, 'the handler is still here');
  const body = page.slice(at, page.indexOf('};', at));
  const opens = body.indexOf('beginJob(');
  const waits = body.indexOf("await api('/api/source-info'");
  assert.ok(opens > -1, 'the panel is opened');
  assert.ok(waits > -1, 'the lookup is still made');
  assert.ok(opens < waits, 'and it is opened before the wait, not after it');
  assert.ok(body.includes('resolveJob('), 'the answer fills the open panel in');
  assert.ok(body.includes('failJob('), 'and a link that cannot be read closes it');
});
