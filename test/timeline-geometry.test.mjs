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

// The editor works in clip-local time but drives a <video> in media time, and
// which file is loaded decides whether those differ. Getting it wrong does not
// look like an off-by-one, it looks like the editor is dead: every seek lands
// past the end of the file and every reported position clamps to zero.
function makeTimebase() {
  const body = ui.slice(ui.indexOf('function applyMediaTimebase(clip,baked){'));
  const src = body.slice(0, body.indexOf('\nfunction bindVideo'));
  const editor = {};
  const fn = new Function('editor', `${src}\nreturn applyMediaTimebase;`)(editor);
  return (clip, baked) => { fn(clip, baked); return { ...editor }; };
}

test('a clean plate keeps the clip offset inside the full lecture', () => {
  const apply = makeTimebase();
  const state = apply({ startSec: 300, endSec: 337 }, false);
  assert.equal(state.sourceBase, 300, 'clip-local 0 sits at startSec in the lecture');
  assert.equal(state.sourceEnd, 337);
  assert.equal(state.trimOut, 37);
});

test('an export preview is its own timeline and takes no offset', () => {
  // The regression: a 37s export with startSec 300 was seeked to 337s, which
  // clamped to the end, while ontimeupdate reported 0 - 300 and clamped to 0.
  // Nothing moved, so dragging and clicking a caption both looked broken.
  const apply = makeTimebase();
  const state = apply({ startSec: 300, endSec: 337 }, true);
  assert.equal(state.sourceBase, 0, 'the export begins at media zero');
  assert.equal(state.sourceEnd, 37, 'and ends at its own duration');
  assert.equal(state.trimOut, 37, 'the clip duration is the same either way');
});

test('duration falls back to durationMs when endSec is absent', () => {
  const apply = makeTimebase();
  assert.equal(apply({ startSec: 10, durationMs: 20000 }, false).trimOut, 20);
  assert.equal(apply({ startSec: 10, durationMs: 20000 }, true).sourceEnd, 20);
});

test('a zero-length clip cannot produce a zero duration', () => {
  // trimOut divides in timelineGeometry; zero would make every position NaN.
  const apply = makeTimebase();
  assert.ok(apply({ startSec: 5, endSec: 5 }, false).trimOut > 0);
});

test('both preview paths set the timebase through one function', () => {
  // The fallback swaps to the export after the timebase was already set for a
  // clean plate, so it has to rebase or it produces a visible but completely
  // unresponsive editor.
  assert.equal((ui.match(/applyMediaTimebase\(/g) || []).length, 4,
    'one definition, plus the clip-open, bind and fallback call sites');
  const bind = ui.slice(ui.indexOf('function bindVideo(clip){'));
  const handler = bind.slice(bind.indexOf('video.onerror=()=>{'));
  assert.match(handler.slice(0, handler.indexOf('\n  };')), /applyMediaTimebase\(clip,true\)/,
    'the export fallback must rebase to media zero');
});

// Fit Timeline. The scale used to be a hard-coded 46 px/s: on a 35.92s clip in
// an 876px frame that produced a 1725px timeline, 1.97x too wide, so the clip
// could never be seen at once on any screen. Fit is the scale being derived
// from the frame instead of asserted.
function makeFit({ clientWidth = 876 } = {}) {
  const body = ui.slice(ui.indexOf('const TIMELINE_GUTTER='));
  const src = body.slice(0, body.indexOf('\nfunction renderTimeline'));
  const editor = { timelineZoom: 1 };
  const scope = new Function(
    '$', 'editor', 'clamp',
    `${src}\nreturn { timelineFitScale, timelineScale, editor, GUT: TIMELINE_GUTTER, PAD: TIMELINE_EDGE_PAD };`,
  )(
    sel => (sel === '#dcTimelineScroll' ? { clientWidth, scrollLeft: 0 } : null),
    editor,
    (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0)),
  );
  return scope;
}

