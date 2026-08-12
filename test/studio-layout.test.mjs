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

test('playback does not repeat work on every frame', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  const start = source.indexOf('function updatePlayhead');
  const body = source.slice(start, source.indexOf('\n}', start));

  // applyFrameAtTime was called here as well as by ontimeupdate, so the frame
  // transform was recomputed twice per tick.
  assert.doesNotMatch(body, /applyFrameAtTime\(/,
    'the caller already runs this once per tick');

  // Every caption block used to have its class toggled each frame; on a
  // word-level track that is hundreds of no-op writes a second.
  assert.doesNotMatch(body, /\$\$\('\.dc-caption-block'\)\.forEach/,
    'only the block that changed should be touched');
  assert.match(body, /activeCaptionBlock/, 'the active block should be remembered between frames');
  assert.match(body, /isConnected/, 'a re-rendered timeline must invalidate the cached block');
});test('the caption box is hidden only where the edit could never be exported', () => {
  // Third revision of this rule, so the evidence is written down rather than
  // re-argued.
  //
  // The previous version asserted the box is never hidden in ANY state. Its
  // reasoning was sound given what was known: a clip with no clean plate was
  // believed to be the common case, so hiding the box would have removed
  // caption positioning from most of the library.
  //
  // Measured against production on 12 Aug, that premise was false. Clips were
  // not reaching the baked path because their sources were missing; they were
  // reaching it because a 2.5s watchdog gave up on healthy sources. The clean
  // plate is a full lecture in object storage behind a redirect, and metadata
  // arrived at 2487ms, 2514ms and 2571ms for three clips of one project. The
  // cutoff sat inside that spread, so the fallback fired at random.
  //
  // With the bound corrected the baked path is rare and genuinely terminal:
  // the export has captions in its pixels and no footage survives to
  // re-render from, so a draggable box there is a control that cannot act.
  //
  // Both concerns are therefore live, and this test holds both: the box must
  // be hidden in the baked state, and must not be hidden anywhere else.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocked = /display:\s*none|visibility:\s*hidden|pointer-events:\s*none/;
  const rulesFor = (selector) => (bare.match(new RegExp(`[^{}]*${selector}[^{]*\\{[^}]*\\}`, 'g')) || [])
    .filter(rule => !rule.slice(0, rule.indexOf('{')).includes('::'));
  const hiding = (selector) => rulesFor(selector)
    .filter(rule => blocked.test(rule.slice(rule.indexOf('{'))))
    .map(rule => rule.slice(0, rule.indexOf('{')).trim());

  const overlay = hiding('#dcCaptionOverlay');
  assert.deepEqual(overlay, ['body.dc-editor-baked-preview #dcCaptionOverlay'],
    'the box may only be hidden by the baked-preview state — and must be hidden there');

  // The resize handle belongs to the video layer, which is editable in every
  // state, so it has no equivalent exception.
  assert.deepEqual(hiding('#dcResizeHandle'), [], 'a rule disables the resize handle');
});

test('the clean-source wait is not tight enough to fire on a healthy source', () => {
  // The constant that made the editor unpredictable. Measured load times for
  // the clean plate were 2487/2514/2571ms; the bound was 2500ms. Anything in
  // that neighbourhood turns a working source into a coin flip, and losing
  // the flip means the captioned export is shown with a live caption box on
  // top of it.
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  const match = source.match(/const SOURCE_TIMEOUT_MS=(\d+);/);
  assert.ok(match, 'the source timeout must stay a named constant');
  assert.ok(Number(match[1]) >= 15000,
    `the wait must be a backstop, not a race: got ${match[1]}ms against ~2.5s real load times`);

  // And the wait itself has to be visible, or the bound gets tightened again
  // to paper over a black canvas.
  assert.match(source, /is-source-loading/, 'waiting must show a loading state');
});

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

