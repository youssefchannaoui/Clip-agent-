import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { state, save, log, clipSettings, musicSettings, ownerOfRecord } from './store.js';
import { selectedTemplate, templateById } from './templates.js';
import { withOwner, ownerOf } from './tenancy.js';
import { workerMusicTracks } from './audio.js';
import * as billing from './billing.js';

const jobsDir = path.join(config.dataDir, 'jobs');
const sourcesDir = path.join(config.dataDir, 'sources');
const clipsDir = path.join(config.dataDir, 'clips');
const running = new Map();
const socialRendering = new Map();
let pumping = false;

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}
function projectById(projectId) { return state.projects.find(project => project.id === projectId) || null; }
function clipById(clipId) { return state.clips.find(clip => clip.id === clipId) || null; }
function jobFile(projectId) { return path.join(jobsDir, projectId, 'job.json'); }
function resultFile(projectId) { return path.join(jobsDir, projectId, 'result.json'); }
function removeDataFile(file) {
  if (!file) return;
  const resolved = path.resolve(file);
  const allowedRoot = path.resolve(config.dataDir) + path.sep;
  if (resolved.startsWith(allowedRoot)) fs.rmSync(resolved, { force: true });
}
/**
 * Render settings for one account.
 *
 * Clip length and music volume are per-account, so every job has to be built
 * with the settings of the person the work belongs to. Background work has no
 * signed-in user, so the owner is resolved from the record instead.
 */
function sharedSettings(user) {
  return {
    ...clipSettings(user), ...musicSettings(user),
    model: config.aiModel, device: config.aiDevice, computeType: config.aiComputeType,
    task: config.aiTask, language: config.aiLanguage, maxSourceMinutes: config.maxSourceMinutes,
    keepSourceFiles: config.keepSourceFiles, ollamaUrl: config.ollamaUrl, ollamaModel: config.ollamaModel,
  };
}


