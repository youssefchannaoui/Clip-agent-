/*
 * Every repo path a test names must exist with the case it was written in.
 *
 * macOS is case-insensitive, so `DESIGN/studio-dashboard.dc.html` opened
 * perfectly on the machine the test was written on and threw ENOENT on Linux
 * CI, where the directory is `design/`. The whole suite was green locally and
 * red on the runner, which is the worst way to find out — and it matters more
 * now than it did: work happens from a phone, where the CI result IS the
 * verification, and a red tick nobody can reproduce locally is a dead end.
 *
 * fs.existsSync cannot catch this on a Mac. Only comparing against the real
 * directory listing can.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Walks the path one segment at a time and checks each against what the
// directory actually contains, which is the only case-sensitive answer a
// case-insensitive filesystem can give.
function resolvesWithExactCase(relative) {
  let current = ROOT;
  for (const segment of relative.split('/').filter(Boolean)) {
    let entries;
    try { entries = fs.readdirSync(current); }
    catch { return false; }
    if (!entries.includes(segment)) return false;
    current = path.join(current, segment);
  }
  return true;
}

const LITERAL = /path\.join\(\s*(?:ROOT|process\.cwd\(\))\s*,\s*'([^']+)'/g;

test('every repo path named in a test exists with exactly that case', () => {
  const wrong = [];
  for (const file of fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.mjs'))) {
    const source = fs.readFileSync(path.join(ROOT, 'test', file), 'utf8');
    for (const [, relative] of source.matchAll(LITERAL)) {
      if (!resolvesWithExactCase(relative)) wrong.push(`${file}: ${relative}`);
    }
  }
  assert.deepEqual(wrong, [],
    'these open on a Mac and throw ENOENT on Linux CI:\n  ' + wrong.join('\n  '));
});

test('the guard itself can tell the difference', () => {
  // Otherwise a broken checker passes everything and the next case slip ships.
  assert.ok(resolvesWithExactCase('design/studio-dashboard.dc.html'));
  assert.ok(!resolvesWithExactCase('DESIGN/studio-dashboard.dc.html'),
    'if this passes, the check is doing nothing on this filesystem');
  assert.ok(!resolvesWithExactCase('src/Public/index.html'));
});
