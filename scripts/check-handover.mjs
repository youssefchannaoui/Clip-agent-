/*
 * Keeps CLAUDE.md honest about the suite it claims to describe.
 *
 * CLAUDE.md is the handover — the only thing that reaches a session started on
 * a phone, with no local state and no earlier conversation. Its test counts are
 * there as a tripwire: a number that stops matching reality is how you notice
 * tests quietly disappeared. They were once wrong by more than a factor of two,
 * which made them worse than absent, because they still read as authoritative.
 *
 * A count maintained by remembering to maintain it will drift again. This reads
 * the numbers out of a real test run and fails when the file disagrees.
 *
 *   node scripts/check-handover.mjs --log test.log
 *
 * The log is whatever `npm test` printed. Nothing is re-run: the point is to
 * describe the run that actually happened.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const logPath = process.argv[process.argv.indexOf('--log') + 1];
if (!logPath || !fs.existsSync(logPath)) {
  console.error('check-handover: pass --log <file> holding the output of `npm test`.');
  process.exit(2);
}

const log = fs.readFileSync(logPath, 'utf8');
// node --test prints "ℹ tests 747" interactively and "# tests 747" as TAP in
// CI. Both are the same run; accepting only one means this passes locally and
// fails on the runner, which is the failure it exists to prevent.
const jsTotal = log.match(/^[#ℹ]\s*tests\s+(\d+)\s*$/m);
const jsFail = log.match(/^[#ℹ]\s*fail\s+(\d+)\s*$/m);
const pyTotal = log.match(/^Ran (\d+) tests?/m);
const pySkip = log.match(/OK \(skipped=(\d+)\)/);

const missing = [];
if (!jsTotal) missing.push('the JS test total');
if (!pyTotal) missing.push('the Python test total');
if (missing.length) {
  console.error(`check-handover: could not read ${missing.join(' or ')} from ${logPath}.`);
  console.error('Did `npm test` actually run to completion?');
  process.exit(2);
}
if (jsFail && Number(jsFail[1]) > 0) {
  console.error('check-handover: the run being described had failures. Fix those first.');
  process.exit(1);
}

const actual = {
  js: Number(jsTotal[1]),
  py: Number(pyTotal[1]),
  skipped: pySkip ? Number(pySkip[1]) : 0,
};

// Overridable so the check itself can be tested against a file with known
// numbers, rather than only ever against the one it is guarding.
const claudeIndex = process.argv.indexOf('--claude');
const claudePath = claudeIndex > -1 ? process.argv[claudeIndex + 1] : path.join(root, 'CLAUDE.md');
const claudeMd = fs.readFileSync(claudePath, 'utf8');
const claimed = claudeMd.match(/\*\*(\d+) JS \+ (\d+) Python\*\*\s*\n?\s*\((\d+) Python skipped\)/);
if (!claimed) {
  console.error('check-handover: the handover file no longer states its test counts in the expected shape:');
  console.error('  **<n> JS + <n> Python**\\n  (<n> Python skipped).');
  console.error('That line is the tripwire. Restore it rather than removing it.');
  process.exit(1);
}

const stated = { js: Number(claimed[1]), py: Number(claimed[2]), skipped: Number(claimed[3]) };
const wrong = Object.keys(stated).filter(key => stated[key] !== actual[key]);
if (wrong.length) {
  console.error('check-handover: CLAUDE.md describes a different suite than the one that just ran.');
  console.error(`  CLAUDE.md says: ${stated.js} JS + ${stated.py} Python (${stated.skipped} skipped)`);
  console.error(`  actually ran:   ${actual.js} JS + ${actual.py} Python (${actual.skipped} skipped)`);
  console.error('');
  // Growing is routine. Shrinking is the case this exists for: a whole file
  // that stopped being discovered looks exactly like a quiet green run.
  const lost = ['js', 'py'].filter(key => actual[key] < stated[key]);
  if (lost.length) {
    for (const key of lost) {
      const label = key === 'js' ? 'JS' : 'Python';
      console.error(`${stated[key] - actual[key]} ${label} test(s) VANISHED since that number was written.`);
    }
    console.error('Work out where they went before updating the count to match.');
  } else {
    console.error('Update the Verification standard section in the handover to match.');
  }
  process.exit(1);
}

console.log(`check-handover: CLAUDE.md matches the run — ${actual.js} JS + ${actual.py} Python (${actual.skipped} skipped).`);
