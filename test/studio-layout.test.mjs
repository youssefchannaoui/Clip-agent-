import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Layout rules that were wrong in shipped screenshots.
 *
 * Each of these is anchored to a defect someone could see: badges sitting on
 * top of burned-in captions, action rows at a different height in every card,
 * a running batch drawing outside its own rounded panel. They assert the CSS
 * that fixes them still exists, because all of it lives in one override layer
 * that later work will be tempted to reorganise.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'src', 'public', 'studio-v6.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');

/** The declarations inside a selector's rule block, whitespace-normalised. */
function ruleFor(selector) {
  const index = css.indexOf(selector);
  assert.notEqual(index, -1, `no rule found for ${selector}`);
  const open = css.indexOf('{', index);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close).replace(/\s+/g, ' ').trim();
}

test('the activity dock clips its contents to its own rounded corners', () => {
  // `overflow:visible` on a 20px-radius panel let job rows, their progress
  // bars and the live dot's glow draw outside the box during a batch.
  const rule = ruleFor('body.dc-app #dcWork {');
  assert.match(rule, /overflow:\s*hidden/, 'the dock must clip its contents');
  assert.doesNotMatch(rule, /overflow:\s*visible/);
  assert.match(rule, /border-radius:\s*20px/, 'radius and clipping have to agree');
});

test('clip badges occupy three different corners, never the caption band', () => {
  const score = ruleFor('body.dc-app .dc-clip-media .dc-score {');
  const duration = ruleFor('body.dc-app .dc-clip-media .dc-duration {');

  // Score moved off bottom-left, where burned-in captions sit.
  assert.match(score, /top:/);
  assert.match(score, /bottom:\s*auto/, 'the original bottom edge must be cleared or it wins');
  // Duration moved off top-right to make room, and must clear its old top.
  assert.match(duration, /bottom:/);
  assert.match(duration, /top:\s*auto/, 'the original top edge must be cleared or the badges stack');

  // Both sit right; the status pill keeps top-left. Score high, duration low.
  assert.match(score, /right:/);
  assert.match(duration, /right:/);
});

test('card titles are clamped so action rows line up across a row', () => {
  const title = ruleFor('body.dc-app .dc-clip-card.v3-full .dc-clip-body h3 {');
  assert.match(title, /-webkit-line-clamp:\s*2/, 'a third line pushes the buttons out of alignment');
  assert.match(title, /overflow:\s*hidden/);

  const actions = ruleFor('body.dc-app .dc-clip-card .dc-clip-actions {');
  assert.match(actions, /margin-top:\s*auto/, 'actions must be pinned to the bottom of the card');
});