function runJsonCommand(command, args, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} reject(new Error('Timed out reading source metadata.')); }, timeoutMs);
    child.stdout.on('data', chunk => { out += chunk.toString(); });
    child.stderr.on('data', chunk => { err += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((err || out || `Command exited ${code}`).split('\n').filter(Boolean).slice(-1)[0] || 'Could not read metadata.'));
      try { resolve(JSON.parse(out)); }
      catch (error) { reject(new Error('Metadata response was not valid JSON.')); }
    });
  });
}
function pickBestThumbnail(info) {
  const thumbs = Array.isArray(info?.thumbnails) ? info.thumbnails : [];
  const sorted = thumbs.filter(t => t?.url).sort((a, b) => Number(b.width || 0) - Number(a.width || 0));
  return info?.thumbnail || sorted[0]?.url || '';
}
function youtubeIdFromUrl(value = '') {
  const text = String(value || '');
  const patterns = [/[?&]v=([^&#]+)/, /youtu\.be\/([^?&#/]+)/, /youtube\.com\/shorts\/([^?&#/]+)/, /youtube\.com\/embed\/([^?&#/]+)/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}
function fallbackThumb(url) {
  const id = youtubeIdFromUrl(url);
  return id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : '';
}
function parseIsoDuration(value = '') {
  const match = String(value || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!match) return null;
  const days = Number(match[1] || 0), hours = Number(match[2] || 0), minutes = Number(match[3] || 0), seconds = Number(match[4] || 0);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : null;
}
function durationFromMetadata(info) {
  const direct = Number(info?.duration || info?.duration_sec || info?.duration_seconds || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const ms = Number(info?.duration_ms || info?.approxDurationMs || 0);
  if (Number.isFinite(ms) && ms > 0) return Math.round(ms / 1000);
  const iso = parseIsoDuration(info?.duration || info?.durationText || info?.length_text || '');
  return iso ? Math.round(iso) : null;
}
async function ffprobeDuration(url) {
  const info = await runJsonCommand(config.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', url], 12_000);
  const duration = Number(info?.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
}
function youtubeWatchUrl(url) {
  const videoId = youtubeIdFromUrl(url);
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : String(url || '');
}
async function fetchText(url, timeoutMs = 18_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    };
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}
function metadataFromYouTubeHtml(html, url) {
  const text = String(html || '');
  const lengthMatch = text.match(/\"lengthSeconds\"\s*:\s*\"?(\d+)/)
    || text.match(/\"approxDurationMs\"\s*:\s*\"?(\d+)/);
  let durationSec = null;
  if (lengthMatch) {
    const raw = Number(lengthMatch[1]);
    durationSec = lengthMatch[0].includes('approxDurationMs') ? Math.round(raw / 1000) : Math.round(raw);
  }
  if (!durationSec) {
    const itemprop = text.match(/itemprop=[\"']duration[\"'][^>]*content=[\"']([^\"']+)/i)
      || text.match(/content=[\"']([^\"']+)[\"'][^>]*itemprop=[\"']duration[\"']/i)
      || text.match(/\"duration\"\s*:\s*\"(PT[^\"]+)/i);
    if (itemprop) durationSec = Math.round(parseIsoDuration(itemprop[1]) || 0) || null;
  }
  const titleMatch = text.match(/<meta\s+property=[\"']og:title[\"']\s+content=[\"']([^\"']+)/i)
    || text.match(/<title>([^<]+)/i);
  const thumbMatch = text.match(/<meta\s+property=[\"']og:image[\"']\s+content=[\"']([^\"']+)/i);
  const decode = input => String(input || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return {
    url,
    title: decode(titleMatch?.[1] || '').replace(/ - YouTube$/i, '').trim(),
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
    thumbnail: decode(thumbMatch?.[1] || '') || fallbackThumb(url),
    extractor: 'youtube-html',
  };
}
async function sourceInfoViaYouTubeHtml(url) {
  const watch = youtubeWatchUrl(url);
  if (!youtubeIdFromUrl(watch)) return null;
  const html = await fetchText(watch);
  const meta = metadataFromYouTubeHtml(html, url);
  return meta.durationSec ? meta : null;
}

async function sourceInfoViaYouTubeDataApi(url) {
  const videoId = youtubeIdFromUrl(url);
  const key = String(config.youtubeDataApiKey || '').trim();
  if (!videoId || !key) return null;
  const apiUrl = `${config.youtubeApiBase}/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(apiUrl, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `YouTube Data API HTTP ${response.status}`;
      throw new Error(message);
    }
    const item = Array.isArray(payload?.items) ? payload.items[0] : null;
    if (!item) return null;
    const durationSec = Math.round(parseIsoDuration(item?.contentDetails?.duration || '') || 0) || null;
    const thumbs = item?.snippet?.thumbnails || {};
    const thumbnail = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || fallbackThumb(url);
    return {
      url,
      title: String(item?.snippet?.title || url),
      durationSec,
      durationKnown: Boolean(durationSec),
      thumbnail,
      extractor: 'youtube-data-api',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sourceInfoViaYtDlp(url) {
  const baseArgs = ['-m', 'yt_dlp', '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings'];
  const attempts = [
    [...baseArgs, url],
    [...baseArgs, '--extractor-args', 'youtube:player_client=web,ios,android', url],
  ];
  let lastError = null;
  for (const args of attempts) {
    try {
      const info = await runJsonCommand(config.pythonBin, args, 35_000);
      const durationSec = durationFromMetadata(info);
      return {
        url,
        title: String(info.title || info.fulltitle || info.alt_title || url),
        durationSec,
        thumbnail: pickBestThumbnail(info) || fallbackThumb(url),
        extractor: info.extractor_key || info.extractor || 'yt-dlp',
      };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Could not read source metadata.');
}

export async function sourceInfo(url) {
  const value = String(url || '').trim();
  if (!value) throw new Error('No source URL supplied.');
  const warnings = [];

  try {
    const apiInfo = await sourceInfoViaYouTubeDataApi(value);
    if (apiInfo?.durationSec) return { ...apiInfo, durationKnown: true };
    if (youtubeIdFromUrl(value) && !config.youtubeDataApiKey) warnings.push('No YOUTUBE_DATA_API_KEY configured for reliable preflight duration.');
  } catch (error) { warnings.push(`YouTube Data API failed: ${error.message}`); }

  try {
    const info = await sourceInfoViaYtDlp(value);
    if (info.durationSec) return { ...info, durationKnown: true, warning: warnings.join(' | ') || undefined };
    warnings.push('yt-dlp did not return a duration.');
  } catch (error) { warnings.push(`yt-dlp failed: ${error.message}`); }

  try {
    const htmlInfo = await sourceInfoViaYouTubeHtml(value);
    if (htmlInfo?.durationSec) return { ...htmlInfo, durationKnown: true, warning: warnings.join(' | ') || undefined };
  } catch (error) { warnings.push(`YouTube HTML fallback failed: ${error.message}`); }

  let durationSec = null;
  try { durationSec = await ffprobeDuration(value); } catch (error) { warnings.push(`ffprobe failed: ${error.message}`); }
  return {
    url: value,
    title: value,
    durationSec: durationSec ? Math.round(durationSec) : null,
    durationKnown: Boolean(durationSec),
    thumbnail: fallbackThumb(value),
    warning: warnings.filter(Boolean).join(' | '),
  };
}

function cleanSourceRange(options = {}) {
  const raw = options?.sourceRange || options || {};
  const startSec = Math.max(0, Math.round(Number(raw.startSec ?? raw.sourceStartSeconds ?? 0) || 0));
  const endValue = Number(raw.endSec ?? raw.sourceEndSeconds);
  const endSec = Number.isFinite(endValue) && endValue > startSec ? Math.round(endValue) : null;
  return { startSec, endSec };
}

function validateSubmission(url, user) {
  const value = String(url || '').trim();
  if (!value) throw new Error('Paste a video link first.');
  if (!/^https?:\/\//i.test(value) && !value.startsWith('file://') && !path.isAbsolute(value)) {
    throw new Error('Use a complete http(s) video link.');
  }
  const template = selectedTemplate(user);
  if (!template?.id) throw new Error('Select a valid template before submitting.');
  const tracks = workerMusicTracks(user);
  if (!tracks.length) throw new Error('Music is required on every clip. Upload at least one nasheed first.');
  return { value, template, tracks };
}

export function readiness(user) {
  const template = selectedTemplate(user);
  const tracks = workerMusicTracks(user);
  return {
    ready: Boolean(template?.id && tracks.length), templateReady: Boolean(template?.id), template,
    musicReady: tracks.length > 0, musicTrackCount: tracks.length, engine: 'self-hosted', model: config.aiModel,
  };
}

export async function submitVideo(url, title = '', userId = '', options = {}) {
  // Every project must name the account that created it. Without an owner the
  // resulting clips are invisible to their creator and can surface elsewhere.
  if (!userId) throw new Error('Sign in before submitting a lecture.');
  const user = state.authUsers?.find(item => item.id === String(userId)) || { id: String(userId), role: 'creator' };
  const { value, template, tracks } = validateSubmission(url, user);
  billing.assertCanStartProject(user);
  const sourceRange = cleanSourceRange(options);
  const sourceMeta = Array.isArray(options?.sourceMeta) ? options.sourceMeta.find(item => String(item?.url || '') === value) || options.sourceMeta[0] : (options?.sourceMeta || {});
  const projectId = id('project');
  const project = withOwner({
    id: projectId, url: String(options.displayUrl || value), title: String(title || '').trim() || value,
    engine: 'self-hosted', status: 'queued', stage: 'Waiting for the local AI worker', progress: 0,
    submittedAt: Date.now(), clipCount: 0, templateIdUsed: template.id, templateNameUsed: template.name,
    templateVersionUsed: template.version || 1, templateSnapshot: template, musicRequired: true, error: null,
    sourceStartSec: sourceRange.startSec || 0, sourceEndSec: sourceRange.endSec || null,
    sourceTitle: sourceMeta?.title || null, sourceDurationSec: sourceMeta?.durationSec || null, sourceThumbUrl: sourceMeta?.thumbnail || null,
    sourceKind: options.sourceKind || 'link', originalFileName: options.originalFileName || null,
    uploadedInputFile: options.uploadedInputFile || null,
  }, user.id);
  state.projects.unshift(project);
  save();

  const dir = path.join(jobsDir, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const job = {
    id: projectId, url: value, title: String(title || '').trim(), sourceDir: sourcesDir,
    outputDir: path.join(clipsDir, projectId), resultPath: resultFile(projectId),
    ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath, template, musicTracks: tracks,
    settings: sharedSettings(user), sourceStartSec: sourceRange.startSec || 0, sourceEndSec: sourceRange.endSec || null,
    sourceTitle: sourceMeta?.title || null, sourceDurationSec: sourceMeta?.durationSec || null, sourceThumbUrl: sourceMeta?.thumbnail || null,
  };
  fs.writeFileSync(jobFile(projectId), JSON.stringify(job, null, 2));
  const rangeCopy = sourceRange.endSec ? ` · source window ${Math.round(sourceRange.startSec / 60)}–${Math.round(sourceRange.endSec / 60)} min` : (sourceRange.startSec ? ` · source starts at ${Math.round(sourceRange.startSec / 60)} min` : '');
  log(`Queued "${project.title}" for the self-hosted clip AI using template "${template.name}"${rangeCopy}.`, 'info', user.id);
  pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  return projectId;
}

function parseWorkerLine(record, line) {
  let payload;
  try { payload = JSON.parse(line); } catch { return; }
  if (payload.type === 'progress') {
    record.stage = String(payload.stage || 'Processing');
    record.progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
    record.status = 'processing';
    record.updatedAt = Date.now();
    save();
  } else if (payload.type === 'warning') {
    log(String(payload.warning || 'The worker reported a warning.'), 'warn');
  } else if (payload.type === 'error') {
    const safe = customerSafeProjectError(payload.error || 'The worker failed.');
    record.error = safe.message;
    record.errorCode = safe.code;
  }
}

export function customerSafeProjectError(value = '') {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (/sign in to confirm you(?:'|’)?re not a bot|cookies-from-browser|--cookies\b|youtube.*bot/i.test(raw)) {
    return {
      code: 'youtube_import_blocked',
      message: 'YouTube blocked this server-side import. Upload the original MP4 or MOV instead; DeenClipped never asks customers for browser cookies.',
    };
  }
  return { code: 'processing_failed', message: raw.slice(-1800) || 'The video could not be processed.' };
}

function importResult(project, file) {
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const imported = [];
  for (const clip of result.clips || []) {
    const record = withOwner({
      ...clip, status: 'waiting', targets: [], addedAt: Date.now(), scheduledAt: null, postedAt: null,
      projectTitle: result.project?.title || project.title, engine: 'self-hosted', renderVersion: 1,
    }, ownerOf(project));
    state.clips.push(record);
    imported.push(record);
  }
  project.title = result.project?.title || project.title;
  project.durationSec = result.project?.durationSec || null;
  project.sourceFullDurationSec = result.project?.sourceFullDurationSec || null;
  project.sourceStartSec = result.project?.sourceStartSec ?? project.sourceStartSec ?? 0;
  project.sourceEndSec = result.project?.sourceEndSec ?? project.sourceEndSec ?? null;
  project.sourceFile = result.project?.sourceFile || null;
  project.transcriptFile = result.project?.transcriptFile || null;
  project.clipCount = imported.length;
  project.status = 'done'; project.stage = 'Clips are ready for review'; project.progress = 100;
  project.completedAt = Date.now(); project.error = null;
  try {
    const charge = billing.chargeSourceMinutes(ownerOf(project), Number(project.durationSec || 0), { projectId: project.id, title: project.title });
    if (charge.charged) project.tokensCharged = charge.charged;
  } catch (error) {
    project.billingWarning = error.message;
    log(`Could not charge tokens for "${project.title}": ${error.message}`, 'warn', ownerOf(project));
  }
  save();
  log(`${imported.length} self-hosted clips are ready from "${project.title}". Every clip passed music, template and resolution checks.`, 'info', ownerOf(project));
}

function finishFailed(record, stderr, code, label) {
  record.status = 'failed'; record.stage = `${label} failed`;
  const safe = customerSafeProjectError(record.error || stderr || `Worker exited with code ${code}.`);
  record.error = safe.message;
  record.errorCode = safe.code;
  record.updatedAt = Date.now(); save();
}

function runProject(project) {
  return new Promise(resolve => {
    const file = jobFile(project.id);
    if (!fs.existsSync(file)) {
      project.status = 'failed'; project.error = 'The job file is missing. Retry the project.'; save(); resolve(); return;
    }
    project.status = 'processing'; project.stage = 'Starting the local AI worker';
    project.progress = Math.max(1, project.progress || 0); project.startedAt = Date.now(); project.error = null; save();
    const child = spawn(config.pythonBin, [config.workerScript, file], {
      cwd: config.root, env: { ...process.env, FFMPEG_PATH: config.ffmpegPath, FFPROBE_PATH: config.ffprobePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.set(project.id, child);
    let stdoutBuffer = '', stderr = '';
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString(); const lines = stdoutBuffer.split(/\r?\n/); stdoutBuffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) parseWorkerLine(project, line.trim());
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.on('error', error => { project.error = error.message; });
    child.on('close', code => {
      running.delete(project.id);
      if (stdoutBuffer.trim()) parseWorkerLine(project, stdoutBuffer.trim());
      try {
        if (code === 0 && fs.existsSync(resultFile(project.id))) importResult(project, resultFile(project.id));
        else { finishFailed(project, stderr, code, 'Processing'); log(`Could not process "${project.title}": ${project.error}`, 'error'); }
      } catch (error) {
        project.status = 'failed'; project.stage = 'Could not import rendered clips'; project.error = error.message; save();
        log(`Could not import "${project.title}": ${error.message}`, 'error');
      }
      resolve(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
    });
  });
}

function importMoreResult(project, jobRecord, file) {
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const existingIds = new Set(state.clips.map(clip => clip.id));
  const imported = [];
  for (const clip of result.clips || []) {
    if (!clip?.id || existingIds.has(clip.id)) continue;
    const record = withOwner({
      ...clip, projectId: project.id, projectTitle: project.title,
      status: 'waiting', targets: [], addedAt: Date.now(), scheduledAt: null, readyAt: null, postedAt: null,
      engine: 'self-hosted', renderVersion: 1, generatedFromSavedLecture: true,
    }, ownerOf(project));
    state.clips.push(record);
    existingIds.add(record.id);
    imported.push(record);
  }
  if (!imported.length) throw new Error('The worker did not return any new unused clips.');
  project.clipCount = state.clips.filter(clip => clip.projectId === project.id).length;
  jobRecord.status = 'done'; jobRecord.stage = `${imported.length} new clips ready`; jobRecord.progress = 100;
  jobRecord.completedAt = Date.now(); jobRecord.error = null; jobRecord.importedCount = imported.length;
  project.updatedAt = Date.now();
  try {
    const outputSeconds = imported.reduce((total, clip) => total + Math.max(0, Number(clip.endSec || 0) - Number(clip.startSec || 0)), 0);
    const charge = billing.chargeOutputMinutes(ownerOf(project), outputSeconds, { projectId: project.id, jobId: jobRecord.id, clips: imported.length });
    if (charge.charged) jobRecord.tokensCharged = charge.charged;
  } catch (error) {
    jobRecord.billingWarning = error.message;
    log(`Could not charge tokens for more clips in "${project.title}": ${error.message}`, 'warn', ownerOf(project));
  }
  save();
  log(`${imported.length} more clips were generated inside "${project.title}" using its saved source and transcript.`, 'info', ownerOf(project));
}

function runMoreClips(project, jobRecord) {
  return new Promise(resolve => {
    const file = jobRecord.jobFile;
    if (!file || !fs.existsSync(file)) {
      jobRecord.status = 'failed'; jobRecord.stage = 'Generate-more job is missing';
      jobRecord.error = 'The generate-more job file is missing. Start it again from Library.'; save(); resolve(); return;
    }
    jobRecord.status = 'processing'; jobRecord.stage = 'Loading the saved lecture';
    jobRecord.progress = 1; jobRecord.startedAt = Date.now(); jobRecord.error = null; save();
    const child = spawn(config.pythonBin, [config.workerScript, file], {
      cwd: config.root, env: { ...process.env, FFMPEG_PATH: config.ffmpegPath, FFPROBE_PATH: config.ffprobePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.set(jobRecord.id, child);
    let stdoutBuffer = '', stderr = '';
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString(); const lines = stdoutBuffer.split(/\r?\n/); stdoutBuffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) parseWorkerLine(jobRecord, line.trim());
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.on('error', error => { jobRecord.error = error.message; });
    child.on('close', code => {
      running.delete(jobRecord.id);
      if (stdoutBuffer.trim()) parseWorkerLine(jobRecord, stdoutBuffer.trim());
      try {
        if (code === 0 && fs.existsSync(jobRecord.resultPath)) importMoreResult(project, jobRecord, jobRecord.resultPath);
        else { finishFailed(jobRecord, stderr, code, 'Generate more clips'); log(`Could not generate more clips for "${project.title}": ${jobRecord.error}`, 'error'); }
      } catch (error) {
        jobRecord.status = 'failed'; jobRecord.stage = 'Could not import the new clips'; jobRecord.error = error.message; save();
        log(`Could not import more clips for "${project.title}": ${error.message}`, 'error');
      }
      resolve(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
    });
  });
}

function importRerenderResult(jobRecord, file) {
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rendered = result.clips?.[0];
  if (!rendered?.renderVerified || !rendered?.musicVerified) throw new Error('The re-render did not pass verification.');
  const original = clipById(jobRecord.clipId);
  if (!original) throw new Error('The original clip was removed before the re-render completed.');
  const newer = state.rerenderJobs.find(item => item.clipId === jobRecord.clipId && !item.asVariant && item.createdAt > jobRecord.createdAt && ['queued', 'processing', 'done'].includes(item.status));
  if (!jobRecord.asVariant && newer) {
    jobRecord.status = 'superseded';
    jobRecord.stage = 'A newer template render replaced this result';
    jobRecord.completedAt = Date.now();
    save();
    return;
  }

  if (jobRecord.asVariant) {
    const variant = withOwner({
      ...original, ...rendered, id: rendered.id, projectId: original.projectId, projectTitle: original.projectTitle,
      status: 'waiting', scheduledAt: null, readyAt: null, postedAt: null, addedAt: Date.now(),
      variantOf: original.id, renderVersion: (original.renderVersion || 1) + 1,
      title: original.title, description: original.description, hashtags: original.hashtags,
    }, ownerOf(original));
    state.clips.push(variant);
    const project = projectById(original.projectId);
    if (project) project.clipCount = state.clips.filter(clip => clip.projectId === project.id).length;
    jobRecord.resultClipId = variant.id;
    log(`Created a re-post variant of "${original.title}" with template "${rendered.templateName}".`);
  } else {
    if (original.status === 'posted') throw new Error('Posted videos cannot be replaced. Create a re-post variant instead.');
    const oldFiles = [original.clipFile, original.thumbFile];
    const preserved = {
      id: original.id, title: original.title, description: original.description, hashtags: original.hashtags,
      status: original.status, scheduledAt: original.scheduledAt, readyAt: original.readyAt,
      addedAt: original.addedAt, approvedAt: original.approvedAt, projectId: original.projectId, userId: ownerOf(original),
      projectTitle: original.projectTitle, targets: original.targets || [],
    };
    Object.assign(original, rendered, preserved, {
      renderVersion: (original.renderVersion || 1) + 1,
      rerenderedAt: Date.now(),
    });
    for (const oldFile of oldFiles) {
      if (oldFile && ![original.clipFile, original.thumbFile].includes(oldFile)) removeDataFile(oldFile);
    }
    jobRecord.resultClipId = original.id;
    log(`Re-rendered "${original.title}" with template "${rendered.templateName}" while preserving its queue status.`);
  }
  jobRecord.status = 'done'; jobRecord.stage = 'Re-render complete'; jobRecord.progress = 100;
  jobRecord.completedAt = Date.now(); jobRecord.error = null;
  save();
}

function runRerender(jobRecord) {
  return new Promise(resolve => {
    const file = jobRecord.jobFile;
    jobRecord.status = 'processing'; jobRecord.stage = 'Starting template re-render';
    jobRecord.progress = 1; jobRecord.startedAt = Date.now(); jobRecord.error = null; save();
    const child = spawn(config.pythonBin, [config.workerScript, file], {
      cwd: config.root, env: { ...process.env, FFMPEG_PATH: config.ffmpegPath, FFPROBE_PATH: config.ffprobePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.set(jobRecord.id, child);
    let stdoutBuffer = '', stderr = '';
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString(); const lines = stdoutBuffer.split(/\r?\n/); stdoutBuffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) parseWorkerLine(jobRecord, line.trim());
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.on('error', error => { jobRecord.error = error.message; });
    child.on('close', code => {
      running.delete(jobRecord.id);
      if (stdoutBuffer.trim()) parseWorkerLine(jobRecord, stdoutBuffer.trim());
      try {
        if (code === 0 && fs.existsSync(jobRecord.resultPath)) importRerenderResult(jobRecord, jobRecord.resultPath);
        else { finishFailed(jobRecord, stderr, code, 'Re-render'); log(`Re-render failed: ${jobRecord.error}`, 'error'); }
      } catch (error) {
        jobRecord.status = 'failed'; jobRecord.stage = 'Could not import re-render'; jobRecord.error = error.message; save();
        log(`Could not import re-render: ${error.message}`, 'error');
      }
      resolve(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
    });
  });
}

export function queueMoreClips(projectId, requestedCount = 8) {
  const project = projectById(projectId);
  if (!project) throw new Error('That lecture does not exist.');
  if (!['done', 'completed'].includes(project.status)) throw new Error('Wait for the lecture to finish processing before generating more clips.');
  if (project.moreJob && ['queued', 'processing'].includes(project.moreJob.status)) {
    throw new Error('This lecture is already generating more clips.');
  }
  if (!project.sourceFile || !fs.existsSync(project.sourceFile)) {
    throw new Error('The saved source video is unavailable. Generate more cannot safely re-download it because that would create a duplicate Library lecture.');
  }
  if (!project.transcriptFile || !fs.existsSync(project.transcriptFile)) {
    throw new Error('The saved transcript is unavailable. This lecture must be processed again before more clips can be generated.');
  }
  const count = Math.max(1, Math.min(20, Math.round(Number(requestedCount) || 8)));
  const owner = ownerOfRecord(project);
  billing.assertCanSpend(owner, billing.tokenCostForSeconds(count * (clipSettings(owner).clipMaxSeconds || 60)), 'generate more clips');
  const template = selectedTemplate(owner);
  if (!template?.id) throw new Error('Choose a valid saved template.');
  const tracks = workerMusicTracks(owner);
  if (!tracks.length) throw new Error('Music is mandatory. Upload at least one nasheed first.');
  const transcriptSegments = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
  if (!Array.isArray(transcriptSegments) || !transcriptSegments.length) throw new Error('The saved transcript is empty.');
  const existingRanges = state.clips
    .filter(clip => clip.projectId === project.id)
    .map(clip => ({ id: clip.id, startSec: Number(clip.startSec || 0), endSec: Number(clip.endSec || 0) }));

  const moreId = id('more');
  const dir = path.join(jobsDir, moreId);
  fs.mkdirSync(dir, { recursive: true });
  const resultPath = path.join(dir, 'result.json');
  const outputDir = path.join(clipsDir, project.id, 'more', moreId);
  const payload = {
    mode: 'more_clips', id: moreId, projectId: project.id, projectTitle: project.title, requestedCount: count,
    sourceFile: project.sourceFile, transcriptFile: project.transcriptFile, transcriptSegments, existingRanges,
    outputDir, resultPath, ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath,
    template, musicTracks: tracks, settings: { ...sharedSettings(owner), clipsPerVideo: count },
  };
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  const record = {
    id: moreId, status: 'queued', stage: 'Waiting to generate more clips', progress: 0,
    requestedCount: count, createdAt: Date.now(), updatedAt: Date.now(), jobFile: file, resultPath,
    reusedSource: true, reusedTranscript: true,
  };
  project.moreJob = record;
  project.updatedAt = Date.now();
  save();
  log(`Queued ${count} more clips inside "${project.title}" using the saved source and transcript.`, 'info', ownerOf(project));
  pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  return record;
}

export function queueClipRerender(clipId, templateId, { asVariant = false } = {}) {
  const clip = clipById(clipId);
  if (!clip) throw new Error('That clip does not exist.');
  if (clip.status === 'posted' && !asVariant) throw new Error('A posted video cannot be changed. Create a re-post variant instead.');
  const project = projectById(clip.projectId);
  if (!project?.sourceFile || !fs.existsSync(project.sourceFile)) throw new Error('The original source file is unavailable. Keep source files enabled to re-render clips.');
  const owner = ownerOfRecord(clip);
  const template = templateById(templateId, owner) || selectedTemplate(owner);
  if (!template?.id) throw new Error('Choose a valid saved template.');
  const tracks = workerMusicTracks(owner);
  if (!tracks.length) throw new Error('Music is mandatory. Upload at least one nasheed first.');
  const transcriptSegments = project.transcriptFile && fs.existsSync(project.transcriptFile)
    ? JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8')) : [];
  const rerenderId = id('rerender');
  const dir = path.join(jobsDir, rerenderId);
  fs.mkdirSync(dir, { recursive: true });
  const resultPath = path.join(dir, 'result.json');
  const outputDir = path.join(clipsDir, project.id, 'rerenders');
  const outputClipId = asVariant ? `${clip.id}-variant-${Date.now().toString(36)}` : `${clip.id}-render-${Date.now().toString(36)}`;
  const payload = {
    mode: 'rerender', id: rerenderId, projectId: project.id, clipIdOverride: outputClipId,
    sourceFile: project.sourceFile, outputDir, resultPath, ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath,
    template, musicTracks: tracks, settings: sharedSettings(owner), transcriptSegments,
    clip: {
      id: clip.id, title: clip.title, description: clip.description, transcript: clip.transcript,
      startSec: clip.startSec, endSec: clip.endSec, score: clip.score, scoreReasons: clip.scoreReasons,
      reviewRequired: clip.reviewRequired,
    },
  };
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  const record = withOwner({
    id: rerenderId, clipId: clip.id, templateId: template.id, templateName: template.name,
    asVariant: Boolean(asVariant), status: 'queued', stage: 'Waiting to re-render', progress: 0,
    createdAt: Date.now(), jobFile: file, resultPath,
  }, ownerOf(clip));
  state.rerenderJobs.unshift(record);
  state.rerenderJobs = state.rerenderJobs.slice(0, 60);
  save();
  log(`Queued ${asVariant ? 'a re-post variant' : 'a re-render'} of "${clip.title}" using "${template.name}".`, 'info', ownerOf(clip));
  pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  return record;
}

export async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (running.size < config.maxConcurrentJobs) {
      const candidates = [
        ...state.projects.filter(item => item.engine === 'self-hosted' && item.status === 'queued').map(item => ({ type: 'project', item, at: item.submittedAt })),
        ...state.projects.filter(item => item.moreJob?.status === 'queued').map(item => ({ type: 'more', item: item.moreJob, project: item, at: item.moreJob.createdAt })),
        ...state.rerenderJobs.filter(item => item.status === 'queued').map(item => ({ type: 'rerender', item, at: item.createdAt })),
      ].sort((a, b) => a.at - b.at);
      const next = candidates[0];
      if (!next) break;
      if (next.type === 'project') runProject(next.item).catch(error => { next.item.status = 'failed'; next.item.error = error.message; save(); });
      else if (next.type === 'more') runMoreClips(next.project, next.item).catch(error => { next.item.status = 'failed'; next.item.error = error.message; save(); });
      else runRerender(next.item).catch(error => { next.item.status = 'failed'; next.item.error = error.message; save(); });
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  } finally { pumping = false; }
}



function runWorkerJob(jobPath, resultPath, label = 'Render') {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonBin, [config.workerScript, jobPath], {
      cwd: config.root, env: { ...process.env, FFMPEG_PATH: config.ffmpegPath, FFPROBE_PATH: config.ffprobePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 || !fs.existsSync(resultPath)) return reject(new Error(`${label} failed: ${stderr.trim().slice(-1800) || `worker exited with ${code}`}`));
      try { resolve(JSON.parse(fs.readFileSync(resultPath, 'utf8'))); }
      catch (error) { reject(new Error(`${label} returned invalid output: ${error.message}`)); }
    });
  });
}

/**
 * Return the final file used for a social platform. TikTok's Content Posting
 * rules prohibit app-added promotional watermarks, so an invisible clean
 * derivative is rendered automatically while the user's normal branded clip
 * remains unchanged for every other destination.
 */
export async function socialPublishFile(clipId, provider) {
  const clip = clipById(clipId);
  if (!clip) throw new Error('That clip does not exist.');
  const regular = clipFilePath(clipId, 'video');
  if (!regular) throw new Error('The rendered clip file is missing.');
  if (provider !== 'tiktok') return regular;

  const clipOwner = ownerOfRecord(clip);
  const template = structuredClone(clip.templateSnapshot || templateById(clip.templateId, clipOwner) || selectedTemplate(clipOwner));
  const needsCleanVariant = Boolean(String(template?.watermark || '').trim() || template?.brandLineEnabled);
  if (!needsCleanVariant) return regular;
  const existing = clip.socialVariants?.tiktok?.clipFile;
  if (existing && fs.existsSync(existing)) return existing;
  if (socialRendering.has(clipId)) return socialRendering.get(clipId);

  const promise = (async () => {
    const project = projectById(clip.projectId);
    if (!project?.sourceFile || !fs.existsSync(project.sourceFile)) throw new Error('The original source is unavailable for the automatic TikTok-safe render.');
    const transcriptSegments = project.transcriptFile && fs.existsSync(project.transcriptFile)
      ? JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8')) : [];
    const tracks = workerMusicTracks(clipOwner);
    if (!tracks.length) throw new Error('Music is required for the TikTok-safe render.');
    const matching = tracks.find(track => track.name === clip.musicName);
    const selectedTracks = matching ? [matching] : tracks;
    const cleanTemplate = {
      ...template,
      id: `${template.id || 'template'}-tiktok-safe`,
      name: `${template.name || 'Template'} · TikTok safe`,
      watermark: '',
      brandLineEnabled: false,
    };
    const renderId = id('social_tiktok');
    const dir = path.join(jobsDir, renderId);
    fs.mkdirSync(dir, { recursive: true });
    const resultPath = path.join(dir, 'result.json');
    const outputDir = path.join(clipsDir, project.id, 'social');
    const outputClipId = `${clip.id}-tiktok-safe`;
    const payload = {
      mode: 'rerender', id: renderId, projectId: project.id, clipIdOverride: outputClipId,
      sourceFile: project.sourceFile, outputDir, resultPath, ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath,
      template: cleanTemplate, musicTracks: selectedTracks, settings: sharedSettings(clipOwner), transcriptSegments,
      clip: {
        id: clip.id, title: clip.title, description: clip.description, transcript: clip.transcript,
        startSec: clip.startSec, endSec: clip.endSec, score: clip.score, scoreReasons: clip.scoreReasons,
        reviewRequired: clip.reviewRequired,
      },
    };
    const jobPath = path.join(dir, 'job.json');
    fs.writeFileSync(jobPath, JSON.stringify(payload, null, 2));
    log(`Rendering a TikTok-safe copy of "${clip.title}" without the app watermark.`);
    const result = await runWorkerJob(jobPath, resultPath, 'TikTok-safe render');
    const rendered = result.clips?.[0];
    if (!rendered?.renderVerified || !rendered?.musicVerified || !rendered?.clipFile || !fs.existsSync(rendered.clipFile)) {
      throw new Error('The TikTok-safe copy did not pass video, audio and music verification.');
    }
    clip.socialVariants = { ...(clip.socialVariants || {}), tiktok: { ...rendered, createdAt: Date.now() } };
    save();
    return rendered.clipFile;
  })().finally(() => socialRendering.delete(clipId));
  socialRendering.set(clipId, promise);
  return promise;
}

export function retryProject(projectId) {
  const project = projectById(projectId);
  if (!project) throw new Error('That project does not exist.');
  if (running.has(projectId)) throw new Error('That project is already processing.');
  if (!fs.existsSync(jobFile(projectId))) throw new Error('The project job file is missing. Submit the video again.');
  const job = JSON.parse(fs.readFileSync(jobFile(projectId), 'utf8'));
  const projectOwner = ownerOfRecord(project);
  const template = selectedTemplate(projectOwner); const tracks = workerMusicTracks(projectOwner);
  if (!template?.id) throw new Error('Select a template before retrying.');
  if (!tracks.length) throw new Error('Upload at least one nasheed before retrying.');
  job.template = template; job.musicTracks = tracks; job.settings = sharedSettings(projectOwner);
  fs.writeFileSync(jobFile(projectId), JSON.stringify(job, null, 2));
  fs.rmSync(resultFile(projectId), { force: true });
  Object.assign(project, {
    status: 'queued', stage: 'Waiting to retry', progress: 0, error: null,
    templateIdUsed: template.id, templateNameUsed: template.name,
    templateVersionUsed: template.version || 1, templateSnapshot: template,
  });
  save(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  return project;
}

export function cancelProject(projectId) {
  running.get(projectId)?.kill('SIGTERM');
  const project = projectById(projectId);
  if (project?.moreJob?.id) running.get(project.moreJob.id)?.kill('SIGTERM');
}
export function deleteProject(projectId) {
  const project = projectById(projectId);
  if (!project) throw new Error('That project does not exist.');
  cancelProject(projectId);
  const clipIds = new Set(state.clips.filter(clip => clip.projectId === projectId).map(clip => clip.id));
  state.clips = state.clips.filter(clip => !clipIds.has(clip.id));
  state.projects = state.projects.filter(item => item.id !== projectId);
  state.rerenderJobs = state.rerenderJobs.filter(item => !clipIds.has(item.clipId));
  fs.rmSync(path.join(jobsDir, projectId), { recursive: true, force: true });
  if (project.moreJob?.id) fs.rmSync(path.join(jobsDir, project.moreJob.id), { recursive: true, force: true });
  fs.rmSync(path.join(clipsDir, projectId), { recursive: true, force: true });
  if (project.sourceFile) removeDataFile(project.sourceFile);
  if (project.uploadedInputFile) removeDataFile(project.uploadedInputFile);
  save(); log(`Removed "${project.title}" and its local rendered files.`);
}

export function clipFilePath(clipId, kind = 'video') {
  const clip = clipById(clipId); if (!clip) return null;
  const candidate = kind === 'thumb' ? clip.thumbFile : clip.clipFile;
  if (!candidate) return null;
  const resolved = path.resolve(candidate); const allowedRoot = path.resolve(config.dataDir) + path.sep;
  if (!resolved.startsWith(allowedRoot) || !fs.existsSync(resolved)) return null;
  return resolved;
}

export function recoverInterruptedJobs() {
  for (const project of state.projects) {
    if (project.engine === 'self-hosted' && project.status === 'processing') {
      project.status = 'queued'; project.stage = 'Recovered after server restart'; project.progress = Math.min(project.progress || 0, 95);
    }
    if (project.moreJob?.status === 'processing') {
      project.moreJob.status = 'queued'; project.moreJob.stage = 'Recovered after server restart'; project.moreJob.progress = Math.min(project.moreJob.progress || 0, 95);
    }
  }
  for (const job of state.rerenderJobs) {
    if (job.status === 'processing') { job.status = 'queued'; job.stage = 'Recovered after server restart'; job.progress = 0; }
  }
  save(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
}
export function activeJobCount() { return running.size; }
