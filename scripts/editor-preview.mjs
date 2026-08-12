#!/usr/bin/env node
/**
 * Build a self-contained preview of the clip editor.
 *
 * WHY THIS EXISTS
 * ---------------
 * The editor has now been broken twice by changes that passed the whole test
 * suite. Both times the failure was visual and structural — a preview sized
 * against the wrong box, a playhead measured from a different origin than the
 * thing it points at, a caption overlay sitting on top of captions already
 * painted into the frame. None of that is visible from a green suite, and
 * verifying it on the live site means every attempt is a deploy.
 *
 * This renders the real renderEditor() output, with the real stylesheets, from
 * the working tree, into one HTML file that opens with no server, no login and
 * no deploy. It is a place to LOOK at a change before shipping it.
 *
 * WHY EVERYTHING IS INLINED
 * -------------------------
 * Chrome blocks fetch() between file:// URLs, so a harness that loaded the CSS
 * and JS by URL would silently render unstyled. The sources are embedded at
 * build time instead, which also means the output is a snapshot: rebuild it
 * after every edit.
 *
 *   node scripts/editor-preview.mjs
 *   open editor-preview.html
 *
 * The fixture deliberately covers the case that keeps regressing: a clip whose
 * startSec is far into the lecture, so any confusion between clip-local time
 * and media time shows up immediately as a dead playhead. Pass --baked to
 * preview the same clip with no clean source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const baked = process.argv.includes('--baked');
const ui = read('src/public/activity-fix.js');

// Strip the module's IIFE wrapper so the harness can reach into it, and stop
// boot() from running — it would inject the whole app shell and start polling
// an API that is not there.
const opened = ui.indexOf('\n');
let body = ui.slice(opened + 1);
const tail = body.lastIndexOf('})();');
if (tail < 0) throw new Error('activity-fix.js no longer ends in an IIFE; update this harness.');
body = body.slice(0, tail);
body = body.replace(
  /if\(document\.readyState==='loading'\)document\.addEventListener\('DOMContentLoaded',boot,\{once:true\}\);else boot\(\);/,
  '/* boot() suppressed by editor-preview */',
);
if (body.includes('else boot();')) throw new Error('boot() was not suppressed; update this harness.');

// A clip that starts 300s into its lecture. If clip-local and media time are
// ever conflated the playhead sits dead at zero, which is exactly the bug that
// made the editor feel broken.
const START = 300;
const DURATION = 37;
const fixture = {
  clips: [{
    id: 'clip_preview', projectId: 'proj_preview', projectTitle: 'You’ll Never Change Until You Win the Battle Within Yourself',
    title: 'Everything is He’s a prophet of Allah', description: 'Preview clip',
    transcript: 'Everything is he is a prophet of Allah and the odour of his mouth his hair everything about him. Are we altogether brothers in this religion.',
    score: 76, scoreReasons: [], startSec: START, endSec: START + DURATION, durationMs: DURATION * 1000,
    status: 'waiting', templateId: 'tpl_preview', templateName: 'Modern Minimal', templateVersion: 1,
    musicName: 'Nasheed', musicVerified: true, targets: [], addedAt: Date.now(),
    cleanSource: !baked,
    videoUrl: '', thumbUrl: '',
  }],
  projects: [{ id: 'proj_preview', title: 'Preview lecture', status: 'done' }],
  rerenderJobs: [],
  templates: [{
    id: 'tpl_preview', name: 'Modern Minimal', version: 1,
    captionMode: 'phrase', captionFontSize: 96, captionPositionX: 50, captionPositionY: 58,
    captionHorizontal: 'center', fitMode: 'crop', cropPositionX: 50, cropPositionY: 50,
    width: 1080, height: 1920, captionTimingOffsetMs: 0,
  }],
  music: [], settings: {}, user: { id: 'u_preview', role: 'owner' },
};

