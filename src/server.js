import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { state, save, log, opusKey, brandTemplateId } from './store.js';
import * as agent from './agent.js';
import * as opus from './opus.js';
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

  if (!pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });
  if (!authed(req, url)) return send(res, 401, { error: 'Wrong password.' });

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
      accounts: state.accounts,
      projects: state.projects.slice(0, 12).map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        stage: p.stage || null,
        submittedAt: p.submittedAt,
        imported: p.imported,
        clipCount: p.clipCount,
      })),
      clips: clips.map(c => ({
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
      })),
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
    try { return send(res, 200, { templates: await opus.getBrandTemplates() }); }
    catch (err) { return send(res, 400, { error: err.message }); }
  }

  if (method === 'POST' && pathname === '/api/brand-template') {
    const body = await readBody(req);
    const id = String(body.id ?? '').trim();
    state.brandTemplateId = id;
    save();
    log(id ? `Clip style set. New lectures will use it.` : 'Clip style cleared. Opus will use your account default.');
    return send(res, 200, { ok: true, brandTemplateId: brandTemplateId() });
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
      }
      save();
      return send(res, 200, { ok: true });
    }

    if (method === 'DELETE') {
      await agent.unschedule(clip);
      state.clips = state.clips.filter(c => c.id !== id);
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
