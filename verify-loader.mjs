import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const serverPath = path.join(repoRoot, 'src', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

const checks = [
  ['workspace CSS file', path.join(repoRoot, 'src', 'public', 'workspace-shell.css')],
  ['workspace JavaScript file', path.join(repoRoot, 'src', 'public', 'workspace-shell.js')],
  ['activity fix file', path.join(repoRoot, 'src', 'public', 'activity-fix.js')],
];

let failed = false;
for (const [label, file] of checks) {
  const ok = fs.existsSync(file);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  failed ||= !ok;
}

const sourceChecks = [
  ['/workspace-shell.css route', "pathname === '/workspace-shell.css'"],
  ['/workspace-shell.js route', "pathname === '/workspace-shell.js'"],
  ['workspace CSS injection', "href=\\\"/workspace-shell.css\\\""],
  ['workspace JS injection', "src=\\\"/workspace-shell.js\\\""],
];

for (const [label, needle] of sourceChecks) {
  const ok = source.includes(needle);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  failed ||= !ok;
}

if (failed) process.exit(1);
console.log('The Phase 1 redesign loader is installed correctly.');
