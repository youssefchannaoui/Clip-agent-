import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import {
  state, save, log, logFor, clipSettings, setClipSettings, musicSettings, setMusicSettings,
  automationSettings, setAutomationSettings, publishingSettings, setPublishingSettings,
} from './store.js';
import { ownedBy, findOwned } from './tenancy.js';
import * as audio from './audio.js';
import * as templates from './templates.js';
import { wordsForClip, silenceSpans } from './captions.js';
import * as agent from './agent.js';
import * as social from './social.js';
import { formatLocal } from './slots.js';
import { checkFfmpeg } from './ffmpeg.js';
import * as auth from './auth.js';
import * as billing from './billing.js';

const page = path.join(config.root, 'src', 'public', 'index.html');
const activityFixPage = path.join(config.root, 'src', 'public', 'activity-fix.js');
const youtubeCookiesFile = path.join(config.dataDir, 'youtube-cookies.txt');

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }

function redirectWithCookies(res, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(302, headers); res.end();
}
function html(res, status, value) {
  const body = Buffer.from(String(value));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'deenclipped.online').split(',')[0].trim() || 'deenclipped.online';
  return (config.publicBaseUrl || `${proto}://${host}`).replace(/\/+$/, '');
}
function marketingLayout(req, { title, description, body, canonicalPath = '/' }) {
  const base = publicBase(req);
  const canonical = `${base}${canonicalPath === '/' ? '' : canonicalPath}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <style>
    :root{color-scheme:dark;--bg:#070707;--panel:#101012;--panel2:#171514;--line:rgba(255,255,255,.12);--text:#f7f2ea;--muted:#aaa4a0;--gold:#e3bd75;--gold2:#f4d99a;--green:#63d89a}
    *{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at 14% 5%,rgba(227,189,117,.18),transparent 32%),linear-gradient(135deg,#050505,#0f1012 55%,#070707);color:var(--text);min-height:100vh;line-height:1.55}a{color:inherit}.site{width:min(1120px,calc(100% - 32px));margin:0 auto}.nav{display:flex;align-items:center;justify-content:space-between;padding:24px 0}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-weight:850;letter-spacing:-.02em}.mark{width:38px;height:38px;border-radius:14px;background:linear-gradient(145deg,var(--gold2),var(--gold));box-shadow:0 18px 60px rgba(227,189,117,.20);position:relative}.mark:after{content:"";position:absolute;inset:10px;border-radius:9px;background:#080808}.navlinks{display:flex;gap:10px;align-items:center}.navlinks a,.btn{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:14px;color:var(--muted);background:rgba(255,255,255,.035)}.btn.primary{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#0c0905;border-color:rgba(227,189,117,.55);font-weight:850}.hero{padding:68px 0 74px;display:grid;grid-template-columns:1.05fr .95fr;gap:42px;align-items:center}.kicker{display:inline-flex;gap:8px;align-items:center;padding:8px 12px;border:1px solid rgba(227,189,117,.25);border-radius:999px;background:rgba(227,189,117,.08);color:var(--gold2);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.hero h1{font-size:clamp(42px,7vw,82px);line-height:.94;letter-spacing:-.075em;margin:22px 0 18px}.hero p{font-size:clamp(17px,2.4vw,22px);color:var(--muted);max-width:720px;margin:0 0 28px}.actions{display:flex;gap:12px;flex-wrap:wrap}.mock{border:1px solid rgba(255,255,255,.10);border-radius:34px;background:linear-gradient(145deg,rgba(255,255,255,.08),rgba(255,255,255,.025));box-shadow:0 30px 120px rgba(0,0,0,.55);padding:18px}.mockbar{display:flex;gap:7px;padding:6px 4px 16px}.dot{width:9px;height:9px;border-radius:99px;background:rgba(255,255,255,.22)}.clipgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.clipcard{min-height:178px;border-radius:24px;border:1px solid rgba(255,255,255,.09);background:linear-gradient(145deg,#171719,#0a0a0b);padding:16px;display:flex;flex-direction:column;justify-content:space-between}.clipcard b{font-size:12px;color:var(--gold2);letter-spacing:.12em;text-transform:uppercase}.clipcard span{color:var(--muted);font-size:13px}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding-bottom:64px}.feature{padding:24px;border:1px solid var(--line);border-radius:24px;background:rgba(255,255,255,.04)}.feature h2{margin:0 0 8px;font-size:20px}.feature p{margin:0;color:var(--muted)}.page{padding:42px 0 72px}.pagecard{max-width:900px;padding:34px;border:1px solid var(--line);border-radius:28px;background:rgba(255,255,255,.04)}.pagecard h1{margin:0 0 12px;font-size:42px;letter-spacing:-.05em}.pagecard h2{margin:28px 0 8px;font-size:22px}.pagecard p,.pagecard li{color:var(--muted)}.footer{border-top:1px solid var(--line);padding:24px 0 36px;color:var(--muted);font-size:14px}.footer .site{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}.footer a{color:var(--muted);margin-left:14px}@media(max-width:820px){.hero{grid-template-columns:1fr;padding-top:36px}.features{grid-template-columns:1fr}.nav{align-items:flex-start}.navlinks{flex-wrap:wrap;justify-content:flex-end}.mock{display:none}}
  </style>
</head>
<body>
  <header class="site nav"><a class="brand" href="/"><span class="mark"></span><span>DeenClipped</span></a><nav class="navlinks"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a class="btn primary" href="/login">Sign in</a></nav></header>
  ${body}
  <footer class="footer"><div class="site"><span>© ${new Date().getFullYear()} DeenClipped. Create, edit and publish short-form clips from long videos.</span><span><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="mailto:support@deenclipped.online">Contact</a></span></div></footer>
</body>
</html>`;
}
function marketingHome(req) {
  return marketingLayout(req, {
    title: 'DeenClipped',
    description: 'DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.',
    canonicalPath: '/',
    body: `<main class="site hero"><section><span class="kicker">DeenClipped app homepage</span><h1>DeenClipped</h1><p><strong>DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.</strong></p><p>Purpose of DeenClipped: users can import or upload a long video, choose the part of the source video they want to use, generate short-form clips, review and edit captions, choose templates, connect their own social media accounts, and publish or schedule clips to their own channels.</p><div class="actions"><a class="btn primary" href="/login?returnTo=/app">Sign in to DeenClipped</a><a class="btn" href="/privacy">Privacy Policy</a><a class="btn" href="/terms">Terms of Service</a></div></section><aside class="mock" aria-label="DeenClipped product preview"><div class="mockbar"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div><div class="clipgrid"><div class="clipcard"><b>Import</b><span>Paste a video link or upload your own video file.</span></div><div class="clipcard"><b>Clip</b><span>Select the source range, template, clip count and style.</span></div><div class="clipcard"><b>Edit</b><span>Review generated clips, captions, layouts and titles.</span></div><div class="clipcard"><b>Publish</b><span>Connect your own YouTube and social accounts to publish clips.</span></div></div></aside></main><section class="site features"><article class="feature"><h2>What DeenClipped does</h2><p>DeenClipped turns long-form videos into short-form clips for platforms such as YouTube Shorts, TikTok, Instagram Reels and Facebook Reels.</p></article><article class="feature"><h2>Who DeenClipped is for</h2><p>DeenClipped is for creators, educators, podcasters and teams who want to repurpose long videos into clips.</p></article><article class="feature"><h2>How DeenClipped works</h2><p>Upload or import a video, generate clips, edit the results, then publish or schedule them through connected accounts.</p></article></section>`
  });
}