test('playback does not repeat work on every frame', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  const start = source.indexOf('function updatePlayhead');
  const body = source.slice(start, source.indexOf('\n}', start));

  // applyFrameAtTime was called here as well as by ontimeupdate, so the frame
  // transform was recomputed twice per tick.
  assert.doesNotMatch(body, /applyFrameAtTime\(/,
    'the caller already runs this once per tick');

  // Every caption block used to have its class toggled each frame; on a
  // word-level track that is hundreds of no-op writes a second.
  assert.doesNotMatch(body, /\$\$\('\.dc-caption-block'\)\.forEach/,
    'only the block that changed should be touched');
  assert.match(body, /activeCaptionBlock/, 'the active block should be remembered between frames');
  assert.match(body, /isConnected/, 'a re-rendered timeline must invalidate the cached block');
});

test('waiting for the clean source is explained, not raced', () => {
  // Rewritten 12 Aug. The original concern — a black canvas while the browser
  // works through its own retries — was real and is kept below. Its remedy was
  // not: bounding the wait at 5s or less put the cutoff inside the measured
  // load spread (2487/2514/2571ms), so healthy sources were abandoned at
  // random and the captioned export was shown in their place.
  //
  // Two mechanisms, one for each half of the problem. A loading state answers
  // "why is nothing on screen", immediately and for as long as it takes. The
  // timer stays only as a backstop for a source that never arrives at all,
  // which is why it now sits far outside any plausible load time.
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  const start = source.indexOf('function bindVideo(clip)');
  const body = source.slice(start, source.indexOf('video.ontimeupdate', start));

  const ms = Number(/SOURCE_TIMEOUT_MS\s*=\s*(\d+)/.exec(body)?.[1]);
  assert.ok(Number.isFinite(ms), 'the wait must stay bounded by a named constant');
  assert.ok(ms >= 15000, `${ms}ms races a real clean-plate load; it must be a backstop`);

  assert.match(body, /setTimeout\(/, 'the backstop needs a timer');
  assert.match(body, /video\.readyState===0/, 'only give up when nothing arrived at all');
  assert.match(body, /video\.onerror\?\.\(\)/, 'timing out must take the same path as an error');

  // The black canvas is answered here, not by the timer.
  assert.match(body, /setLoading\(true\)/, 'the wait must be shown to the user');
  assert.match(body, /is-source-loading/);

  // A source that does load must cancel both the timer and the loading state.
  const init = source.slice(source.indexOf('const initialise=()=>{', start));
  assert.match(init.slice(0, 260), /clearTimeout\(sourceWatchdog\)/,
    'a source that does load must cancel the watchdog');
  assert.match(init.slice(0, 260), /setLoading\(false\)/,
    'and must clear the loading state');

  // Failing must clear it too, or a dead source leaves "Loading…" forever.
  const onerror = source.slice(source.indexOf('video.onerror=()=>{', start));
  assert.match(onerror.slice(0, 200), /setLoading\(false\)/);
});

test('the clean plate is seeked to the clip, not left at the top of the lecture', () => {
  // The clean plate is the whole lecture; the clip is a window inside it. This
  // seek is the only thing that puts the preview on the clip. It read a local
  // `start` that a refactor had removed, inside a try/catch that swallowed the
  // ReferenceError — so it silently stopped happening and the editor previewed
  // the wrong footage while every test still passed.
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  const start = source.indexOf('function bindVideo(clip)');
  const init = source.slice(source.indexOf('const initialise=()=>{', start));
  const body = init.slice(0, init.indexOf('};'));
  assert.match(body, /video\.currentTime=editor\.sourceBase/,
    'the seek must use the shared timebase, which is 0 for an export');
  assert.doesNotMatch(body, /currentTime=start\b/, 'the removed local must not come back');
});

test('the editor loads the template the clip was actually rendered with', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');
  const start = source.indexOf('const template = clone(clip.templateSnapshot');
  assert.notEqual(start, -1, 'the draft must start from the clip\'s own snapshot');

  // A lookup by id returns whatever that template has become since the render,
  // or — if it was deleted — something unrelated. The editable caption box
  // then floats somewhere the burned-in captions are not, which is what makes
  // a baked preview show two captions in two different places.
  const expression = source.slice(start, source.indexOf(';', start));
  const snapshot = expression.indexOf('clip.templateSnapshot');
  const byId = expression.indexOf('t.id===clip.templateId');
  assert.ok(snapshot > -1 && snapshot < byId, 'the snapshot must be preferred over a lookup by id');
});
