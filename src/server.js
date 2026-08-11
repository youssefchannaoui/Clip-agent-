import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { config, productionConfigurationErrors } from './config.js';
import {
  state, save, log, logFor, clipSettings, setClipSettings, musicSettings, setMusicSettings,
  automationSettings, setAutomationSettings, publishingSettings, setPublishingSettings,
  brandSettings, setBrandSettings,
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
import * as marketing from './marketing.js';
import * as admin from './admin.js';
import * as adminOps from './admin-ops.js';
import { saveVideoUpload, removeUploadedFile } from './uploads.js';
import * as objectStorage from './object-storage.js';
import { assertStorageObjectKey } from './video-import.js';
import * as workerClient from './worker-client.js';

const page = path.join(config.root, 'src', 'public', 'index.html');
const activityFixPage = path.join(config.root, 'src', 'public', 'activity-fix.js');
const premiumDashboardPage = path.join(config.root, 'src', 'public', 'premium-dashboard.js');
const studioV6CssPage = path.join(config.root, 'src', 'public', 'studio-v6.css');
const marketingCssPage = path.join(config.root, 'src', 'public', 'marketing.css');
const marketingJsPage = path.join(config.root, 'src', 'public', 'marketing.js');
function assetVersion(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12); }
  catch { return 'missing'; }
}
const activityFixVersion = assetVersion(activityFixPage);
const premiumDashboardVersion = assetVersion(premiumDashboardPage);
const studioV6CssVersion = assetVersion(studioV6CssPage);
// Marketing images are looked for in a dedicated subfolder first, then in
// src/public itself. They are currently committed directly to src/public, so
// serving only from the subfolder means every request 404s against a directory
// that does not exist. Accepting both keeps existing files working and still
// supports tidying them into the subfolder later.
const marketingAssetDirs = [
  path.resolve(config.root, 'src', 'public', 'marketing-assets'),
  path.resolve(config.root, 'src', 'public'),
];

// BillingError and friends carry a machine-readable `code` plus the token
// numbers. Without this the client only sees a sentence and cannot tell an
// out-of-tokens refusal apart from any other 400.
function errorBody(error) {
  const body = { error: error?.message || 'Something went wrong.' };
  if (!error?.code) return body;
  body.code = error.code;
  for (const key of ['needed', 'remaining', 'shortfall', 'plan', 'expiredAt']) {
    if (error[key] !== undefined) body[key] = error[key];
  }
  return body;
}

