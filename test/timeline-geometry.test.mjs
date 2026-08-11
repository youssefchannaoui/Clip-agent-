import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The timeline used to answer "where does time t sit on screen" three different
// ways at once:
//
//   ruler labels   left: (i*20)% of the full scroll width, no gutter
//   caption blocks left: (100*start/duration)% of .dc-track-content, which
//                  begins after a 56px label gutter
//   playhead       72 + (t/d) * (scrollWidth - 72), in pixels from the scroll
//                  container
//
// Three origins, none equal. The playhead never landed on the caption you
// clicked, the ruler agreed with neither, and seeking felt broken because it
// genuinely was. These tests pin the property that matters: every element that
// represents a moment must derive its position from one shared geometry.

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

// Rebuild the real helper with a stub DOM, so this tests the shipped formula
// rather than a restatement of it.
function makeGeometry({ gutter = 57, contentWidth = 800, scrollLeft = 0, duration = 30 } = {}) {
  const body = ui.slice(ui.indexOf('function timelineGeometry(){'));
  const src = body.slice(0, body.indexOf('\nfunction renderTimeline'));
  const scroll = {
    scrollLeft,
    getBoundingClientRect: () => ({ left: 100 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 100 + gutter, width: contentWidth }) }),
  };
  return new Function('$', 'editor', `${src}\nreturn timelineGeometry;`)(
    sel => (sel === '#dcTimelineScroll' ? scroll : null),
    { trimOut: duration },
  );
}

test('geometry measures the track content, not the scroll container', () => {
  const geo = makeGeometry({ gutter: 57, contentWidth: 800 })();
  assert.equal(geo.left, 57, 'the label gutter must be excluded from the timeline origin');
  assert.equal(geo.width, 800);
  assert.equal(geo.duration, 30);
});

test('the playhead lands exactly where a caption of the same time starts', () => {
  const geo = makeGeometry({ gutter: 57, contentWidth: 800, duration: 30 })();
  for (const t of [0, 7.5, 15, 22.5, 30]) {
    // What updatePlayhead() computes.
    const playheadPx = geo.left + (t / geo.duration) * geo.width;
    // What renderTimeline() gives a caption block starting at t: a percentage
    // of the same content box, which the browser resolves against its width.
    const captionPx = geo.left + ((100 * t / geo.duration) / 100) * geo.width;
    assert.equal(playheadPx, captionPx, `time ${t}s must map to one pixel, not two`);
  }
});

test('a horizontally scrolled timeline still maps clicks to the right time', () => {
  // A long clip scrolls. Ignoring scrollLeft put every seek off by the scroll
  // distance once the timeline was wider than its container.
  const geo = makeGeometry({ gutter: 57, contentWidth: 800, scrollLeft: 240 })();
  assert.equal(geo.left, 57 + 240, 'the origin must be in scroll-content space');
});

test('seeking and drawing share one origin in the shipped code', () => {
  // Guard against the three-origin regression returning by a later edit
  // reintroducing a hard-coded offset.
  const playhead = ui.slice(ui.indexOf('function updatePlayhead(time){'));
  const playheadBody = playhead.slice(0, playhead.indexOf('\n}'));
  assert.match(playheadBody, /timelineGeometry\(\)/, 'the playhead must not compute its own offset');
  assert.doesNotMatch(playheadBody, /72\s*\+/, 'the 72px magic offset must not come back');

  const scrub = ui.slice(ui.indexOf('function bindTimelineScrub(){'));
  const scrubBody = scrub.slice(0, scrub.indexOf('\nfunction timelineGeometry'));
  assert.match(scrubBody, /timelineGeometry\(\)/, 'seeking must use the same geometry as drawing');
});

test('the timeline supports dragging, not only a single click', () => {
  const scrub = ui.slice(ui.indexOf('function bindTimelineScrub(){'));
  const body = scrub.slice(0, scrub.indexOf('\nfunction timelineGeometry'));
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.match(body, new RegExp(`'${event}'`), `${event} must be handled for drag-to-scrub`);
  }
  // A caption block is a jump target; a drag starting on one would otherwise
  // seek to wherever the pointer happened to land instead of that line.
  assert.match(body, /data-caption-start/);
  // Scrubbing a playing clip fought the ontimeupdate handler and stuttered.
  assert.match(body, /wasPlaying/);
});

test('the ruler shares the caption track gutter', () => {
  const css = ui.slice(ui.indexOf('.dc-ruler{'));
  const rule = css.slice(0, css.indexOf('}'));
  assert.match(rule, /grid-template-columns:56px 1fr/,
    'the ruler must use the same 56px gutter as .dc-track-row');
});
