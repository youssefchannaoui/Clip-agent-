/*
 * Shipping code means bumping the version.
 *
 * package.json's version is the single source both apps announce, and it is
 * what the worker deploy compares the running container against. A commit that
 * changes what runs without moving it makes the running system report itself as
 * the previous release — and the first time that matters is the moment someone
 * is trying to work out which build a bug is in.
 *
 * Only src/ and worker/ count. Documentation, tests and workflows can land
 * without a release; a rule that fires on everything gets worked around.
 *
 * Two ways this check has actually failed, both fixed here:
 *
 * 1. It compared HEAD against HEAD^ on a checkout fetched two commits deep. On
 *    a merge, or on a push of several commits, HEAD^ is not the change's
 *    logical parent — so the diff came back empty and the run printed "no src/
 *    or worker/ changes in this commit" for a commit that rewrote
 *    worker/clip_worker.py. A guard that cannot see the history must say so,
 *    not pass.
 * 2. It only ever looked one commit back, so two commits could each bump from
 *    their own parent and still both claim the same version. That happened on
 *    31 Aug 2026 — two different trees both called 3.54.1 — and "3.54.1 is
 *    live" then meant nothing.
 */
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };

const fail = (headline, ...detail) => {
  console.error(`check-version-bump: ${headline}`);
  for (const line of detail) console.error(`  ${line}`);
  console.error('');
  console.error('Bump package.json — patch for a fix, minor for a feature — and amend.');
  process.exit(1);
};

const parent = tryGit('rev-parse', 'HEAD^');
if (!parent) {
  console.log('check-version-bump: no parent commit to compare against; nothing to check.');
  process.exit(0);
}

const changed = git('diff', '--name-only', parent, 'HEAD').split('\n').filter(Boolean);
const shipping = changed.filter(file => file.startsWith('src/') || file.startsWith('worker/'));

// A shallow clone cannot answer either question honestly. Saying "nothing
// changed" from a truncated history is how this guard passed a commit that
// rewrote the worker.
const shallow = tryGit('rev-parse', '--is-shallow-repository') === 'true';
if (shallow && !shipping.length) {
  fail(
    'the history here is too shallow to tell whether this ships code.',
    'git says this is a shallow clone, and the diff against HEAD^ came back empty.',
    'That is exactly what a truncated checkout looks like, and it is indistinguishable',
    'from a genuine docs-only commit — so this refuses rather than guessing.',
    'In CI: set fetch-depth on actions/checkout deep enough to see the branch.',
  );
}

if (!shipping.length) {
  console.log('check-version-bump: no src/ or worker/ changes in this commit.');
  process.exit(0);
}

const versionAt = ref => {
  const raw = tryGit('show', `${ref}:package.json`);
  if (!raw) return null;
  try { return JSON.parse(raw).version; } catch { return null; }
};

const after = versionAt('HEAD');
const before = versionAt(parent);
const changedList = `${shipping.slice(0, 8).join(', ')}${shipping.length > 8 ? `, +${shipping.length - 8} more` : ''}`;

if (!after) fail('package.json at HEAD has no readable version.');

if (before && after && before === after) {
  fail(
    'this commit changes what runs but not which version it says it is.',
    `version stayed at ${after}`,
    `changed: ${changedList}`,
  );
}

// The version must be NEW on this branch, not merely different from the parent.
// Two commits can each bump from their own parent and still collide, which is
// what happened when a concurrent push had already taken the number.
const ancestors = (tryGit('rev-list', '--max-count=60', `${parent}`) || '').split('\n').filter(Boolean);
const clash = ancestors.find(sha => versionAt(sha) === after);
if (clash) {
  fail(
    `version ${after} is already used by an earlier commit on this branch.`,
    `first claimed by ${clash.slice(0, 8)} — ${tryGit('log', '-1', '--format=%s', clash) || '(unknown)'}`,
    `changed: ${changedList}`,
    'Two trees sharing one release number makes the deploy check meaningless:',
    'it compares the running container against this number to prove what landed.',
  );
}

console.log(`check-version-bump: ${before} → ${after} for ${shipping.length} changed file(s); ${after} is new on this branch.`);
