import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'src', 'public', 'index.html'), 'utf8');
// The dashboard's DOM comes from two places: this file, and the template
// generated from the design. A check that only reads index.html cannot see
// half the elements the page script talks to, and reports an id that exists
// as missing.
const generated = fs.readFileSync(path.join(root, 'src', 'public', 'studio-template.generated.js'), 'utf8');
const generatedIds = [...generated.matchAll(/"id":"([^"]+)"/g)].map(match => match[1]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const knownIds = new Set([...ids, ...generatedIds]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML IDs: ${[...new Set(duplicates)].join(', ')}`);

const literalSelectors = [...html.matchAll(/\$\('#([^']+)'\)/g)].map(match => match[1]);
const missing = [...new Set(literalSelectors.filter(id => !knownIds.has(id)))];
if (missing.length) throw new Error(`JavaScript references missing IDs: ${missing.join(', ')}`);

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error('No inline dashboard script found.');
new Function(scriptMatch[1]);
console.log(`UI check passed: ${knownIds.size} unique IDs (${generatedIds.length} from the design), ${literalSelectors.length} literal ID references.`);
