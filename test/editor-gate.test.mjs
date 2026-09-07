/*
 * THE CLIP EDITOR SHIPPED ON 7 SEPT 2026 (v3.139.0), and its launch gate went
 * with it. This file used to prove the gate held -- both halves served, the
 * notice over the blur, the subtree inert -- and it now proves the gate is
 * GONE, because half a gate is the worst of both: a served stylesheet that
 * blurs an editor nothing announces as coming, or an inert subtree with no
 * notice over it.
 *
 * It shipped once before, briefly (v3.78.0, 2 Sept 2026), and was re-gated the
 * same hour at Youssef's call; this is the second and deliberate time. Asked
 * whether to settle the one remaining unknown first (no preview or save has
 * been watched landing from the REAL worker) or to take the gate off now, he
 * chose now. That unknown is recorded in CLAUDE.md, not hidden here.
 *
 * The two gate files are `git rm`'d, not merely unlinked: a file on disk that
 * nothing serves is a file the next person "restores" by re-adding a link.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-gate-'));
const port = 17750 + Math.floor(Math.random() * 100);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'false';
process.env.APP_SESSION_SECRET = 'editor-gate-test-secret-long-enough';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
const responsive = fs.readFileSync(path.join(ROOT, 'src/public/studio-responsive.css'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');

test('the two gate files are gone from the tree, not merely unlinked', () => {
  for (const rel of ['src/public/editor-gate.js', 'src/public/studio-editor-gate.css']) {
    assert.ok(!fs.existsSync(path.join(ROOT, rel)), `${rel} must be deleted -- a file nothing serves is one the next person re-links`);
  }
});

test('neither half of the gate is served any more', async () => {
  for (const route of ['/studio-editor-gate.css', '/editor-gate.js']) {
    const res = await fetch(`${base}${route}`);
    assert.equal(res.status, 404, `${route} must no longer be in the static allowlist`);
  }
  assert.doesNotMatch(serverSrc, /studioAsset\('(studio-)?editor-gate\./, 'and the allowlist lines are deleted, not commented out');
});

test('the page does not load the gate', () => {
  // The TAGS, not the words: the comment where the link used to be names both
  // files on purpose, so the next person knows what shipped and when.
  assert.doesNotMatch(host, /<link[^>]+studio-editor-gate\.css/);
  assert.doesNotMatch(host, /<script[^>]+editor-gate\.js/);
});

test('the phone rule hides the whole editor and explains itself, with no notice to exempt', () => {
  const hideRule = responsive.match(/#studio \[data-dc-editor\] > [^{]+\{[^}]*display:\s*none/);
  assert.ok(hideRule, 'the phone rule still exists: the editor needs a wider screen');
  assert.doesNotMatch(hideRule[0], /dcEditorSoon/, 'the exemption was for a notice that no longer exists');
  assert.match(responsive, /\[data-dc-editor\]::before[^}]*content:\s*'The clip editor needs a wider screen/,
    'the wider-screen message is the one thing a phone sees');
});

test('the editor is reachable: nothing marks it gated', async () => {
  // The gate's own identifiers, not a bare `.inert = true` -- the dialogs'
  // focus trap (v3.125.0) sets inert on SIBLINGS and is a different feature
  // that must stay. The first cut of this matched it and went red on correct
  // code.
  const page = await fetch(`${base}/app`).then(r => r.text());
  assert.doesNotMatch(page, /dc-editor-gated|['"#]dcEditorSoon['"]|OVERLAY_ID/);
});

test('the editor no longer wears a BETA badge or a first-run beta pop-up', () => {
  // Retired with the editor fixes of 6 Sept 2026: a screen that has just come
  // out from behind "coming soon" must not open by telling the customer it is
  // not ready after all.
  assert.ok(!host.includes('edBetaPop'), 'the beta pop-up is gone from the host');
  assert.ok(!host.includes('deenEditorBetaSeen'), 'and so is its storage key');
  const adapter = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  assert.ok(!/editor:\s*'Clip editor[^']*BETA/.test(adapter), 'the title carries no BETA');
  assert.ok(!/Beta \\u2014 sliders preview instantly/.test(adapter), 'the subtitle no longer calls it a beta');
});

test('no public sentence still calls the editor coming soon', () => {
  // The claim lived in five places (help, terms, the features chapter, a
  // landing page's honest-limits list, and the /alternatives copy). A gate
  // that is off while the site still says it is on is the stale-claim
  // failure CLAUDE.md pays for most often.
  // The SPECIFIC retired sentences, not a fuzzy "editor near coming soon":
  // the features chapter legitimately keeps a "Concept preview · frame-level
  // tools coming soon" badge on an image of tools that do not exist, and a
  // window regex catches that while proving nothing about the editor.
  const retired = [
    ['src/marketing.js', 'The complete editor is currently marked coming soon'],
    ['src/marketing.js', 'The full editor stays clearly marked as coming soon'],
    ['src/marketing.js', 'the full clip editor is behind a "coming soon" gate'],
    ['src/marketing.js', 'DeenClipped editor coming soon'],
    ['src/seo-copy.js', 'the full clip editor is behind a "coming soon" gate'],
    ['src/help.js', 'The clip editor says coming soon'],
  ];
  for (const [rel, sentence] of retired) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!src.includes(sentence), `${rel} still says: ${sentence}`);
  }
});
