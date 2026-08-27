import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, productionConfigurationErrors, fatalConfigurationErrors } from './config.js';
import {
  state, save, log, logFor, clipSettings, setClipSettings, musicSettings, setMusicSettings,
  automationSettings, setAutomationSettings, publishingSettings, setPublishingSettings,
  importNetworkSettings, setImportNetworkSettings, stateRev,
} from './store.js';
import { ownedBy, findOwned } from './tenancy.js';
import * as audio from './audio.js';
import * as templates from './templates.js';
import * as throttle from './throttle.js';
import * as backgrounds from './backgrounds.js';
import { wordsForClip, silenceSpans } from './captions.js';
import * as agent from './agent.js';
import * as backup from './backup.js';
import * as alerts from './alerts.js';
import * as ownerFeed from './owner-feed.js';
import { fallbackThumb } from './local-engine.js';
import * as social from './social.js';
import { formatLocal } from './slots.js';
import { checkFfmpeg } from './ffmpeg.js';
import * as auth from './auth.js';
import * as billing from './billing.js';
import * as marketing from './marketing.js';
import * as admin from './admin.js';
import * as owner from './owner.js';
import { startYouTubeRetention } from './youtube-retention.js';
import { saveVideoUpload, removeUploadedFile } from './uploads.js';
import * as objectStorage from './object-storage.js';
import { assertStorageObjectKey } from './video-import.js';
import * as workerClient from './worker-client.js';

const page = path.join(config.root, 'src', 'public', 'index.html');
const activityFixPage = path.join(config.root, 'src', 'public', 'activity-fix.js');
const premiumDashboardPage = path.join(config.root, 'src', 'public', 'premium-dashboard.js');
const ownerPage = path.join(config.root, 'src', 'public', 'owner.html');
const ownerScript = path.join(config.root, 'src', 'public', 'owner.js');
const ownerStyles = path.join(config.root, 'src', 'public', 'owner.css');
const marketingCssPage = path.join(config.root, 'src', 'public', 'marketing.css');
const studioAsset = name => path.join(config.root, 'src', 'public', name);
const JS_TYPE = 'text/javascript; charset=utf-8';
const STUDIO_ASSETS = {
  '/studio-template.generated.js': { file: studioAsset('studio-template.generated.js'), type: JS_TYPE },
  '/studio-runtime.js': { file: studioAsset('studio-runtime.js'), type: JS_TYPE },
  '/studio-adapter.js': { file: studioAsset('studio-adapter.js'), type: JS_TYPE },
  '/studio-styles.generated.css': { file: studioAsset('studio-styles.generated.css'), type: 'text/css; charset=utf-8' },
  // The browser-tab identity. /favicon.ico is served as PNG -- every modern
  // browser accepts it, and agents that request the path blindly stop 404ing.
  '/favicon.svg': { file: studioAsset('favicon.svg'), type: 'image/svg+xml' },
  '/favicon.ico': { file: studioAsset('apple-touch-icon.png'), type: 'image/png' },
  '/apple-touch-icon.png': { file: studioAsset('apple-touch-icon.png'), type: 'image/png' },
  '/og-image.jpg': { file: studioAsset('og-image.jpg'), type: 'image/jpeg' },
};
const marketingJsPage = path.join(config.root, 'src', 'public', 'marketing.js');
// Marketing images are looked for in a dedicated subfolder first, then in
// src/public itself. They are currently committed directly to src/public, so
// serving only from the subfolder means every request 404s against a directory
// that does not exist. Accepting both keeps existing files working and still
// supports tidying them into the subfolder later.
const marketingAssetDirs = [
  path.resolve(config.root, 'src', 'public', 'marketing-assets'),
  path.resolve(config.root, 'src', 'public'),
];

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
// Rendered media lives in R2. Its pub-*.r2.dev public endpoint is a dev URL
// that Cloudflare rate-limits (measured: consecutive GET 503s mid-session),
// so when MEDIA_PUBLIC_BASE names a custom domain on the same bucket, every
// r2.dev URL is swapped to it here -- one choke point, stored records untouched.
function mediaUrl(url) {
  if (!url || !config.mediaPublicBase) return url || '';
  try {
    const parsed = new URL(url);
    if (parsed.host.endsWith('.r2.dev')) return config.mediaPublicBase + parsed.pathname + parsed.search;
  } catch { /* not a URL: leave it alone */ }
  return url;
}

function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
function temporaryRedirect(res, location) { res.writeHead(307, { Location: location, 'Cache-Control': 'private, no-store' }); res.end(); }

function redirectWithCookies(res, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(302, headers); res.end();
}
/**
 * The client address, as far as it can be trusted.
 *
 * Behind exactly one proxy the LAST entry of x-forwarded-for is the address
 * that proxy actually observed; anything earlier was supplied by the caller
 * and can be invented. Reading the first entry -- the usual mistake -- would
 * let an attacker send a fresh fake address on every request and walk straight
 * past a per-IP limit.
 */
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
  if (forwarded.length) return forwarded[forwarded.length - 1];
  return req.socket?.remoteAddress || '';
}

/** A refused attempt says how long to wait, and nothing about the account. */
/**
 * Work costs real money -- worker time, storage, egress -- so it waits for a
 * confirmed address. Only where email can actually be sent: on a deployment
 * with no provider configured every account counts as verified and nothing
 * changes, because refusing there would refuse everyone forever.
 */
function assertVerified(user) {
  if (auth.isVerified(user)) return;
  const error = new Error('Confirm your email address first — we sent you a link. Check your inbox, including spam.');
  error.statusCode = 403;
  error.needsVerification = true;
  throw error;
}

function tooManyAttempts(res, retryAfterSec, returnTo) {
  res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
  const wait = retryAfterSec >= 60
    ? `${Math.ceil(retryAfterSec / 60)} minutes`
    : `${Math.max(1, retryAfterSec)} seconds`;
  return redirect(res, `/login?error=${encodeURIComponent(`Too many sign-in attempts. Try again in ${wait}.`)}&returnTo=${encodeURIComponent(returnTo || '/app')}`);
}

const CSRF_EXEMPT = new Set(['/auth/apple/callback']);

// Link previews, briefly. The title and duration of a lecture do not change
// between two pastes of the same URL, and every miss is a live API call.
const sourceInfoCache = new Map();

/**
 * A state-changing POST must come from this site.
 *
 * Browsers send Origin on every cross-origin POST, so an absent Origin with a
 * Referer that disagrees is equally a refusal. Apple's form_post callback is
 * genuinely cross-origin and carries its own signed token, and the Stripe and
 * worker webhooks verify signatures of their own, so those are exempt.
 */
function sameOriginPost(req, url) {
  if (CSRF_EXEMPT.has(url.pathname)) return true;
  const expected = (config.publicBaseUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || ''}`).replace(/\/+$/, '');
  const origin = String(req.headers.origin || '');
  if (origin) return origin.replace(/\/+$/, '') === expected;
  const referer = String(req.headers.referer || '');
  if (referer) { try { return new URL(referer).origin.replace(/\/+$/, '') === expected; } catch { return false; } }
  // Neither header: not a browser form post from this site.
  return false;
}

function html(res, status, value) {
  const body = Buffer.from(String(value));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function importNetworkPage({ saved = false, error = '' } = {}) {
  const current = importNetworkSettings();
  const mask = value => {
    try { const u = new URL(value); return `${u.protocol}//…@${u.hostname}:${u.port || '80'}`; } catch { return '(set)'; }
  };
  const esc = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // Credentials are never echoed back into the form: a saved proxy shows as a
  // masked summary and saved cookies as a count, so the page can be screenshared
  // without leaking either. Submitting empty fields clears them.
  const cookieLines = current.cookiesText ? current.cookiesText.split('\n').filter(line => line.includes('youtube.com')).length : 0;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Import network — DeenClipped</title>