test('an odd last action fills the row instead of hanging in one column', () => {
  assert.match(css, /\.dc-clip-actions\s*>\s*\.dc-btn:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});

test('the size scale exists and card copy is above the old 8.5px floor', () => {
  const tokens = ruleFor('body.dc-app {');
  for (const token of ['--v6-s1', '--v6-s2', '--v6-s3', '--v6-s4', '--v6-radius-md', '--v6-text-card-title']) {
    assert.ok(tokens.includes(token), `missing token ${token}`);
  }
  const size = Number(/--v6-text-card-title:\s*([\d.]+)px/.exec(tokens)?.[1]);
  assert.ok(size >= 12, `card titles at ${size}px are too small to read comfortably`);
});

test('keyboard focus is visible across the app, not on seven elements', () => {
  assert.match(css, /button:focus-visible/);
  assert.match(css, /input:focus-visible/);
  const rule = ruleFor('body.dc-app a:focus-visible,');
  assert.match(rule, /outline:/);
  assert.match(rule, /outline-offset:/);
});

test('the Happening Now bar never prints a raw URL as the title', () => {
  // A fresh import used to show https://www.youtube.com/watch?v=… on the home
  // screen, which is the least useful string available.
  assert.match(app, /function liveJobTitle\(job\)/);
  assert.match(app, /esc\(shortText\(liveJobTitle\(job\),72\)\)/,
    'the live title must go through the cleaner');
  assert.doesNotMatch(app, /esc\(shortText\(job\.title,72\)\)/,
    'the raw-title path is still present');
});

test('liveJobTitle turns a watch URL into something readable', async () => {
  // Executed, not grepped: run the real helper over the real inputs.
  const source = app.slice(app.indexOf('function liveJobTitle'));
  const body = source.slice(0, source.indexOf('\nfunction v5HappeningNow'));
  const cleanUrlTitleSource = app.slice(app.indexOf('function cleanUrlTitle'));
  const cleanBody = cleanUrlTitleSource.slice(0, cleanUrlTitleSource.indexOf('\n', cleanUrlTitleSource.indexOf('}')) + 1);
  const module = await import(
    `data:text/javascript,${encodeURIComponent(`${cleanBody}\n${body}\nexport { liveJobTitle };`)}`
  );

  const cleaned = module.liveJobTitle({ title: 'https://www.youtube.com/watch?v=UgqL1fdj8YQ' });
  assert.doesNotMatch(cleaned, /^https?:\/\//, 'a raw URL reached the home screen');
  assert.match(cleaned, /youtube\.com/);
  // A real title is left completely alone.
  assert.equal(module.liveJobTitle({ title: 'Sabab Ep.2 with Deya Elayyan' }), 'Sabab Ep.2 with Deya Elayyan');
  assert.equal(module.liveJobTitle({}), 'Working now');
});

test('every slider uses the studio accent, not the browser default', () => {
  // The editor's Look panel rendered brightness/contrast/saturation in system
  // blue because accent-color was only set inside two unrelated containers.
  assert.match(css, /body\.dc-app input\[type=range\]\s*\{[^}]*accent-color/,
    'sliders outside .dc-range-bars fall back to the browser default');
});

test('rules for removed markup cannot reshape live controls', () => {
  // `.dc-style-tile` no longer exists, but `.dc-style-enlarge` survived the
  // rename, so an unscoped tile-era rule was still restyling the live pill.
  const app = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  assert.equal(app.includes('dc-style-tile'), false, 'tile markup is gone; update this test if it returns');
  assert.doesNotMatch(css, /\.dc-style-enlarge/,
    'the override layer must not restyle a control whose markup it no longer owns');
  // Screens that were deleted, whose rules outlived them. `dc-qc-empty` is
  // deliberately absent from this list: it is still rendered.
  assert.doesNotMatch(css, /dc-style-tile|dc-style-scrim|dc-style-make|dc-qc-(?:list|row|thumb|actions)|dc-director-playbook|dc-director-forecast|dc-sub-rail|dc-sub-panel|dc-subscription-(?:hero|layout)/,
    'rules for removed screens must not linger in the override layer');
});

test('caption editing stays usable when the preview is a baked export', () => {
  // Regression: hiding the overlay removed caption positioning on nearly every
  // clip, because a YouTube import discards its raw download after processing,
  // so most clips reach this fallback. The control must stay interactive; only
  // its labelling changes.
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  assert.match(source, /classList\.add\('dc-editor-baked-preview'\)/);
  assert.match(source, /classList\.remove\('dc-editor-baked-preview'\)/,
    'the state must reset when another clip is bound');

  const overlayRules = (css.match(/body\.dc-editor-baked-preview #dcCaptionOverlay[^{]*\{[^}]*\}/g) || [])
    // The ::after label is decoration and is meant to ignore pointer events;
    // only rules targeting the box itself constrain interactivity.
    .filter(rule => !rule.slice(0, rule.indexOf('{')).includes('::'));
  assert.ok(overlayRules.length, 'the baked-preview state should still mark the caption box');
  for (const rule of overlayRules) {
    assert.doesNotMatch(rule, /display:\s*none/, 'the caption box must stay draggable');
    assert.doesNotMatch(rule, /pointer-events:\s*none/, 'the caption box must stay clickable');
  }
  assert.doesNotMatch(css, /#dcResizeHandle[^{]*\{[^}]*display:\s*none/,
    'the resize handle must stay usable');

  // And the user is told which of the two captions is theirs.
  assert.match(source, /outlined box is the live caption/);
});

test('the override layer has no rule that can never match', () => {
  // A rule whose selector names a class that appears nowhere in the markup is
  // dead weight at best. At worst it shares a name with something live and
  // silently restyles it, which is exactly how the enlarge control broke.
  // This is the invariant, so it catches the next removed screen too.
  const markup = ['activity-fix.js', 'index.html', 'premium-dashboard.js']
    .map(name => fs.readFileSync(path.join(root, 'src', 'public', name), 'utf8')).join('');
  const present = new Set(markup.match(/dc-[a-z0-9-]+/g) || []);
  const referenced = new Set((css.match(/\.(dc-[a-z0-9-]+)/g) || []).map(value => value.slice(1)));
  const dead = [...referenced].filter(name => name !== 'dc-app' && !present.has(name)).sort();
  assert.deepEqual(dead, [], `override layer targets classes that no longer exist: ${dead.join(', ')}`);
});

test('the stylesheet is structurally valid', () => {
  // A brace-unbalanced stylesheet still passes `npm run check`, which only
  // syntax-checks JS and Python. This caught a bad automated edit already.
  let depth = 0;
  for (const char of css) {
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    assert.ok(depth >= 0, 'a closing brace appeared before its opening brace');
  }
  assert.equal(depth, 0, 'unbalanced braces in studio-v6.css');
});

test('the transcript is a persistent panel, not another settings tab', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  // It sits in the editor workspace beside the canvas, not inside the tool
  // panel that the category rail swaps in and out.
  assert.match(source, /<section class="dc-transcript"/);
  assert.match(source, /id="dcTranscript"/);
  // Anchor on the markup, not the first mention of the class — the file
  // embeds CSS too, and that appears earlier.
  const workspace = source.slice(source.indexOf('class="dc-editor-workspace"'));
  const panel = workspace.indexOf('dc-transcript');
  const canvas = workspace.indexOf('dc-canvas-area');
  assert.ok(panel > -1 && panel < canvas, 'the transcript must sit before the canvas in the workspace');
  assert.match(css, /body\.dc-app \.dc-transcript\s*\{/, 'the panel needs styling or it renders unstyled');
});

test('clicking a transcript word seeks the video', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  assert.match(source, /closest\('\[data-transcript-word\]'\)/, 'no click handler for transcript words');
  const handler = source.slice(source.indexOf("closest('[data-transcript-word]')"));
  assert.match(handler.slice(0, 400), /seekEditor\(/, 'a word click must seek');
  // Each word carries its real start time from Whisper, not an index.
  assert.match(source, /data-at="\$\{Number\(word\.start\)/);
});

test('the active word follows playback without rebuilding the list', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  assert.match(source, /highlightTranscriptWord\(local\)/, 'playback must drive the highlight');

  const start = source.indexOf('function highlightTranscriptWord');
  const body = source.slice(start, source.indexOf('\n}', start));
  // Rewriting innerHTML every frame re-lays-out every word and shimmers.
  assert.doesNotMatch(body, /innerHTML/, 'the highlight must not rebuild the transcript each frame');
  assert.match(body, /if\(index === transcriptActiveIndex\) return;/, 'unchanged frames must bail early');
});

test('a clip with no transcript says so instead of rendering nothing', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  const start = source.indexOf('function renderTranscript');
  const body = source.slice(start, source.indexOf('\n}', start));
  assert.match(body, /No transcript is available/);
});

test('deleting a word from the transcript uses the caption edit pipeline', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  assert.match(source, /closest\('\[data-cut-word\]'\)/, 'no handler for removing a word');
  const start = source.indexOf('function removeTranscriptWord');
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf('\n}', start));

  // Editing from the transcript and from the caption textarea must not drift:
  // both re-map onto the original speech timing and mark the source edited.
  assert.match(body, /mapEditedWordsToSpeech\(/);
  assert.match(body, /editor\.captionSource\s*=\s*'edited'/);
  assert.match(body, /captionTimingReference/, 'edits must map against the original timing');
  assert.match(body, /markEditorDirty\(\)/);
  assert.match(body, /debouncedHistory\(\)/, 'a deletion must be undoable');
  // The textarea has to show the same text, or the two views disagree.
  assert.match(body, /#dcCaptionText/);
  // Out-of-range indices must not corrupt the transcript.
  assert.match(body, /Number\.isInteger\(index\)/);
});

test('canvas guidance is not painted permanently, but user toggles are respected', () => {
  assert.match(css, /body\.dc-app \.dc-framing-guide,\s*\nbody\.dc-app \.dc-layer-badge \{[^}]*opacity: 0/);
  assert.match(css, /\.dc-canvas-area:hover \.dc-framing-guide/, 'guidance must return on hover');
  assert.match(css, /\.dc-video-canvas\.is-dragging \.dc-framing-guide/, 'and while dragging');
  // Safe zones have their own control; overriding it repeats a past mistake.
  assert.doesNotMatch(css, /body\.dc-app \.dc-safe-zone \{[^}]*opacity: 0/,
    'safe zones are user-toggled and must not be force-hidden');
});

test('selecting a layer opens that layer\'s properties', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  const start = source.indexOf('function selectEditorLayer');
  const body = source.slice(start, source.indexOf('\n}', start));

  // Clicking the caption on the canvas should open caption properties, and
  // the video should open framing — instead of the tool rail being the only
  // way to change what the panel shows.
  assert.match(source, /LAYER_TOOL = \{ captions: 'captions', video: 'canvas' \}/);
  assert.match(body, /renderEditorTool\(\)/, 'selection must re-render the panel');

  // Re-selecting the same layer must not drag the panel back if the user has
  // deliberately opened Audio or Post since.
  assert.match(body, /editor\.selectedLayer !== previous/,
    'the panel should only follow an actual change of selection');
});
