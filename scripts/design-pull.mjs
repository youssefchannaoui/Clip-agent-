#!/usr/bin/env node
// Takes a Studio dashboard exported from Claude Design, vendors it into design/,
// and recompiles. This is the whole "I changed the design, pull it in" step.
//
//   node scripts/design-pull.mjs                  # newest .dc.html in ~/Downloads
//   node scripts/design-pull.mjs path/to/file     # or an explicit path
//
// Why this exists rather than fetching the file directly: the design MCP's
// get_file caps at 256 KiB and this export is larger, so it comes back truncated.
// The export therefore has to arrive as a file — either downloaded through the
// browser, or synced to the repo by Claude Design's GitHub integration.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'design', 'studio-dashboard.dc.html');

function newestDownload() {
  const dir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.dc.html'))
    .map(f => path.join(dir, f))
    .map(f => ({ f, t: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? files[0].f : null;
}

const src = process.argv[2] || newestDownload();
if (!src) {
  console.error('design-pull: no .dc.html given and none found in ~/Downloads.');
  console.error('Export "Studio Dashboard.dc.html" from Claude Design, then re-run.');
  process.exit(2);
}
if (!fs.existsSync(src)) {
  console.error(`design-pull: not found: ${src}`);
  process.exit(2);
}

let text = fs.readFileSync(src, 'utf8');

// A file downloaded from the design app's preview carries an injected preamble
// ahead of the real document. Strip it so what lands in design/ is the source
// as authored, and so the vendored file stays diffable across exports.
const start = text.indexOf('<x-dc');
if (start === -1) {
  console.error('design-pull: no <x-dc> block — is this a Claude Design .dc.html?');
  process.exit(2);
}
const head = text.slice(0, start)
  .replace(/<style data-omelette-injected>[\s\S]*?<\/style>/g, '')
  .replace(/<script data-omelette[^>]*>[\s\S]*?<\/script>/g, '');
text = head + text.slice(start);

// Validate BEFORE writing. A truncated export still parses far enough to look
// plausible, and vendoring it first would destroy the known-good copy on the way
// to failing. An export can be cut anywhere, including before the script tag, so
// every landmark is checked rather than just the one.
const problems = [];
if (text.lastIndexOf('</x-dc>') === -1) problems.push('the markup block never closes (no </x-dc>)');
const scriptOpen = /<script[^>]*data-dc-script[^>]*>/.exec(text);
if (!scriptOpen) problems.push('the behaviour script is missing entirely');
else if (text.indexOf('</script>', scriptOpen.index) === -1) problems.push('the behaviour script never closes');
if (problems.length) {
  console.error('design-pull: this export is incomplete, so nothing was changed.');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nRe-export the full file. A partial one compiles but renders blank screens.');
  process.exit(1);
}

const before = fs.existsSync(DEST) ? fs.readFileSync(DEST, 'utf8') : null;
if (before === text) {
  console.log('design-pull: the export matches what is already vendored — nothing to do.');
  process.exit(0);
}

fs.writeFileSync(DEST, text);
console.log(`design-pull: vendored ${(text.length / 1024).toFixed(1)}kB from ${src}`);
console.log(`             ${before === null ? 'created' : 'replaced'} design/studio-dashboard.dc.html\n`);

// If the importer rejects it after all, put the previous source back so the
// working tree is never left holding an export that cannot compile.
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/import-design.mjs')], { stdio: 'inherit' });
} catch {
  if (before === null) fs.rmSync(DEST, { force: true });
  else fs.writeFileSync(DEST, before);
  console.error('\ndesign-pull: the importer rejected that export, so the previous one was put back.');
  process.exit(1);
}

console.log('\nNext: npm run check && npm test, then look at the screens before committing.');
console.log('      design/preview.html renders every screen without a server.');
