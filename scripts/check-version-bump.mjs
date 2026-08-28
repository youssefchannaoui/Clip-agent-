/*
 * Shipping code means bumping the version.
 *
 * package.json's version is the single source both apps announce. A commit that
 * changes what runs without moving it makes the running system report itself as
 * the previous release — and the first time that matters is the moment someone
 * is trying to work out which build a bug is in.
 *
 * Only src/ and worker/ count. Documentation, tests and workflows can land
 * without a release; a rule that fires on everything gets worked around.
 */
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// The commit this push is measured against. A first commit has no parent, and
// a shallow CI checkout may not have fetched one.
let parent;
try { parent = git('rev-parse', 'HEAD^'); }
catch { console.log('check-version-bump: no parent commit to compare against; nothing to check.'); process.exit(0); }

const changed = git('diff', '--name-only', parent, 'HEAD').split('\n').filter(Boolean);
const shipping = changed.filter(file => file.startsWith('src/') || file.startsWith('worker/'));
if (!shipping.length) {
  console.log('check-version-bump: no src/ or worker/ changes in this commit.');
  process.exit(0);
}

const versionAt = ref => {
  try { return JSON.parse(git('show', `${ref}:package.json`)).version; }
  catch { return null; }
};
const before = versionAt(parent);
const after = versionAt('HEAD');

if (before && after && before === after) {
  console.error('check-version-bump: this commit changes what runs but not which version it says it is.');
  console.error(`  version stayed at ${after}`);
  console.error(`  changed: ${shipping.slice(0, 8).join(', ')}${shipping.length > 8 ? `, +${shipping.length - 8} more` : ''}`);
  console.error('');
  console.error('Bump package.json — patch for a fix, minor for a feature — and amend.');
  process.exit(1);
}

console.log(`check-version-bump: ${before} → ${after} for ${shipping.length} changed file(s).`);
