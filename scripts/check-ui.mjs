import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'src', 'public', 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML IDs: ${[...new Set(duplicates)].join(', ')}`);

const literalSelectors = [...html.matchAll(/\$\('#([^']+)'\)/g)].map(match => match[1]);
const missing = [...new Set(literalSelectors.filter(id => !ids.includes(id)))];
if (missing.length) throw new Error(`JavaScript references missing IDs: ${missing.join(', ')}`);

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error('No inline dashboard script found.');
new Function(scriptMatch[1]);
console.log(`UI check passed: ${ids.length} unique IDs, ${literalSelectors.length} literal ID references.`);