const html = `<!doctype html>
<meta charset="utf-8">
<title>Editor preview${baked ? ' — baked (no clean source)' : ''}</title>
<style>${read('src/public/studio-v6.css')}</style>
<style>
  /* The harness stands in for the app shell, which boot() would normally
     inject. Only layout scaffolding lives here — never anything that could
     make the editor look more correct than it is. */
  html,body{margin:0;height:100%;background:#0a0a0c;color:#e9e9ee;
    font-family:Manrope,system-ui,-apple-system,'Segoe UI',sans-serif}
  body{--dc-top:0px}
  .main-col{height:100vh}
  #view-editor{height:100%;padding:10px;box-sizing:border-box}
  #view-editor.hide{display:none}
  .preview-note{position:fixed;right:10px;bottom:10px;z-index:9999;padding:6px 10px;
    border-radius:8px;background:#000c;color:#8b8b96;font-size:10px;pointer-events:none}
  /* The harness has to explain its own failures. Without this a thrown error
     leaves a black page and the only way to read it is devtools, which is not
     always reachable. */
  #preview-error{position:fixed;inset:16px;z-index:10000;display:none;overflow:auto;
    padding:16px 18px;border-radius:12px;border:1px solid #7a2f36;background:#160d0f;
    color:#ffd9dd;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
  #preview-error b{display:block;margin-bottom:8px;color:#ff8a95;font-size:13px}
  #preview-report{position:fixed;left:10px;bottom:10px;right:280px;z-index:9998;
    padding:5px 9px;border-radius:8px;background:#000c;color:#7d8fa0;
    font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
</style>
<body class="dc-app">
<!-- The minimum shell go() touches. boot() normally injects the whole app
     chrome; reproducing all of it would make this harness a second copy of
     the app. These four are exactly what the router dereferences on its way
     to the editor view, and nothing here affects how the editor renders. -->
<span id="dcPageName" hidden></span><span id="dcPageSub" hidden></span>
<div class="main-col">
  <section id="view-editor" class="panel"></section>
</div>
<div class="preview-note">preview fixture · ${baked ? 'no clean source' : 'clean source'} · startSec ${START}s</div>
<div id="preview-report"></div>
<pre id="preview-error"></pre>
<script>
window.DATA = ${JSON.stringify(fixture)};
window.PW = '';
window.__previewFail = (label, err) => {
  const box = document.getElementById('preview-error');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<b>' + label + '</b>';
  // Safari's .stack omits the message, so print both or the useful half is lost.
  const message = (err && err.message) ? err.message : String(err);
  const stack = (err && err.stack) ? '\n\n' + err.stack : '';
  box.append(message + stack);
};
addEventListener('error', e => window.__previewFail('Uncaught error', e.error || e.message));
addEventListener('unhandledrejection', e => window.__previewFail('Unhandled rejection', e.reason));
</script>
<script>
(() => {
'use strict';
${body}

// --- harness -------------------------------------------------------------
// Video files do not exist here. Point both elements at a generated blank
// clip so metadata loads and the timeline has a real duration to work with,
// rather than leaving the canvas black and the geometry untestable.
const blankVideo = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 1920);
  gradient.addColorStop(0, '#3b3327'); gradient.addColorStop(1, '#14161c');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = '#6c6152'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('PREVIEW FRAME', 540, 900);
  return canvas.toDataURL('image/png');
};

window.__preview = { editor, renderEditor, openEditor, timelineGeometry, currentClip };

const step = s => { const el = document.getElementById('preview-report'); if (el) el.textContent = 'step: ' + s; };

(async () => {
  try {
  editor.clipId = '';
  step('openEditor');
  // Not awaited. openEditor() awaits loadCaptionWords(), which calls the API —
  // on file:// that request never settles, so awaiting here hangs the harness
  // before anything renders. The editor draws from local state regardless;
  // captions simply stay on the evenly-spaced fallback, which is fine for a
  // layout check and is itself one of the states worth looking at.
  const opening = Promise.resolve(openEditor('clip_preview')).catch(err => window.__previewFail('openEditor rejected', err));
  await Promise.race([opening, new Promise(r => setTimeout(r, 1200))]);
  step('rendered');
  if (!document.querySelector('.dc-tool-rail')) {
    // Fall back to rendering the editor directly, so a stall in the async
    // setup cannot leave a blank page with nothing to look at.
    step('direct renderEditor');
    const clip = (DATA.clips || [])[0];
    editor.clipId = clip.id;
    renderEditor(clip);
  }
  if (!document.querySelector('.dc-tool-rail')) {
    throw new Error('renderEditor() produced no editor markup — check that the fixture satisfies currentClip().');
  }
  // Stand in for media the harness cannot load, without touching the code
  // under test: give the elements a poster and a synthetic duration.
  const poster = blankVideo();
  for (const id of ['dcEditorVideo', 'dcEditorVideoBg']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.removeAttribute('src');
    el.setAttribute('poster', poster);
    Object.defineProperty(el, 'duration', { value: ${baked ? DURATION : START + DURATION}, configurable: true });
  }
  renderTimeline();
  updatePlayhead(0);

  // Rendering without throwing is not the same as being on screen. Report what
  // actually laid out, so a blank page says why it is blank instead of leaving
  // devtools as the only way to find out.
  const panel = document.getElementById('view-editor');
  const rail = document.querySelector('.dc-tool-rail');
  const sections = [...document.querySelectorAll('[data-editor-tool]')].map(b => b.dataset.editorTool);
  const box = el => { const r = el && el.getBoundingClientRect(); return r ? Math.round(r.width) + 'x' + Math.round(r.height) : 'none'; };
  const report = {
    'view-editor class': panel ? panel.className : 'MISSING',
    'view-editor display': panel ? getComputedStyle(panel).display : 'n/a',
    'view-editor size': box(panel),
    'tool rail size': box(rail),
    'sections': sections.join(', ') || 'NONE',
    'tool panel size': box(document.querySelector('.dc-tool-panel')),
    'canvas size': box(document.querySelector('.dc-video-canvas')),
    'timeline size': box(document.querySelector('.dc-timeline-scroll')),
  };
  const laidOut = rail && rail.getBoundingClientRect().height > 0;
  if (!laidOut) {
    window.__previewFail('Editor rendered but is not on screen', new Error(
      Object.entries(report).map(([k, v]) => k + ': ' + v).join('\\n')));
  }
  document.getElementById('preview-report').textContent =
    sections.length + ' sections · ' + Object.entries(report).map(([k, v]) => k + ' ' + v).join(' · ');
  } catch (err) { window.__previewFail('Preview harness failed', err); }
})();
})();
</script>
`;

const out = path.join(root, baked ? 'editor-preview-baked.html' : 'editor-preview.html');
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} kB)`);
