/*
 * The clip editor is held back for launch.
 *
 * It opens from the queue and draws itself, blurred, behind a "coming soon"
 * notice — so what is coming is visible and what is not ready is said plainly.
 *
 * Two failures are worth a test each. The first is a blurred editor that is
 * still REACHABLE: pointer-events stops the mouse but not the keyboard, and a
 * Save button that can be tabbed to can write an edit onto a customer's clip
 * that nobody asked for. The second is the phone rule that hides every child of
 * the editor — which, once the notice became a child, would hide the notice and
 * leave a blank screen.
 *
 * When the editor ships, this whole file goes with the two it describes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-gate-'));
const port = 41500 + Math.floor(Math.random() * 500);
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

const gateCss = fs.readFileSync(path.join(ROOT, 'src/public/studio-editor-gate.css'), 'utf8');
const gateJs = fs.readFileSync(path.join(ROOT, 'src/public/editor-gate.js'), 'utf8');
const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
const responsive = fs.readFileSync(path.join(ROOT, 'src/public/studio-responsive.css'), 'utf8');

test('both halves of the gate are actually served', async () => {
  // Static files are an explicit allowlist. An unlisted one 404s, which would
  // leave the editor open and working with no notice over it at all.
  for (const [route, type] of [['/studio-editor-gate.css', /css/], ['/editor-gate.js', /javascript/]]) {
    const res = await fetch(`${base}${route}`);
    assert.equal(res.status, 200, `${route} must be registered in src/server.js`);
    assert.match(res.headers.get('content-type') || '', type);
    assert.ok((await res.text()).length > 200, `${route} must not be served empty`);
  }
});

test('the page loads the gate, after the stylesheet it has to override', async () => {
  assert.match(host, /studio-editor-gate\.css/);
  assert.match(host, /editor-gate\.js/);
  assert.ok(host.indexOf('studio-editor-gate.css') > host.indexOf('studio-responsive.css'),
    'the gate must come after the mobile stylesheet to win the cascade');
});

test('the notice survives the phone rule that hides the editor', () => {
  // studio-responsive.css hides every child of the editor below 700px. The
  // notice is a child. Without the exclusion the phone gets a blank screen.
  const hideRule = responsive.match(/#studio \[data-dc-editor\] > [^{]+\{[^}]*display:\s*none/);
  assert.ok(hideRule, 'the phone rule should still exist');
  assert.match(hideRule[0], /:not\(#dcEditorSoon\)/,
    'hiding the notice along with the editor leaves nothing on screen');
});

test('the phone never shows two different messages about one screen', () => {
  // The old "needs a wider screen" note and the notice say different things
  // about the same screen; while the gate is on, only one of them speaks.
  const phoneBlock = gateCss.slice(gateCss.indexOf('@media (max-width: 700px)'));
  assert.match(phoneBlock, /\[data-dc-editor\]::before[^}]*display:\s*none/,
    'the wider-screen message must stand down while the notice is up');
});

test('the editor underneath cannot be reached by mouse or by keyboard', () => {
  // Blur is not a lock. CSS stops the pointer; only inert stops tabbing, and a
  // reachable Save writes an edit onto a clip nobody meant to edit.
  assert.match(gateCss, /#studio \[data-dc-editor\] > \*:not\(#dcEditorSoon\)[^}]*pointer-events:\s*none/s,
    'the mouse has to be stopped in CSS');
  assert.match(gateJs, /\.inert = true/,
    'and the keyboard in JS — pointer-events does not affect the tab order');
});

test('the beta popup, which promises that edits save, is silenced', () => {
  // "Your edits save the moment you make them" is true of the editor and false
  // of the gate, and it renders on top of the notice.
  assert.match(gateCss, /body\.dc-editor-gated #edBetaPop[^}]*display:\s*none/);
  assert.match(gateJs, /dc-editor-gated/, 'something has to set that class');
});

test('the gate never rewrites a subtitle belonging to another screen', () => {
  // It replaces the editor's beta line in the topbar, and the topbar is shared
  // by every screen in the app.
  assert.match(gateJs, /beta/i);
  assert.ok(/if \(!editor\) return;/.test(gateJs),
    'it must give up before touching anything when the editor is not on screen');
});

test('turning the editor back on is a deletion, not an untangling', () => {
  // The gate is deliberately not in the design export: re-importing the design
  // regenerates hashed class names, and that churn should not be the price of
  // shipping the editor.
  const design = fs.readFileSync(path.join(ROOT, 'design/studio-dashboard.dc.html'), 'utf8');
  assert.ok(!design.includes('dcEditorSoon'),
    'the notice belongs to the gate, not to the design');
  const generated = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  assert.ok(!generated.includes('dcEditorSoon'));
  assert.ok(generated.includes('data-dc-editor'),
    'but the hook the gate hangs off has to be in the template');
});
