import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const marketing = fs.readFileSync(path.join(ROOT, 'src/marketing.js'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');

// The YouTube API Services compliance review (13 Aug 2026, policy III.F.2a,b)
// flagged two separate things: YouTube's icon redrawn and recoloured, and
// DeenClipped's own mark being YouTube's shape.

test('the DeenClipped mark is not a play triangle in a rounded square', () => {
  // That is YouTube's icon in everything but colour, and it was flagged in both
  // the site header and the footer. A product that publishes to YouTube must
  // not look like it is YouTube.
  const mark = /function logoMark\(\)[\s\S]*?\n}/.exec(marketing)[0];
  assert.doesNotMatch(mark, /<rect[^>]*rx="8"/, 'no rounded-square badge');
  assert.doesNotMatch(mark, /M13 11\.5 21 16l-8 4\.5Z/, 'no play triangle');
  assert.match(mark, /10\.5 10\.5/, 'the mihrab arch the dashboard already uses');
});

test('no icon anywhere is a play triangle inside a rounded rectangle', () => {
  // The clips icon carried the same borrowed shape as the brand mark.
  const clips = /clips: '<svg[^']*'/.exec(marketing)[0];
  assert.doesNotMatch(clips, /m10 9 6 3-6 3Z/, 'the play triangle is gone');
});

test("YouTube's icon is drawn in their colours, not the dashboard's", () => {
  // ph-youtube-logo is a redrawn shape and inherits currentColor, so it
  // rendered gold. Both the shape and the colour were violations.
  const rule = /#studio i\.ph-youtube-logo\{[\s\S]*?\}/.exec(shell)[0];
  assert.match(rule, /%23FF0000/, 'YouTube red');
  assert.match(rule, /%23FFFFFF/, 'white play triangle');
  assert.match(rule, /color:transparent/, 'the redrawn glyph is suppressed');
});

test("the icon never renders below YouTube's 20px minimum", () => {
  const rule = /#studio i\.ph-youtube-logo\{[\s\S]*?\}/.exec(shell)[0];
  assert.match(rule, /min-width:20px/);
  assert.match(rule, /min-height:20px/);
});
