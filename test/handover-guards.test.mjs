/*
 * The guards that keep CLAUDE.md and the version honest, tested by running them.
 *
 * Both exist because Youssef works from his phone, where CLAUDE.md is the only
 * handover and CI is the only verification. Both are also the kind of check
 * that can rot into always-passing without anyone noticing — which is strictly
 * worse than not having it, because the green tick still reads as a promise.
 * So each one is exercised on a case it must REJECT, not only on a good one.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANDOVER = path.join(ROOT, 'scripts/check-handover.mjs');
const BUMP = path.join(ROOT, 'scripts/check-version-bump.mjs');

// Runs a script and reports how it exited, rather than throwing on failure —
// the failing cases are the point.
function run(script, args = [], cwd = ROOT) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-guards-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

function logFile(name, body) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, body);
  return file;
}

function claudeFile(name, js, py, skipped) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `## Verification standard\n\n- must pass. Currently **${js} JS + ${py} Python**\n  (${skipped} Python skipped). Update these numbers.\n`);
  return file;
}

const GOOD_LOG = 'ℹ tests 500\nℹ pass 500\nℹ fail 0\nRan 300 tests in 3.4s\n\nOK (skipped=7)\n';
const TAP_LOG = '# tests 500\n# pass 500\n# fail 0\nRan 300 tests in 3.4s\n\nOK (skipped=7)\n';

test('the handover check passes when the file describes the run', () => {
  const result = run(HANDOVER, ['--log', logFile('good.log', GOOD_LOG), '--claude', claudeFile('good.md', 500, 300, 7)]);
  assert.equal(result.code, 0, result.out);
});

test('it reads CI output as readily as local output', () => {
  // node --test prints ℹ locally and TAP in CI. Accepting only one is how a
  // check passes on the machine that wrote it and fails on the runner.
  const result = run(HANDOVER, ['--log', logFile('tap.log', TAP_LOG), '--claude', claudeFile('tap.md', 500, 300, 7)]);
  assert.equal(result.code, 0, result.out);
});

test('it refuses a stale count, which is the whole reason it exists', () => {
  const result = run(HANDOVER, ['--log', logFile('stale.log', GOOD_LOG), '--claude', claudeFile('stale.md', 480, 300, 7)]);
  assert.equal(result.code, 1);
  assert.match(result.out, /different suite/i);
  assert.match(result.out, /480/, 'say what the file claims');
  assert.match(result.out, /500/, 'and what actually ran');
});

test('it notices tests that vanished, not just tests that were added', () => {
  const shrunk = 'ℹ tests 400\nℹ pass 400\nℹ fail 0\nRan 300 tests in 3.4s\n\nOK (skipped=7)\n';
  const result = run(HANDOVER, ['--log', logFile('shrunk.log', shrunk), '--claude', claudeFile('shrunk.md', 500, 300, 7)]);
  assert.equal(result.code, 1);
  assert.match(result.out, /vanish/i, 'and say so, because that is the case worth looking at');
});

test('it will not bless a run that had failures', () => {
  const failed = 'ℹ tests 500\nℹ pass 499\nℹ fail 1\nRan 300 tests in 3.4s\n\nOK (skipped=7)\n';
  const result = run(HANDOVER, ['--log', logFile('failed.log', failed), '--claude', claudeFile('failed.md', 500, 300, 7)]);
  assert.equal(result.code, 1);
  assert.match(result.out, /failures/i);
});

test('it says so plainly when it cannot read the run at all', () => {
  // Silently passing on an empty log would make the guard decorative.
  const result = run(HANDOVER, ['--log', logFile('empty.log', 'nothing useful\n'), '--claude', claudeFile('empty.md', 1, 1, 0)]);
  assert.equal(result.code, 2);
  assert.match(result.out, /could not read/i);
});

// ── the version bump ────────────────────────────────────────────────────────

function repo(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'first\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return { dir, git };
}

test('shipping code without a version bump is refused', () => {
  const { dir, git } = repo('no-bump');
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'changed\n');
  git('add', '-A');
  git('commit', '-qm', 'change src without bumping');
  const result = run(BUMP, [], dir);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /not which version it says it is/i);
  assert.match(result.out, /src\/app\.js/, 'name what changed');
});

test('shipping code with a bump is fine', () => {
  const { dir, git } = repo('bumped');
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'changed\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.1' }));
  git('add', '-A');
  git('commit', '-qm', 'change src and bump');
  const result = run(BUMP, [], dir);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /1\.0\.0 → 1\.0\.1/);
});

test('docs and tests may land without a release', () => {
  // A rule that fires on everything gets worked around, and then it protects
  // nothing at all.
  const { dir, git } = repo('docs-only');
  fs.writeFileSync(path.join(dir, 'README.md'), 'words\n');
  git('add', '-A');
  git('commit', '-qm', 'docs only');
  const result = run(BUMP, [], dir);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /no src\/ or worker\/ changes/i);
});

test('a first commit with no parent is not treated as a violation', () => {
  const { dir } = repo('first-only');
  const result = run(BUMP, [], dir);
  assert.equal(result.code, 0, result.out);
});