function cleanBrandSettings(input = {}, user = null) {
  const current = brandSettings(user);
  const features = billing.featureAccess(user);
  const positions = new Set(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']);
  const cleanColor = (value, fallback) => /^#[0-9A-F]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback;
  const cleanList = (value, fallback = []) => {
    if (value === undefined || value === null) return fallback;
    const source = Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/);
    const cleaned = source.map(item => String(item || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean);
    return [...new Set(cleaned)].slice(0, 80);
  };
  const audiences = new Set(['general', 'new-muslims', 'students', 'families', 'creators']);
  const goals = new Set(['education', 'growth', 'community', 'reflection']);
  const tones = new Set(['respectful', 'warm', 'direct', 'reflective']);
  const audience = String(input.audience ?? current.audience ?? 'general');
  const contentGoal = String(input.contentGoal ?? current.contentGoal ?? 'education');
  const brandTone = String(input.brandTone ?? current.brandTone ?? 'respectful');
  const opacity = features.watermarkRequired ? 88 : Math.max(20, Math.min(100, Math.round(Number(input.watermarkOpacity ?? current.watermarkOpacity ?? 88))));
  return {
    watermarkEnabled: features.canRemoveWatermark ? input.watermarkEnabled !== false : true,
    watermarkText: features.customBranding
      ? (String(input.watermarkText ?? current.watermarkText ?? 'DEENCLIPPED').trim().slice(0, 60) || 'DEENCLIPPED')
      : 'DEENCLIPPED',
    watermarkPosition: features.customBranding && positions.has(String(input.watermarkPosition)) ? String(input.watermarkPosition) : 'top-center',
    watermarkColor: features.customBranding ? cleanColor(input.watermarkColor, current.watermarkColor || '#D9B478') : '#D9B478',
    watermarkOpacity: opacity,
    brandLineEnabled: features.customBranding ? Boolean(input.brandLineEnabled) : false,
    brandLineColor: cleanColor(input.brandLineColor, current.brandLineColor || '#D9B478'),
    brandVocabulary: features.customBranding ? cleanList(input.brandVocabulary, current.brandVocabulary || []) : [],
    audience: features.customBranding && audiences.has(audience) ? audience : 'general',
    contentGoal: features.customBranding && goals.has(contentGoal) ? contentGoal : 'education',
    brandTone: features.customBranding && tones.has(brandTone) ? brandTone : 'respectful',
    avoidPhrases: features.customBranding ? cleanList(input.avoidPhrases, current.avoidPhrases || []).slice(0, 30) : [],
  };
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
function temporaryRedirect(res, location) { res.writeHead(307, { Location: location, 'Cache-Control': 'private, no-store' }); res.end(); }

async function projectTranscriptSegments(project) {
  if (!project) return [];
  let parsed = null;
  if (project.transcriptFile && fs.existsSync(project.transcriptFile)) {
    parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
  } else if (project.transcriptObjectKey && objectStorage.configured()) {
    const key = String(project.transcriptObjectKey || '');
    if (!/^projects\/[A-Za-z0-9._/-]+\/transcript\.json$/.test(key) || key.includes('..')) {
      throw new Error('The stored transcript reference is invalid.');
    }
    const response = await fetch(objectStorage.presign({ method: 'GET', key, expiresSec: 120 }), {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Stored transcript download failed with status ${response.status}.`);
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > 20 * 1024 * 1024) throw new Error('The stored transcript is unexpectedly large.');
    const body = await response.text();
    if (Buffer.byteLength(body) > 20 * 1024 * 1024) throw new Error('The stored transcript is unexpectedly large.');
    parsed = JSON.parse(body);
  }
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.segments) ? parsed.segments : []);
}

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

function applySecurityHeaders(res) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com");
}

const authAttempts = new Map();
function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function authRateLimited(req) {
  const key = requestIp(req);
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter(at => now - at < 15 * 60_000);
  recent.push(now);
  authAttempts.set(key, recent);
  return recent.length > 12;
}
function unsafeCrossSiteRequest(req, url) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || 'GET')) return false;
  if (url.pathname === '/api/billing/webhook' || url.pathname === '/auth/apple/callback' || url.pathname.startsWith('/api/worker-callbacks/')) return false;
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return true;
  const origin = String(req.headers.origin || '');
  if (!origin) return false;
  try { return new URL(origin).origin !== new URL(publicBase(req)).origin; } catch { return true; }
}

function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'deenclipped.online').split(',')[0].trim() || 'deenclipped.online';
  return (config.publicBaseUrl || `${proto}://${host}`).replace(/\/+$/, '');
}
function marketingContext(req) {
  return { base: publicBase(req), currentUser: auth.currentUser(req) };
}
function marketingHome(req) { return marketing.home(marketingContext(req)); }
function featuresPage(req) { return marketing.features(marketingContext(req)); }
function pricingPage(req) { return marketing.pricing(marketingContext(req)); }
function contactPage(req) { return marketing.contact(marketingContext(req)); }
function privacyPage(req) { return marketing.privacy(marketingContext(req)); }
function termsPage(req) { return marketing.terms(marketingContext(req)); }

function serveAppShell(req, res, url, currentUser) {
  if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  if (auth.enabled() && currentUser && billing.needsPlanChoice(currentUser)) return redirect(res, `/plans?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  let html = fs.readFileSync(page, 'utf8');
  if (!html.includes('/studio-v6.css')) html = html.replace('</head>', `<link rel="stylesheet" href="/studio-v6.css?v=${studioV6CssVersion}">\n</head>`);
  if (!html.includes('/activity-fix.js')) html = html.replace('</body>', `<script src="/activity-fix.js?v=${activityFixVersion}"></script>\n</body>`);
  if (!html.includes('/premium-dashboard.js')) html = html.replace('</body>', `<script src="/premium-dashboard.js?v=${premiumDashboardVersion}"></script>\n</body>`);
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
  if (!['owner', 'admin'].includes(String(user?.role || '').toLowerCase())) throw Object.assign(new Error('Not found.'), { statusCode: 404 });
  return user;
}

function queueTemplateForEveryUnpostedClip(template, user, reason = 'template update') {
  let queued = 0;
  let skipped = 0;
  const errors = [];
  // One id per action, so the browser can group these jobs and count them
  // instead of showing four unrelated bars.
  const batchId = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const eligible = ownedBy(state.clips, user?.id).filter(clip => clip.status !== 'posted' && !clip.variantOf).length;
  // Only the acting account's clips. This used to sweep `state.clips`, so one
  // customer saving a template queued a re-render of every other customer's
  // work onto their own template.
  for (const clip of ownedBy(state.clips, user?.id)) {
    if (clip.status === 'posted' || clip.variantOf) { skipped += 1; continue; }
    try {
      agent.engine.queueClipRerender(clip.id, template.id, { asVariant: false, batchId, batchLabel: `Applying "${template.name}"`, batchTotal: eligible });
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
function verifyWorkerRequest(req, pathname, rawBody) {
  const timestamp = String(req.headers['x-deenclipped-timestamp'] || '');
  const supplied = String(req.headers['x-deenclipped-signature'] || '');
  if (!config.workerCallbackSecret || !timestamp || !supplied || Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = crypto.createHmac('sha256', config.workerCallbackSecret).update(`${timestamp}\n${req.method || 'GET'}\n${pathname}\n${rawBody}`).digest('hex');
  return sameSecret(expected, supplied);
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
    scoreBreakdown: clip.scoreBreakdown || clip.quality?.scoreBreakdown || null,
    confidence: Number.isFinite(Number(clip.confidence)) ? Number(clip.confidence) : null,
    intelligenceSignals: clip.intelligenceSignals || null,
    growthPack: clip.growthPack || null, platformMetadata: clip.platformMetadata || null,
    reviewRequired: Boolean(clip.reviewRequired), startSec: clip.startSec, endSec: clip.endSec, durationMs: clip.durationMs,
    status: clip.status, approvedBy: clip.approvedBy || null,
    scheduledAt: clip.scheduledAt, scheduledLabel: clip.scheduledAt ? formatLocal(clip.scheduledAt) : null,
    readyAt: clip.readyAt || null, postedAt: clip.postedAt,
    musicName: clip.musicName, musicVerified: Boolean(clip.musicVerified),
    templateId: clip.templateId, templateName: clip.templateName, templateVersion: clip.templateVersion || 1,
    templateOutdated: Boolean(currentTemplate && Number(currentTemplate.version || 1) > Number(clip.templateVersion || 1)),
    renderVersion: clip.renderVersion || 1, renderVerified: Boolean(clip.renderVerified),
    renderedWidth: clip.renderedWidth || null, renderedHeight: clip.renderedHeight || null,
    smartFraming: clip.smartFraming || null,
    variantOf: clip.variantOf || null, addedAt: clip.addedAt,
    targets: (clip.targets || []).map(social.targetPublic),
    rerender: rerender ? { id: rerender.id, status: rerender.status, stage: rerender.stage, progress: rerender.progress, error: rerender.error || null, asVariant: rerender.asVariant } : null,
    videoUrl: clip.clipUrl || `/api/clips/${encodeURIComponent(clip.id)}/video`, thumbUrl: clip.thumbUrl || `/api/clips/${encodeURIComponent(clip.id)}/thumb`,
  };
}

function appState(user = null) {
  // Everything below is scoped to one account: its records, its settings, its
  // templates, its music, its connected platforms and its activity feed.
  if (!user?.id) return { engine: config.processingMode === 'remote' ? 'remote-worker' : 'self-hosted', user: null, auth: auth.publicConfig(), projects: [], clips: [], log: [] };
  const readiness = agent.engine.readiness(user);
  const projectsForUser = ownedBy(state.projects, user.id);
  const projectIdsForUser = new Set(projectsForUser.map(project => project.id));
  const clipsForUser = ownedBy(state.clips, user.id).filter(clip => projectIdsForUser.has(clip.projectId));
  return {
    engine: config.processingMode === 'remote' ? 'remote-worker' : 'self-hosted', user: auth.userPublic(user), auth: auth.publicConfig(), readiness, clipSettings: clipSettings(user), musicSettings: musicSettings(user), automationSettings: automationSettings(user),
    selectedTemplate: templates.selectedTemplate(user), templates: templates.listTemplates(user), templateDraft: templates.defaultTemplateDraft(),
    tracks: audio.listNasheeds(user),
    projects: projectsForUser.map(project => ({
      id: project.id, title: project.title, url: project.url, engine: project.engine, status: project.status,
      stage: project.stage, progress: project.progress || 0, error: project.error || null, errorCode: project.errorCode || null,
      queuePosition: Math.max(0, Number(project.queuePosition || 0)),
      submittedAt: project.submittedAt, completedAt: project.completedAt || null, clipCount: project.clipCount || 0,
      durationSec: project.durationSec || project.sourceDurationSec || null, sourceDurationSec: project.sourceDurationSec || null, sourceThumbUrl: project.sourceThumbUrl || null, sourceTitle: project.sourceTitle || null, templateIdUsed: project.templateIdUsed,
      templateNameUsed: project.templateNameUsed, templateVersionUsed: project.templateVersionUsed || 1, musicRequired: true,
      sourceReusable: Boolean((project.sourceFile && fs.existsSync(project.sourceFile) && project.transcriptFile && fs.existsSync(project.transcriptFile)) || (project.sourceObjectKey && project.transcriptObjectKey)),
      moreJob: project.moreJob ? {
        id: project.moreJob.id, status: project.moreJob.status, stage: project.moreJob.stage,
        progress: project.moreJob.progress || 0, error: project.moreJob.error || null,
        queuePosition: Math.max(0, Number(project.moreJob.queuePosition || 0)),
        requestedCount: project.moreJob.requestedCount || 0, importedCount: project.moreJob.importedCount || 0,
        createdAt: project.moreJob.createdAt || null, startedAt: project.moreJob.startedAt || null,
        completedAt: project.moreJob.completedAt || null, updatedAt: project.moreJob.updatedAt || null,
        reusedSource: true, reusedTranscript: true,
      } : null,
    })),
    clips: clipsForUser.map(publicClip),
    rerenderJobs: ownedBy(state.rerenderJobs, user.id)
      .filter(job => clipsForUser.some(clip => clip.id === job.clipId))
      .slice(0, 30)
      .map(job => ({
        id: job.id, clipId: job.clipId, status: job.status, stage: job.stage, progress: job.progress,
        error: job.error || null, asVariant: Boolean(job.asVariant), engine: job.engine || '',
        createdAt: job.createdAt || null, startedAt: job.startedAt || null, updatedAt: job.updatedAt || null,
        finishedAt: job.finishedAt || null,
        clipTitle: job.clipTitle || '', projectTitle: job.projectTitle || '',
        templateName: job.templateName || '',
        batchId: job.batchId || '', batchLabel: job.batchLabel || '', batchTotal: Number(job.batchTotal || 0),
        etaSec: Number.isFinite(Number(job.etaSec)) ? Number(job.etaSec) : null,
        currentClip: job.currentClip ?? null, totalClips: job.totalClips ?? null,
        stages: Array.isArray(job.stages) ? job.stages.slice(-12) : [],
      })),
    postTimes: config.postTimes, timezone: config.timezone, activeJobs: agent.engine.activeJobCount(),
    log: logFor(user, 60), directPublishingEnabled: config.socialPublishEnabled,
    publishingSettings: publishingSettings(user), social: social.connectionStatus(user), billing: billing.publicBilling(user),
    brandSettings: cleanBrandSettings(brandSettings(user), user),
    role: String(user?.role || 'creator').toLowerCase(),
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
  if (pathname === '/healthz') return json(res, 200, { ok: true, engine: config.processingMode === 'remote' ? 'remote-worker' : 'self-hosted' });
  if (pathname === '/readyz') {
    const errors = productionConfigurationErrors();
    try { fs.accessSync(config.dataDir, fs.constants.R_OK | fs.constants.W_OK); } catch { errors.push('Persistent data storage is not readable and writable.'); }
    if (config.processingMode === 'remote' && !errors.some(item => item.startsWith('WORKER_'))) {
      try { await workerClient.readiness(); } catch (error) { errors.push(`External worker is not ready: ${error.message}`); }
    }
    return json(res, errors.length ? 503 : 200, { ok: errors.length === 0, engine: config.processingMode, checks: errors.length ? errors : ['configuration', 'storage', 'worker'] });
  }
  const workerCallback = pathname.match(/^\/api\/worker-callbacks\/([^/]+)$/);
  if (method === 'POST' && workerCallback) {
    const raw = await readRawBody(req, 5_000_000);
    if (!verifyWorkerRequest(req, pathname, raw)) return json(res, 401, { error: 'Invalid worker signature.' });
    let update; try { update = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid callback JSON.' }); }
    const project = agent.engine.acceptRemoteUpdate(decodeURIComponent(workerCallback[1]), update);
    return project ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Job not found.' });
  }
  const workerMusic = pathname.match(/^\/api\/worker-assets\/music\/([^/]+)$/);
  if (method === 'GET' && workerMusic) {
    const trackId = decodeURIComponent(workerMusic[1]);
    const userId = String(url.searchParams.get('user') || '');
    if (!agent.engine.verifyWorkerAssetSignature(trackId, userId, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
      return json(res, 401, { error: 'Invalid or expired worker asset link.' });
    }
    const found = audio.nasheedFilePath(userId, trackId);
    if (!found) return json(res, 404, { error: 'Track not found.' });
    return streamFile(req, res, found.file, { contentType: 'audio/mpeg' });
  }
  if (method === 'POST' && pathname === '/api/billing/webhook') {
    try {
      const raw = await readRawBody(req, 5_000_000);
      const event = billing.verifyStripeSignature(raw, req.headers['stripe-signature'] || '');
      billing.handleWebhookEvent(event);
      return json(res, 200, { received: true });
    } catch (error) {
      return json(res, 400, errorBody(error));
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
  if (method === 'POST' && pathname === '/billing/topup') {
    try {
      const body = await formBody(req);
      const session = await billing.createTopupCheckoutSession(currentUser, String(body.package || ''));
      return redirect(res, session.url);
    } catch (error) {
      return redirect(res, `/plans?error=${encodeURIComponent(error.message)}`);
    }
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
    return redirectWithCookies(res, '/', auth.cookieHeaders('', { clear: true }));
  }
  if (method === 'GET' && pathname === '/marketing.css') {
    return streamFile(req, res, marketingCssPage, { contentType: 'text/css; charset=utf-8', cacheControl: 'public, max-age=3600' });
  }
  if (method === 'GET' && pathname === '/marketing.js') {
    return streamFile(req, res, marketingJsPage, { contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' });
  }
  if (method === 'GET' && pathname.startsWith('/marketing-assets/')) {
    const name = path.basename(decodeURIComponent(pathname));
    let file = null;
    for (const dir of marketingAssetDirs) {
      const candidate = path.resolve(dir, name);
      // Keep the traversal guard: the resolved path must stay inside the
      // directory being searched.
      if (!candidate.startsWith(dir + path.sep)) continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { file = candidate; break; }
    }
    if (!file) return json(res, 404, { error: 'Marketing asset not found.' });
    const extension = path.extname(file).toLowerCase();
    const contentType = extension === '.webp' ? 'image/webp' : extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
    return streamFile(req, res, file, { contentType, cacheControl: 'public, max-age=86400' });
  }
  if (method === 'GET' && pathname === '/robots.txt') {
    const origin = marketingContext(req).base;
    const body = [
      'User-agent: *',
      'Allow: /',
      // Everything below is behind login. Indexing it wastes crawl budget
      // and surfaces endpoints that should not be in search results.
      'Disallow: /app',
      'Disallow: /plans',
      'Disallow: /admin',
      'Disallow: /auth/',
      'Disallow: /api/',
      'Disallow: /billing/',
      '',
      `Sitemap: ${origin}/sitemap.xml`,
      '',
    ].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(body);
  }
  if (method === 'GET' && pathname === '/sitemap.xml') {
    const origin = marketingContext(req).base;
    const pages = [
      { path: '/', priority: '1.0', freq: 'weekly' },
      { path: '/features', priority: '0.8', freq: 'monthly' },
      { path: '/pricing', priority: '0.9', freq: 'weekly' },
      { path: '/contact', priority: '0.4', freq: 'yearly' },
      { path: '/privacy', priority: '0.3', freq: 'yearly' },
      { path: '/terms', priority: '0.3', freq: 'yearly' },
    ];
    const today = new Date().toISOString().slice(0, 10);
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + pages.map(page => `  <url><loc>${origin}${page.path === '/' ? '' : page.path}</loc>`
        + `<lastmod>${today}</lastmod><changefreq>${page.freq}</changefreq>`
        + `<priority>${page.priority}</priority></url>`).join('\n')
      + `\n</urlset>\n`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(body);
  }
  // Browsers request these at the root regardless of what the HTML declares.
  if (method === 'GET' && (pathname === '/favicon.ico' || pathname === '/favicon.png')) {
    const file = path.resolve(config.root, 'src', 'public', 'marketing-assets', 'favicon-32.png');
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Favicon not found.' });
    return streamFile(req, res, file, { contentType: 'image/png', cacheControl: 'public, max-age=604800' });
  }
  if (method === 'GET' && pathname === '/apple-touch-icon.png') {
    const file = path.resolve(config.root, 'src', 'public', 'marketing-assets', 'apple-touch-icon.png');
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Icon not found.' });
    return streamFile(req, res, file, { contentType: 'image/png', cacheControl: 'public, max-age=604800' });
  }
  if (method === 'GET' && pathname === '/features') return html(res, 200, featuresPage(req));
  if (method === 'GET' && pathname === '/pricing') return html(res, 200, pricingPage(req));
  if (method === 'GET' && pathname === '/contact') return html(res, 200, contactPage(req));
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
  if (method === 'GET' && pathname === '/premium-dashboard.js') {
    if (!fs.existsSync(premiumDashboardPage)) return json(res, 404, { error: 'Premium dashboard script not found.' });
    const body = fs.readFileSync(premiumDashboardPage);
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (method === 'GET' && pathname === '/studio-v6.css') {
    if (!fs.existsSync(studioV6CssPage)) return json(res, 404, { error: 'Studio V6 stylesheet not found.' });
    const body = fs.readFileSync(studioV6CssPage);
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
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
    const remoteClip = state.clips.find(item => item.id === clipId);
    if (remoteClip?.clipUrl) return temporaryRedirect(res, remoteClip.clipUrl);
    // This signed link is what a social platform fetches the video from, so
    // a preview-quality file reaching it would be published at that quality.
    try { agent.engine.assertExportQuality(remoteClip); }
    catch (error) { return json(res, error.statusCode || 409, errorBody(error)); }
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
  if (!auth.enabled() && !auth.sessionUser(req) && !authed(req, url)) return json(res, 401, { error: 'Wrong password.' });

  if (method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { user: auth.userPublic(currentUser), auth: auth.publicConfig() });
  if (method === 'GET' && pathname === '/api/state') return json(res, 200, appState(currentUser));
  if (method === 'GET' && pathname === '/api/billing') return json(res, 200, billing.publicBilling(currentUser));
  if (method === 'GET' && pathname === '/api/brand-settings') {
    return json(res, 200, { settings: cleanBrandSettings(brandSettings(currentUser), currentUser), features: billing.featureAccess(currentUser) });
  }
  if (method === 'POST' && pathname === '/api/brand-settings') {
    const body = await readBody(req);
    try {
      const settings = setBrandSettings(currentUser, cleanBrandSettings(body, currentUser));
      log(`Brand Kit updated${billing.featureAccess(currentUser).watermarkRequired ? ' with the required free-plan watermark' : ''}.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, settings: cleanBrandSettings(settings, currentUser), features: billing.featureAccess(currentUser) });
    } catch (error) { return json(res, 400, errorBody(error)); }
  }
  if (method === 'POST' && pathname === '/api/billing/estimate') {
    const body = await readBody(req);
    try { return json(res, 200, billing.estimateTokenCharge(currentUser, Number(body.minutes || body.sourceMinutes || 0))); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  if (method === 'POST' && pathname === '/api/billing/checkout') {
    const body = await readBody(req);
    try { return json(res, 200, await billing.createCheckoutSession(currentUser, String(body.plan || ''))); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  if (method === 'POST' && pathname === '/api/billing/topup-checkout') {
    const body = await readBody(req);
    try { return json(res, 200, await billing.createTopupCheckoutSession(currentUser, String(body.package || ''))); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  if (method === 'POST' && pathname === '/api/billing/portal') {
    try { return json(res, 200, await billing.createPortalSession(currentUser)); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }

  if (method === 'GET' && pathname === '/api/admin/analytics') {
    try { requireOperator(currentUser); return json(res, 200, admin.analytics(currentUser)); }
    catch (error) { return json(res, error.statusCode || 404, errorBody(error)); }
  }

  if (method === 'GET' && pathname === '/api/admin/operations') {
    try { requireOperator(currentUser); return json(res, 200, await adminOps.operations(currentUser)); }
    catch (error) { return json(res, error.statusCode || 404, errorBody(error)); }
  }

  if (method === 'POST' && pathname === '/api/admin/service-meta') {
    try {
      requireOperator(currentUser);
      const body = await readBody(req);
      return json(res, 200, adminOps.saveServiceMeta(currentUser, body));
    } catch (error) { return json(res, error.statusCode || 400, errorBody(error)); }
  }

  if (method === 'GET' && pathname === '/api/admin/vendors') {
    try { requireOperator(currentUser); return json(res, 200, adminOps.listVendors(currentUser)); }
    catch (error) { return json(res, error.statusCode || 404, errorBody(error)); }
  }

  if (method === 'POST' && pathname === '/api/admin/vendors') {
    try {
      requireOperator(currentUser);
      const body = await readBody(req);
      return json(res, 200, adminOps.saveVendor(currentUser, body));
    } catch (error) { return json(res, error.statusCode || 400, errorBody(error)); }
  }

  if (method === 'DELETE' && pathname.startsWith('/api/admin/vendors/')) {
    try {
      requireOperator(currentUser);
      const id = decodeURIComponent(pathname.slice('/api/admin/vendors/'.length));
      return json(res, 200, adminOps.deleteVendor(currentUser, id));
    } catch (error) { return json(res, error.statusCode || 400, errorBody(error)); }
  }

  const socialConnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/connect$/);
  if (method === 'POST' && socialConnect) {
    try { return json(res, 200, { url: social.oauthStartUrl(socialConnect[1], currentUser?.id) }); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  const socialDisconnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/disconnect$/);
  if (method === 'POST' && socialDisconnect) {
    try { await social.disconnect(socialDisconnect[1], currentUser); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, errorBody(error)); }
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
    } catch (error) { return json(res, 400, errorBody(error)); }
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

  if (method === 'POST' && pathname === '/api/uploads/presign') {
    const body = await readBody(req);
    try {
      const upload = objectStorage.createUpload(currentUser.id, String(body.fileName || ''), String(body.contentType || 'video/mp4'));
      return json(res, 200, { ok: true, ...upload });
    } catch (error) { return json(res, 400, errorBody(error)); }
  }

  if (method === 'POST' && pathname === '/api/videos') {
    const body = await readBody(req);
    if (body.objectKey) {
      try {
        const objectKey = assertStorageObjectKey(body.objectKey);
        const projectId = await agent.submitVideo(objectKey, body.title || body.fileName || '', currentUser.id, {
          sourceKind: 'object_storage', originalFileName: body.fileName || '', displayUrl: `Uploaded file · ${body.fileName || 'video'}`,
          sourceMeta: { title: body.title || body.fileName || '', durationSec: Number(body.durationSec || 0) || null, thumbnail: '' },
          sourceRange: { startSec: Number(body.sourceStartSeconds || 0), endSec: Number(body.sourceEndSeconds) || null },
        });
        return json(res, 201, { ok: true, projectId });
      } catch (error) { return json(res, 400, errorBody(error)); }
    }
    const urls = String(body.urls || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
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

  if (method === 'POST' && pathname === '/api/video-uploads') {
    if (config.processingMode === 'remote') {
      return json(res, 409, { error: 'Large videos upload directly to secure object storage. Refresh the app and try Upload MP4 again.', directUploadRequired: true });
    }
    let upload = null;
    try {
      upload = await saveVideoUpload(req, currentUser.id);
      const sourceStartSeconds = Math.max(0, Math.round(Number(req.headers['x-source-start-seconds'] || 0)));
      const sourceEndRaw = Number(req.headers['x-source-end-seconds']);
      const sourceEndSeconds = Number.isFinite(sourceEndRaw) && sourceEndRaw > sourceStartSeconds ? Math.round(sourceEndRaw) : null;
      if (sourceEndSeconds !== null && sourceEndSeconds - sourceStartSeconds < 30) throw new Error('Choose at least 30 seconds of source video.');
      const durationSec = Math.max(0, Math.round(Number(req.headers['x-source-duration-seconds'] || 0)));
      const projectId = await agent.submitVideo(upload.filePath, upload.title, currentUser.id, {
        sourceRange: { startSec: sourceStartSeconds, endSec: sourceEndSeconds },
        sourceMeta: { title: upload.title, durationSec: durationSec || null, thumbnail: '' },
        sourceKind: 'upload', originalFileName: upload.fileName, uploadedInputFile: upload.filePath,
        displayUrl: `Uploaded file · ${upload.fileName}`,
      });
      return json(res, 201, { ok: true, projectId, fileName: upload.fileName, size: upload.size });
    } catch (error) {
      if (upload?.filePath) removeUploadedFile(upload.filePath);
      return json(res, error.statusCode || 400, errorBody(error));
    }
  }

  const projectRetry = pathname.match(/^\/api\/projects\/([^/]+)\/retry$/);
  if (method === 'POST' && projectRetry) {
    try { const id = decodeURIComponent(projectRetry[1]); assertCanAccessProject(currentUser, id); return json(res, 200, { ok: true, project: agent.engine.retryProject(id) }); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  const projectMore = pathname.match(/^\/api\/projects\/([^/]+)\/more-clips$/);
  if (method === 'POST' && projectMore) {
    const body = await readBody(req);
    try {
      const id = decodeURIComponent(projectMore[1]); assertCanAccessProject(currentUser, id);
      const job = agent.engine.queueMoreClips(id, Number(body.count || 8));
      return json(res, 202, { ok: true, job });
    } catch (error) { return json(res, 400, errorBody(error)); }
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === 'DELETE' && projectMatch) {
    try { const id = decodeURIComponent(projectMatch[1]); assertCanAccessProject(currentUser, id); agent.engine.deleteProject(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, errorBody(error)); }
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
    } catch (error) { return json(res, 400, errorBody(error)); }
  }
  const duplicateTemplate = pathname.match(/^\/api\/templates\/([^/]+)\/duplicate$/);
  if (method === 'POST' && duplicateTemplate) {
    const body = await readBody(req);
    try {
      const template = templates.duplicateTemplate(currentUser, decodeURIComponent(duplicateTemplate[1]), body.name);
      templates.setSelectedTemplate(currentUser, template.id);
      return json(res, 200, { ok: true, template });
    } catch (error) { return json(res, 400, errorBody(error)); }
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
    } catch (error) { return json(res, 400, errorBody(error)); }
  }
  if (method === 'DELETE' && templateMatch) {
    try { templates.deleteTemplate(currentUser, decodeURIComponent(templateMatch[1])); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, errorBody(error)); }
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
    } catch (error) { return json(res, 400, errorBody(error)); }
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
    catch (error) { return json(res, 400, errorBody(error)); }
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

  if (pathname === '/api/diagnostics') {
    try { requireOperator(currentUser); }
    catch (error) { return json(res, error.statusCode || 404, errorBody(error)); }
  }
  if (method === 'GET' && pathname === '/api/diagnostics') {
    if (config.processingMode === 'remote') {
      try {
        const worker = await workerClient.readiness();
        return json(res, 200, { ok: Boolean(worker.ready), worker, readiness: agent.engine.readiness(currentUser), model: config.aiModel, note: 'Heavy processing runs on the external worker.' });
      } catch (error) {
        return json(res, 503, { ok: false, error: error.message, readiness: agent.engine.readiness(currentUser) });
      }
    }
    const [ffmpeg, worker] = await Promise.all([checkFfmpeg(), runDoctor()]);
    return json(res, 200, { ok: ffmpeg.ok && worker.ok, ffmpeg, worker, readiness: agent.engine.readiness(currentUser), python: config.pythonBin, model: config.aiModel, note: 'The first real transcription downloads the selected Whisper model once.' });
  }

  if (method === 'POST' && pathname === '/api/clips/schedule-selected') {
    const body = await readBody(req);
    try {
      for (const id of (Array.isArray(body.ids) ? body.ids : [])) assertCanAccessClip(currentUser, String(id));
      const summary = agent.scheduleSelected(body.ids);
      return json(res, 200, { ok: summary.failed === 0, ...summary });
    } catch (error) { return json(res, 400, errorBody(error)); }
  }

  const sourcePreview = pathname.match(/^\/api\/clips\/([^/]+)\/source-preview$/);
  if (method === 'GET' && sourcePreview) {
    let clip; try { clip = assertCanAccessClip(currentUser, decodeURIComponent(sourcePreview[1])); } catch (error) { return json(res, error.statusCode || 400, errorBody(error)); }
    const project = clip ? state.projects.find(item => item.id === clip.projectId) : null;
    const sourceFile = clip?.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project?.sourceFile;
    if (!clip) return json(res, 404, { error: 'Clip not found.' });
    if (sourceFile && fs.existsSync(sourceFile)) return streamFile(req, res, sourceFile, { contentType: 'video/mp4' });

    // Remote workers keep the clean project source in private object storage.
    // The persisted sourceUrl is the bucket address, not necessarily a public
    // URL, so redirecting to it directly makes the editor report a missing file
    // even though the object exists. Sign a short-lived owner-scoped preview URL
    // instead. Access to this route has already been checked through the clip.
    const sourceObjectKey = String(clip.sourceObjectKey || project?.sourceObjectKey || '').trim();
    if (sourceObjectKey) {
      if (!/^projects\/[A-Za-z0-9._/-]+\/source\.mp4$/.test(sourceObjectKey) || sourceObjectKey.split('/').includes('..')) {
        return json(res, 400, { error: 'The stored source video reference is invalid.' });
      }
      if (!objectStorage.configured()) {
        return json(res, 503, { error: 'The clean source preview is temporarily unavailable because object storage is not configured.' });
      }
      try {
        return temporaryRedirect(res, objectStorage.presign({ method: 'GET', key: sourceObjectKey, expiresSec: 900 }));
      } catch (error) {
        return json(res, 503, { error: `The clean source preview could not be prepared: ${error.message}` });
      }
    }

    // Keep support for deliberately public/external source URLs created by
    // older imports, but only after trying the private object key above.
    if (project?.sourceUrl) return temporaryRedirect(res, project.sourceUrl);
    return json(res, 404, { error: 'The clean source video is unavailable.' });
  }

  const clipVideo = pathname.match(/^\/api\/clips\/([^/]+)\/(video|download|thumb)$/);
  if (method === 'GET' && clipVideo) {
    const id = decodeURIComponent(clipVideo[1]); const kind = clipVideo[2];
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 400, errorBody(error)); }
    const remoteUrl = kind === 'thumb' ? clip?.thumbUrl : clip?.clipUrl;
    if (remoteUrl) return temporaryRedirect(res, remoteUrl);
    const file = agent.engine.clipFilePath(id, kind === 'thumb' ? 'thumb' : 'video'); if (!file) return json(res, 404, { error: 'Rendered file not found.' });
    if (kind === 'thumb') return streamFile(req, res, file, { contentType: 'image/jpeg' });
    // A fast preview render may be streamed for review inside the app, but
    // never handed over as a file the customer keeps.
    if (kind === 'download') {
      try { agent.engine.assertExportQuality(clip); }
      catch (error) { return json(res, error.statusCode || 409, errorBody(error)); }
    }
    const filename = `${(clip?.title || 'deenclipped').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'deenclipped'}.mp4`;
    return streamFile(req, res, file, kind === 'download' ? { downloadName: filename } : {});
  }

  const rerenderClip = pathname.match(/^\/api\/clips\/([^/]+)\/rerender$/);
  if (method === 'POST' && rerenderClip) {
    const body = await readBody(req);
    try {
      const id = decodeURIComponent(rerenderClip[1]);
      assertCanAccessClip(currentUser, id);
      const options = { asVariant: Boolean(body.asVariant) };
      // Only forward a framing choice the caller actually made, so a plain
      // re-render does not silently clear an override set earlier.
      if (body.framingBias !== undefined) options.framingBias = String(body.framingBias);
      return json(res, 202, { ok: true, job: agent.engine.queueClipRerender(id, String(body.templateId || ''), options) });
    }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  const clipPublish = pathname.match(/^\/api\/clips\/([^/]+)\/publish$/);
  if (method === 'POST' && clipPublish) {
    try { const id = decodeURIComponent(clipPublish[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(await agent.publishNow(id)) }); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  const clipRetryPublish = pathname.match(/^\/api\/clips\/([^/]+)\/retry-publish$/);
  if (method === 'POST' && clipRetryPublish) {
    const body = await readBody(req);
    try { const id = decodeURIComponent(clipRetryPublish[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.retryPublishing(id, String(body.provider || ''))) }); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  const clipReady = pathname.match(/^\/api\/clips\/([^/]+)\/ready$/);
  if (method === 'POST' && clipReady) {
    try { const id = decodeURIComponent(clipReady[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.readyNow(id)) }); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  const clipPosted = pathname.match(/^\/api\/clips\/([^/]+)\/posted$/);
  if (method === 'POST' && clipPosted) {
    try { const id = decodeURIComponent(clipPosted[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.markPosted(id)) }); }
    catch (error) { return json(res, 400, errorBody(error)); }
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
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, errorBody(error)); }

    const project = state.projects.find(item => item.id === clip.projectId);
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    const duration = Math.max(0, clipEnd - clipStart);

    let words = [];
    let exact = false;
    if ((project?.transcriptFile && fs.existsSync(project.transcriptFile)) || project?.transcriptObjectKey) {
      try {
        const segments = await projectTranscriptSegments(project);
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
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, errorBody(error)); }
    const project = state.projects.find(item => item.id === clip.projectId);
    if ((!project?.transcriptFile || !fs.existsSync(project.transcriptFile)) && !project?.transcriptObjectKey) {
      return json(res, 400, { error: 'No transcript is stored for this lecture, so speech timing cannot be recovered.' });
    }
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    try {
      const segments = await projectTranscriptSegments(project);
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
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, errorBody(error)); }
    if (!billing.featureAccess(currentUser).advancedFraming) {
      return json(res, 403, {
        error: 'AI active-speaker framing is included with Monthly and Yearly Premium.',
        code: 'premium_feature',
        feature: 'advancedFraming',
      });
    }
    const project = state.projects.find(item => item.id === clip.projectId);
    const body = await readBody(req);
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    const duration = Math.max(0, clipEnd - clipStart);
    if (duration < 0.25 || duration > 180) {
      return json(res, 400, { error: 'This clip duration cannot be analysed for framing.' });
    }

    // Give the tracker the real speech spans so it holds position during
    // silence instead of chasing detector noise when nobody is talking.
    let speechSpans = [];
    try {
      const segments = await projectTranscriptSegments(project);
      speechSpans = wordsForClip(segments, clipStart, clipEnd).map(w => [w.start, w.end]);
    } catch { speechSpans = []; }

    const requestPayload = {
      start: clipStart, duration,
      width: Number(body.width) || 1080, height: Number(body.height) || 1920,
      bias: String(body.bias || 'auto'), padding: Number(body.padding ?? 0.18),
      zoom: Number(body.zoom ?? 1), smoothing: Number(body.smoothing ?? 0.68),
      sampleHz: Math.max(1, Math.min(5, Number(body.sampleHz) || 3)), speechSpans,
    };
    const sourceFile = clip?.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project?.sourceFile;

    // Production clips live in object storage and are rendered by the
    // third-party worker. Analyse them there instead of incorrectly claiming
    // the source has disappeared just because Render has no local copy.
    if ((!sourceFile || !fs.existsSync(sourceFile)) && project?.sourceObjectKey && workerClient.configured()) {
      try {
        const result = await workerClient.analyseFraming({ ...requestPayload, sourceKey: project.sourceObjectKey });
        return json(res, 200, { plan: result.plan || result });
      } catch (error) {
        return json(res, 200, { plan: { available: false, reason: `Speaker analysis is temporarily unavailable: ${error.message}` } });
      }
    }
    if (!sourceFile || !fs.existsSync(sourceFile)) {
      return json(res, 200, { plan: { available: false, reason: 'The original video is no longer stored, so framing cannot be analysed.' } });
    }

    const requestFile = path.join(config.dataDir, `framing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(requestFile, JSON.stringify({
      ...requestPayload, source: sourceFile, ffprobe: config.ffprobePath || 'ffprobe',
    }));

    try {
      const plan = await new Promise((resolve) => {
        const child = spawn(config.pythonBin, [config.workerScript, '--framing', requestFile], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ available: false, reason: 'Framing analysis took too long and was stopped.' }); }, 180000);
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
    } catch (error) { return json(res, 400, errorBody(error)); }
  }
  if (clipMatch && method === 'DELETE') {
    try { const id = decodeURIComponent(clipMatch[1]); assertCanAccessClip(currentUser, id); agent.deleteClip(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, errorBody(error)); }
  }
  return json(res, 404, { error: 'Not found.' });
}

export const server = http.createServer((req, res) => {
  applySecurityHeaders(res);
  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return json(res, 400, { error: 'Bad request.' }); }
  if (unsafeCrossSiteRequest(req, url)) return json(res, 403, { error: 'Cross-site request blocked.' });
  if (req.method === 'POST' && ['/auth/email', '/auth/password'].includes(url.pathname) && authRateLimited(req)) {
    res.setHeader('Retry-After', '900');
    return json(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  }
  route(req, res, url).catch(error => { console.error(error); if (!res.headersSent) json(res, 500, errorBody(error)); });
});
server.listen(config.port, () => { console.log(`DeenClipped self-hosted engine listening on http://localhost:${config.port}`); agent.start(); });