<style>body{font:15px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#1a1a1a}
input,textarea{width:100%;padding:8px;margin:4px 0 16px;border:1px solid #bbb;border-radius:6px;font:inherit}
textarea{height:140px;font-family:ui-monospace,monospace;font-size:12px}
button{padding:10px 22px;border:0;border-radius:6px;background:#111;color:#fff;font:inherit;cursor:pointer}
.ok{background:#e8f6ec;border:1px solid #9fd4ad;padding:10px 14px;border-radius:6px}
.err{background:#fbeaea;border:1px solid #e3a6a6;padding:10px 14px;border-radius:6px}
small{color:#666}</style>
<h1>Import network</h1>
<p>Used by the worker's YouTube downloader to get past the bot wall on its datacenter IP. Saved values are sent to the worker with each import job; they are never shown back here.</p>
${saved ? '<p class="ok">Saved. The next URL import uses these settings — no rebuild needed.</p>' : ''}
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post">
<label>Residential proxy URL <small>— currently ${current.proxy ? esc(mask(current.proxy)) : 'not set'}</small></label>
<input name="proxy" placeholder="http://username:password@host:port" autocomplete="off">
<label>YouTube cookies export <small>— currently ${cookieLines ? `${cookieLines} youtube.com cookie(s) saved` : 'not set'}. Use a throwaway Google account, never the channel's.</small></label>
<textarea name="cookiesText" placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;…"></textarea>
<label><input type="checkbox" name="clearProxy" value="1" style="width:auto"> clear the saved proxy</label>
<label><input type="checkbox" name="clearCookies" value="1" style="width:auto"> clear the saved cookies</label>
<p><button>Save</button></p>
<p><small>An empty field keeps what is already saved; use the checkboxes to clear.</small></p>
</form>`;
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

// Injected into <head> for the Studio shell. Declared here, once, because the
// Content-Security-Policy has to allow this exact text by hash: shipping it as
// a literal at the injection site meant the policy knew nothing about it, the
// browser refused it, window.STUDIO_SHELL was never set, and every visitor got
// the old dashboard instead of the studio.
const STUDIO_SHELL_SCRIPT = 'window.STUDIO_SHELL=true;';

function serveAppShell(req, res, url, currentUser) {
  if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  if (auth.enabled() && currentUser && billing.needsPlanChoice(currentUser)) return redirect(res, `/plans?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  let html = fs.readFileSync(page, 'utf8');
  // activity-fix.js builds the current dashboard shell (#dcSidebar/#dcTopbar/#dcWork)
  // by appending to document.body, and premium-dashboard.js layers onto it. The
  // Studio dashboard is a full replacement for that shell, so the two cannot both
  // run — loading them together leaves each overwriting the other's markup.
  // `?studio=1` serves the page without them.
  // The Studio dashboard is the default. `?classic=1` serves the previous shell
  // and is the escape hatch: the two cannot both run, so if something is wrong
  // with Studio in production that URL is the way back without a deploy.
  const studioShell = url.searchParams.get('classic') !== '1';
  if (studioShell) {
    // Into <head>, not before </body>: the page's inline script calls boot() during
    // parse, so a flag set at the end of the body would arrive after the decision.
    // The page reads this rather than sniffing for the scripts, so that merely
    // mentioning a script path in index.html cannot change what gets injected.
    html = html.replace('</head>', `<script>${STUDIO_SHELL_SCRIPT}</script>\n</head>`);
  } else {
    const has = tag => html.includes(`src="${tag}"`);
    if (!has('/activity-fix.js')) html = html.replace('</body>', '<script src="/activity-fix.js"></script>\n</body>');
    if (!has('/premium-dashboard.js')) html = html.replace('</body>', '<script src="/premium-dashboard.js"></script>\n</body>');
  }
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

// One clip's look becomes the shared template (per-account patch on a
// built-in). Framing never travels. Returns the saved template.
function promoteClipLook(user, clip) {
  const overrides = clip.styleOverrides && Object.keys(clip.styleOverrides).length ? clip.styleOverrides : null;
  if (!overrides) throw new Error('This clip has no changes of its own to apply.');
  const base = templates.templateById(clip.templateId, user);
  if (!base) throw new Error('The style this clip uses no longer exists.');
  const look = { ...overrides };
  for (const field of templates.FRAMING_FIELDS) delete look[field];
  if (!Object.keys(look).length) throw new Error('Only framing was changed, and framing belongs to this clip alone.');
  const { template } = templates.saveTemplate(user, base.id, look);
  // The look now lives in the style itself; holding it twice would make a
  // later style edit look like it had no effect on this clip. The framing
  // never travelled, so it stays the clip's own.
  const keptFraming = {};
  for (const field of templates.FRAMING_FIELDS) {
    if (clip.styleOverrides[field] !== undefined) keptFraming[field] = clip.styleOverrides[field];
  }
  if (Object.keys(keptFraming).length) clip.styleOverrides = keptFraming;
  else delete clip.styleOverrides;
  clip.stylePending = true;
  return template;
}

function queueTemplateForEveryUnpostedClip(template, user, reason = 'template update', projectId = '') {
  let queued = 0;
  let skipped = 0;
  const errors = [];
  // Only the acting account's clips. This used to sweep `state.clips`, so one
  // customer saving a template queued a re-render of every other customer's
  // work onto their own template.
  for (const clip of ownedBy(state.clips, user?.id)) {
    if (clip.status === 'posted' || clip.variantOf) { skipped += 1; continue; }
    // Saving from the clip editor applies to that lecture, per the design; the
    // Templates screen still applies to everything unposted.
    if (projectId && clip.projectId !== projectId) { skipped += 1; continue; }
    // ... everything unposted THAT USES THIS TEMPLATE. Without this, saving
    // Quran Recitation queued a re-render of every unposted clip the account
    // had ever made -- lecture clips, old test clips -- onto the recitation
    // template, flooding the worker with twenty-plus renders nobody asked for
    // and overwriting clips with a style that was never theirs.
    if (clip.templateId !== template.id) { skipped += 1; continue; }
    try {
      agent.engine.queueClipRerender(clip.id, template.id, { asVariant: false, priority: 2 });
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
  if (!config.workerSharedSecret || !timestamp || !supplied || Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = crypto.createHmac('sha256', config.workerSharedSecret).update(`${timestamp}\n${req.method || 'GET'}\n${pathname}\n${rawBody}`).digest('hex');
  return sameSecret(expected, supplied);
}
function authed(req, url) { return !config.password || sameSecret(req.headers['x-app-password'] || url.searchParams.get('pw') || '', config.password); }
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    // A declared length over the cap is refused before a byte is buffered.
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new Error('Request body is too large.'));
      req.destroy();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Request body was not valid JSON.')); }
    });
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

function latestRerender(clipId) {
  // The full render outranks a preview window in the status line -- the
  // preview's whole life is seconds, and it has its own chip in the editor.
  const jobs = state.rerenderJobs.filter(job => job.clipId === clipId);
  return jobs.find(job => !job.preview && ['queued', 'processing'].includes(job.status)) || jobs[0] || null;
}
function publicClip(clip, { detail = false } = {}) {
  // Resolved as the clip's owner sees it. Without the user, the account's own
  // template edits are invisible here, so "outdated" compared against the
  // shipped file and the badge never showed for an edited built-in.
  const currentTemplate = templates.templateById(clip.templateId, clip.userId || '');
  const rerender = latestRerender(clip.id);
  return {
    id: clip.id, projectId: clip.projectId, projectTitle: clip.projectTitle,
    title: clip.title, description: clip.description, hashtags: clip.hashtags, transcript: clip.transcript,
    // Sentence-level caption timings and matched ayahs are editor-only and by
    // far the heaviest fields on a clip (~85% of its bytes). The list payload
    // the dashboard polls every 2s omits them; the editor fetches
    // /api/clips/:id/detail for the one clip it has open.
    ...(detail ? {
      captionSegments: Array.isArray(clip.captionSegments) ? clip.captionSegments : [],
      ayahs: Array.isArray(clip.ayahs) ? clip.ayahs : [],
    } : {}),
    score: clip.score, scoreReasons: clip.scoreReasons || [], quality: clip.quality || null,
    reviewRequired: Boolean(clip.reviewRequired), startSec: clip.startSec, endSec: clip.endSec, durationMs: clip.durationMs,
    status: clip.status, approvedBy: clip.approvedBy || null,
    scheduledAt: clip.scheduledAt, scheduledLabel: clip.scheduledAt ? formatLocal(clip.scheduledAt) : null,
    readyAt: clip.readyAt || null, postedAt: clip.postedAt,
    musicName: clip.musicName, musicVerified: Boolean(clip.musicVerified),
    // false only when the job deliberately had no nasheed; absent means required.
    musicEnabled: clip.musicEnabled !== false,
    templateId: clip.templateId, templateName: clip.templateName, templateVersion: clip.templateVersion || 1,
    templateOutdated: Boolean(currentTemplate && Number(currentTemplate.version || 1) > Number(clip.templateVersion || 1)),
    // This clip's own style tweaks, and whether the rendered file still matches
    // them. The editor reads both so it can show what is unsaved to the video.
    styleOverrides: clip.styleOverrides ? { ...clip.styleOverrides } : null,
    styleOverrideCount: clip.styleOverrides ? Object.keys(clip.styleOverrides).length : 0,
    stylePending: Boolean(clip.stylePending),
    renderVersion: clip.renderVersion || 1, renderVerified: Boolean(clip.renderVerified), renderQuality: clip.renderQuality || null,
    renderedWidth: clip.renderedWidth || null, renderedHeight: clip.renderedHeight || null,
    variantOf: clip.variantOf || null, addedAt: clip.addedAt,
    targets: (clip.targets || []).map(social.targetPublic),
    rerender: rerender ? { id: rerender.id, status: rerender.status, stage: rerender.stage, progress: rerender.progress, error: rerender.error || null, asVariant: rerender.asVariant, preview: Boolean(rerender.preview) } : null,
    stylePreview: clip.stylePreview ? { ...clip.stylePreview, url: mediaUrl(clip.stylePreview.url) } : null,
    videoUrl: mediaUrl(clip.clipUrl) || `/api/clips/${encodeURIComponent(clip.id)}/video`, thumbUrl: mediaUrl(clip.thumbUrl) || `/api/clips/${encodeURIComponent(clip.id)}/thumb`,
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
    backgrounds: backgrounds.listBackgrounds(user).map(entry => ({
      id: entry.id, name: entry.name, durationSec: entry.durationSec, shared: Boolean(entry.shared),
      posterUrl: `/api/backgrounds/${encodeURIComponent(entry.id)}/poster`,
      own: entry.userId === user.id && !entry.shared,
      deletable: entry.userId === user.id || (Boolean(entry.shared) && ['owner', 'admin'].includes(String(user.role || '').toLowerCase())),
    })),
    tracks: audio.listNasheeds(user),
    storage: agent.engine.storageBytes(user.id),
    projects: projectsForUser.map(project => ({
      id: project.id, title: project.title, url: project.url, engine: project.engine, status: project.status,
      stage: project.stage, phase: project.phase || '', progress: project.progress || 0, etaSec: project.etaSec ?? null, error: project.error || null, errorCode: project.errorCode || null,
      bytesDone: project.bytesDone ?? null, bytesTotal: project.bytesTotal ?? null,
      currentClip: project.currentClip ?? null, totalClips: project.totalClips ?? null,
      clipPercent: project.clipPercent ?? null, clipPlan: project.clipPlan || null,
      submittedAt: project.submittedAt, completedAt: project.completedAt || null, clipCount: project.clipCount || 0,
      queueAhead: project.status === 'queued' ? agent.engine.queueAhead(project.id) : null,
      priority: project.priority ?? null,
      clipsRequested: project.clipsRequested || 0,
      durationSec: project.durationSec || project.sourceDurationSec || null, sourceDurationSec: project.sourceDurationSec || null,       // Derived at read time as well as at submit: lectures queued before the
      // dashboard sent sourceMeta have null on the record, and back-filling here
      // gives the existing library its posters without a migration.
      sourceThumbUrl: project.sourceThumbUrl || fallbackThumb(project.url) || null, sourceTitle: project.sourceTitle || null, templateIdUsed: project.templateIdUsed,
      templateNameUsed: project.templateNameUsed, templateVersionUsed: project.templateVersionUsed || 1, musicRequired: true,
      sourceReusable: Boolean((project.sourceFile && fs.existsSync(project.sourceFile) && project.transcriptFile && fs.existsSync(project.transcriptFile)) || (project.sourceObjectKey && project.transcriptObjectKey)),
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
  if (pathname === '/healthz') return json(res, 200, { ok: true, engine: config.processingMode === 'remote' ? 'remote-worker' : 'self-hosted' });
  if (pathname === '/readyz') {
    const errors = productionConfigurationErrors();
    try { fs.accessSync(config.dataDir, fs.constants.R_OK | fs.constants.W_OK); } catch { errors.push('Persistent data storage is not readable and writable.'); }
    if (config.processingMode === 'remote' && !errors.some(item => item.startsWith('WORKER_'))) {
      try { await workerClient.readiness(); } catch (error) { errors.push(`External worker is not ready: ${error.message}`); }
    }
    // Reported, never fatal. A backup that cannot be written is serious, but
    // failing readiness over it would take a working product offline and, on a
    // platform that restarts unready instances, keep it there.
    const backupState = backup.lastResult();
    const backupReport = backup.blockedReason()
      || (backupState.at === 0 ? 'no backup has run yet'
        : `${backupState.ok ? 'ok' : 'FAILING'} -- ${backupState.detail} (${new Date(backupState.at).toISOString()})`);
    return json(res, errors.length ? 503 : 200, {
      ok: errors.length === 0,
      engine: config.processingMode,
      checks: errors.length ? errors : ['configuration', 'storage', 'worker'],
      backup: backupReport,
    });
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
  const workerBackground = pathname.match(/^\/api\/worker-assets\/background\/([^/]+)$/);
  if (method === 'GET' && workerBackground) {
    const bgId = decodeURIComponent(workerBackground[1]);
    const userId = String(url.searchParams.get('user') || '');
    if (!agent.engine.verifyWorkerAssetSignature(`background:${bgId}`, userId, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
      return json(res, 401, { error: 'Invalid or expired worker asset link.' });
    }
    const found = backgrounds.backgroundFilePath(userId, bgId);
    if (!found) return json(res, 404, { error: 'Background not found.' });
    return streamFile(req, res, found.file, { contentType: 'video/mp4' });
  }
  if (method === 'POST' && pathname === '/api/billing/webhook') {
    try {
      const raw = await readRawBody(req, 5_000_000);
      const signature = req.headers['stripe-signature'] || '';
      const event = billing.verifyStripeSignature(raw, signature);
      billing.handleWebhookEvent(event);
      alerts.report('billing', false).catch(() => {});
      return json(res, 200, { received: true });
    } catch (error) {
      // A rejected webhook used to return 400 and tell nobody. If the signing
      // secret is ever wrong, the money reaches Stripe, the app never hears
      // about it, and the customer sits there with no tokens until they
      // complain -- the exact silent failure the alerts exist to prevent.
      //
      // Only a request that actually carried a signature raises the alarm.
      // A public endpoint is scanned constantly, and unsigned junk is noise,
      // not a billing outage.
      if (req.headers['stripe-signature']) {
        alerts.report('billing', true,
          `A Stripe webhook was refused: ${error.message}\n` +
          'A payment may have completed without the customer receiving tokens.').catch(() => {});
      }
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
    // Seeing the page is what "plans seen" means. Marking it only in the
    // continue-free POST left the page's own "Dashboard" link -- a plain GET
    // /app -- bouncing straight back here forever, with the form button as the
    // only way out.
    if (currentUser) billing.markPlansSeen(currentUser);
    return html(res, 200, billing.plansPage(currentUser, { error: url.searchParams.get('error') || '', info: url.searchParams.get('info') || '', returnTo: url.searchParams.get('returnTo') || '/app' }));
  }
  if (method === 'POST' && pathname === '/billing/continue-free') {
    try { const body = await formBody(req); billing.markPlansSeen(currentUser); return redirect(res, billing.postLoginRedirect(currentUser, body.returnTo || '/app')); }
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
    const body = await formBody(req);
    const ip = clientIp(req);
    const keys = throttle.keysFor(ip, body.email || '');
    const gate = throttle.check(keys);
    if (!gate.allowed) return tooManyAttempts(res, gate.retryAfterSec, body.returnTo);
    // Signing in and signing UP are the same request here, and there is no
    // verification step, so one address could mint accounts as fast as it could
    // post -- each one arriving with free tokens that cost real worker time and
    // storage. Existing accounts are unaffected: this only counts addresses
    // that have never been seen before.
    const known = auth.accountExists(body.email || '');
    if (!known) {
      const signups = throttle.rateLimit(`signup:${ip}`, 3, 24 * 60 * 60_000);
      if (!signups.allowed) {
        return redirect(res, `/login?error=${encodeURIComponent('Too many new accounts from this connection today. Sign in to an existing account, or try again tomorrow.')}`);
      }
    }
    try {
      const user = await auth.emailLogin(body.email || '', body.password || '', body.name || '');
      throttle.succeed(keys);
      // Fire and forget: a provider outage must not stop someone signing in.
      if (!known) auth.sendVerification(user, config.publicBaseUrl || `https://${req.headers.host || ''}`).catch(() => {});
      const session = auth.createSession(user, { provider: 'email' });
      return redirectWithCookies(res, billing.postLoginRedirect(user, body.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) {
      throttle.fail(keys);
      return redirect(res, `/login?error=${encodeURIComponent(error.message)}`);
    }
  }
  if (method === 'POST' && pathname === '/auth/password') {
    const body = await formBody(req);
    // One shared secret and no account to name, so this is the endpoint most
    // worth guessing at and the one that had nothing slowing it down.
    const keys = throttle.keysFor(clientIp(req), 'admin-password');
    const gate = throttle.check(keys);
    if (!gate.allowed) return tooManyAttempts(res, gate.retryAfterSec, body.returnTo);
    try {
      const user = await auth.passwordLogin(body.password || '');
      throttle.succeed(keys);
      const session = auth.createSession(user, { provider: 'password' });
      return redirectWithCookies(res, billing.postLoginRedirect(user, body.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) {
      throttle.fail(keys);
      return redirect(res, `/login?error=${encodeURIComponent(error.message)}`);
    }
  }
  if (method === 'GET' && pathname === '/auth/verify') {
    const confirmed = auth.consumeVerification(url.searchParams.get('token') || '');
    if (!confirmed) {
      return redirect(res, `/login?error=${encodeURIComponent('That confirmation link has expired or has already been used. Sign in and we will send another.')}`);
    }
    // Signed straight in: the link proves the address, and asking someone to
    // type a password immediately after proving it is friction for nothing.
    const session = auth.createSession(confirmed, { provider: 'email' });
    return redirectWithCookies(res, billing.postLoginRedirect(confirmed, '/app'), auth.cookieHeaders(session));
  }
  if (method === 'POST' && pathname === '/auth/resend-verification') {
    if (!currentUser) return json(res, 401, { error: 'Sign in first.' });
    const gate = throttle.rateLimit(`verify:${currentUser.id}`, 5, 60 * 60_000);
    if (!gate.allowed) return json(res, 429, { error: 'Another confirmation was sent recently. Check your inbox, including spam.' });
    const sent = await auth.sendVerification(currentUser, config.publicBaseUrl || `https://${req.headers.host || ''}`);
    return json(res, 200, { ok: true, sent });
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
  if (method === 'GET' && pathname.startsWith('/fonts/')) {
    // The bundled caption faces (see worker/fonts/NOTICE.md), so the editor
    // previews ayat in the exact face the render burns in.
    const name = path.basename(decodeURIComponent(pathname));
    const fontsDir = path.resolve(config.root, 'src', 'public', 'fonts');
    const file = path.resolve(fontsDir, name);
    if (!file.startsWith(fontsDir + path.sep) || !file.endsWith('.ttf') || !fs.existsSync(file)) {
      return json(res, 404, { error: 'Not found.' });
    }
    return streamFile(req, res, file, { contentType: 'font/ttf', cacheControl: 'public, max-age=604800, immutable' });
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

  /**
   * The owner's own surface, deliberately outside the studio.
   *
   * Not a tab inside /app for two reasons. The studio's markup is generated
   * from design/studio-dashboard.dc.html, so anything hand-added there is
   * erased by the next `npm run design:import`. And this is the operator's
   * books -- it has no business sharing a shell with the page paying customers
   * use, where a mistake in one is a mistake in the other.
   *
   * Gated like every other operator surface: 404, not 403, so it is
   * indistinguishable from a route that does not exist. The script and
   * stylesheet are gated the same way rather than left on 'self', because the
   * shape of an admin page is itself worth not publishing.
   */
  const ownerAsset = { '/owner': [ownerPage, 'text/html; charset=utf-8'], '/owner.js': [ownerScript, 'text/javascript; charset=utf-8'], '/owner.css': [ownerStyles, 'text/css; charset=utf-8'] }[pathname];
  if (method === 'GET' && ownerAsset) {
    if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent('/owner')}`);
    try { requireOperator(currentUser); } catch { return json(res, 404, { error: 'Not found.' }); }
    const [file, type] = ownerAsset;
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Owner dashboard asset not found.' });
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
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
  // Studio dashboard assets. Static files are served by explicit route here, so a
  // new generated file is invisible until it is listed. See design/README.md.
  if (method === 'GET' && STUDIO_ASSETS[pathname]) {
    const asset = STUDIO_ASSETS[pathname];
    if (!fs.existsSync(asset.file)) return json(res, 404, { error: 'Studio asset not found. Run `npm run design:import`.' });
    const body = fs.readFileSync(asset.file);
    // no-cache (revalidate), not no-store (re-download): with a content ETag,
    // an unchanged asset costs a 304 instead of shipping ~700KB of JS on
    // every page load, while a deploy still takes effect immediately.
    const etag = `"${crypto.createHash('sha1').update(body).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': body.length, 'Cache-Control': 'no-cache', ETag: etag });
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
    if (remoteClip?.clipUrl) return temporaryRedirect(res, mediaUrl(remoteClip.clipUrl));
    const file = agent.engine.clipFilePath(clipId, 'video');
    return streamFile(req, res, file, { cacheControl: 'public, max-age=3600, immutable' });
  }
  // A wildcard /:name.txt route used to live here and served ANY .txt file in
  // the application directory to anyone, with no session. The narrow TikTok
  // route below is what it was there to do.
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

  // Import network settings, as a server-rendered page rather than a JSON API.
  // MUST stay above the non-/api catch-all below: this route first shipped
  // underneath it and was unreachable dead code answering the generic 404 --
  // indistinguishable, from the outside, from the operator lacking the role.
  // These get set exactly when URL imports are down and the operator's only
  // other tool is the Hetzner web console, which mangles the characters a
  // proxy URL is made of. A plain form in the browser has no such failure mode.
  if (pathname === '/admin/import-network') {
    // Signed out: to the login page, like every other page. Signed in without
    // the role: the masked 404. The two must stay distinguishable -- when this
    // route was dead code, its generic 404 was read as a role problem and the
    // real bug went unfound.
    if (!currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent('/admin/import-network')}`);
    try { requireOperator(currentUser); } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
    if (method === 'POST') {
      const raw = await readRawBody(req, 2_000_000);
      const form = new URLSearchParams(raw);
      const proxy = String(form.get('proxy') || '').trim();
      const cookiesText = String(form.get('cookiesText') || '').trim();
      if (proxy) {
        let parsed;
        try { parsed = new URL(proxy); } catch { parsed = null; }
        if (!parsed || !['http:', 'https:', 'socks5:'].includes(parsed.protocol)) {
          return html(res, 400, importNetworkPage({ error: 'The proxy must be a full URL like http://user:pass@host:port' }));
        }
      }
      if (cookiesText && !/youtube\.com/.test(cookiesText)) {
        return html(res, 400, importNetworkPage({ error: 'That does not look like a YouTube cookies export — it has no youtube.com lines.' }));
      }
      // Empty means "keep what is saved": values are never echoed back into
      // the form, so an empty field on submit is almost always an untouched
      // one, and treating it as "clear" would wipe a credential the operator
      // could not see was there. Clearing is the explicit checkboxes.
      const update = {};
      if (proxy) update.proxy = proxy; else if (form.get('clearProxy')) update.proxy = '';
      if (cookiesText) update.cookiesText = cookiesText; else if (form.get('clearCookies')) update.cookiesText = '';
      setImportNetworkSettings(update);
      const describe = (value, cleared) => (value ? 'set' : cleared ? 'cleared' : 'kept');
      log(`Import network settings updated by ${currentUser.email || currentUser.id}: proxy ${describe(proxy, form.get('clearProxy'))}, cookies ${describe(cookiesText, form.get('clearCookies'))}.`, 'info');
      return html(res, 200, importNetworkPage({ saved: true }));
    }
    return html(res, 200, importNetworkPage({}));
  }

  if (!pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
  if (auth.enabled() && !currentUser) return json(res, 401, { error: 'Sign in to continue.', loginRequired: true });
  if (!auth.enabled() && !auth.sessionUser(req) && !authed(req, url)) return json(res, 401, { error: 'Wrong password.' });

  if (method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { user: auth.userPublic(currentUser), auth: auth.publicConfig() });
  if (method === 'GET' && pathname === '/api/state') {
    const rev = stateRev();
    if (url.searchParams.get('rev') === rev) return json(res, 200, { unchanged: true, rev });
    return json(res, 200, { ...appState(currentUser), rev });
  }
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
  if (method === 'POST' && pathname === '/api/billing/topup-checkout') {
    const body = await readBody(req);
    try { return json(res, 200, await billing.createTopupCheckoutSession(currentUser, String(body.package || ''))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/billing/portal') {
    try { return json(res, 200, await billing.createPortalSession(currentUser)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/admin/analytics') {
    try { requireOperator(currentUser); return json(res, 200, admin.analytics(currentUser)); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/owner/finance') {
    // Clamped rather than trusted: an unbounded day count is an unbounded
    // number of Stripe pages, on a route one request can hold open.
    const days = Math.min(365, Math.max(30, Number(url.searchParams.get('days')) || 180));
    try { requireOperator(currentUser); return json(res, 200, await owner.finance(currentUser, { days })); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/owner/health') {
    // Clamped for the same reason as finance: the window decides how much
    // state is walked, and an unbounded one is a request that holds the loop.
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
    try {
      requireOperator(currentUser);
      const health = owner.pipelineHealth(currentUser, { days });
      // The worker's own view sits beside the app's. They can disagree -- the
      // app records a job it never managed to hand over -- and that difference
      // is itself the diagnosis, so neither is allowed to stand in for the other.
      const worker = await workerClient.health().catch(error => ({ error: error.message }));
      return json(res, 200, { ...health, worker });
    } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/owner/costs') {
    try {
      requireOperator(currentUser);
      return json(res, 200, { costs: owner.costs(currentUser), cadences: owner.CADENCES, categories: owner.COST_CATEGORIES });
    } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/owner/costs') {
    const body = await readBody(req);
    try { requireOperator(currentUser); return json(res, 200, { cost: owner.upsertCost(currentUser, body) }); }
    catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/owner/spend') {
    const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 90));
    try { requireOperator(currentUser); return json(res, 200, owner.spend(currentUser, { days })); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/owner/spend') {
    const body = await readBody(req);
    try {
      requireOperator(currentUser);
      // Accepts one payment or a batch, because the thing that writes here is
      // a sync over a mailbox, and a sync that can only post one row at a time
      // is a sync nobody runs twice.
      const entries = Array.isArray(body.entries) ? body.entries : [body];
      const results = entries.map(entry => owner.recordSpend(currentUser, entry));
      return json(res, 200, {
        recorded: results.filter(item => !item.duplicate).length,
        skipped: results.filter(item => item.duplicate).length,
        results,
      });
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
  const ownerSpendDelete = pathname.match(/^\/api\/owner\/spend\/([\w-]+)$/);
  if (method === 'DELETE' && ownerSpendDelete) {
    try { requireOperator(currentUser); return json(res, 200, { removed: owner.removeSpend(currentUser, ownerSpendDelete[1]) }); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  const ownerCostDelete = pathname.match(/^\/api\/owner\/costs\/([\w-]+)$/);
  if (method === 'DELETE' && ownerCostDelete) {
    try { requireOperator(currentUser); return json(res, 200, { removed: owner.removeCost(currentUser, ownerCostDelete[1]) }); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }


  const socialConnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/connect$/);
  if (method === 'POST' && socialConnect) {
    try { return json(res, 200, { url: social.oauthStartUrl(socialConnect[1], currentUser?.id) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const socialDisconnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/disconnect$/);
  if (method === 'POST' && socialDisconnect) {
    try { await social.disconnect(socialDisconnect[1], currentUser); return json(res, 200, { ok: true }); }
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
          // Coerced rather than spread through: a sub-option arriving true with
          // the parent off would post a declaration the creator never made.
          commercialContent: Boolean(body.tiktok?.commercialContent),
          yourBrand: Boolean(body.tiktok?.commercialContent) && Boolean(body.tiktok?.yourBrand),
          brandedContent: Boolean(body.tiktok?.commercialContent) && Boolean(body.tiktok?.brandedContent),
        },
      };
      // Connecting TikTok cannot switch it on, because its guidelines forbid a
      // default audience and an enabled destination without one would queue
      // posts that fail. It is marked at connect time instead, and this is the
      // moment it becomes possible: the first save that carries an audience.
      // Cleared either way, so turning it off later stays off.
      if (next.tiktok.enableWhenReady && String(next.tiktok.privacy || '') && !body.tiktok?.enabled) {
        next.tiktok.enabled = true;
      }
      if (String(next.tiktok.privacy || '')) next.tiktok.enableWhenReady = false;
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
    // Each URL costs a live YouTube Data API call against one shared key and a
    // daily quota. Eight per request with nothing counting them meant a few
    // hundred scripted requests could burn the whole day's allowance -- for
    // every account at once, since the key is the product's, not the user's.
    const lookups = throttle.rateLimit(`sourceinfo:${currentUser.id}`, 120, 60 * 60_000);
    if (!lookups.allowed) {
      res.setHeader('Retry-After', String(lookups.retryAfterSec));
      return json(res, 429, { error: 'Too many link previews in the last hour. Try again shortly.' });
    }
    const sources = [];
    for (const source of urls.slice(0, 8)) {
      const cached = sourceInfoCache.get(source);
      if (cached && cached.until > Date.now()) { sources.push(cached.value); continue; }
      try {
        const info = await agent.sourceInfo(source);
        // A lecture's title and length do not change; a short cache turns a
        // pasted-and-repasted link into one call instead of many.
        sourceInfoCache.set(source, { value: info, until: Date.now() + 10 * 60_000 });
        if (sourceInfoCache.size > 500) {
          for (const [key, entry] of sourceInfoCache) if (entry.until < Date.now()) sourceInfoCache.delete(key);
        }
        sources.push(info);
      }
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
    // A signed URL is a licence to write into the bucket, and this handed out
    // an unlimited number of them. The content type is no longer taken from
    // the caller at all -- it is derived from the extension.
    const gate = throttle.rateLimit(`presign:${currentUser.id}`, 60, 60 * 60_000);
    if (!gate.allowed) {
      res.setHeader('Retry-After', String(gate.retryAfterSec));
      return json(res, 429, { error: 'Too many uploads started in the last hour. Try again shortly.' });
    }
    try {
      const upload = objectStorage.createUpload(currentUser.id, String(body.fileName || ''), Number(body.size));
      return json(res, 200, { ok: true, ...upload });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/videos') {
    const body = await readBody(req);
    if (body.objectKey) {
      try {
        assertVerified(currentUser);
        const objectKey = assertStorageObjectKey(body.objectKey);
        // The key shape is checked above; this checks it is *this* account's
        // upload, so one tenant cannot submit another tenant's file.
        if (!objectKey.startsWith(objectStorage.uploadPrefixFor(currentUser.id))) throw new Error('The uploaded video reference is outside the permitted storage area.');
        // templateId / musicEnabled / musicTrackId travel on the URL branch
        // below and were dropped here, so an uploaded MP4 silently ignored the
        // Clip Style that was picked and fell back to the account default.
        const projectId = await agent.submitVideo(objectKey, body.title || body.fileName || '', currentUser.id, {
          templateId: String(body.templateId || ''),
          musicEnabled: body.musicEnabled !== false,
          musicTrackId: String(body.musicTrackId || ''),
          language: String(body.language || ''),
          backgroundMode: body.backgroundMode, backgroundId: body.backgroundId, introSeconds: body.introSeconds,
          sourceKind: 'object_storage', originalFileName: body.fileName || '', displayUrl: `Uploaded file · ${body.fileName || 'video'}`,
          sourceMeta: { title: body.title || body.fileName || '', durationSec: Number(body.durationSec || 0) || null, thumbnail: '' },
          sourceRange: { startSec: Number(body.sourceStartSeconds || 0), endSec: Number(body.sourceEndSeconds) || null },
        });
        return json(res, 201, { ok: true, projectId });
      } catch (error) { return json(res, 400, { error: error.message }); }
    }
    const urls = String(body.urls || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return json(res, 400, { error: 'Paste at least one video link.' });
    try { assertVerified(currentUser); }
    catch (error) { return json(res, error.statusCode || 403, { error: error.message, needsVerification: true }); }
    const sourceStartSeconds = Math.max(0, Math.round(Number(body.sourceStartSeconds || 0)));
    const sourceEndRaw = Number(body.sourceEndSeconds);
    const sourceEndSeconds = Number.isFinite(sourceEndRaw) && sourceEndRaw > sourceStartSeconds ? Math.round(sourceEndRaw) : null;
    if (sourceEndSeconds !== null && sourceEndSeconds - sourceStartSeconds < 30) return json(res, 400, { error: 'Choose at least 30 seconds of source video.' });
    const sourceRange = { startSec: sourceStartSeconds, endSec: sourceEndSeconds };
    const sourceMeta = Array.isArray(body.sourceMeta) ? body.sourceMeta : [];
    const results = [];
    for (const source of urls) {
      try { results.push({ url: source, ok: true, projectId: await agent.submitVideo(source, body.title || '', currentUser.id, { sourceRange, sourceMeta, idempotencyKey: body.idempotencyKey, musicEnabled: body.musicEnabled !== false, musicTrackId: String(body.musicTrackId || ''), templateId: String(body.templateId || ''), backgroundMode: body.backgroundMode, backgroundId: body.backgroundId, introSeconds: body.introSeconds, language: String(body.language || '') }) }); }
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
        backgroundMode: String(req.headers['x-background-mode'] || ''), backgroundId: String(req.headers['x-background-id'] || ''), introSeconds: Number(req.headers['x-intro-seconds'] || 0),
        language: String(req.headers['x-source-language'] || ''),
        sourceRange: { startSec: sourceStartSeconds, endSec: sourceEndSeconds },
        sourceMeta: { title: upload.title, durationSec: durationSec || null, thumbnail: '' },
        sourceKind: 'upload', originalFileName: upload.fileName, uploadedInputFile: upload.filePath,
        displayUrl: `Uploaded file · ${upload.fileName}`,
      });
      return json(res, 201, { ok: true, projectId, fileName: upload.fileName, size: upload.size });
    } catch (error) {
      if (upload?.filePath) removeUploadedFile(upload.filePath);
      return json(res, error.statusCode || 400, { error: error.message });
    }
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
  // The Happening-now rows' own controls: remove a job from the queue, or
  // move a queued one to the front. Ownership is checked per kind -- a render
  // belongs to whoever owns its clip, everything else to the project owner.
  if (method === 'POST' && (pathname === '/api/queue/cancel' || pathname === '/api/queue/prioritize')) {
    const body = await readBody(req);
    const kind = String(body.kind || 'project');
    const id = String(body.id || '');
    try {
      if (kind === 'render') {
        const job = state.rerenderJobs.find(item => item.id === id);
        if (!job) throw new Error('That render is no longer in the queue.');
        assertCanAccessClip(currentUser, job.clipId);
      } else {
        assertCanAccessProject(currentUser, id);
      }
      const item = pathname.endsWith('/cancel')
        ? agent.engine.cancelWork(kind, id)
        : agent.engine.prioritizeWork(kind, id);
      return json(res, 200, { ok: true, status: item.status || null });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'DELETE' && projectMatch) {
    try { const id = decodeURIComponent(projectMatch[1]); assertCanAccessProject(currentUser, id); agent.engine.deleteProject(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/templates') return json(res, 200, { templates: templates.listTemplates(currentUser), selectedTemplate: templates.selectedTemplate(currentUser), draft: templates.defaultTemplateDraft() });
  if (method === 'POST' && pathname === '/api/templates') {
    // The editor's Save posts here when the open template is built in -- a
    // holdover from when built-ins were read-only and Save had to mint a copy.
    // Copies are gone (one template per content type), and built-ins take
    // per-account edits now, so this saves onto the template the draft came
    // from. Refusing here made the editor's Save button an error message.
    const body = await readBody(req);
    try {
      const draft = body.template || body;
      const byName = templates.listTemplates(currentUser).find(item => item.name === String(draft.name || '').trim());
      let target = templates.templateById(String(draft.id || ''), currentUser) || byName;
      if (!target && body.select === false) {
        // No identity and no intent to select: this is the old "mint a copy"
        // shape (the Duplicate buttons). Copies are gone, one template per
        // content type -- refuse rather than overwrite a template it never named.
        return json(res, 400, { error: 'One template per content type — edit the template directly; copies are no longer created.' });
      }
      target = target || templates.selectedTemplate(currentUser);
      if (!target?.id) return json(res, 400, { error: 'There is no template to save onto.' });
      // The PUT route has always checked this; POST did not, so saving a draft
      // with the watermark blanked through this door removed it on a free plan
      // -- one of exactly two things the product charges for.
      assertWatermarkAllowed(draft);
      const saved = templates.saveTemplate(currentUser, target.id, draft);
      if (body.select !== false) templates.setSelectedTemplate(currentUser, target.id);
      log(`Saved template "${saved.template.name}" version ${saved.template.version}. New renders use it automatically.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template: saved.template, propagation: { queued: 0, skipped: 0, errors: [] } });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  // No duplicate route: templates.duplicateTemplate throws unconditionally
  // because the product is one template per content type. The function stays
  // as a guard against minting -- see test/templates.test.mjs -- but nothing
  // is exposed that can only ever answer with its refusal.
  // Publishing without the DeenClipped watermark is a paid feature. The gate
  // sits on the two style write paths, not in sanitiseTemplate, because the
  // sanitiser cannot know who is asking. Only an EXPLICIT empty watermark is
  // blocked -- absent fields and non-empty text pass untouched.
  function assertWatermarkAllowed(style) {
    if (!style || typeof style !== 'object') return;
    // Emptying the text and zeroing the opacity are the same act -- a clip
    // with no visible watermark -- so the gate covers both doors.
    const wantsNone = ('watermark' in style && String(style.watermark ?? '').trim() === '')
      || ('watermarkOpacity' in style && Number(style.watermarkOpacity) <= 0);
    if (!wantsNone) return;
    if (billing.isPaid(currentUser)) return;
    throw new Error('Removing the DeenClipped watermark is a Pro feature. Upgrade to any paid plan to publish without it.');
  }

  // Which templates a plan may actually use. Free gets the default one; every
  // other built-in is Pro. Blocked here at the door rather than only at render
  // time so the account is told why, instead of quietly getting a clip in a
  // style it did not pick. The render still enforces it too -- a subscription
  // can lapse between queueing a job and rendering it.
  function assertTemplateAllowed(template) {
    if (!template?.pro) return template;
    if (billing.isPaid(currentUser)) return template;
    throw new Error(`"${template.name}" is a Pro template. The ${templates.templateById(config.defaultTemplateId, currentUser)?.name || 'default'} style is included on the free plan; any paid plan unlocks the rest.`);
  }

  const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (method === 'PUT' && templateMatch) {
    const body = await readBody(req);
    try {
      // Editing a built-in forks it onto the user's own copy rather than
      // refusing, so Save always means save. `forked` travels back so the page
      // can say which template it actually saved.
      assertWatermarkAllowed(body.template || body);
      const saved = templates.saveTemplate(currentUser, decodeURIComponent(templateMatch[1]), body.template || body);
      const template = saved.template;
      // Re-rendering every unposted clip is explicit now. It used to fire on any
      // field write, and the editor's sliders write on every `input` event, so
      // dragging one slider queued a re-render per clip per pixel -- each of
      // which re-downloads the whole source on a single-slot worker.
      //
      // The sweep itself is scoped to clips *using this template*, so it no
      // longer also requires the template to be the selected one -- that gate
      // made "save and re-render" silently do nothing whenever the clip's
      // template differed from the account default.
      const propagation = body.propagate === true
        ? queueTemplateForEveryUnpostedClip(template, currentUser, 'saving the template', String(body.propagateProjectId || ''))
        : { queued: 0, skipped: 0, errors: [] };
      log(saved.forked
        ? `"${saved.from}" is built in, so your changes were saved to "${template.name}" and it is now selected.`
        : `Saved template "${template.name}" version ${template.version}. New renders use it automatically.`,
      'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation, forked: saved.forked, forkedFrom: saved.from });
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
    try { assertTemplateAllowed(template); }
    catch (error) { return json(res, 402, { error: error.message, upgrade: true }); }
    let queued = 0; let skipped = 0; const errors = [];
    for (const clip of ownedBy(state.clips, currentUser.id)) {
      if (clip.variantOf) { skipped += 1; continue; }
      try {
        agent.engine.queueClipRerender(clip.id, template.id, { asVariant: clip.status === 'posted', priority: 2 });
        queued += 1;
      } catch (error) {
        skipped += 1; errors.push({ clipId: clip.id, error: error.message });
      }
    }
    log(`Applied template "${template.name}" to ${queued} existing clips; ${skipped} skipped.`, 'info', currentUser.id);
    return json(res, 202, { ok: true, queued, skipped, errors: errors.slice(0, 20), template });
  }

  if (method === 'POST' && pathname === '/api/template') {
    // Selection is a default for future renders, nothing more. The dashboard
    // posts here on every job submission, and this used to queue a re-render
    // of every unposted clip already on the template -- so submitting one new
    // lecture re-rendered the whole backlog, charged. Re-rendering existing
    // clips stays explicit: /api/templates/apply-all or a template save with
    // propagate: true.
    const body = await readBody(req);
    try {
      assertTemplateAllowed(templates.templateById(String(body.id || ''), currentUser));
      const template = templates.setSelectedTemplate(currentUser, String(body.id || ''));
      log(`Automation template set to "${template.name}". New renders use it.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation: { queued: 0, skipped: 0, errors: [] } });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/clip-settings') {
    const body = await readBody(req); const count = Math.round(Number(body.clipsPerVideo));
    const minimum = Math.round(Number(body.clipMinSeconds)); const maximum = Math.round(Number(body.clipMaxSeconds));
    if (!Number.isFinite(count) || count < 1 || count > 30) return json(res, 400, { error: 'Clips per video must be between 1 and 30.' });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 3 || maximum > 180 || minimum >= maximum) return json(res, 400, { error: 'Choose a valid clip range between 3 and 180 seconds.' });
    // More than one length preset may be picked; each band is a [min,max]
    // pair inside the envelope the two fields above already carry.
    let bands = [];
    if (Array.isArray(body.clipLengthBands)) {
      bands = body.clipLengthBands
        .map(pair => [Math.round(Number(pair?.[0])), Math.round(Number(pair?.[1]))])
        .filter(([lo, hi]) => Number.isFinite(lo) && Number.isFinite(hi) && lo >= 3 && hi <= 180 && lo < hi)
        .slice(0, 6);
    }
    setClipSettings(currentUser, { clipsPerVideo: count, clipMinSeconds: minimum, clipMaxSeconds: maximum, clipLengthBands: bands });
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
    let body;
    try { body = await readBody(req, 24 * 1024 * 1024); }
    catch { return json(res, 413, { error: 'That nasheed is too large to send this way. Keep it under 24MB.' }); }
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

  // Stock background videos for the Quran recitation flow.
  const backgroundPoster = pathname.match(/^\/api\/backgrounds\/([^/]+)\/poster$/);
  if (method === 'GET' && backgroundPoster) {
    const poster = await backgrounds.posterPathFor(currentUser, decodeURIComponent(backgroundPoster[1]));
    if (!poster) {
      res.setHeader('Cache-Control', 'private, max-age=300');
      return json(res, 404, { error: 'No poster for that background.' });
    }
    return streamFile(req, res, poster, { contentType: 'image/jpeg', cacheControl: 'private, max-age=86400' });
  }

  if (method === 'GET' && pathname === '/api/backgrounds') return json(res, 200, { backgrounds: backgrounds.listBackgrounds(currentUser) });
  if (method === 'POST' && pathname === '/api/backgrounds') {
    let body;
    // Anything bigger goes straight to object storage from the browser and
    // arrives here as an objectKey, which never touches this process.
    try { body = await readBody(req, 12 * 1024 * 1024); }
    catch { return json(res, 413, { error: 'That file is too large to send through the API. Configure object storage, or use a shorter loop under 12MB.' }); }
    // Only the operator can publish into every account's library.
    const shared = body.shared === true && ['owner', 'admin'].includes(String(currentUser?.role || '').toLowerCase());
    try {
      let entry;
      if (body.objectKey) {
        // The fast path: the browser PUT the raw file straight to object
        // storage with a presigned URL (no base64, no app server in the upload
        // path), and this registers it -- the server pulls it down on its own
        // datacenter bandwidth. Same prefix guard as video submissions.
        const objectKey = assertStorageObjectKey(String(body.objectKey));
        if (!objectKey.startsWith(objectStorage.uploadPrefixFor(currentUser.id))) throw new Error('The uploaded video reference is outside the permitted storage area.');
        const temp = path.join(config.dataDir, 'backgrounds', `incoming-${crypto.randomBytes(6).toString('hex')}`);
        fs.mkdirSync(path.dirname(temp), { recursive: true });
        const response = await fetch(objectStorage.presign({ method: 'GET', key: objectKey, expiresSec: 600 }));
        if (!response.ok || !response.body) throw new Error(`The uploaded file could not be fetched from storage (HTTP ${response.status}).`);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
        entry = await backgrounds.registerBackgroundFile(currentUser, body.name, temp, body.mimeType, { shared });
        // The staging object has served its purpose.
        objectStorage.deleteObject(objectKey).catch(() => {});
      } else {
        entry = await backgrounds.saveBackground(currentUser, body.name, body.data, body.mimeType, { shared });
      }
      log(`Added background video "${entry.name}"${shared ? ' to the shared stock library' : ''}.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, background: entry });
    }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const backgroundVideo = pathname.match(/^\/api\/backgrounds\/([^/]+)\/video$/);
  if (method === 'GET' && backgroundVideo) {
    const found = backgrounds.backgroundFilePath(currentUser, decodeURIComponent(backgroundVideo[1])); if (!found) return json(res, 404, { error: 'Background not found.' });
    return streamFile(req, res, found.file, { contentType: 'video/mp4' });
  }
  const backgroundDelete = pathname.match(/^\/api\/backgrounds\/([^/]+)$/);
  if (method === 'DELETE' && backgroundDelete) {
    const operator = ['owner', 'admin'].includes(String(currentUser?.role || '').toLowerCase());
    return backgrounds.deleteBackground(currentUser, decodeURIComponent(backgroundDelete[1]), { operator }) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Background not found.' });
  }

  if (pathname === '/api/diagnostics') {
    try { requireOperator(currentUser); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/diagnostics') {
    if (config.processingMode === 'remote') {
      try {
        // health carries the capability report; readiness carries queue depth.
        // Both, because "is the box up" and "does the box have the current
        // code" are different questions and only the second one has been
        // catching us out.
        const [worker, health] = await Promise.all([
          workerClient.readiness(),
          workerClient.health().catch(error => ({ error: error.message })),
        ]);
        const capabilities = health?.capabilities || worker?.capabilities || null;
        return json(res, 200, {
          ok: Boolean(worker.ready), worker, health, capabilities,
          // Named so the answer to "did the rebuild take" is readable without
          // knowing which flag means what.
          workerBuild: capabilities ? summariseWorkerBuild(capabilities) : 'The worker did not report its capabilities — it is running a build from before they existed.',
          readiness: agent.engine.readiness(currentUser), model: config.aiModel,
          note: 'Heavy processing runs on the external worker.',
        });
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
      // Optional. `day` is a calendar day, `at` one exact posting slot. This
      // route read only `at`, so every per-day button sent a `day` the server
      // dropped on the floor and the clip went to the next open slot -- the
      // exact bug the day parameter was added to fix, still live because the
      // unit tests called scheduleSelected directly and never crossed the route.
      const at = Number(body.at), day = Number(body.day);
      const summary = agent.scheduleSelected(body.ids, {
        at: Number.isFinite(at) && at > 0 ? at : null,
        day: Number.isFinite(day) && day > 0 ? day : null,
      });
      return json(res, 200, { ok: summary.failed === 0, ...summary });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  const sourcePreview = pathname.match(/^\/api\/clips\/([^/]+)\/source-preview$/);
  if (method === 'GET' && sourcePreview) {
    let clip; try { clip = assertCanAccessClip(currentUser, decodeURIComponent(sourcePreview[1])); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    const project = clip ? state.projects.find(item => item.id === clip.projectId) : null;
    const sourceFile = clip?.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project?.sourceFile;
    if (project?.sourceUrl) return temporaryRedirect(res, project.sourceUrl);
    if (!clip || !sourceFile || !fs.existsSync(sourceFile)) return json(res, 404, { error: 'Original source video is unavailable.' });
    return streamFile(req, res, sourceFile, { contentType: 'video/mp4' });
  }

  const clipVideo = pathname.match(/^\/api\/clips\/([^/]+)\/(video|download|thumb)$/);
  if (method === 'GET' && clipVideo) {
    const id = decodeURIComponent(clipVideo[1]); const kind = clipVideo[2];
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    const remoteUrl = mediaUrl(kind === 'thumb' ? clip?.thumbUrl : clip?.clipUrl);
    const downloadName = `${(clip?.title || 'deenclipped').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'deenclipped'}.mp4`;
    // A download has to arrive as a file, not as a video that happens to open
    // in a tab. Redirecting to the CDN gives the browser no filename and no
    // disposition, so it plays instead of saving -- which is indistinguishable
    // from the download being broken. The bytes are relayed instead, which
    // costs egress on a rare action and gets the customer their MP4.
    if (kind === 'download' && remoteUrl) {
      try {
        const upstream = await fetch(remoteUrl);
        if (!upstream.ok || !upstream.body) throw new Error(`storage returned ${upstream.status}`);
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${downloadName}"`,
          'Cache-Control': 'private, no-store',
          ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length') } : {}),
        });
        const { Readable } = await import('node:stream');
        return Readable.fromWeb(upstream.body).pipe(res);
      } catch (error) {
        return json(res, 502, { error: `That clip could not be fetched for download: ${error.message}` });
      }
    }
    if (remoteUrl) {
      // Thumbnail redirects may be cached briefly: they are painted as CSS
      // backgrounds on every poll repaint, and a no-store redirect to a dead
      // object meant the browser walked into the same 404 forever. Video
      // redirects stay no-store -- they can point at presigned URLs that
      // expire, and a cached one would replay a signature past its window.
      if (kind === 'thumb') {
        res.writeHead(307, { Location: remoteUrl, 'Cache-Control': 'private, max-age=300' });
        return res.end();
      }
      return temporaryRedirect(res, remoteUrl);
    }
    const file = agent.engine.clipFilePath(id, kind === 'thumb' ? 'thumb' : 'video');
    if (!file) {
      // A cacheable miss. Thumbnails are painted as CSS backgrounds, and a
      // repaint re-resolves the URL: with a plain 404 the browser asked for
      // the same missing file on every poll, forever. Five cached minutes
      // turns the loop into one request, without hiding a thumb for long
      // once a render finally produces it.
      res.setHeader('Cache-Control', 'private, max-age=300');
      return json(res, 404, { error: kind === 'thumb' ? 'No thumbnail rendered.' : 'Rendered file not found.' });
    }
    if (kind === 'thumb') return streamFile(req, res, file, { contentType: 'image/jpeg' });
    return streamFile(req, res, file, kind === 'download' ? { downloadName } : {});
  }

  const rerenderClip = pathname.match(/^\/api\/clips\/([^/]+)\/rerender$/);
  if (method === 'POST' && rerenderClip) {
    const body = await readBody(req);
    try {
      const id = decodeURIComponent(rerenderClip[1]);
      assertCanAccessClip(currentUser, id);
      // The selection routes check the plan; this one never did, so a free
      // account could re-render a clip onto a Pro style, get a success, and
      // receive a clip in the default style because enforceTemplatePlan swaps
      // it back at render. Refused at the door, with the reason.
      const wanted = String(body.templateId || '');
      if (wanted) assertTemplateAllowed(templates.templateById(wanted, currentUser));
      // Priority 1, level with a submitted lecture. At 0 a free re-render
      // outranked every paying customer's job on a single worker slot.
      // A preview window renders ~6s around the playhead on the worker's quick
      // lane -- the editor's fast feedback loop, never a replacement render.
      const previewWindow = body.preview && Number.isFinite(Number(body.preview.startSec)) && Number.isFinite(Number(body.preview.endSec))
        ? { startSec: Math.max(0, Number(body.preview.startSec)), endSec: Math.max(0, Number(body.preview.endSec)) }
        : null;
      return json(res, 202, { ok: true, job: agent.engine.queueClipRerender(id, wanted, { asVariant: Boolean(body.asVariant), priority: previewWindow ? 0 : 1, preview: previewWindow }) });
    }
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
  const clipDetail = pathname.match(/^\/api\/clips\/([^/]+)\/detail$/);
  if (method === 'GET' && clipDetail) {
    const id = decodeURIComponent(clipDetail[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }
    return json(res, 200, { ok: true, clip: publicClip(clip, { detail: true }) });
  }
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
      edited: Boolean(clip.transcriptEdited),
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
    const sourceFile = clip?.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project?.sourceFile;
    if (!sourceFile || !fs.existsSync(sourceFile)) {
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
      source: sourceFile, ffprobe: config.ffprobePath || 'ffprobe',
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
      assertWatermarkAllowed(body.styleOverrides);
      agent.updateClip(id, body); let clip;
      if (body.status === 'approved') clip = agent.approveClip(id); else if (body.status === 'rejected') clip = agent.rejectClip(id); else if (body.status === 'waiting') clip = state.clips.find(item => item.id === id)?.status === 'rejected' ? agent.unrejectClip(id) : agent.pullBack(id); else clip = state.clips.find(item => item.id === id);
      return json(res, 200, { ok: true, clip: publicClip(clip) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (clipMatch && method === 'DELETE') {
    try { const id = decodeURIComponent(clipMatch[1]); assertCanAccessClip(currentUser, id); agent.deleteClip(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  // Promote one clip's tweaks onto its shared style, so every clip using that
  // style picks them up. This is the old always-on behaviour, now something the
  // user asks for by name instead of a side effect of dragging a slider.
  // Spread one clip's own tweaks to its siblings.
  //
  // Editing a clip writes only that clip, which is right -- one clip's crop must
  // not move every clip in the lecture. But the common intent after getting a
  // clip looking right is "now do that to the rest of this video", and nothing
  // did it: promote-style writes the shared template, which reaches every other
  // lecture too, and refuses outright on a built-in.
  //
  // scope 'lecture' copies the overrides onto the other clips from the same
  // source video only. scope 'template' is the old promote-style behaviour, kept
  // for when the user really does mean everything.
  const applyStyleMatch = pathname.match(/^\/api\/clips\/([^/]+)\/apply-style$/);
  if (applyStyleMatch && method === 'POST') {
    const id = decodeURIComponent(applyStyleMatch[1]);
    const body = await readBody(req);
    const scope = String(body.scope || 'lecture');
    try {
      assertCanAccessClip(currentUser, id);
      const clip = state.clips.find(item => item.id === id);
      if (!clip) return json(res, 404, { error: 'That clip no longer exists.' });
      const overrides = clip.styleOverrides && Object.keys(clip.styleOverrides).length ? clip.styleOverrides : null;
      // The button shows whenever siblings exist; pressing it with nothing
      // changed is a no-op, not a mistake to scold.
      if (!overrides) return json(res, 200, { ok: true, scope, applied: 0, queued: 0, pending: 0, errors: [] });
      if (scope === 'template') {
        // The old promote-style behaviour the route comment promises: the look
        // lands on the shared template, so every lecture using it follows.
        const updated = promoteClipLook(currentUser, clip);
        save();
        return json(res, 200, { ok: true, scope, template: updated, clip: publicClip(clip) });
      }
      if (scope !== 'lecture') return json(res, 400, { error: 'Unknown scope.' });

      // Siblings from the same lecture, this account only, and never a clip that
      // has already gone out -- rewriting a posted video is not a style change.
      const siblings = ownedBy(state.clips, currentUser.id).filter(item => item.projectId === clip.projectId
        && item.id !== clip.id && !item.variantOf && item.status !== 'posted');
      // The style is stored either way, and stylePending marks the video as out
      // of date -- the same contract promote-style uses. Rolling the style back
      // when a re-render cannot start would mean the whole action silently did
      // nothing on an account whose source files have been cleaned up, which is
      // a supported state rather than an error.
      let applied = 0; let queued = 0; const errors = [];
      for (const sibling of siblings) {
        // They are meant to end up looking the same, so the look replaces the
        // sibling's own tweaks rather than merging underneath them -- but the
        // framing is the sibling's alone and survives.
        //
        // Two clips from one lecture are different moments, so the speaker sits
        // in a different part of each frame. Copying this clip's crop across
        // re-centres every sibling on wherever *this* speaker was and cuts the
        // others' heads off. The whole point of "same look, own framing".
        const keptFraming = {};
        for (const field of templates.FRAMING_FIELDS) {
          if (sibling.styleOverrides && sibling.styleOverrides[field] !== undefined) {
            keptFraming[field] = sibling.styleOverrides[field];
          }
        }
        const look = { ...overrides };
        for (const field of templates.FRAMING_FIELDS) delete look[field];
        sibling.styleOverrides = { ...look, ...keptFraming };
        sibling.stylePending = true;
        applied += 1;
        try {
          agent.engine.queueClipRerender(sibling.id, sibling.templateId || clip.templateId, {});
          queued += 1;
        } catch (error) {
          errors.push({ clipId: sibling.id, error: error.message });
        }
      }
      save();
      const project = state.projects.find(item => item.id === clip.projectId);
      log(`Applied "${clip.title || 'clip'}" styling to ${applied} other clip${applied === 1 ? '' : 's'} in "${project?.title || 'this lecture'}"; ${queued} re-rendering now.`,
        'info', currentUser.id);
      return json(res, 202, { ok: true, scope, applied, queued, pending: applied - queued, errors: errors.slice(0, 20) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  const promoteMatch = pathname.match(/^\/api\/clips\/([^/]+)\/promote-style$/);
  if (promoteMatch && method === 'POST') {
    const id = decodeURIComponent(promoteMatch[1]);
    try {
      assertCanAccessClip(currentUser, id);
      const clip = state.clips.find(item => item.id === id);
      if (!clip) return json(res, 404, { error: 'That clip no longer exists.' });
      const updated = promoteClipLook(currentUser, clip);
      save();
      return json(res, 200, { ok: true, template: updated, clip: publicClip(clip) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  return json(res, 404, { error: 'Not found.' });
}

// Turns the worker's capability report into one readable line. Every item here
// has been shipped and then silently not deployed at least once.
function summariseWorkerBuild(capabilities) {
  const missing = [];
  if (!capabilities.captionAnimation) missing.push('caption animation');
  if (!capabilities.clipBreakdown) missing.push('per-clip progress');
  if (!capabilities.downloadProgress) missing.push('download size');
  if (!capabilities.faceDetection) missing.push(`face detection (${capabilities.faceDetectionNote || 'unavailable'})`);
  if (!capabilities.quranCaptions) missing.push('the Quran corpus, so the recitation template falls back to plain captions');
  if ((capabilities.missingFonts || []).length) missing.push(`fonts: ${capabilities.missingFonts.join(', ')}`);
  // Not a missing feature, but the single most useful fact when an import
  // fails: whether the download happened on the worker or on a service the
  // operator cannot see.
  const via = capabilities.importProvider === 'ytdlp'
    ? 'Imports download on the worker itself.'
    : `Imports download via ${capabilities.importProvider || 'a managed provider'}`
      + (capabilities.importFallback === 'off' ? ', with no fallback.' : ', falling back to the worker if it is blocked.');
  // Only worth mentioning once a block is the live problem: without one of
  // these the worker has no way past YouTube refusing its address.
  const past = capabilities.importProxy || capabilities.importCookies
    ? ` The worker can retry through ${[capabilities.importProxy && 'a proxy', capabilities.importCookies && 'signed-in cookies'].filter(Boolean).join(' and ')}.`
    : ' It has no proxy or cookies configured, so a blocked IP has nothing to fall back to.';
  return missing.length
    ? `Rebuild needed — the running worker is missing ${missing.join('; ')}. ${via}${past}`
    : `Up to date — the running worker has every current feature. ${via}${past}`;
}

/**
 * The one inline <script> the studio page carries, hashed so the policy can
 * allow exactly it and nothing else. Computed at startup from the file on
 * disk, so editing the page updates the hash instead of silently breaking it,
 * and no attacker-injected script can ever match.
 */
const INLINE_SCRIPT_HASHES = (() => {
  const hashes = new Set();
  // The shell flag the server injects, not just what is on disk.
  hashes.add(`'sha256-${crypto.createHash('sha256').update(STUDIO_SHELL_SCRIPT, 'utf8').digest('base64')}'`);
  for (const file of [page]) {
    let source; try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const match of source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes];
})();

/**
 * Security headers on every response.
 *
 * There were none at all. The Content-Security-Policy is the one that carries
 * weight: script-src allows this origin plus the hash of the page's own inline
 * block, so injected script cannot run even if something did get through the
 * escaping. style-src has to keep 'unsafe-inline' -- the design system writes
 * style="..." on nearly every element -- which is a real limit, and the reason
 * the script side is kept strict.
 */
function securityHeaders(res, { pathname }) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${INLINE_SCRIPT_HASHES.join(' ')}`.trim(),
    // The icon font is served from unpkg: the generated stylesheet @imports
    // two Phosphor sheets from there, and those pull their font files from the
    // same host. Leaving it out blocked every icon in the product -- the nav,
    // the platform row, every control that is an icon rather than a word.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src 'self' https://fonts.gstatic.com https://unpkg.com data:",
    // Clip thumbnails and renders can live on object storage, and the editor
    // reads frames through blob: URLs.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https:",
    // Nothing here is ever framed, and nothing may be framed into it.
    "frame-ancestors 'none'",
    "frame-src https://js.stripe.com https://checkout.stripe.com",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Only over TLS, and only where it cannot strand a local http deployment.
  if (config.publicBaseUrl.startsWith('https://')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // A credentialed API response must never be cached by a shared proxy.
  if (pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
}

export const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return json(res, 400, { error: 'Bad request.' }); }
  securityHeaders(res, { pathname: url.pathname });
  if ((req.method || 'GET') === 'POST'
      && (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/billing/'))
      && !sameOriginPost(req, url)) {
    return json(res, 403, { error: 'This request did not come from DeenClipped.' });
  }
  route(req, res, url).catch(error => { console.error(error); if (!res.headersSent) json(res, 500, { error: error.message || 'Unexpected server error.' }); });
});
// Checked before the socket opens. A deployment that cannot be served safely
// must not be served at all -- previously these only turned /readyz red while
// the instance carried on answering customers.
const fatal = fatalConfigurationErrors();
if (fatal.length) {
  for (const problem of fatal) console.error(`[fatal] ${problem}`);
  console.error('[fatal] Fix the environment and redeploy. See SECRET-ROTATION.md.');
  process.exit(1);
}

server.listen(config.port, () => {
  console.log(`DeenClipped self-hosted engine listening on http://localhost:${config.port}`);
  agent.start();
  // Nothing anywhere held a second copy of state.json. Started here for the
  // same reason as the sweep below: importing this module in a test must not
  // ship a real state file to a real bucket.
  backup.start();
  ownerFeed.start();
  // Nothing ever told anyone the worker had stopped answering. Every render
  // fails while the product looks fine, and the first report is a customer's.
  if (config.processingMode === 'remote') {
    const checkWorker = async () => {
      try {
        await workerClient.readiness();
        await alerts.report('worker', false);
      } catch (error) {
        await alerts.report('worker', true, `The render worker is not answering: ${error.message}\nNothing can be transcribed or rendered until it is back.`);
      }
    };
    const workerTimer = setInterval(() => { checkWorker().catch(() => {}); }, 5 * 60_000);
    workerTimer.unref?.();
    checkWorker().catch(() => {});
  }
  // YouTube API Data is cleared after 30 days (policy III.E.4.a-g). Started
  // here rather than on import so a test that loads this module does not sweep
  // a real state file as a side effect.
  startYouTubeRetention();
});
