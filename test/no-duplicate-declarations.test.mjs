import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// This guard originally lived in test/quality-center-render.test.mjs. When
// Quality Center was deleted, the test file went with it — and the guard,
// which had nothing to do with Quality Center, went too. Within a day a
// patch silently declared styleStageInner, bindStyleCaptionDrag, formatEta,
// activityModel and bindWorkDock twice each, and the suite stayed green.
//
// Duplicate function declarations are legal JavaScript: the later one wins
// for the whole script and `node --check` passes. That is exactly how
// Quality Center shipped rendering "[object Object]". So this lives in a
// file named after the invariant, not after any feature.

const FILES = [
  'activity-fix.js',
  'premium-dashboard.js',
];

for (const name of FILES) {
  test(`${name} declares no top-level function name twice`, () => {
    const source = fs.readFileSync(new URL(`../src/public/${name}`, import.meta.url), 'utf8');
    const names = [...source.matchAll(/^function ([A-Za-z0-9_]+)/gm)].map(match => match[1]);
    const counts = new Map();
    for (const fn of names) counts.set(fn, (counts.get(fn) || 0) + 1);
    const dupes = [...counts.entries()].filter(([, count]) => count > 1).map(([fn, count]) => `${fn} (${count}x)`);
    assert.deepEqual(dupes, [], `later declarations silently override earlier ones: ${dupes.join(', ')}`);
  });

  test(`${name} declares no top-level const twice`, () => {
    const source = fs.readFileSync(new URL(`../src/public/${name}`, import.meta.url), 'utf8');
    const names = [...source.matchAll(/^const ([A-Za-z0-9_]+)\s*=/gm)].map(match => match[1]);
    const counts = new Map();
    for (const id of names) counts.set(id, (counts.get(id) || 0) + 1);
    const dupes = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    // Unlike functions, a duplicate top-level const is a hard SyntaxError, so
    // this catches it with a readable message instead of a parse failure.
    assert.deepEqual(dupes, [], `duplicate const declarations: ${dupes.join(', ')}`);
  });
}
