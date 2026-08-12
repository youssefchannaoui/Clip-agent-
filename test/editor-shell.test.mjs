import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = fs.readFileSync(path.join(root, 'src', 'public', 'activity-fix.js'), 'utf8');

// The editor is an application shell, not a page. The defect these tests pin:
// the timeline used to live *inside* the workspace grid, in the same column as
// the preview, so a tall inspector panel grew the tracks and pushed the
// timeline down and off-screen. Switching from Text (short panel) to Captions
// (long panel) visibly moved the timeline and resized the preview — the
// editor's geometry depended on which tab was open.
//
// The fix is structural: the timeline is a sibling of the workspace, so no
// amount of inspector content can reach it.

const rule = selector => {
  const index = ui.indexOf(`${selector}{`);
  assert.ok(index >= 0, `expected a rule for ${selector}`);
  return ui.slice(index + selector.length + 1, ui.indexOf('}', index));
};

test('the timeline is a sibling of the workspace, not inside it', () => {
  // The whole defect in one assertion. If the timeline is nested in the
  // workspace it shares a grid with the inspector, and inspector content can
  // move it.
  const markup = ui.slice(ui.indexOf('<div class="dc-editor-workspace">'));
  const workspaceEnd = markup.indexOf('</main></div>');
  const timelineStart = markup.indexOf('<section class="dc-timeline">');
  assert.ok(workspaceEnd > 0, 'the workspace must be closed explicitly');
  assert.ok(timelineStart > workspaceEnd,
    'the timeline must open after the workspace closes, not inside it');
});

test('the page is the shell grid: header, workspace, timeline', () => {
  const shell = rule('.dc-editor-page');
  assert.match(shell, /display:grid/);
  assert.match(shell, /grid-template-rows:auto minmax\(0,1fr\) var\(--dc-timeline-h/,
    'timeline height must be a reserved row, not whatever is left over');
  assert.match(shell, /overflow:hidden/, 'the shell must not scroll as a page');
});

test('the workspace is columns only and can shrink', () => {
  const workspace = rule('.dc-editor-workspace');
  assert.doesNotMatch(workspace, /grid-template-rows/,
    'a second row is what let the timeline live inside the workspace');
  assert.match(workspace, /min-height:0/, 'without this the grid item grows to fit its content');
  assert.match(workspace, /minmax\(0,1fr\)/, 'the preview column must be allowed to shrink');
});

test('only the inspector content scrolls', () => {
  // Every other region must clip. A stray overflow:auto on an ancestor
  // reproduces the original bug by letting content push instead of scroll.
  const content = rule('.dc-tool-content');
  assert.match(content, /overflow-y:auto/, 'the inspector content is the scroller');
  assert.match(content, /min-height:0/, 'a grid/flex child needs this to scroll rather than grow');
  assert.match(content, /overscroll-behavior:contain/, 'scrolling it must not chain to the page');

  for (const selector of ['.dc-tool-panel', '.dc-canvas-area', '.dc-timeline', '.dc-editor-workspace']) {
    const body = rule(selector);
    assert.match(body, /overflow:hidden/, `${selector} must clip, not scroll`);
    assert.match(body, /min-height:0/, `${selector} must be allowed to shrink`);
  }
});

test('the inspector reserves a fixed header and a flexible body', () => {
  // Two rows: the heading stays put while only the content below it moves, so
  // the panel title does not scroll away from the controls it names.
  const panel = rule('.dc-tool-panel');
  assert.match(panel, /grid-template-rows:auto minmax\(0,1fr\)/);
});

test('no region spans rows that no longer exist', () => {
  // The rail and inspector used to span rows 1/3 because the timeline was row
  // 2. Leaving those spans behind after the restructure silently stretches
  // them over the timeline row.
  for (const selector of ['.dc-tool-rail', '.dc-tool-panel']) {
    assert.doesNotMatch(rule(selector), /grid-row:1\/3/, `${selector} must not span the old timeline row`);
  }
  assert.doesNotMatch(rule('.dc-timeline'), /grid-row/, 'the timeline is a shell row, not a workspace cell');
});

test('the preview keeps its black framing', () => {
  // The two black areas either side of the portrait video are deliberate. They
  // exist because a 9:16 child is centred in a wider area — stretching the
  // child to fill the width would remove them.
  const wrap = rule('.dc-canvas-wrap');
  assert.match(wrap, /place-items:center/, 'the composition must stay centred');
  const canvas = rule('.dc-video-canvas');
  assert.match(canvas, /aspect-ratio:9\/16/, 'the preview must keep its ratio rather than fill');
  assert.match(canvas, /max-width:100%/);
  // Anchored, or this matches the `max-width:100%` immediately above it.
  assert.doesNotMatch(canvas, /(^|;)width:100%/, 'filling the width would remove the black areas');
  assert.match(canvas, /(^|;)width:auto/, 'width follows from the height and the ratio');
});

test('the editor route disables page scrolling, and only that route', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'public', 'studio-v6.css'), 'utf8');
  assert.match(css, /body\.dc-app\.dc-editor-route\s*\{\s*overflow:\s*hidden/,
    'the shell must not sit inside a scrolling page');
  // Scoped by a class that is toggled off on leaving, or every other page breaks.
  assert.match(ui, /classList\.toggle\('dc-editor-route',view==='editor'\)/,
    'the route class must be set from the router and removed on the way out');
  assert.match(css, /#app\s*>\s*\.wrap\s*>\s*\.shell[\s\S]*?#app\s*>\s*\.wrap\s*>\s*\.shell\s*>\s*\.main-col[\s\S]*?height:\s*100%/,
    'the editor height must resolve through the complete parent chain');
  assert.match(css, /body\.dc-app\.dc-editor-route\s+\.dc-editor-workspace\s*\{[\s\S]*?height:\s*auto/,
    'the workspace must not keep the legacy calc height inside the shell grid');
});
