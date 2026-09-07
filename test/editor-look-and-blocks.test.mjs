import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * TWO FAULTS FOUND BY OPENING THE EDITOR AND USING IT, both invisible to a
 * green suite and to anyone reading the code.
 *
 * The editor is behind the coming-soon gate, so nobody had driven it since the
 * section cuts landed. Un-gated locally and clicked through, it had these:
 *
 *   1. THE TIMELINE'S OWN HINT WAS A LIE FROM FOUR OF THE FIVE TABS.
 *      "Click a caption block to edit its words" -- and the words DO load, into
 *      the Captions panel, which is not on screen unless that tab happened to
 *      be the one showing. From Framing, Audio, Look or Export the block took
 *      its gold outline and nothing else moved: a dead control (invariant 9) on
 *      the one gesture the timeline advertises.
 *
 *   2. THE LOOK TAB WAS MISSING THE LOOKS. v3.118.0 gave Templates twelve
 *      graded looks and four weather effects with their strength and a darken
 *      slider; the editor's Look tab predates it and offered grain, warmth,
 *      vignette and the watermark. So the screen actually named "Look" was the
 *      one place the look controls were missing, and per CLIP they could not be
 *      reached at all.
 *
 * Both are driven here rather than grepped -- `select()` is CALLED and the
 * control rows are READ -- because this repo has been caught seven times by a
 * source test passing against a behaviour that had changed underneath it.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const sandbox = {
  window: {},
  document: {
    addEventListener() {},
    querySelectorAll: () => [],
    getElementById: () => null,
    querySelector: () => null,
  },
  innerWidth: 1440,
  innerHeight: 950,
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  localStorage: {
    getItem: () => null, setItem() {}, removeItem() {},
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('src/public/safe-zones.js'), sandbox);
vm.runInContext(read('src/public/studio-adapter.js'), sandbox);
const A = sandbox.StudioAdapter;

// One clip with real sentence timings, which is what makes the timeline draw
// blocks that can be clicked at all -- an untimed transcript takes a different
// branch and would not exercise the fault.
const SEGMENTS = [
  { start: 0, end: 3.2, text: 'The door does not close because you walked through it yesterday.' },
  { start: 3.2, end: 6.4, text: 'He is not waiting for you to run out of chances.' },
  { start: 6.4, end: 9.1, text: 'He is waiting for you to turn around.' },
];

const CLIP = {
  id: 'c1', userId: 'u1', projectId: 'p1', status: 'waiting',
  title: 'The door that never closes', addedAt: 1,
  startSec: 120, endSec: 129.1, durationSec: 9.1,
  templateId: 'clean-line', renderVersion: 2, renderQuality: 'final',
  videoUrl: 'https://media.example/clip.mp4',
  transcript: SEGMENTS.map((s) => s.text).join(' '),
  transcriptSegments: SEGMENTS,
};

const DATA = {
  clips: [CLIP],
  projects: [{ id: 'p1', userId: 'u1', title: 'A lecture', status: 'done' }],
  tracks: [], music: [], social: { providers: {} }, tasks: {},
};

function inEditor(tab) {
  Object.assign(A.ui, {
    screen: 'editor', edClipId: 'c1', edTab: tab,
    edBlock: 0, edBlockDraft: null, edStyleDraft: null,
    edTrim: null, edCutOuts: null, edCutMark: null, edTime: 0, edPlayhead: 0,
  });
  return A.bindings(DATA);
}

test('clicking a caption block opens the panel that edits it', () => {
  // The fault, exactly: standing on any tab but Captions, click a block.
  for (const from of ['framing', 'audio', 'look', 'export']) {
    const v = inEditor(from);
    const blocks = v.edCapBlocks || [];
    assert.ok(blocks.length >= 3, 'the timeline drew a block per timed segment');

    blocks[2].select({ preventDefault() {}, stopPropagation() {} });

    assert.equal(
      A.ui.edTab, 'captions',
      `from ${from}, selecting a block must reveal the Captions panel -- the timeline's `
      + 'hint promises the words become editable, and they are not on screen otherwise',
    );
    assert.equal(A.ui.edBlock, 2, 'and it is the block that was clicked');
  }
});

test('the selected block is the one the Captions panel edits', () => {
  // The other half: switching the tab is only worth anything if the panel is
  // then showing the clicked block's words rather than block 0's.
  const v = inEditor('export');
  v.edCapBlocks[2].select({ preventDefault() {}, stopPropagation() {} });
  const after = A.bindings(DATA);
  assert.match(
    String(after.edSelText || ''), /turn around/,
    'the panel edits the words of the block that was clicked',
  );
});

test('the editor Look tab carries the looks and the weather', () => {
  const v = inEditor('look');
  const rows = v.edLookControls || [];
  const fields = rows.map((r) => r.field);

  for (const field of ['filterPreset', 'overlayEffect', 'overlayDarken']) {
    assert.ok(
      fields.includes(field),
      `the editor's Look tab must reach ${field} -- it is on Templates and was `
      + 'unreachable per clip, which is the fault this pins',
    );
  }

  const look = rows.filter((r) => r.field === 'filterPreset')[0];
  assert.ok(look.opts.length >= 12, 'all twelve graded looks are offered, not a subset');
  const weather = rows.filter((r) => r.field === 'overlayEffect')[0];
  // Array.from first: these are built in the vm realm, so a strict deepEqual
  // rejects them on the prototype ("same structure but not reference-equal").
  assert.deepEqual(
    Array.from(weather.opts.map((o) => o.value)),
    ['none', 'rain', 'snow', 'dust', 'bokeh'],
    'the four weather effects come from the schema enum, so a new one appears here for free',
  );
});

test('it never draws a second slider for something the panel already has', () => {
  /*
   * Found by COUNTING the rendered rows in a browser rather than by reading the
   * group: passing `tplControlsFor().look` through whole put a second Grain,
   * Warmth and Vignette slider directly beneath the export's own three. Two
   * controls for one setting is the fault this repo has shipped three times
   * (two watermark positions, two onboarding systems, two tour buttons).
   */
  const rows = inEditor('look').edLookControls || [];
  for (const field of ['grain', 'warm', 'vignette']) {
    assert.ok(
      !rows.some((r) => r.field === field),
      `${field} is drawn by the design export's own Look panel -- adding it here `
      + 'is a second control for one setting',
    );
  }
});

test('the strength slider appears only once there is weather to strengthen', () => {
  // A control that cannot change anything must not be shown (invariant 9), and
  // the condition has to be the SAME one Templates uses or the two screens
  // disagree about when the slider is meaningful.
  const off = inEditor('look').edLookControls;
  assert.ok(
    !off.some((r) => r.field === 'overlayIntensity'),
    'with no atmosphere chosen there is no strength to set',
  );

  CLIP.styleOverrides = { overlayEffect: 'rain' };
  const on = inEditor('look').edLookControls;
  assert.ok(
    on.some((r) => r.field === 'overlayIntensity'),
    'choosing rain reveals its strength',
  );
  delete CLIP.styleOverrides;
});

test('the Look rows write to the clip, and the painter is wired like every other host panel', () => {
  /*
   * A SOURCE test on purpose for the second half: CI has no browser, and a host
   * panel dropped from paintStudio's list or missing `data-host-owned` fails
   * SILENTLY -- the app renders, the suite stays green, and the panel churns or
   * shifts every generated sibling on each repaint (v3.124.5).
   */
  const html = read('src/public/index.html');
  const painter = html.slice(html.indexOf('function paintEditorLook'));
  const body = painter.slice(0, painter.indexOf('\n}\n'));

  assert.match(body, /data-host-owned/, 'the patcher must skip it, or it shifts its siblings');
  assert.match(body, /dcSetHtml/, 'redrawn only when the markup changed, or focus is thrown out');
  // A hashed class is `.s` + a DIGIT + one or two more, `.s29` / `.s4j`. The
  // first cut of this matched `\.s[0-9a-z]{2,3}` and went red on `c.set(e)` --
  // requiring the digit is what tells a generated class from ordinary code.
  assert.ok(
    !/\.s[0-9][0-9a-z]{1,2}\b/.test(body),
    'it must not name a hashed class -- a design re-import renumbers every one',
  );

  const paint = html.slice(html.indexOf('function paintStudio'));
  assert.match(
    paint.slice(0, paint.indexOf('\n}\n')), /paintEditorLook\(vals\)/,
    'it runs from paintStudio, never from a MutationObserver (the v3.53.5 lesson)',
  );
});
