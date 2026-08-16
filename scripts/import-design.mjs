#!/usr/bin/env node
// Compiles a Claude Design `.dc.html` file into the two generated artefacts the
// dashboard loads at runtime:
//
//   src/public/studio-template.generated.js   the markup, as a data AST
//   src/public/studio-styles.generated.css    every literal style, hoisted
//
// Nothing here is hand-edited after a re-import. The parts that *are* hand-written
// — studio-runtime.js (interprets the AST) and studio-adapter.js (maps the app's
// DATA onto the design's binding names) — are deliberately kept out of this file's
// output, so pulling a fresh design down never clobbers wiring.
//
//   node scripts/import-design.mjs
//   node scripts/import-design.mjs --src design/studio-dashboard.dc.html --check
//
// --check reports what changed and exits non-zero if bindings the template needs
// have no supplier in studio-adapter.js. That is the signal that a re-import
// added a surface and the adapter has to grow to match.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const SRC = path.resolve(ROOT, flag('src', 'design/studio-dashboard.dc.html'));
const OUT = path.resolve(ROOT, flag('out', 'src/public'));
const CHECK_ONLY = args.includes('--check');

// ── HTML tokenizer ──────────────────────────────────────────────────────────
// The template is machine-generated and well-formed, so a tolerant single-pass
// tokenizer is enough — no dependency needed, matching the rest of the repo.

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
  // SVG leaves that appear unclosed in the design output
  'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'stop', 'use',
]);

function parseAttrs(raw) {
  const attrs = [];
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs.push([m[1], value]);
  }
  return attrs;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { tokens.push({ type: 'text', text: src.slice(i) }); break; }
    if (lt > i) tokens.push({ type: 'text', text: src.slice(i, lt) });

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    // Find the tag's real end, ignoring '>' inside quoted attribute values.
    let j = lt + 1, quote = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') break;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;

    if (inner.startsWith('/')) {
      tokens.push({ type: 'close', tag: inner.slice(1).trim().toLowerCase() });
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const sp = body.search(/\s/);
    const tag = (sp === -1 ? body : body.slice(0, sp)).toLowerCase();
    const attrs = sp === -1 ? [] : parseAttrs(body.slice(sp));
    tokens.push({ type: 'open', tag, attrs, selfClosing: selfClosing || VOID.has(tag) });
  }
  return tokens;
}

function buildTree(tokens) {
  const root = { tag: '#root', attrs: [], children: [] };
  const stack = [root];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.type === 'text') {
      if (t.text.trim() || t.text.includes('{{')) top.children.push({ tag: '#text', text: t.text });
      continue;
    }
    if (t.type === 'open') {
      const node = { tag: t.tag, attrs: t.attrs, children: [] };
      top.children.push(node);
      if (!t.selfClosing) stack.push(node);
      continue;
    }
    // close — unwind to the matching open, tolerating stray closers
    for (let k = stack.length - 1; k > 0; k--) {
      if (stack[k].tag === t.tag) { stack.length = k; break; }
    }
  }
  return root;
}

// ── expression + text handling ──────────────────────────────────────────────

const BINDING = /\{\{\s*([^}]+?)\s*\}\}/g;

// `{{ x }}` -> {p:'x'} (a path looked up through the scope chain)
// `{{ true }}` -> {v:true} (a literal)
function expr(sourceText) {
  const raw = sourceText.trim();
  if (raw === 'true') return { v: true };
  if (raw === 'false') return { v: false };
  if (raw === 'null') return { v: null };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { v: Number(raw) };
  if (/^'([^']*)'$/.test(raw) || /^"([^"]*)"$/.test(raw)) return { v: raw.slice(1, -1) };
  return { p: raw };
}

