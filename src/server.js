import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { state, save, log, opusKey, brandTemplateId, brandTemplateSelection, setBrandTemplateSelection, clipSettings, setClipSettings, copyPrompt, setCopyPrompt } from './store.js';
import * as agent from './agent.js';
import * as opus from './opus.js';
import * as audio from './audio.js';
import * as thumbs from './thumbs.js';
import { checkFfmpeg } from './ffmpeg.js';
import { formatLocal } from './slots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(here, 'public', 'index.html');

/* ---- helpers ------------------------------------------------------- */

const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Body too large.')); req.destroy(); return; }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Body was not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

/** Length-independent comparison, so the password can't be guessed by timing. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const authed = (req, url) =>
  !config.password ||
  sameSecret(req.headers['x-app-password'] || url.searchParams.get('pw') || '', config.password);

const sourceProjectIdForClip = clip =>
  clip.sourceProjectId || clip.originalProjectId || clip.projectId;

function updateClipFromOpus(clip, fresh) {
  if (!fresh) return;
  if (fresh.exportUrl) clip.exportUrl = fresh.exportUrl;
  if (fresh.preview) clip.preview = fresh.preview;
  if (fresh.renderPref) clip.renderPref = fresh.renderPref;
  if (Array.isArray(fresh.timeRanges)) clip.timeRanges = fresh.timeRanges;
  clip.mediaRefreshedAt = Date.now();
}

async function refreshClipMediaUrl(clip) {
  const projectIds = [...new Set([clip.projectId, sourceProjectIdForClip(clip)].filter(Boolean))];
  for (const projectId of projectIds) {
    try {
      const clips = await opus.getClips(projectId);
      const fresh = clips.find(c =>
        c.id === clip.id ||
        c.clipId === clip.clipId ||
        c.clipId === clip.originalClipId ||
        c.id === `${projectId}.${clip.clipId}`
      );
      if (!fresh) continue;
      updateClipFromOpus(clip, fresh);
      save();
      return fresh.preview || fresh.exportUrl || '';
    } catch {
      // Try the next known project id, then fall back to the stored URL.
    }
  }
  return clip.preview || clip.exportUrl || '';
}

async function refreshProjectClipMediaUrl(projectId, clipId) {
  const clips = await opus.getClips(projectId);
  const fresh = clips.find(c =>
    c.id === clipId ||
    c.clipId === clipId ||
    c.id === `${projectId}.${clipId}`
  );
  return fresh?.preview || fresh?.exportUrl || '';
}

function mediaHeaders(upstream) {
  const h = {
    'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
  };
  for (const k of ['content-length', 'content-range', 'last-modified', 'etag']) {
    const v = upstream.headers.get(k);
    if (v) h[k.replace(/(^|-)(.)/g, (_, dash, ch) => dash + ch.toUpperCase())] = v;
  }
  return h;
}

async function pipeRemoteMedia(req, res, initialUrl, refreshUrl) {
  let url = initialUrl;
  let refreshed = false;

  for (;;) {
    if (!url) {
      url = await refreshUrl?.();
      refreshed = true;
    }
    if (!url) return send(res, 404, { error: 'No preview URL is available yet.' });

    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    let upstream;
    try {
      upstream = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      if (!refreshed && refreshUrl) { url = ''; continue; }
      return send(res, 502, { error: `Could not load preview: ${err.message}` });
    }

    if (!upstream.ok && upstream.status !== 206 && !refreshed && refreshUrl) {
      url = '';
      continue;
    }
    if (!upstream.ok && upstream.status !== 206) {
      return send(res, upstream.status || 502, { error: `Preview could not be loaded (${upstream.status}).` });
    }

    res.writeHead(upstream.status, mediaHeaders(upstream));
    if (!upstream.body) return res.end();
    return Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
  }
}

/**
 * Give a clip a genuine second chance at music when it's pulled back —
 * but only if nothing actually got mixed in last time. A clip that's
 * already carrying real music keeps it; re-mixing it again would just
 * spend Opus credits a second time for no benefit.
 */
function pullBackMusic(clip) {
  if (clip.musicMixed && clip.musicMixed !== 'done') {
    delete clip.musicMixed;
    delete clip.musicNote;
    delete clip.musicAttempts;
    delete clip.musicNextTryAt;
  }
}

