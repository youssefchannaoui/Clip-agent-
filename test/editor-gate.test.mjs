/*
 * The clip editor SHIPPED on 2 Sept 2026 (v3.78.0), and its launch gate went
 * with it. This file used to prove the gate held; it now proves the gate is
 * gone, because half of a gate is the worst of both -- a served stylesheet that
 * blurs an editor nothing announces as coming, or an inert subtree with no
 * notice over it.
 *
 * The two gate files (src/public/editor-gate.js, src/public/studio-editor-
 * gate.css) may still exist on disk until someone runs `git rm` on them; what
 * matters is that nothing links, serves or exempts them.
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

test('neither half of the gate is served any more', async () => {
  for (const route of ['/studio-editor-gate.css', '/editor-gate.js']) {
    const res = await fetch(`${base}${route}`);
    assert.equal(res.status, 404, `${route} must no longer be in the static allowlist`);
  }
});

test('the page does not load the gate', () => {
  assert.doesNotMatch(host, /studio-editor-gate\.css/);
  assert.doesNotMatch(host, /editor-gate\.js/);
});

test('the phone rule hides the whole editor and explains itself, with no notice to exempt', () => {
  const hideRule = responsive.match(/#studio \[data-dc-editor\] > [^{]+\{[^}]*display:\s*none/);
  assert.ok(hideRule, 'the phone rule still exists: the editor needs a wider screen');
  assert.doesNotMatch(hideRule[0], /dcEditorSoon/, 'the exemption was for a notice that no longer exists');
  assert.match(responsive, /\[data-dc-editor\]::before[^}]*content:\s*'The clip editor needs a wider screen/,
    'the wider-screen message is the one thing a phone sees');
});

test('the editor is reachable: nothing marks it inert', async () => {
  const page = await fetch(`${base}/app`).then(r => r.text());
  assert.doesNotMatch(page, /dc-editor-gated|dcEditorSoon|\.inert = true/);
});