// A value that may interleave literal text and bindings becomes either a plain
// string (no bindings), a single expr, or a concat list.
function valueNode(text) {
  BINDING.lastIndex = 0;
  if (!text.includes('{{')) return text;
  const parts = [];
  let last = 0, m;
  while ((m = BINDING.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(expr(m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 1) return parts[0];
  return { cat: parts };
}

// ── style hoisting ──────────────────────────────────────────────────────────
// Inline `style` on 1121 elements is most of the file's weight and none of it is
// cacheable. Every *literal* style (and every style-hover / style-active, which
// cannot be inline at all) is hoisted into a generated class, deduped by content.

const EVENTS = { onclick: 'click', onchange: 'change', oninput: 'input', onmousedown: 'mousedown', onmouseenter: 'mouseenter', onmouseleave: 'mouseleave', onsubmit: 'submit', onkeydown: 'keydown', onfocus: 'focus', onblur: 'blur' };
const DROP_ATTRS = new Set(['hint-placeholder-count', 'hint-placeholder-val', 'ref']);

class StyleTable {
  constructor() { this.byKey = new Map(); this.rules = []; }

  // Each of base / :hover / :active is interned on its own, so a declaration
  // block shared by elements that differ in another bucket is still emitted once.
  // An element ends up with a class list ("s3 s9") rather than one fused class.
  #bucket(suffix, decls, important) {
    if (!decls) return null;
    const body = tidy(important ? addImportant(decls) : decls);
    if (!body) return null;
    const key = `${suffix}|${body}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const name = `s${this.byKey.size.toString(36)}`;
    this.byKey.set(key, name);
    this.rules.push(`.${name}${suffix}{${body}}`);
    return name;
  }

  // needsImportant: the element's base style is a runtime binding, so it stays
  // inline — and inline beats a class even on :hover, so those rules need it.
  intern(base, hover, active, needsImportant) {
    return [
      this.#bucket('', base, false),
      this.#bucket(':hover', hover, needsImportant),
      this.#bucket(':active', active, needsImportant),
    ].filter(Boolean).join(' ');
  }

  css() { return this.rules.join('\n'); }
}

const tidy = decls => decls.replace(/\s+/g, ' ').trim().replace(/;$/, '');

function addImportant(decls) {
  return decls.split(';').map(d => {
    const t = d.trim();
    if (!t || t.includes('!important')) return t;
    return `${t} !important`;
  }).filter(Boolean).join(';');
}

// ── template -> AST ─────────────────────────────────────────────────────────

// Literal text the design bakes in that is really data. See
// design/text-overrides.json.
const OVERRIDES_FILE = path.resolve(ROOT, 'design/text-overrides.json');
let TEXT_OVERRIDES = {};
if (fs.existsSync(OVERRIDES_FILE)) {
  try {
    TEXT_OVERRIDES = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')).overrides || {};
  } catch (err) {
    console.error(`import-design: could not read ${path.relative(ROOT, OVERRIDES_FILE)}: ${err.message}`);
    process.exit(2);
  }
}
const overridesHit = new Set();

const styles = new StyleTable();
const bindingsUsed = new Set();
const loopVars = [];

function noteBindings(v) {
  if (!v || typeof v === 'string') return;
  if (v.p) bindingsUsed.add(v.p);
  if (v.cat) v.cat.forEach(noteBindings);
}

function compileNode(node) {
  if (node.tag === '#text') {
    const v = valueNode(node.text);
    if (typeof v === 'string') {
      const collapsed = v.replace(/\s+/g, ' ');
      if (!collapsed.trim()) return null;
      // Literal text that is really data becomes a binding, so the adapter can
      // supply the account's own value instead of the designer's placeholder.
      const binding = TEXT_OVERRIDES[collapsed.trim()];
      if (binding) {
        overridesHit.add(collapsed.trim());
        bindingsUsed.add(binding);
        return { t: 'txt', v: { p: binding } };
      }
      return collapsed;
    }
    noteBindings(v);
    return { t: 'txt', v };
  }

  const attrs = Object.fromEntries(node.attrs);

  if (node.tag === 'sc-if') {
    const cond = valueNode(attrs.value || '');
    noteBindings(cond);
    return { t: 'if', c: cond, ch: compileChildren(node.children) };
  }

  if (node.tag === 'sc-for') {
    const list = valueNode(attrs.list || '');
    noteBindings(list);
    const as = attrs.as || 'item';
    loopVars.push(as);
    const ch = compileChildren(node.children);
    loopVars.pop();
    return { t: 'for', l: list, as, ch };
  }

  // <helmet> carries page-level <link>/<style> — handled separately, not rendered.
  if (node.tag === 'helmet') return null;

  const out = { t: 'el', tag: node.tag };
  const on = {};
  const attrOut = {};
  let baseStyle = null, boundStyle = null;

  for (const [rawName, rawValue] of node.attrs) {
    const name = rawName.toLowerCase();
    if (DROP_ATTRS.has(name)) continue;

    if (name === 'style') {
      if (rawValue.includes('{{')) { boundStyle = valueNode(rawValue); noteBindings(boundStyle); }
      else baseStyle = rawValue;
      continue;
    }
    if (name === 'style-hover' || name === 'style-active') continue; // folded in below

    if (EVENTS[name]) {
      const v = valueNode(rawValue);
      noteBindings(v);
      on[EVENTS[name]] = v;
      continue;
    }
    const v = valueNode(rawValue);
    noteBindings(v);
    attrOut[rawName] = v;
  }

  const hover = attrs['style-hover'] || '';
  const active = attrs['style-active'] || '';
  // Only a literal base style can be hoisted; a bound one must stay inline.
  const hoistable = baseStyle && !boundStyle ? baseStyle : '';
  if (hoistable || hover || active) {
    const cls = styles.intern(hoistable, hover, active, Boolean(boundStyle));
    if (cls) {
      attrOut.class = attrOut.class ? { cat: [attrOut.class, ' ', cls] } : cls;
    }
  }
  if (boundStyle) out.st = boundStyle;

  if (Object.keys(attrOut).length) out.a = attrOut;
  if (Object.keys(on).length) out.on = on;
  const ch = compileChildren(node.children);
  if (ch.length) out.ch = ch;
  return out;
}

function compileChildren(children) {
  const out = [];
  for (const c of children) {
    const n = compileNode(c);
    if (n !== null && n !== undefined) out.push(n);
  }
  return out;
}

// ── head / helmet extraction ────────────────────────────────────────────────

function extractHeadCss(src) {
  // The design file's own <style> blocks (keyframes, resets) travel with the
  // markup — collect them so the generated stylesheet is self-contained.
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[1].includes('omelette-injected')) continue;
    out.push(m[1].trim());
  }
  return out.join('\n\n');
}

function extractFontLinks(src) {
  const links = [];
  const re = /<link\s+[^>]*href="(https:\/\/fonts\.googleapis\.com[^"]*|https:\/\/unpkg\.com[^"]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(src))) links.push(m[1]);
  return [...new Set(links)];
}

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`import-design: source not found: ${path.relative(ROOT, SRC)}`);
    console.error('Export "Studio Dashboard.dc.html" from Claude Design into design/ and re-run.');
    process.exit(2);
  }
  const src = fs.readFileSync(SRC, 'utf8');

  const open = /<x-dc(?:\s[^>]*)?>/.exec(src);
  const close = src.lastIndexOf('</x-dc>');
  if (!open || close === -1) {
    console.error('import-design: no <x-dc> block found — is this a .dc.html file?');
    process.exit(2);
  }
  const template = src.slice(open.index + open[0].length, close);

  // The behaviour script is not executed or ported; it is read only to record
  // which bindings the design itself supplies, so --check can flag the gap.
  // A truncated export has an opening <script data-dc-script> that never closes,
  // so match the opening tag first and only then look for its terminator.
  const scriptOpen = /<script[^>]*data-dc-script[^>]*>/.exec(src);
  let designScript = '';
  let truncated = false;
  if (scriptOpen) {
    const from = scriptOpen.index + scriptOpen[0].length;
    const end = src.indexOf('</script>', from);
    truncated = end === -1;
    designScript = truncated ? src.slice(from) : src.slice(from, end);
  }

  const tree = buildTree(tokenize(template));
  const ast = compileChildren(tree.children);

  const declared = new Set();
  for (const m of designScript.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) declared.add(m[1]);

  const rootBindings = new Set();
  for (const b of bindingsUsed) rootBindings.add(b.split('.')[0]);
  const loopNames = new Set();
  for (const m of template.matchAll(/as="(\w+)"/g)) loopNames.add(m[1]);
  const needed = [...rootBindings].filter(b => !loopNames.has(b)).sort();
  const unsupplied = needed.filter(b => !declared.has(b));

  const headCss = extractHeadCss(src);
  const fonts = extractFontLinks(src);

  const cssOut = [
    '/* GENERATED by scripts/import-design.mjs — do not edit.',
    ` * source: ${path.relative(ROOT, SRC)}`,
    ' * Rebuild with: node scripts/import-design.mjs',
    ' */',
    fonts.map(f => `@import url("${f}");`).join('\n'),
    '',
    headCss,
    '',
    '/* hoisted element styles */',
    styles.css(),
    '',
  ].join('\n');

  const jsOut = [
    '// GENERATED by scripts/import-design.mjs — do not edit.',
    `// source: ${path.relative(ROOT, SRC)}`,
    '// Rebuild with: node scripts/import-design.mjs',
    '// Consumed by studio-runtime.js; bindings are supplied by studio-adapter.js.',
    '(function (global) {',
    '  "use strict";',
    `  global.STUDIO_TEMPLATE = ${JSON.stringify(ast)};`,
    `  global.STUDIO_BINDINGS = ${JSON.stringify(needed)};`,
    '})(typeof window !== "undefined" ? window : globalThis);',
    '',
  ].join('\n');

  const cssPath = path.join(OUT, 'studio-styles.generated.css');
  const jsPath = path.join(OUT, 'studio-template.generated.js');

  // An override that matches nothing means either a typo, or the design was
  // fixed and the entry can go. Never fail silently either way.
  const staleOverrides = Object.keys(TEXT_OVERRIDES).filter(k => !overridesHit.has(k));

  const summary = {
    overrides: overridesHit.size,
    staleOverrides,
    nodes: countNodes(ast),
    bindings: needed.length,
    hoistedClasses: styles.byKey.size,
    cssBytes: cssOut.length,
    jsBytes: jsOut.length,
    unsupplied,
    truncated,
  };

  if (CHECK_ONLY) {
    report(summary, cssPath, jsPath, true);
    process.exit(unsupplied.length ? 1 : 0);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(cssPath, cssOut);
  fs.writeFileSync(jsPath, jsOut);
  report(summary, cssPath, jsPath, false);
  if (truncated) process.exitCode = 1;
}

function countNodes(nodes) {
  let n = 0;
  const walk = list => { for (const x of list) { n++; if (x && x.ch) walk(x.ch); } };
  walk(nodes);
  return n;
}

function report(s, cssPath, jsPath, dry) {
  const kb = b => `${(b / 1024).toFixed(1)}kB`;
  console.log(`import-design: ${s.nodes} nodes, ${s.bindings} bindings, ${s.hoistedClasses} hoisted classes`);
  if (s.overrides) console.log(`  ${s.overrides} hardcoded string(s) replaced with bindings (design/text-overrides.json)`);
  console.log(`  ${dry ? 'would write' : 'wrote'} ${path.relative(ROOT, jsPath)}  ${kb(s.jsBytes)}`);
  console.log(`  ${dry ? 'would write' : 'wrote'} ${path.relative(ROOT, cssPath)} ${kb(s.cssBytes)}`);
  if (s.truncated) {
    console.log('\n  WARNING: the source file is truncated — its <script data-dc-script> block');
    console.log('  never closes. The markup compiled fine, but bindings below are unverified.');
  }
  if (s.staleOverrides.length) {
    console.log(`\n  ${s.staleOverrides.length} text override(s) matched nothing in this export:`);
    for (const k of s.staleOverrides) console.log(`    - ${JSON.stringify(k)}`);
    console.log('  Either the design was fixed (delete the entry) or the string changed.');
  }
  if (s.unsupplied.length) {
    console.log(`\n  ${s.unsupplied.length} binding(s) used by the template with no supplier in the design script:`);
    for (const b of s.unsupplied) console.log(`    - ${b}`);
    console.log('  studio-adapter.js must supply each of these.');
  }
}

main();