function privacyPage(req) {
  return marketingLayout(req, {
    title: 'Privacy Policy — DeenClipped',
    description: 'Privacy Policy for DeenClipped.',
    canonicalPath: '/privacy',
    body: `<main class="site page"><article class="pagecard"><h1>Privacy Policy</h1><p>Last updated: 4 August 2026</p><p>DeenClipped helps users create, edit and publish short-form clips from long videos. This Privacy Policy explains what information DeenClipped collects and how it is used.</p><h2>Information we collect</h2><p>We may collect account information such as your name, email address and profile picture when you sign in. We may also store videos, links, generated clips, captions, templates, publishing settings, billing status and connected social account information needed to provide the service.</p><h2>Connected accounts</h2><p>When you connect a platform such as YouTube, DeenClipped stores the connection for your own account so clips can be published to the channel you choose. Tokens are used only to provide requested publishing features and are not sold.</p><h2>How we use information</h2><p>We use information to operate DeenClipped, process videos, generate clips, show projects in your library, provide billing/token features, connect publishing platforms, prevent abuse and improve reliability.</p><h2>Sharing</h2><p>We do not sell personal information. We may share information with service providers used to operate the app, such as hosting, payment processing, authentication and social publishing APIs, only as needed to provide the service.</p><h2>Data security</h2><p>We use reasonable technical measures to protect user data. No online service can guarantee absolute security.</p><h2>Your choices</h2><p>You can disconnect social accounts, delete generated content where available, or contact support about account data.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></main>`
  });
}
function termsPage(req) {
  return marketingLayout(req, {
    title: 'Terms of Service — DeenClipped',
    description: 'Terms of Service for DeenClipped.',
    canonicalPath: '/terms',
    body: `<main class="site page"><article class="pagecard"><h1>Terms of Service</h1><p>Last updated: 4 August 2026</p><p>These Terms govern use of DeenClipped, an app for creating, editing and publishing short-form clips from long videos.</p><h2>Use of the service</h2><p>You must use DeenClipped lawfully and only with content you own or have permission to use. You are responsible for the videos, links, clips, captions and posts you create or publish through the service.</p><h2>Source content and copyright</h2><p>Uploading or importing videos you do not own or do not have permission to use may violate copyright or platform rules. By using DeenClipped, you confirm that you have the required rights and permissions for the content you process.</p><h2>Connected platforms</h2><p>When you connect YouTube or another platform, DeenClipped publishes only using the connected account permissions you grant. You remain responsible for complying with each platform's rules.</p><h2>Billing and tokens</h2><p>Some features may require tokens, subscriptions or paid plans. Token usage may be based on selected source video time and other plan rules shown in the app.</p><h2>Service availability</h2><p>DeenClipped may change, pause or remove features over time. We do not guarantee uninterrupted access.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></main>`
  });
}