/**
 * Give the AI-written caption a genuine fresh shot too. Unlike music,
 * writing a caption is a lightweight text request, not a full re-render —
 * there's no real cost to trying again, so this always resets it, not
 * only when it was previously skipped. Without this, a clip whose caption
 * was marked "skipped" once (say, before any accounts were connected, or
 * before a caption prompt was ever set) would stay stuck that way
 * forever, no matter how many times it's pulled back and re-approved.
 * The person's own manual edits (editedTitle etc.) are untouched either
 * way, since those always take priority over the AI suggestion.
 */
function pullBackCopy(clip) {
  delete clip.copy;
  delete clip.copyState;
  delete clip.copyError;
}

/* ---- routes -------------------------------------------------------- */

async function route(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/healthz') return send(res, 200, { ok: true });

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const html = fs.readFileSync(page);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length });
    return res.end(html);
  }

  // Opus calls this when clipping finishes. It carries no secrets and only
  // nudges the agent to look sooner than its next scheduled pass.
  if (method === 'POST' && pathname === '/webhooks/opus') {
    const body = await readBody(req).catch(() => ({}));
    send(res, 200, { ok: true });
    const id = body?.projectId || body?.data?.projectId;
    const project = state.projects.find(p => p.id === id);
    if (project) { project.checkAfter = 0; save(); log(`Opus finished clipping ${project.title}`); }
    agent.tick().catch(() => {});
    return;
  }

  // Opus fetches the mixed file from here to re-import it, so this has to
  // be reachable without the app password — same reasoning as the webhook.
  if (method === 'GET' && pathname.startsWith('/media/mixed/')) {
    const file = audio.mixedFilePath(pathname.slice('/media/mixed/'.length));
    if (!file) return send(res, 404, { error: 'Not found.' });
    const buf = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    return res.end(buf);
  }

  if (!pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });
  if (!authed(req, url)) return send(res, 401, { error: 'Wrong password.' });

  if (method === 'GET' && pathname.startsWith('/api/clips/thumb/')) {
    const id = decodeURIComponent(pathname.slice('/api/clips/thumb/'.length).replace(/\.jpg$/, ''));
    const file = thumbs.thumbPath(id);
    if (!file) return send(res, 404, { error: 'No thumbnail yet.' });
    const buf = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
    return res.end(buf);
  }

  // Same-origin video previews. Opus preview/export links are signed and can
  // expire, so each browser asks this app; if the stored URL fails, the app
  // refreshes the clip from Opus and streams the fresh media back.
  if (method === 'GET' && pathname.startsWith('/api/clips/preview/')) {
    const raw = pathname.slice('/api/clips/preview/'.length).replace(/\.mp4$/i, '');
    const id = decodeURIComponent(raw);
    const clip = state.clips.find(c => c.id === id);
    if (!clip) return send(res, 404, { error: 'That clip is no longer in the queue.' });
    return pipeRemoteMedia(req, res, clip.preview || clip.exportUrl || '', () => refreshClipMediaUrl(clip));
  }

  const projectPreviewMatch = pathname.match(/^\/api\/projects\/([^/]+)\/clips\/([^/]+)\/preview(?:\.mp4)?$/);
  if (method === 'GET' && projectPreviewMatch) {
    const projectId = decodeURIComponent(projectPreviewMatch[1]);
    const clipId = decodeURIComponent(projectPreviewMatch[2]);
    return pipeRemoteMedia(req, res, '', () => refreshProjectClipMediaUrl(projectId, clipId));
  }

  if (method === 'GET' && pathname === '/api/state') {
    const rank = s => ({ waiting: 0, approved: 1, scheduled: 2, posted: 3 }[s] ?? 4);
    const clips = [...state.clips].sort((a, b) =>
      rank(a.status) - rank(b.status) || (a.scheduledAt || a.addedAt) - (b.scheduledAt || b.addedAt));

    // True while the agent is mid-job, so the page can refresh more often.
    const working = state.clips.some(c => c.stage || c.status === 'approved')
      || state.projects.some(p => p.status === 'clipping');

    return send(res, 200, {
      connected: Boolean(opusKey()),
      autoApprove: config.autoApprove,
      postTimes: config.postTimes,
      timezone: config.timezone,
      working,
      brandTemplateId: brandTemplateId(),
      brandTemplate: brandTemplateSelection(),
      clipSettings: clipSettings(),
      copyPrompt: copyPrompt(),
      musicSettings: audio.musicSettings(),
      accounts: state.accounts,
      projects: state.projects.slice(0, 12).map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        stage: p.stage || null,
        submittedAt: p.submittedAt,
        imported: state.clips.filter(c => sourceProjectIdForClip(c) === p.id).length,
        clipCount: p.clipCount,
      })),
      clips: (() => {
        const currentTemplate = brandTemplateId();
        const projectsById = new Map(state.projects.map(p => [p.id, p]));
        return clips.map(c => {
          const sourceProjectId = c.sourceProjectId || c.originalProjectId || c.projectId;
          const project = projectsById.get(sourceProjectId);
          const sourceTemplateId = c.sourceTemplateId ?? project?.brandTemplateIdUsed;
          const templateChanged = sourceTemplateId !== undefined && sourceTemplateId !== null
            ? sourceTemplateId !== currentTemplate
            : null; // older clips predate this being tracked — admit we don't know, rather than guess
          return {
            id: c.id,
            title: c.editedTitle ?? c.copy?.title ?? c.title,
            description: c.editedDescription ?? c.copy?.description ?? c.description,
            hashtags: c.editedHashtags ?? c.copy?.hashtags ?? c.hashtags,
            projectTitle: c.projectTitle,
            durationMs: c.durationMs,
            status: c.status,
            stage: c.stage || null,
            scheduledAt: c.scheduledAt,
            scheduledLabel: c.scheduledAt ? formatLocal(c.scheduledAt) : null,
            targets: c.targets,
            musicMixed: c.musicMixed || null,
            musicNote: c.musicNote || null,
            musicAttempts: c.musicAttempts || 0,
            musicNextTryAt: c.musicNextTryAt || null,
            musicTemplateId: c.musicTemplateId || null,
            templateError: c.templateError || null,
            sourceTemplateId: sourceTemplateId ?? null,
            sourceTemplateName: c.sourceTemplateName || project?.brandTemplateNameUsed || '',
            sourceCaptionsEnabled: typeof c.sourceCaptionsEnabled === 'boolean'
              ? c.sourceCaptionsEnabled
              : (typeof project?.captionsEnabledUsed === 'boolean' ? project.captionsEnabledUsed : null),
            copyState: c.copyState || null,
            copyError: c.copyError || null,
            thumbState: c.thumbState || null,
            thumbAttempts: c.thumbAttempts || 0,
            // The browser can show the actual clip immediately while the
            // server-generated JPEG is still pending or unavailable.
            previewUrl: c.id ? `/api/clips/preview/${encodeURIComponent(c.id)}.mp4` : (c.preview || c.exportUrl || ''),
            templateChanged,
          };
        });
      })(),
      log: state.log.slice(0, 40),
    });
  }

  if (method === 'POST' && pathname === '/api/connect') {
    const body = await readBody(req);
    const key = String(body.key || '').trim();
    if (!key) return send(res, 400, { error: 'Paste your Opus API key first.' });

    const previous = { key: state.opusKey, org: state.opusOrgId };
    state.opusKey = key;
    state.opusOrgId = String(body.orgId || '').trim();
    try {
      const accounts = await agent.refreshAccounts(true, true);
      save();
      log(`Connected to Opus. ${accounts.length} social accounts found.`);
      return send(res, 200, { ok: true, accounts });
    } catch (err) {
      state.opusKey = previous.key;
      state.opusOrgId = previous.org;
      return send(res, 400, { error: err.message });
    }
  }

  // The clip style — captions on or off, fonts, logo — lives in Opus.
  // List them here so one can be picked without hunting for its id.
  if (method === 'GET' && pathname === '/api/brand-templates') {
    try {
      const templates = await opus.getBrandTemplates();
      const currentId = brandTemplateId();
      const current = currentId ? templates.find(t => t.id === currentId) : null;
      // Automatically hydrate older saved selections that predate template
      // metadata tracking, so a normal page load is enough to verify them.
      if (current) setBrandTemplateSelection(current);
      return send(res, 200, { templates, brandTemplate: brandTemplateSelection() });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/brand-template') {
    const body = await readBody(req);
    const id = String(body.id ?? '').trim();

    if (!id) {
      setBrandTemplateSelection(null);
      log('Clip style cleared. Opus will use your account default, which cannot be strictly verified.');
      return send(res, 200, { ok: true, brandTemplateId: '', brandTemplate: brandTemplateSelection() });
    }

    try {
      const templates = await opus.getBrandTemplates();
      const chosen = templates.find(t => t.id === id);
      if (!chosen) return send(res, 400, { error: 'That Clip style is no longer available in your Opus account. Refresh the list and choose it again.' });

      setBrandTemplateSelection(chosen);
      log(`Clip style set to "${chosen.name}" (${chosen.enableCaption === false ? 'captions off' : chosen.enableCaption === true ? 'captions on' : 'caption setting unknown'}).`);
      return send(res, 200, {
        ok: true,
        brandTemplateId: chosen.id,
        brandTemplate: brandTemplateSelection(),
      });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // How many clips to keep per video, and how long each one should run.
  if (method === 'POST' && pathname === '/api/clip-settings') {
    const body = await readBody(req);
    const clean = {};

    if ('clipsPerVideo' in body) {
      const n = Math.round(Number(body.clipsPerVideo));
      if (!Number.isFinite(n) || n < 0 || n > 60) {
        return send(res, 400, { error: 'Clips per video must be between 0 (keep all) and 60.' });
      }
      clean.clipsPerVideo = n;
    }
    if ('clipMinSeconds' in body || 'clipMaxSeconds' in body) {
      const cur = clipSettings();
      const min = Math.round(Number(body.clipMinSeconds ?? cur.clipMinSeconds));
      const max = Math.round(Number(body.clipMaxSeconds ?? cur.clipMaxSeconds));
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 3 || max > 600 || min >= max) {
        return send(res, 400, { error: 'Clip length needs a minimum below the maximum, both between 3 and 600 seconds.' });
      }
      clean.clipMinSeconds = min;
      clean.clipMaxSeconds = max;
    }

    setClipSettings(clean);
    const applied = clipSettings();
    log(`Clip settings updated: ${applied.clipsPerVideo > 0 ? applied.clipsPerVideo + ' per video' : 'keep all'}, ${applied.clipMinSeconds}-${applied.clipMaxSeconds}s`);
    return send(res, 200, { ok: true, clipSettings: applied });
  }

  // The instructions sent to Opus for writing each clip's title, caption
  // and hashtags — this is how someone changes the language or tone of
  // what gets generated, without needing to redeploy anything.
  if (method === 'POST' && pathname === '/api/copy-prompt') {
    const body = await readBody(req);
    const prompt = String(body.prompt ?? '').trim();
    if (prompt.length > 2000) {
      return send(res, 400, { error: 'Keep the prompt under 2000 characters.' });
    }

    setCopyPrompt(prompt);

    // A new prompt should visibly affect the clips the person is currently
    // reviewing, not only clips imported in the future. This button explicitly
    // says rewrite, so it replaces both previous AI copy and unsaved wording.
    let queuedForRewrite = 0;
    for (const clip of state.clips) {
      if (clip.status !== 'waiting') continue;
      delete clip.copy;
      delete clip.copyState;
      delete clip.copyError;
      delete clip.editedTitle;
      delete clip.editedDescription;
      delete clip.editedHashtags;
      queuedForRewrite++;
    }
    save();
    log(`Caption prompt updated. ${queuedForRewrite} waiting clip${queuedForRewrite === 1 ? '' : 's'} queued for fresh Opus AI copy.`);
    send(res, 200, { ok: true, copyPrompt: copyPrompt(), queuedForRewrite });
    agent.tick().catch(() => {});
    return;
  }

  // The nasheed library — upload, list, remove, and the mix settings.
  if (method === 'GET' && pathname === '/api/music') {
    return send(res, 200, { tracks: audio.listNasheeds(), settings: audio.musicSettings() });
  }

  if (method === 'POST' && pathname === '/api/music') {
    // A full-length nasheed as base64 is easily tens of megabytes, so this
    // needs a much larger body limit than the usual small JSON requests.
    const body = await readBody(req, 45 * 1024 * 1024);
    try {
      const entry = await audio.saveNasheed(body.name, body.data, body.mimeType);
      log(`Added "${entry.name}" to the nasheed library.`);
      return send(res, 200, { ok: true, track: entry });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  if (method === 'DELETE' && pathname.startsWith('/api/music/')) {
    const id = pathname.slice('/api/music/'.length);
    const removed = audio.deleteNasheed(decodeURIComponent(id));
    if (!removed) return send(res, 404, { error: 'That track is not in the library.' });
    log('Removed a track from the nasheed library.');
    return send(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/music-settings') {
    const body = await readBody(req);
    const clean = {};
    if ('enabled' in body) clean.enabled = Boolean(body.enabled);
    if ('volumePercent' in body) {
      const n = Math.round(Number(body.volumePercent));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return send(res, 400, { error: 'Volume must be between 0 and 100.' });
      }
      clean.volumePercent = n;
    }
    audio.setMusicSettings(clean);
    const applied = audio.musicSettings();
    log(`Music settings updated: ${applied.enabled ? 'on' : 'off'}, volume ${applied.volumePercent}%`);
    return send(res, 200, { ok: true, settings: applied });
  }

  // A direct, no-guessing answer to "is ffmpeg actually working here" —
  // both music mixing and thumbnails depend on it.
  if (method === 'GET' && pathname === '/api/diagnostics/ffmpeg') {
    return send(res, 200, await checkFfmpeg());
  }

  // Every lecture ever sent to Opus, not just the recent ones /api/state
  // shows for the live "being clipped" list. This is what lets someone
  // pull more clips from something they already paid Opus to process,
  // instead of resubmitting the same video and spending credits again.
  if (method === 'GET' && pathname === '/api/projects') {
    const currentTemplate = brandTemplateId();
    const projects = state.projects.map(p => {
      const ownClips = state.clips.filter(c => sourceProjectIdForClip(c) === p.id);
      const hidden = new Set(Array.isArray(p.hiddenClipIds) ? p.hiddenClipIds : []);
      const cover = ownClips.find(c => c.preview || c.exportUrl) || ownClips.find(c => c.thumbState === 'ready');
      return {
        id: p.id,
        title: p.title,
        url: p.url,
        external: Boolean(p.external),
        status: p.status,
        submittedAt: p.submittedAt,
        // Derived fresh from what's actually in the queue right now, not a
        // running total — a total would only ever grow, even for clips
        // that were later discarded, eventually claiming more clips were
        // "imported" than Opus even reported existing for the lecture.
        imported: ownClips.length,
        hidden: hidden.size,
        clipCount: p.clipCount || 0,
        available: Math.max(0, (p.clipCount || 0) - ownClips.length - hidden.size),
        coverClipId: cover ? cover.id : null,
        // Only claim a style mismatch when we actually know what this
        // project used — older projects predate this being tracked at all,
        // and a confident wrong guess is worse than admitting we don't know.
        styleChanged: p.brandTemplateIdUsed !== undefined
          ? p.brandTemplateIdUsed !== currentTemplate
          : null,
      };
    });
    return send(res, 200, { projects });
  }

  // Opus's documented API cannot enumerate an organisation's full dashboard
  // library. This lets someone attach an existing project when they know its
  // project ID (or paste a dashboard link containing that ID).
  if (method === 'POST' && pathname === '/api/projects/import-existing') {
    const body = await readBody(req);
    try {
      const result = await agent.attachExistingProject(body.projectRef, body.title);
      return send(res, 200, { ok: true, ...result });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  const projectDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === 'DELETE' && projectDeleteMatch) {
    const projectId = decodeURIComponent(projectDeleteMatch[1]);
    try {
      const result = await agent.removeProject(projectId);
      return send(res, 200, { ok: true, ...result });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname.startsWith('/api/projects/') && pathname.endsWith('/more-clips')) {
    const id = decodeURIComponent(pathname.slice('/api/projects/'.length, -'/more-clips'.length));
    try {
      const result = await agent.refreshProjectClips(id);
      return send(res, 200, { ok: true, ...result });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // Every clip Opus has for a lecture, so someone can see exactly what's
  // there and pick specific ones, rather than only an automatic next batch.
  if (method === 'GET' && pathname.startsWith('/api/projects/') && pathname.endsWith('/available-clips')) {
    const id = decodeURIComponent(pathname.slice('/api/projects/'.length, -'/available-clips'.length));
    try {
      return send(res, 200, { clips: await agent.listAvailableClips(id) });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname.startsWith('/api/projects/') && pathname.endsWith('/import-clips')) {
    const id = decodeURIComponent(pathname.slice('/api/projects/'.length, -'/import-clips'.length));
    const body = await readBody(req);
    const clipIds = Array.isArray(body.clipIds) ? body.clipIds.map(String) : [];
    if (!clipIds.length) return send(res, 400, { error: 'No clips were selected.' });
    try {
      const result = await agent.importSelectedClips(id, clipIds);
      return send(res, 200, { ok: true, ...result });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  const projectClipMatch = pathname.match(/^\/api\/projects\/([^/]+)\/clips\/([^/]+)$/);
  if (method === 'DELETE' && projectClipMatch) {
    const projectId = decodeURIComponent(projectClipMatch[1]);
    const clipId = decodeURIComponent(projectClipMatch[2]);
    try {
      const result = await agent.removeProjectClip(projectId, clipId);
      return send(res, 200, { ok: true, ...result });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/accounts/refresh') {
    try { return send(res, 200, { accounts: await agent.refreshAccounts(true, true) }); }
    catch (err) { return send(res, 400, { error: err.message }); }
  }

  if (method === 'POST' && pathname === '/api/videos') {
    const body = await readBody(req);
    const urls = String(body.urls || '').split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);
    if (!urls.length) return send(res, 400, { error: 'No links found.' });

    const results = [];
    for (const u of urls) {
      if (!/^https?:\/\//i.test(u)) { results.push({ url: u, error: 'That is not a link.' }); continue; }
      try { await agent.submitVideo(u); results.push({ url: u, ok: true }); }
      catch (err) { results.push({ url: u, error: err.message }); }
    }
    if (results.some(r => r.ok)) setTimeout(() => agent.tick().catch(() => {}), 20_000);
    return send(res, 200, { results });
  }

  // Discard everything still waiting for review at once — the queue
  // equivalent of "pull back all", for clearing out a big batch you've
  // decided not to bother reading through individually.
  if (method === 'POST' && pathname === '/api/clips/discard-all') {
    const targets = state.clips.filter(c => c.status === 'waiting');
    for (const clip of targets) {
      await agent.unschedule(clip);
      thumbs.deleteThumbnail(clip.id);
    }
    const ids = new Set(targets.map(c => c.id));
    state.clips = state.clips.filter(c => !ids.has(c.id));
    save();
    if (targets.length) log(`Discarded ${targets.length} waiting clip${targets.length === 1 ? '' : 's'}.`);
    return send(res, 200, { ok: true, count: targets.length });
  }

  // Pull every currently loaded clip back to waiting at once — useful
  // after a settings change, so old clips scheduled under the previous
  // setup don't quietly go out wrong.
  if (method === 'POST' && pathname === '/api/clips/pull-back-all') {
    const targets = state.clips.filter(c => ['approved', 'scheduled'].includes(c.status));
    for (const clip of targets) {
      await agent.unschedule(clip);
      clip.status = 'waiting';
      pullBackMusic(clip);
      pullBackCopy(clip);
    }
    save();
    if (targets.length) log(`Pulled back ${targets.length} clip${targets.length === 1 ? '' : 's'} to the queue.`);
    return send(res, 200, { ok: true, count: targets.length });
  }

  const rewriteMatch = pathname.match(/^\/api\/clips\/([^/]+)\/rewrite$/);
  if (rewriteMatch && method === 'POST') {
    const id = decodeURIComponent(rewriteMatch[1]);
    try {
      const copy = await agent.regenerateCopy(id);
      return send(res, 200, { ok: true, copy });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  const clipMatch = pathname.match(/^\/api\/clips\/([^/]+)(\/now)?$/);
  if (clipMatch) {
    const id = decodeURIComponent(clipMatch[1]);

    if (clipMatch[2] === '/now' && method === 'POST') {
      try { await agent.postNow(id); return send(res, 200, { ok: true }); }
      catch (err) { return send(res, 400, { error: err.message }); }
    }

    const clip = state.clips.find(c => c.id === id);
    if (!clip) return send(res, 404, { error: 'That clip is no longer in the queue.' });

    if (method === 'PATCH') {
      const body = await readBody(req);
      if (typeof body.title === 'string') clip.editedTitle = body.title;
      if (typeof body.description === 'string') clip.editedDescription = body.description;
      if (typeof body.hashtags === 'string') clip.editedHashtags = body.hashtags;

      if (body.status === 'approved' && clip.status === 'waiting') {
        clip.status = 'approved';
        save();
        send(res, 200, { ok: true });
        agent.tick().catch(() => {});
        return;
      }
      if (body.status === 'waiting' && clip.status !== 'posted') {
        await agent.unschedule(clip);
        clip.status = 'waiting';
        pullBackMusic(clip);
        pullBackCopy(clip);
      }
      save();
      return send(res, 200, { ok: true });
    }

    if (method === 'DELETE') {
      await agent.unschedule(clip);
      state.clips = state.clips.filter(c => c.id !== id);
      thumbs.deleteThumbnail(id);
      save();
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Not found.' });
}

/* ---- server -------------------------------------------------------- */

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return send(res, 400, { error: 'Bad request.' }); }

  route(req, res, url).catch(err => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: err.message || 'Something went wrong.' });
  });
});

server.listen(config.port, () => {
  console.log(`Clip agent listening on http://localhost:${config.port}`);
  if (config.publicBaseUrl) console.log(`Opus webhook: ${config.publicBaseUrl}/webhooks/opus`);
  agent.start();
});