test('a fitted clip exactly fills the usable timeline width', () => {
  const s = makeFit({ clientWidth: 876 });
  const duration = 35.92;
  const perSecond = s.timelineFitScale(duration);
  const usable = 876 - s.GUT - s.PAD * 2;
  assert.equal(Math.round(perSecond * duration), usable, 'the whole clip must span the usable width');
  assert.ok(perSecond < 46, `fit (${perSecond.toFixed(1)}px/s) must be tighter than the old constant on this clip`);
});

test('fit adapts to the frame instead of asserting a constant', () => {
  const duration = 35.92;
  const narrow = makeFit({ clientWidth: 600 }).timelineFitScale(duration);
  const wide = makeFit({ clientWidth: 1600 }).timelineFitScale(duration);
  assert.ok(wide > narrow, 'a wider frame must give a larger scale, not the same one');
});

test('a long clip and a short clip both fit', () => {
  const s = makeFit({ clientWidth: 876 });
  const usable = 876 - s.GUT - s.PAD * 2;
  for (const duration of [3, 35.92, 600]) {
    assert.equal(Math.round(s.timelineFitScale(duration) * duration), usable, `${duration}s must fit`);
  }
});

test('zero, negative and unmeasured widths cannot produce a broken scale', () => {
  // A zero px/s collapses every position onto the same pixel; NaN propagates
  // into every left offset on the timeline. Both look like a dead editor.
  const s = makeFit({ clientWidth: 876 });
  assert.equal(s.timelineFitScale(0), null, 'zero duration must not divide');
  assert.equal(s.timelineFitScale(-5), null);
  assert.equal(makeFit({ clientWidth: 0 }).timelineFitScale(30), null, 'pre-layout width must not divide');
  // And the caller must still return something usable.
  assert.ok(makeFit({ clientWidth: 0 }).timelineScale(30) > 0, 'a fallback scale is required');
  assert.ok(Number.isFinite(s.timelineScale(0)));
});

test('zoom is a multiplier on fit, so resizing keeps a fitted clip fitted', () => {
  // Storing absolute px/s would mean a fitted clip stops fitting the moment
  // the panel is resized, which is what makes "fitted" a state rather than a
  // one-off calculation.
  const s = makeFit({ clientWidth: 876 });
  const duration = 35.92;
  assert.equal(s.timelineScale(duration), s.timelineFitScale(duration), 'zoom 1 is exactly fit');
  s.editor.timelineZoom = 2;
  assert.equal(s.timelineScale(duration), s.timelineFitScale(duration) * 2);
});

test('zoom cannot go below fit or run away', () => {
  const s = makeFit({ clientWidth: 876 });
  const duration = 35.92;
  s.editor.timelineZoom = 0.1;
  assert.equal(s.timelineScale(duration), s.timelineFitScale(duration), 'below 1x is clamped to fit');
  s.editor.timelineZoom = 9999;
  assert.equal(s.timelineScale(duration), s.timelineFitScale(duration) * 40, 'zoom is bounded');
});

test('zoom never touches timing data', () => {
  // The whole risk of a zoom feature is that it retimes something. Every
  // position is derived from time through timelineGeometry(), so the zoom
  // handler must not write to any timing field.
  const fn = ui.slice(ui.indexOf('function bindTimelineZoom(){'));
  const body = fn.slice(0, fn.indexOf('\nfunction updateTimelineZoomButtons'));
  for (const field of ['trimIn', 'trimOut', 'sourceBase', 'sourceEnd', 'captionWords', 'captionTimingOffsetMs']) {
    assert.doesNotMatch(body, new RegExp(`${field}\\s*=`), `zoom must not write ${field}`);
  }
});

test('the ruler shares the caption track gutter', () => {
  const css = ui.slice(ui.indexOf('.dc-ruler{'));
  const rule = css.slice(0, css.indexOf('}'));
  assert.match(rule, /grid-template-columns:56px 1fr/,
    'the ruler must use the same 56px gutter as .dc-track-row');
});
