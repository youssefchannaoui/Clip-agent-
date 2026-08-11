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