function serveAppShell(req, res, url, currentUser) {
  if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  if (auth.enabled() && currentUser && billing.needsPlanChoice(currentUser)) return redirect(res, `/plans?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  let html = fs.readFileSync(page, 'utf8');
  if (!html.includes('/activity-fix.js')) html = html.replace('</body>', '<script src="/activity-fix.js"></script>\n</body>');
  const body = Buffer.from(html);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  return res.end(body);
}

function formBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; } raw += chunk; });
    req.on('end', () => { const params = new URLSearchParams(raw); const body = {}; for (const [key, value] of params.entries()) body[key] = value; resolve(body); });
    req.on('error', reject);
  });
}
function userRecordForRequest(req) { return auth.currentUser(req); }
/*
 * Record lookup is scoped to the signed-in account, always.
 *
 * These previously found the record first and checked permission second, and
 * answered 403 when the check failed — which told a stranger that a clip id
 * exists and belongs to someone else. Now a record owned by another account is
 * simply not found, and the response is identical to a genuinely missing id.
 */
function assertCanAccessClip(user, clipId) {
  const clip = findOwned(state.clips, clipId, user?.id);
  if (!clip) throw Object.assign(new Error('Clip not found.'), { statusCode: 404 });
  return clip;
}
function assertCanAccessProject(user, projectId) {
  const project = findOwned(state.projects, projectId, user?.id);
  if (!project) throw Object.assign(new Error('Project not found.'), { statusCode: 404 });
  return project;
}
function requireOperator(user) {
  if (user?.role !== 'owner') throw Object.assign(new Error('Not found.'), { statusCode: 404 });
  return user;
}

function queueTemplateForEveryUnpostedClip(template, user, reason = 'template update') {
  let queued = 0;
  let skipped = 0;
  const errors = [];
  // Only the acting account's clips. This used to sweep `state.clips`, so one
  // customer saving a template queued a re-render of every other customer's
  // work onto their own template.
  for (const clip of ownedBy(state.clips, user?.id)) {
    if (clip.status === 'posted' || clip.variantOf) { skipped += 1; continue; }
    try {
      agent.engine.queueClipRerender(clip.id, template.id, { asVariant: false });
      queued += 1;
    } catch (error) {
      skipped += 1;
      errors.push({ clipId: clip.id, error: error.message });
    }
  }
  log(`Template "${template.name}" queued for ${queued} unposted clips after ${reason}; ${skipped} skipped.`, 'info', user?.id);
  return { queued, skipped, errors: errors.slice(0, 20) };
}
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0; for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}
function authed(req, url) { return !config.password || sameSecret(req.headers['x-app-password'] || url.searchParams.get('pw') || '', config.password); }
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; } raw += chunk; });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('Request body was not valid JSON.')); } });
    req.on('error', reject);
  });
}

function readRawBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function streamFile(req, res, file, { downloadName = '', contentType = '', cacheControl = 'private, no-store' } = {}) {
  if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'File not found.' });
  const stat = fs.statSync(file); const range = req.headers.range;
  const headers = { 'Content-Type': contentType || (path.extname(file).toLowerCase() === '.jpg' ? 'image/jpeg' : 'video/mp4'), 'Accept-Ranges': 'bytes', 'Cache-Control': cacheControl };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName.replace(/["\r\n]/g, '')}"`;
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0; const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start >= stat.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      const finalEnd = Math.min(end, stat.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${finalEnd}/${stat.size}`, 'Content-Length': finalEnd - start + 1 });
      return fs.createReadStream(file, { start, end: finalEnd }).pipe(res);
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size }); return fs.createReadStream(file).pipe(res);
}

function latestRerender(clipId) { return state.rerenderJobs.find(job => job.clipId === clipId) || null; }
function publicClip(clip) {
  const currentTemplate = templates.templateById(clip.templateId);
  const rerender = latestRerender(clip.id);
  return {
    id: clip.id, projectId: clip.projectId, projectTitle: clip.projectTitle,
    title: clip.title, description: clip.description, hashtags: clip.hashtags, transcript: clip.transcript,
    score: clip.score, scoreReasons: clip.scoreReasons || [], quality: clip.quality || null,
    reviewRequired: Boolean(clip.reviewRequired), startSec: clip.startSec, endSec: clip.endSec, durationMs: clip.durationMs,
    status: clip.status, approvedBy: clip.approvedBy || null,
    scheduledAt: clip.scheduledAt, scheduledLabel: clip.scheduledAt ? formatLocal(clip.scheduledAt) : null,
    readyAt: clip.readyAt || null, postedAt: clip.postedAt,
    musicName: clip.musicName, musicVerified: Boolean(clip.musicVerified),
    templateId: clip.templateId, templateName: clip.templateName, templateVersion: clip.templateVersion || 1,
    templateOutdated: Boolean(currentTemplate && Number(currentTemplate.version || 1) > Number(clip.templateVersion || 1)),
    renderVersion: clip.renderVersion || 1, renderVerified: Boolean(clip.renderVerified),
    renderedWidth: clip.renderedWidth || null, renderedHeight: clip.renderedHeight || null,
    variantOf: clip.variantOf || null, addedAt: clip.addedAt,
    targets: (clip.targets || []).map(social.targetPublic),
    rerender: rerender ? { id: rerender.id, status: rerender.status, stage: rerender.stage, progress: rerender.progress, error: rerender.error || null, asVariant: rerender.asVariant } : null,
    videoUrl: `/api/clips/${encodeURIComponent(clip.id)}/video`, thumbUrl: `/api/clips/${encodeURIComponent(clip.id)}/thumb`,
  };
}

function appState(user = null) {
  // Everything below is scoped to one account: its records, its settings, its
  // templates, its music, its connected platforms and its activity feed.
  if (!user?.id) return { engine: 'self-hosted', user: null, auth: auth.publicConfig(), projects: [], clips: [], log: [] };
  const readiness = agent.engine.readiness(user);
  const projectsForUser = ownedBy(state.projects, user.id);
  const projectIdsForUser = new Set(projectsForUser.map(project => project.id));
  const clipsForUser = ownedBy(state.clips, user.id).filter(clip => projectIdsForUser.has(clip.projectId));
  return {
    engine: 'self-hosted', user: auth.userPublic(user), auth: auth.publicConfig(), readiness, clipSettings: clipSettings(user), musicSettings: musicSettings(user), automationSettings: automationSettings(user),
    selectedTemplate: templates.selectedTemplate(user), templates: templates.listTemplates(user), templateDraft: templates.defaultTemplateDraft(),
    tracks: audio.listNasheeds(user),
    projects: projectsForUser.map(project => ({
      id: project.id, title: project.title, url: project.url, engine: project.engine, status: project.status,
      stage: project.stage, progress: project.progress || 0, error: project.error || null,
      submittedAt: project.submittedAt, completedAt: project.completedAt || null, clipCount: project.clipCount || 0,
      durationSec: project.durationSec || project.sourceDurationSec || null, sourceDurationSec: project.sourceDurationSec || null, sourceThumbUrl: project.sourceThumbUrl || null, sourceTitle: project.sourceTitle || null, templateIdUsed: project.templateIdUsed,
      templateNameUsed: project.templateNameUsed, templateVersionUsed: project.templateVersionUsed || 1, musicRequired: true,
      sourceReusable: Boolean(project.sourceFile && fs.existsSync(project.sourceFile) && project.transcriptFile && fs.existsSync(project.transcriptFile)),
      moreJob: project.moreJob ? {
        id: project.moreJob.id, status: project.moreJob.status, stage: project.moreJob.stage,
        progress: project.moreJob.progress || 0, error: project.moreJob.error || null,
        requestedCount: project.moreJob.requestedCount || 0, importedCount: project.moreJob.importedCount || 0,
        createdAt: project.moreJob.createdAt || null, startedAt: project.moreJob.startedAt || null,
        completedAt: project.moreJob.completedAt || null, updatedAt: project.moreJob.updatedAt || null,
        reusedSource: true, reusedTranscript: true,
      } : null,
    })),
    clips: clipsForUser.map(publicClip),
    rerenderJobs: ownedBy(state.rerenderJobs, user.id).filter(job => clipsForUser.some(clip => clip.id === job.clipId)).slice(0, 30),
    postTimes: config.postTimes, timezone: config.timezone, activeJobs: agent.engine.activeJobCount(),
    log: logFor(user, 60), directPublishingEnabled: config.socialPublishEnabled,
    publishingSettings: publishingSettings(user), social: social.connectionStatus(user), billing: billing.publicBilling(user),
  };
}

function runDoctor() {
  return new Promise(resolve => {
    const child = spawn(config.pythonBin, [config.workerScript, '--doctor'], {
      cwd: config.root, env: { ...process.env, FFMPEG_PATH: config.ffmpegPath, FFPROBE_PATH: config.ffprobePath }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => { clearTimeout(timer); let details = null; try { details = JSON.parse(stdout.trim()); } catch {} resolve({ ok: code === 0, details, error: stderr.trim() || (!details ? stdout.trim() : '') }); });
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
  });
}

async function route(req, res, url) {
  const { pathname } = url; const method = req.method || 'GET';
  if (pathname === '/healthz') return json(res, 200, { ok: true, engine: 'self-hosted' });
  if (method === 'POST' && pathname === '/api/billing/webhook') {
    try {
      const raw = await readRawBody(req, 5_000_000);
      const event = billing.verifyStripeSignature(raw, req.headers['stripe-signature'] || '');
      billing.handleWebhookEvent(event);
      return json(res, 200, { received: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const currentUser = userRecordForRequest(req);
  if (method === 'GET' && pathname === '/login') {
    if (currentUser && auth.enabled()) return redirect(res, billing.postLoginRedirect(currentUser, url.searchParams.get('returnTo') || '/app'));
    return html(res, 200, auth.loginPage({ error: url.searchParams.get('error') || '', info: url.searchParams.get('info') || '', returnTo: url.searchParams.get('returnTo') || '/app' }));
  }
  if (method === 'GET' && pathname === '/plans') {
    if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent(pathname + url.search)}`);
    return html(res, 200, billing.plansPage(currentUser, { error: url.searchParams.get('error') || '', info: url.searchParams.get('info') || '', returnTo: url.searchParams.get('returnTo') || '/app' }));
  }
  if (method === 'POST' && pathname === '/billing/continue-free') {
    try { const body = await formBody(req); billing.markPlansSeen(currentUser); return redirect(res, body.returnTo || '/app'); }
    catch (error) { return redirect(res, `/plans?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/billing/checkout') {
    try { const body = await formBody(req); const session = await billing.createCheckoutSession(currentUser, String(body.plan || '')); return redirect(res, session.url); }
    catch (error) { return redirect(res, `/plans?error=${encodeURIComponent(error.message)}`); }
  }
  const authStart = pathname.match(/^\/auth\/(google|apple)\/start$/);
  if (method === 'GET' && authStart) {
    try { return redirect(res, auth.oauthStart(authStart[1], req, url.searchParams.get('returnTo') || '/app')); }
    catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'GET' && pathname === '/auth/google/callback') {
    try {
      const result = await auth.completeGoogle(req, url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      const session = auth.createSession(result.user, { provider: 'google' });
      return redirectWithCookies(res, billing.postLoginRedirect(result.user, result.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/apple/callback') {
    try {
      const body = await formBody(req);
      const result = await auth.completeApple(req, body);
      const session = auth.createSession(result.user, { provider: 'apple' });
      return redirectWithCookies(res, billing.postLoginRedirect(result.user, result.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/email') {
    try {
      const body = await formBody(req);
      const user = auth.emailLogin(body.email || '', body.password || '', body.name || '');
      const session = auth.createSession(user, { provider: 'email' });
      return redirectWithCookies(res, billing.postLoginRedirect(user, body.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/password') {
    try {
      const body = await formBody(req);
      const user = auth.passwordLogin(body.password || '');
      const session = auth.createSession(user, { provider: 'password' });
      return redirectWithCookies(res, billing.postLoginRedirect(user, body.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/logout') {
    auth.destroySession(req);
    return redirectWithCookies(res, '/login?info=Signed%20out', auth.cookieHeaders('', { clear: true }));
  }
  if (method === 'GET' && pathname === '/privacy') return html(res, 200, privacyPage(req));
  if (method === 'GET' && pathname === '/terms') return html(res, 200, termsPage(req));
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    // Google OAuth verification must always see a public homepage here.
    // The logged-in product is served from /app so / is never hidden behind auth.
    return html(res, 200, marketingHome(req));
  }
  if (method === 'GET' && (pathname === '/app' || pathname === '/dashboard')) {
    return serveAppShell(req, res, url, currentUser);
  }
  if (method === 'GET' && pathname === '/activity-fix.js') {
    if (!fs.existsSync(activityFixPage)) return json(res, 404, { error: 'Activity UI script not found.' });
    const body = fs.readFileSync(activityFixPage);
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  const oauthCallback = pathname.match(/^\/auth\/(youtube|meta|tiktok)\/callback$/);
  if (method === 'GET' && oauthCallback) {
    const provider = oauthCallback[1];
    try {
      // The account comes from the signed OAuth state, not from whoever holds
      // a session cookie when the callback lands.
      await social.completeOAuth(provider, url);
      return redirect(res, `/app?social=connected&provider=${encodeURIComponent(provider)}`);
    } catch (error) {
      console.error(error);
      return redirect(res, `/app?social=error&provider=${encodeURIComponent(provider)}&message=${encodeURIComponent(error.message)}`);
    }
  }
  const socialMedia = pathname.match(/^\/media\/social\/([^/]+)\.mp4$/);
  if (method === 'GET' && socialMedia) {
    const clipId = decodeURIComponent(socialMedia[1]);
    let allowed = false;
    try { allowed = social.verifyMediaSignature(clipId, url.searchParams.get('exp'), url.searchParams.get('sig')); } catch {}
    if (!allowed) return json(res, 403, { error: 'This media link is invalid or expired.' });
    const file = agent.engine.clipFilePath(clipId, 'video');
    return streamFile(req, res, file, { cacheControl: 'public, max-age=3600, immutable' });
  }
  // Serve TikTok's root verification text file before the non-API 404.
  // This supports TikTok-generated verification filenames without hard-coding one token.
  if (method === 'GET') {
    const verificationMatch = pathname.match(/^\/([A-Za-z0-9._-]+\.txt)$/);
    if (verificationMatch) {
      const verificationFile = path.resolve(config.root, verificationMatch[1]);
      const rootPrefix = path.resolve(config.root) + path.sep;

      if (
        verificationFile.startsWith(rootPrefix) &&
        fs.existsSync(verificationFile) &&
        fs.statSync(verificationFile).isFile()
      ) {
        const body = fs.readFileSync(verificationFile);
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
        });
        return res.end(body);
      }
    }
  }

  // TikTok URL-prefix verification files are uploaded to the repository root.
  // Serve only root-level TikTok .txt verification files publicly.
  if (method === 'GET' && /^\/tiktok[^/]*\.txt$/i.test(pathname)) {
    const verificationName = path.basename(decodeURIComponent(pathname));
    const verificationFile = path.join(config.root, verificationName);
    if (!fs.existsSync(verificationFile) || !fs.statSync(verificationFile).isFile()) {
      return json(res, 404, { error: 'TikTok verification file not found.' });
    }
    const body = fs.readFileSync(verificationFile);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    return res.end(body);
  }

  if (!pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
  if (auth.enabled() && !currentUser) return json(res, 401, { error: 'Sign in to continue.', loginRequired: true });
  if (!auth.enabled() && !authed(req, url)) return json(res, 401, { error: 'Wrong password.' });

  if (method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { user: auth.userPublic(currentUser), auth: auth.publicConfig() });
  if (method === 'GET' && pathname === '/api/state') return json(res, 200, appState(currentUser));
  if (method === 'GET' && pathname === '/api/billing') return json(res, 200, billing.publicBilling(currentUser));
  if (method === 'POST' && pathname === '/api/billing/estimate') {
    const body = await readBody(req);
    try { return json(res, 200, billing.estimateTokenCharge(currentUser, Number(body.minutes || body.sourceMinutes || 0))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/billing/checkout') {
    const body = await readBody(req);
    try { return json(res, 200, await billing.createCheckoutSession(currentUser, String(body.plan || ''))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/billing/portal') {
    try { return json(res, 200, await billing.createPortalSession(currentUser)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  const socialConnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/connect$/);
  if (method === 'POST' && socialConnect) {
    try { return json(res, 200, { url: social.oauthStartUrl(socialConnect[1], currentUser?.id) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const socialDisconnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/disconnect$/);
  if (method === 'POST' && socialDisconnect) {
    try { social.disconnect(socialDisconnect[1], currentUser); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const socialTest = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/test$/);
  if (method === 'POST' && socialTest) {
    const body = await readBody(req);
    try { return json(res, 200, { ok: true, result: await social.testConnection(socialTest[1], String(body.accountId || ''), currentUser), social: social.connectionStatus(currentUser) }); }
    catch (error) { return json(res, 400, { error: error.message, social: social.connectionStatus(currentUser) }); }
  }
  if (method === 'POST' && pathname === '/api/publishing-settings') {
    const body = await readBody(req);
    try {
      const current = publishingSettings(currentUser);
      const next = {
        enabled: Boolean(body.enabled),
        youtube: { ...current.youtube, ...(body.youtube || {}), enabled: Boolean(body.youtube?.enabled) },
        instagram: { ...current.instagram, ...(body.instagram || {}), enabled: Boolean(body.instagram?.enabled), shareToFeed: body.instagram?.shareToFeed !== false },
        facebook: { ...current.facebook, ...(body.facebook || {}), enabled: Boolean(body.facebook?.enabled) },
        tiktok: {
          ...current.tiktok, ...(body.tiktok || {}), enabled: Boolean(body.tiktok?.enabled),
          allowComments: body.tiktok?.allowComments !== false,
          allowDuet: Boolean(body.tiktok?.allowDuet), allowStitch: Boolean(body.tiktok?.allowStitch),
        },
      };
      social.validatePublishingSettings(next, currentUser);
      if (next.facebook.enabled && clipSettings(currentUser).clipMaxSeconds > 60) {
        throw new Error('Facebook Reels currently requires clips of 60 seconds or less. Set Maximum seconds to 60 before enabling Facebook.');
      }
      setPublishingSettings(currentUser, next);
      log(`Automatic publishing ${next.enabled ? 'enabled' : 'paused'} for ${['youtube','instagram','facebook','tiktok'].filter(provider => next[provider].enabled).join(', ') || 'no destinations'}.`, 'info', currentUser.id);
      agent.tick().catch(() => {});
      return json(res, 200, { ok: true, settings: publishingSettings(currentUser), social: social.connectionStatus(currentUser) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/source-info') {
    const body = await readBody(req);
    const urls = String(body.urls || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return json(res, 400, { error: 'Paste at least one video link.' });
    const sources = [];
    for (const source of urls.slice(0, 8)) {
      try { sources.push(await agent.sourceInfo(source)); }
      catch (error) { sources.push({ url: source, title: source, durationSec: null, thumbnail: '', error: error.message }); }
    }
    const durations = sources.map(item => Number(item.durationSec)).filter(value => Number.isFinite(value) && value > 0);
    return json(res, 200, {
      ok: true,
      sources,
      known: durations.length === sources.length,
      totalDurationSec: durations.reduce((sum, value) => sum + value, 0),
    });
  }

  if (method === 'POST' && pathname === '/api/videos') {
    const body = await readBody(req); const urls = String(body.urls || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return json(res, 400, { error: 'Paste at least one video link.' });
    const sourceStartSeconds = Math.max(0, Math.round(Number(body.sourceStartSeconds || 0)));
    const sourceEndRaw = Number(body.sourceEndSeconds);
    const sourceEndSeconds = Number.isFinite(sourceEndRaw) && sourceEndRaw > sourceStartSeconds ? Math.round(sourceEndRaw) : null;
    if (sourceEndSeconds !== null && sourceEndSeconds - sourceStartSeconds < 30) return json(res, 400, { error: 'Choose at least 30 seconds of source video.' });
    const sourceRange = { startSec: sourceStartSeconds, endSec: sourceEndSeconds };
    const sourceMeta = Array.isArray(body.sourceMeta) ? body.sourceMeta : [];
    const results = [];
    for (const source of urls) {
      try { results.push({ url: source, ok: true, projectId: await agent.submitVideo(source, body.title || '', currentUser.id, { sourceRange, sourceMeta }) }); }
      catch (error) { results.push({ url: source, error: error.message }); }
    }
    return json(res, 200, { results, sourceRange });
  }

  const projectRetry = pathname.match(/^\/api\/projects\/([^/]+)\/retry$/);
  if (method === 'POST' && projectRetry) {
    try { const id = decodeURIComponent(projectRetry[1]); assertCanAccessProject(currentUser, id); return json(res, 200, { ok: true, project: agent.engine.retryProject(id) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const projectMore = pathname.match(/^\/api\/projects\/([^/]+)\/more-clips$/);
  if (method === 'POST' && projectMore) {
    const body = await readBody(req);
    try {
      const id = decodeURIComponent(projectMore[1]); assertCanAccessProject(currentUser, id);
      const job = agent.engine.queueMoreClips(id, Number(body.count || 8));
      return json(res, 202, { ok: true, job });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === 'DELETE' && projectMatch) {
    try { const id = decodeURIComponent(projectMatch[1]); assertCanAccessProject(currentUser, id); agent.engine.deleteProject(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/templates') return json(res, 200, { templates: templates.listTemplates(currentUser), selectedTemplate: templates.selectedTemplate(currentUser), draft: templates.defaultTemplateDraft() });
  if (method === 'POST' && pathname === '/api/templates') {
    const body = await readBody(req);
    try {
      const template = templates.createTemplate(currentUser, body.template || body);
      const selected = body.select !== false;
      if (selected) templates.setSelectedTemplate(currentUser, template.id);
      const propagation = selected ? queueTemplateForEveryUnpostedClip(template, currentUser, 'creating and selecting it') : { queued: 0, skipped: 0, errors: [] };
      log(`Created template "${template.name}". It is ready for automated renders.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const duplicateTemplate = pathname.match(/^\/api\/templates\/([^/]+)\/duplicate$/);
  if (method === 'POST' && duplicateTemplate) {
    const body = await readBody(req);
    try {
      const template = templates.duplicateTemplate(currentUser, decodeURIComponent(duplicateTemplate[1]), body.name);
      templates.setSelectedTemplate(currentUser, template.id);
      return json(res, 200, { ok: true, template });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (method === 'PUT' && templateMatch) {
    const body = await readBody(req);
    try {
      const template = templates.updateTemplate(currentUser, decodeURIComponent(templateMatch[1]), body.template || body);
      const selected = templates.selectedTemplate(currentUser);
      const propagation = selected?.id === template.id
        ? queueTemplateForEveryUnpostedClip(template, currentUser, 'saving the active template')
        : { queued: 0, skipped: 0, errors: [] };
      log(`Saved template "${template.name}" version ${template.version}. New renders use it automatically.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'DELETE' && templateMatch) {
    try { templates.deleteTemplate(currentUser, decodeURIComponent(templateMatch[1])); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/templates/apply-all') {
    const body = await readBody(req);
    const template = templates.templateById(String(body.templateId || ''), currentUser) || templates.selectedTemplate(currentUser);
    if (!template?.id) return json(res, 400, { error: 'Choose a valid saved template.' });
    let queued = 0; let skipped = 0; const errors = [];
    for (const clip of ownedBy(state.clips, currentUser.id)) {
      if (clip.variantOf) { skipped += 1; continue; }
      try {
        agent.engine.queueClipRerender(clip.id, template.id, { asVariant: clip.status === 'posted' });
        queued += 1;
      } catch (error) {
        skipped += 1; errors.push({ clipId: clip.id, error: error.message });
      }
    }
    log(`Applied template "${template.name}" to ${queued} existing clips; ${skipped} skipped.`, 'info', currentUser.id);
    return json(res, 202, { ok: true, queued, skipped, errors: errors.slice(0, 20), template });
  }

  if (method === 'POST' && pathname === '/api/template') {
    const body = await readBody(req);
    try {
      const template = templates.setSelectedTemplate(currentUser, String(body.id || ''));
      const propagation = queueTemplateForEveryUnpostedClip(template, currentUser, 'selecting it as the default');
      log(`Automation template set to "${template.name}". Every new and unposted clip is locked to this saved version.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/clip-settings') {
    const body = await readBody(req); const count = Math.round(Number(body.clipsPerVideo));
    const minimum = Math.round(Number(body.clipMinSeconds)); const maximum = Math.round(Number(body.clipMaxSeconds));
    if (!Number.isFinite(count) || count < 1 || count > 30) return json(res, 400, { error: 'Clips per video must be between 1 and 30.' });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 3 || maximum > 180 || minimum >= maximum) return json(res, 400, { error: 'Choose a valid clip range between 3 and 180 seconds.' });
    setClipSettings(currentUser, { clipsPerVideo: count, clipMinSeconds: minimum, clipMaxSeconds: maximum });
    return json(res, 200, { ok: true, clipSettings: clipSettings(currentUser) });
  }
  if (method === 'POST' && pathname === '/api/automation-settings') {
    const body = await readBody(req);
    const clean = {
      enabled: Boolean(body.enabled), minimumScore: Math.round(Number(body.minimumScore)), minimumQuality: Math.round(Number(body.minimumQuality)),
      maxPerProject: Math.round(Number(body.maxPerProject)), skipReviewRequired: body.skipReviewRequired !== false,
    };
    if (!Number.isFinite(clean.minimumScore) || clean.minimumScore < 1 || clean.minimumScore > 100) return json(res, 400, { error: 'Minimum score must be 1–100.' });
    if (!Number.isFinite(clean.minimumQuality) || clean.minimumQuality < 1 || clean.minimumQuality > 100) return json(res, 400, { error: 'Minimum quality must be 1–100.' });
    if (!Number.isFinite(clean.maxPerProject) || clean.maxPerProject < 1 || clean.maxPerProject > 20) return json(res, 400, { error: 'Automatic clips per source must be 1–20.' });
    setAutomationSettings(currentUser, clean); log(`Automation ${clean.enabled ? 'enabled' : 'paused'}: score ${clean.minimumScore}+, quality ${clean.minimumQuality}+, up to ${clean.maxPerProject} per source.`, 'info', currentUser.id);
    agent.tick().catch(() => {});
    return json(res, 200, { ok: true, settings: automationSettings(currentUser) });
  }

  if (method === 'GET' && pathname === '/api/music') return json(res, 200, { tracks: audio.listNasheeds(currentUser), settings: musicSettings(currentUser) });
  if (method === 'POST' && pathname === '/api/music') {
    const body = await readBody(req, 60 * 1024 * 1024);
    try { const track = await audio.saveNasheed(currentUser, body.name, body.data, body.mimeType); log(`Added "${track.name}". The renderer can rotate it across clips.`, 'info', currentUser.id); return json(res, 200, { ok: true, track }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/music-settings') {
    const body = await readBody(req); const volumePercent = Math.round(Number(body.volumePercent));
    if (!Number.isFinite(volumePercent) || volumePercent < 1 || volumePercent > 50) return json(res, 400, { error: 'Background music volume must be between 1% and 50%.' });
    setMusicSettings(currentUser, { volumePercent, required: true, shuffle: true }); return json(res, 200, { ok: true, settings: musicSettings(currentUser) });
  }
  const musicAudio = pathname.match(/^\/api\/music\/([^/]+)\/audio$/);
  if (method === 'GET' && musicAudio) {
    const found = audio.nasheedFilePath(currentUser, decodeURIComponent(musicAudio[1])); if (!found) return json(res, 404, { error: 'Track not found.' });
    const extension = path.extname(found.file).toLowerCase(); const contentType = extension === '.wav' ? 'audio/wav' : extension === '.ogg' ? 'audio/ogg' : extension === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
    return streamFile(req, res, found.file, { contentType });
  }
  const musicDelete = pathname.match(/^\/api\/music\/([^/]+)$/);
  if (method === 'DELETE' && musicDelete) return audio.deleteNasheed(currentUser, decodeURIComponent(musicDelete[1])) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Track not found.' });

  // The downloader cookies are a deployment-wide credential belonging to the
  // operator, not a per-account setting. Any signed-in customer could read,
  // replace or delete them before this check existed.
  if (pathname === '/api/admin/youtube-cookies' || pathname === '/api/diagnostics') {
    try { requireOperator(currentUser); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/admin/youtube-cookies') {
    return json(res, 200, { connected: fs.existsSync(youtubeCookiesFile) });
  }
  if (method === 'POST' && pathname === '/api/admin/youtube-cookies') {
    const body = await readBody(req, 5 * 1024 * 1024);
    const contents = String(body.contents || '');
    const headerValid = contents.includes('# Netscape HTTP Cookie File') || contents.includes('# HTTP Cookie File');
    if (!headerValid) return json(res, 400, { error: 'Upload a valid Netscape-format cookies.txt file.' });
    if (!/(^|\n)(?:#HttpOnly_)?\.?youtube\.com\t/im.test(contents) && !contents.includes('.youtube.com')) {
      return json(res, 400, { error: 'The file does not contain YouTube cookies.' });
    }
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(youtubeCookiesFile, contents, { encoding: 'utf8', mode: 0o600 });
    log('YouTube downloader cookies were updated through the admin panel.');
    return json(res, 200, { ok: true, connected: true });
  }
  if (method === 'DELETE' && pathname === '/api/admin/youtube-cookies') {
    try { fs.unlinkSync(youtubeCookiesFile); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    log('YouTube downloader cookies were removed.');
    return json(res, 200, { ok: true, connected: false });
  }

  if (method === 'GET' && pathname === '/api/diagnostics') {
    const [ffmpeg, worker] = await Promise.all([checkFfmpeg(), runDoctor()]);
    return json(res, 200, { ok: ffmpeg.ok && worker.ok, ffmpeg, worker, readiness: agent.engine.readiness(currentUser), python: config.pythonBin, model: config.aiModel, note: 'The first real transcription downloads the selected Whisper model once.' });
  }

  if (method === 'POST' && pathname === '/api/clips/schedule-selected') {
    const body = await readBody(req);
    try {
      for (const id of (Array.isArray(body.ids) ? body.ids : [])) assertCanAccessClip(currentUser, String(id));
      const summary = agent.scheduleSelected(body.ids);
      return json(res, 200, { ok: summary.failed === 0, ...summary });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  const sourcePreview = pathname.match(/^\/api\/clips\/([^/]+)\/source-preview$/);
  if (method === 'GET' && sourcePreview) {
    let clip; try { clip = assertCanAccessClip(currentUser, decodeURIComponent(sourcePreview[1])); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    const project = clip ? state.projects.find(item => item.id === clip.projectId) : null;
    if (!clip || !project?.sourceFile || !fs.existsSync(project.sourceFile)) return json(res, 404, { error: 'Original source video is unavailable.' });
    return streamFile(req, res, project.sourceFile, { contentType: 'video/mp4' });
  }

  const clipVideo = pathname.match(/^\/api\/clips\/([^/]+)\/(video|download|thumb)$/);
  if (method === 'GET' && clipVideo) {
    const id = decodeURIComponent(clipVideo[1]); const kind = clipVideo[2];
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    const file = agent.engine.clipFilePath(id, kind === 'thumb' ? 'thumb' : 'video'); if (!file) return json(res, 404, { error: 'Rendered file not found.' });
    if (kind === 'thumb') return streamFile(req, res, file, { contentType: 'image/jpeg' });
    const filename = `${(clip?.title || 'deenclipped').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'deenclipped'}.mp4`;
    return streamFile(req, res, file, kind === 'download' ? { downloadName: filename } : {});
  }

  const rerenderClip = pathname.match(/^\/api\/clips\/([^/]+)\/rerender$/);
  if (method === 'POST' && rerenderClip) {
    const body = await readBody(req);
    try { const id = decodeURIComponent(rerenderClip[1]); assertCanAccessClip(currentUser, id); return json(res, 202, { ok: true, job: agent.engine.queueClipRerender(id, String(body.templateId || ''), { asVariant: Boolean(body.asVariant) }) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipPublish = pathname.match(/^\/api\/clips\/([^/]+)\/publish$/);
  if (method === 'POST' && clipPublish) {
    try { const id = decodeURIComponent(clipPublish[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(await agent.publishNow(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipRetryPublish = pathname.match(/^\/api\/clips\/([^/]+)\/retry-publish$/);
  if (method === 'POST' && clipRetryPublish) {
    const body = await readBody(req);
    try { const id = decodeURIComponent(clipRetryPublish[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.retryPublishing(id, String(body.provider || ''))) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipReady = pathname.match(/^\/api\/clips\/([^/]+)\/ready$/);
  if (method === 'POST' && clipReady) {
    try { const id = decodeURIComponent(clipReady[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.readyNow(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipPosted = pathname.match(/^\/api\/clips\/([^/]+)\/posted$/);
  if (method === 'POST' && clipPosted) {
    try { const id = decodeURIComponent(clipPosted[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.markPosted(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  // Real speech timing for one clip.
  //
  // The editor requests this to place captions on actual spoken words. When
  // it was missing the request 404'd, the editor fell back to
  // approximateWords(), and captions were spread evenly across the whole
  // clip at a fixed cadence — appearing during silence and drifting out of
  // sync with speech. The worker already stores exact word-level timings
  // from Faster-Whisper in the project transcript, in absolute source time;
  // this converts them to clip-relative time for the clip in question.
  const clipCaptions = pathname.match(/^\/api\/clips\/([^/]+)\/captions$/);
  if (method === 'GET' && clipCaptions) {
    const id = decodeURIComponent(clipCaptions[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }

    const project = state.projects.find(item => item.id === clip.projectId);
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    const duration = Math.max(0, clipEnd - clipStart);

    let words = [];
    let exact = false;
    if (project?.transcriptFile && fs.existsSync(project.transcriptFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
        const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
        words = wordsForClip(segments, clipStart, clipEnd);
        exact = words.length > 0;
      } catch {
        words = [];
      }
    }

    return json(res, 200, {
      words,
      exact,
      synced: exact,
      edited: false,
      transcript: clip.transcript || '',
      durationSec: duration,
      silence: silenceSpans(words, duration),
    });
  }

  // Re-derive caption timing from the original Whisper transcript.
  // Backs the editor's "Auto-sync" button, which 404'd before this existed.
  const clipResync = pathname.match(/^\/api\/clips\/([^/]+)\/captions\/resync$/);
  if (method === 'POST' && clipResync) {
    const id = decodeURIComponent(clipResync[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }
    const project = state.projects.find(item => item.id === clip.projectId);
    if (!project?.transcriptFile || !fs.existsSync(project.transcriptFile)) {
      return json(res, 400, { error: 'No transcript is stored for this lecture, so speech timing cannot be recovered.' });
    }
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    try {
      const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
      const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
      const words = wordsForClip(segments, clipStart, clipEnd);
      if (!words.length) return json(res, 400, { error: 'No speech was found inside this clip.' });
      return json(res, 200, {
        words, exact: true, synced: true,
        transcript: words.map(w => w.word).join(' '),
        silence: silenceSpans(words, Math.max(0, clipEnd - clipStart)),
      });
    } catch (error) {
      return json(res, 400, { error: `The transcript could not be read: ${error.message}` });
    }
  }

  // Active-speaker framing analysis. The editor calls this to preview where
  // the AI crop will sit over time; it 404'd before this existed, which is
  // why smart framing reported "Not found".
  const clipFraming = pathname.match(/^\/api\/clips\/([^/]+)\/framing-preview$/);
  if (method === 'POST' && clipFraming) {
    const id = decodeURIComponent(clipFraming[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }
    const project = state.projects.find(item => item.id === clip.projectId);
    if (!project?.sourceFile || !fs.existsSync(project.sourceFile)) {
      return json(res, 200, { plan: { available: false, reason: 'The original video is no longer stored, so framing cannot be analysed.' } });
    }

    const body = await readBody(req);
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    const duration = Math.max(0, clipEnd - clipStart);

    // Give the tracker the real speech spans so it holds position during
    // silence instead of chasing detector noise when nobody is talking.
    let speechSpans = [];
    if (project.transcriptFile && fs.existsSync(project.transcriptFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
        const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
        speechSpans = wordsForClip(segments, clipStart, clipEnd).map(w => [w.start, w.end]);
      } catch { speechSpans = []; }
    }

    const requestFile = path.join(config.dataDir, `framing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(requestFile, JSON.stringify({
      source: project.sourceFile, ffprobe: config.ffprobePath || 'ffprobe',
      start: clipStart, duration,
      width: Number(body.width) || 1080, height: Number(body.height) || 1920,
      bias: String(body.bias || 'auto'), padding: Number(body.padding ?? 0.18),
      zoom: Number(body.zoom ?? 1), smoothing: Number(body.smoothing ?? 0.82),
      speechSpans,
    }));

    try {
      const plan = await new Promise((resolve) => {
        const child = spawn(config.pythonBin, [config.workerScript, '--framing', requestFile], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ available: false, reason: 'Framing analysis took too long and was stopped.' }); }, 120000);
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        child.on('error', e => { clearTimeout(timer); resolve({ available: false, reason: `The analyser could not start: ${e.message}` }); });
        child.on('close', () => {
          clearTimeout(timer);
          try { resolve(JSON.parse(out).plan); }
          catch { resolve({ available: false, reason: (err.trim().split('\n').pop() || 'The analyser returned no result.').slice(0, 300) }); }
        });
      });
      return json(res, 200, { plan });
    } finally {
      try { fs.unlinkSync(requestFile); } catch {}
    }
  }

  const clipMatch = pathname.match(/^\/api\/clips\/([^/]+)$/);
  if (clipMatch && method === 'PATCH') {
    const id = decodeURIComponent(clipMatch[1]); const body = await readBody(req);
    try {
      assertCanAccessClip(currentUser, id);
      agent.updateClip(id, body); let clip;
      if (body.status === 'approved') clip = agent.approveClip(id); else if (body.status === 'waiting') clip = agent.pullBack(id); else clip = state.clips.find(item => item.id === id);
      return json(res, 200, { ok: true, clip: publicClip(clip) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (clipMatch && method === 'DELETE') {
    try { const id = decodeURIComponent(clipMatch[1]); assertCanAccessClip(currentUser, id); agent.deleteClip(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  return json(res, 404, { error: 'Not found.' });
}

export const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return json(res, 400, { error: 'Bad request.' }); }
  route(req, res, url).catch(error => { console.error(error); if (!res.headersSent) json(res, 500, { error: error.message || 'Unexpected server error.' }); });
});
server.listen(config.port, () => { console.log(`DeenClipped self-hosted engine listening on http://localhost:${config.port}`); agent.start(); });
