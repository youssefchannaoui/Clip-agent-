import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { state, save, log, clipSettings, musicSettings, brandSettings, ownerOfRecord } from './store.js';
import { selectedTemplate, templateById } from './templates.js';
import { withOwner, ownerOf } from './tenancy.js';
import { workerMusicTracks } from './audio.js';
import * as billing from './billing.js';
import * as vizard from './vizard.js';
import * as workerClient from './worker-client.js';
import { parseYouTubeUrl, assertStorageObjectKey } from './video-import.js';

const jobsDir = path.join(config.dataDir, 'jobs');
const sourcesDir = path.join(config.dataDir, 'sources');
const clipsDir = path.join(config.dataDir, 'clips');
const publishCacheDir = path.join(config.dataDir, 'publish-cache');
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

function trustedRemoteMediaUrl(value) {
  const url = new URL(String(value || ''));
  const configuredBase = config.objectStoragePublicUrl || config.objectStorageEndpoint;
  if (!configuredBase || url.protocol !== 'https:' || url.origin !== new URL(configuredBase).origin) {
    throw new Error('The rendered clip URL is outside the configured media storage host.');
  }
  return url.toString();
}

async function cacheRemotePublishClip(clip) {
  const url = trustedRemoteMediaUrl(clip.clipUrl);
  fs.mkdirSync(publishCacheDir, { recursive: true });
  const file = path.join(publishCacheDir, `${String(clip.id).replace(/[^A-Za-z0-9_-]/g, '_')}.mp4`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  const temporary = `${file}.part`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Stored clip download returned HTTP ${response.status}.`);
    trustedRemoteMediaUrl(response.url || url);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 256 * 1024 * 1024) throw new Error('This finished clip is too large for the publishing relay. Download it or shorten the clip.');
    let received = 0;
    const limiter = new TransformStream({ transform(chunk, stream) { received += chunk.byteLength; if (received > 256 * 1024 * 1024) throw new Error('This finished clip exceeds the publishing relay limit.'); stream.enqueue(chunk); } });
    await pipeline(Readable.fromWeb(response.body.pipeThrough(limiter)), fs.createWriteStream(temporary));
    fs.renameSync(temporary, file);
    return file;
  } finally {
    clearTimeout(timer);
    fs.rmSync(temporary, { force: true });
  }
}
/**
 * Render settings for one account.
 *
 * Clip length and music volume are per-account, so every job has to be built
 * with the settings of the person the work belongs to. Background work has no
 * signed-in user, so the owner is resolved from the record instead.
 */
function sharedSettings(user) {
  const brand = brandSettings(user);
  return {
    ...clipSettings(user), ...musicSettings(user),
    model: config.aiModel, device: config.aiDevice, computeType: config.aiComputeType,
    task: config.aiTask, language: config.aiLanguage, maxSourceMinutes: config.maxSourceMinutes,
    keepSourceFiles: config.keepSourceFiles, ollamaUrl: config.ollamaUrl, ollamaModel: config.ollamaModel,
    videoPreset: config.videoPreset, videoCrf: config.videoCrf,
    brandVocabulary: brand.brandVocabulary || [], audience: brand.audience || 'general',
    contentGoal: brand.contentGoal || 'education', brandTone: brand.brandTone || 'respectful',
    avoidPhrases: brand.avoidPhrases || [],
  };
}

/**
 * Resolve the template that is actually sent to FFmpeg. Watermark entitlement
 * lives here instead of in the browser so free accounts cannot remove the
 * DeenClipped mark by editing a request or a saved template file.
 */
export function effectiveTemplateForUser(user, sourceTemplate = null) {
  const source = sourceTemplate || selectedTemplate(user) || {};
  const template = structuredClone(source);
  const access = billing.featureAccess(user);
  const brand = brandSettings(user);
  if (access.watermarkRequired) {
    template.watermark = 'DEENCLIPPED';
    template.watermarkOpacity = Math.max(72, Number(brand.watermarkOpacity || 88));
    template.watermarkPosition = 'top-center';
    template.watermarkColor = '#D9B478';
    template.brandLineEnabled = false;
  } else {
    template.watermark = brand.watermarkEnabled === false ? '' : String(brand.watermarkText || 'DEENCLIPPED').trim().slice(0, 60);
    template.watermarkOpacity = Number(brand.watermarkOpacity ?? template.watermarkOpacity ?? 88);
    template.watermarkPosition = brand.watermarkPosition || template.watermarkPosition || 'top-center';
    template.watermarkColor = brand.watermarkColor || template.watermarkColor || '#D9B478';
  }
  if (access.customBranding) {
    template.brandLineEnabled = Boolean(brand.brandLineEnabled);
    template.brandLineColor = brand.brandLineColor || template.brandLineColor || '#D9B478';
  }
  template.watermarkRequired = access.watermarkRequired;
  return template;
}

function remoteProcessing() { return config.processingMode === 'remote'; }

function signedMusicUrl(track, userId) {
  const expires = Date.now() + config.workerJobTimeoutMs;
  const message = `${track.id}\n${userId}\n${expires}`;
  const sig = crypto.createHmac('sha256', config.workerCallbackSecret).update(message).digest('hex');
  return `${config.publicBaseUrl}/api/worker-assets/music/${encodeURIComponent(track.id)}?user=${encodeURIComponent(userId)}&exp=${expires}&sig=${sig}`;
}

export function verifyWorkerAssetSignature(trackId, userId, expires, supplied) {
  const expiry = Number(expires);
  if (!config.workerCallbackSecret || !Number.isFinite(expiry) || expiry < Date.now() || expiry > Date.now() + config.workerJobTimeoutMs + 60_000) return false;
  const expected = crypto.createHmac('sha256', config.workerCallbackSecret).update(`${trackId}\n${userId}\n${expiry}`).digest('hex');
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function remoteMusicTracks(tracks, userId) {
  if (!config.publicBaseUrl) throw new Error('PUBLIC_BASE_URL must be configured before the external worker can fetch nasheed tracks.');
  return tracks.map(track => ({ id: track.id, name: track.name, url: signedMusicUrl(track, userId) }));
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
  if (remoteProcessing()) {
    const parsed = parseYouTubeUrl(value);
    // yt-dlp and ffprobe do not exist on the web service, but the YouTube Data
    // API and the public watch page are ordinary HTTPS calls that work here.
    // Trying them means the token estimate is based on the real length instead
    // of forcing the person to type it in by hand every single time.
    try {
      const apiInfo = await sourceInfoViaYouTubeDataApi(value);
      if (apiInfo?.durationSec) return { ...apiInfo, durationKnown: true, extractor: 'youtube-data-api' };
    } catch { /* fall through to the HTML page */ }
    try {
      const htmlInfo = await sourceInfoViaYouTubeHtml(value);
      if (htmlInfo?.durationSec) return { ...htmlInfo, durationKnown: true, extractor: 'youtube-html' };
    } catch { /* fall through to manual entry */ }
    return {
      url: parsed.canonicalUrl, title: parsed.canonicalUrl, durationSec: null, durationKnown: false,
      thumbnail: fallbackThumb(parsed.canonicalUrl), extractor: 'validated-only',
      warning: config.youtubeDataApiKey
        ? 'Could not read the duration from YouTube; enter it manually.'
        : 'Set YOUTUBE_DATA_API_KEY for reliable duration lookup.',
    };
  }
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

function validateSubmission(url, user, options = {}) {
  const value = String(url || '').trim();
  if (!value) throw new Error(options.sourceKind === 'object_storage' ? 'Upload a video first.' : 'Paste a video link first.');
  if (remoteProcessing() && options.sourceKind === 'object_storage') assertStorageObjectKey(value);
  else if (remoteProcessing()) parseYouTubeUrl(value);
  else if (!/^https?:\/\//i.test(value) && !value.startsWith('file://') && !path.isAbsolute(value)) {
    throw new Error('Use a complete http(s) video link.');
  }
  const template = effectiveTemplateForUser(user, selectedTemplate(user));
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
    musicReady: tracks.length > 0, musicTrackCount: tracks.length, engine: remoteProcessing() ? 'remote-worker' : 'self-hosted', model: config.aiModel,
    worker: { configured: workerClient.configured(), mode: config.processingMode },
    youtubeImport: { configured: remoteProcessing() ? Boolean(config.videoImportApiKey && workerClient.configured()) : vizard.configured(), provider: remoteProcessing() ? config.videoImportProvider : 'vizard' },
  };
}

export async function submitVideo(url, title = '', userId = '', options = {}) {
  // Every project must name the account that created it. Without an owner the
  // resulting clips are invisible to their creator and can surface elsewhere.
  if (!userId) throw new Error('Sign in before submitting a lecture.');
  const user = state.authUsers?.find(item => item.id === String(userId)) || { id: String(userId), role: 'creator' };
  const { value, template, tracks } = validateSubmission(url, user, options);
  billing.assertCanStartProject(user);
  const sourceRange = cleanSourceRange(options);
  const sourceMeta = Array.isArray(options?.sourceMeta) ? options.sourceMeta.find(item => String(item?.url || '') === value) || options.sourceMeta[0] : (options?.sourceMeta || {});
  const projectId = id('project');
  const useRemote = remoteProcessing();
  const useVizard = !useRemote && vizard.isYouTubeUrl(value);
  if (useVizard && !vizard.configured()) {
    throw new Error('YouTube URL import is not configured yet. The site owner must add a Vizard API key. You can still upload an MP4 or MOV.');
  }
  const knownDuration = Number(sourceMeta?.durationSec || 0);
  const trimsYouTube = sourceRange.startSec > 0
    || (sourceRange.endSec && knownDuration > 0 && sourceRange.endSec < knownDuration - 2);
  if (useVizard && trimsYouTube) {
    throw new Error('YouTube URL import currently processes the full video. Reset the source window to Full video, or upload the original file to clip only a selected range.');
  }
  const project = withOwner({
    id: projectId, url: String(options.displayUrl || value), title: String(title || '').trim() || value,
    engine: useRemote ? 'remote' : useVizard ? 'vizard' : 'self-hosted', status: 'queued',
    stage: useRemote ? 'queued' : useVizard ? 'Waiting for secure YouTube import' : 'Waiting for the local AI worker', progress: 0,
    submittedAt: Date.now(), clipCount: 0, templateIdUsed: template.id, templateNameUsed: template.name,
    templateVersionUsed: template.version || 1, templateSnapshot: template, musicRequired: true, error: null,
    sourceStartSec: sourceRange.startSec || 0, sourceEndSec: sourceRange.endSec || null,
    sourceTitle: sourceMeta?.title || null, sourceDurationSec: sourceMeta?.durationSec || null, sourceThumbUrl: sourceMeta?.thumbnail || null,
    sourceKind: options.sourceKind || 'link', originalFileName: options.originalFileName || null,
    uploadedInputFile: options.uploadedInputFile || null, sourceObjectKey: options.sourceKind === 'object_storage' ? value : null,
  }, user.id);
  state.projects.unshift(project);
  save();

  const dir = path.join(jobsDir, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const job = useRemote ? {
    id: projectId, projectId, title: String(title || '').trim() || sourceMeta?.title || '',
    source: options.sourceKind === 'object_storage'
      ? { type: 'object_storage', objectKey: assertStorageObjectKey(value), title: options.originalFileName || sourceMeta?.title || '' }
      : { type: 'youtube', url: parseYouTubeUrl(value).canonicalUrl },
    template, musicTracks: remoteMusicTracks(tracks, user.id), settings: sharedSettings(user),
    requestedClipCount: clipSettings(user).clipsPerVideo,
    // The worker rotates between accounts rather than running strict FIFO, so
    // it needs to know whose job this is. Fairness only — the worker never
    // uses this to decide who may see what.
    tenant: user.id,
    sourceStartSec: sourceRange.startSec || 0, sourceEndSec: sourceRange.endSec || null,
    callbackUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/api/worker-callbacks/${encodeURIComponent(projectId)}` : '',
  } : {
    id: projectId, url: value, title: String(title || '').trim(), sourceDir: sourcesDir,
    outputDir: path.join(clipsDir, projectId), resultPath: resultFile(projectId),
    ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath, template, musicTracks: tracks,
    settings: sharedSettings(user), sourceStartSec: sourceRange.startSec || 0, sourceEndSec: sourceRange.endSec || null,
    sourceTitle: sourceMeta?.title || null, sourceDurationSec: sourceMeta?.durationSec || null, sourceThumbUrl: sourceMeta?.thumbnail || null,
  };
  fs.writeFileSync(jobFile(projectId), JSON.stringify(job, null, 2));
  const rangeCopy = sourceRange.endSec ? ` · source window ${Math.round(sourceRange.startSec / 60)}–${Math.round(sourceRange.endSec / 60)} min` : (sourceRange.startSec ? ` · source starts at ${Math.round(sourceRange.startSec / 60)} min` : '');
  log(`Queued "${project.title}" for ${useRemote ? 'the external processing worker' : useVizard ? 'secure YouTube import and DeenClipped rendering' : 'the self-hosted clip AI'} using template "${template.name}"${rangeCopy}.`, 'info', user.id);
  pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  return projectId;
}

function parseWorkerLine(record, line) {
  let payload;
  try { payload = JSON.parse(line); } catch { return; }
  if (payload.type === 'progress') {
    const stage = String(payload.stage || 'Processing');
    // The worker already reports all of this on every step. Keeping only
    // stage+progress is why the UI had no ETA and no clip counter.
    const num = value => (Number.isFinite(Number(value)) ? Number(value) : null);
    record.stage = stage;
    record.progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
    record.etaSec = num(payload.etaSec);
    record.currentClip = num(payload.currentClip);
    record.totalClips = num(payload.totalClips);
    record.sourceDurationSec = num(payload.sourceDurationSec);
    record.processedSec = num(payload.processedSec);
    record.status = 'processing';
    if (!record.startedAt) record.startedAt = Date.now();
    // One entry per distinct stage, so the log reads as steps rather than
    // one line per percentage tick. Bounded so state.json cannot grow.
    record.stages = Array.isArray(record.stages) ? record.stages : [];
    if (record.stages[record.stages.length - 1]?.stage !== stage) {
      record.stages.push({ stage, at: Date.now(), progress: record.progress });
      if (record.stages.length > 40) record.stages = record.stages.slice(-40);
    }
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

function importResultObject(project, result, engine = 'self-hosted') {
  const imported = [];
  for (const clip of result.clips || []) {
    const record = withOwner({
      ...clip, status: 'waiting', targets: [], addedAt: Date.now(), scheduledAt: null, postedAt: null,
      projectTitle: result.project?.title || project.title, engine, renderVersion: 1,
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
  project.sourceObjectKey = result.project?.sourceObjectKey || project.sourceObjectKey || null;
  project.sourceUrl = result.project?.sourceUrl || project.sourceUrl || null;
  project.transcriptObjectKey = result.project?.transcriptObjectKey || null;
  project.transcriptUrl = result.project?.transcriptUrl || null;
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
  log(`${imported.length} clips are ready from "${project.title}". Every clip passed music, template and resolution checks.`, 'info', ownerOf(project));
}

function importResult(project, file) {
  importResultObject(project, JSON.parse(fs.readFileSync(file, 'utf8')), 'self-hosted');
}

export function acceptRemoteUpdate(projectId, update) {
  const project = projectById(projectId);
  if (!project || project.engine !== 'remote') return null;
  if (update.status === 'completed' && update.result && project.status !== 'done') {
    importResultObject(project, update.result, 'remote-worker');
    project.queuePosition = 0;
  } else if (update.status === 'failed') {
    project.status = 'failed'; project.stage = 'failed'; project.progress = Number(update.progress || project.progress || 0);
    project.queuePosition = 0;
    project.error = customerSafeProjectError(update.error || 'The external worker failed.').message;
    project.errorCode = 'processing_failed'; project.updatedAt = Date.now(); save();
  } else if (update.status === 'cancelled') {
    project.status = 'cancelled'; project.stage = 'cancelled'; project.queuePosition = 0; project.updatedAt = Date.now(); save();
  } else if (project.status !== 'done') {
    project.status = update.status === 'queued' ? 'queued' : 'processing';
    project.stage = String(update.stage || update.status || 'processing');
    project.progress = Math.max(0, Math.min(100, Number(update.progress) || 0));
    project.queuePosition = Math.max(0, Number(update.queuePosition || 0));
    project.updatedAt = Date.now(); save();
  }
  return project;
}

async function runRemoteProject(project) {
  const file = jobFile(project.id);
  if (!fs.existsSync(file)) {
    project.status = 'failed'; project.stage = 'failed'; project.error = 'The remote job metadata is missing. Submit the video again.'; save(); return;
  }
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  project.status = 'processing'; project.stage = 'Connecting to processing worker'; project.progress = Math.max(1, project.progress || 0); project.error = null; save();
  running.set(project.id, { remote: true });
  const started = Date.now();
  try {
    await workerClient.createJob(payload);
    while (Date.now() - started < config.workerJobTimeoutMs) {
      const update = await workerClient.getJob(project.id);
      acceptRemoteUpdate(project.id, update);
      if (['completed', 'failed', 'cancelled'].includes(update.status)) return;
      await new Promise(resolve => setTimeout(resolve, config.workerPollIntervalMs));
    }
    throw new Error('The processing worker exceeded the job timeout. The job can be retried safely.');
  } catch (error) {
    if (project.status !== 'done') {
      project.status = error.code === 'worker_unavailable' ? 'queued' : 'failed';
      project.stage = error.code === 'worker_unavailable' ? 'Worker unavailable — retrying after recovery' : 'failed';
      project.error = error.message; project.errorCode = error.code || 'processing_failed';
      if (error.code === 'worker_unavailable') project.nextRetryAt = Date.now() + 30_000;
      save();
      if (error.code === 'worker_unavailable') setTimeout(() => pump().catch(() => {}), 30_000);
    }
  } finally {
    running.delete(project.id);
    pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  }
}

async function runRemoteAux(project, jobRecord, kind) {
  if (!jobRecord.jobFile || !fs.existsSync(jobRecord.jobFile)) {
    jobRecord.status = 'failed'; jobRecord.stage = 'Job metadata is missing'; jobRecord.error = 'Start this operation again.'; save(); return;
  }
  const payload = JSON.parse(fs.readFileSync(jobRecord.jobFile, 'utf8'));
  jobRecord.status = 'processing'; jobRecord.stage = 'Connecting to processing worker'; jobRecord.progress = 1; jobRecord.error = null; save();
  running.set(jobRecord.id, { remote: true });
  try {
    await workerClient.createJob(payload);
    const started = Date.now();
    while (Date.now() - started < config.workerJobTimeoutMs) {
      const update = await workerClient.getJob(jobRecord.id);
      jobRecord.stage = String(update.stage || update.status || 'processing');
      jobRecord.progress = Math.max(0, Math.min(100, Number(update.progress) || 0));
      jobRecord.queuePosition = Math.max(0, Number(update.queuePosition || 0));
      jobRecord.status = update.status === 'queued' ? 'queued' : 'processing'; save();
      if (update.status === 'completed') {
        jobRecord.queuePosition = 0;
        if (kind === 'more') importMoreResultObject(project, jobRecord, update.result || {}, 'remote-worker');
        else importRerenderResultObject(jobRecord, update.result || {});
        return;
      }
      if (update.status === 'failed') throw new Error(update.error || 'The external worker failed.');
      if (update.status === 'cancelled') { jobRecord.status = 'cancelled'; jobRecord.stage = 'cancelled'; jobRecord.queuePosition = 0; save(); return; }
      await new Promise(resolve => setTimeout(resolve, config.workerPollIntervalMs));
    }
    throw new Error('The processing worker exceeded the job timeout.');
  } catch (error) {
    jobRecord.queuePosition = 0;
    jobRecord.status = error.code === 'worker_unavailable' ? 'queued' : 'failed';
    jobRecord.stage = error.code === 'worker_unavailable' ? 'Worker unavailable — retrying' : 'failed';
    jobRecord.error = error.message;
    if (error.code === 'worker_unavailable') jobRecord.nextRetryAt = Date.now() + 30_000;
    save();
    if (error.code === 'worker_unavailable') setTimeout(() => pump().catch(() => {}), 30_000);
  } finally {
    running.delete(jobRecord.id);
    pump().catch(() => {});
  }
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

async function downloadVizardClip(url, destination) {
  const trusted = vizard.assertTrustedClipUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60_000);
  const temporary = `${destination}.part`;
  try {
    const response = await fetch(trusted, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Clip download returned HTTP ${response.status}.`);
    vizard.assertTrustedClipUrl(response.url || trusted);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 750 * 1024 * 1024) throw new Error('A generated clip exceeded the 750 MB safety limit.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
    fs.renameSync(temporary, destination);
    return destination;
  } finally {
    clearTimeout(timer);
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

async function renderVizardVideo(project, video, index, owner, template, tracks) {
  const providerId = String(video.videoId || index).replace(/[^a-z0-9_-]+/gi, '').slice(0, 80) || String(index);
  const rawDir = path.join(sourcesDir, project.id);
  const rawFile = path.join(rawDir, `vizard-${providerId}.mp4`);
  await downloadVizardClip(video.videoUrl, rawFile);
  const durationSec = Math.max(3, Number(video.videoMsDuration || 0) / 1000);
  const renderId = `${project.id}-vizard-${String(index).padStart(2, '0')}`;
  const dir = path.join(jobsDir, project.id, 'vizard-renders', String(index));
  const outputDir = path.join(clipsDir, project.id);
  const outputClipId = `${project.id}-${String(index).padStart(2, '0')}`;
  const resultPath = path.join(dir, 'result.json');
  fs.mkdirSync(dir, { recursive: true });
  const transcript = String(video.transcript || '').trim();
  const score = Math.max(0, Math.min(100, Math.round(Number(video.viralScore || 0) * 10)));
  const payload = {
    mode: 'rerender', id: renderId, projectId: project.id, clipIdOverride: outputClipId,
    sourceFile: rawFile, outputDir, resultPath, ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath,
    template, musicTracks: tracks, settings: sharedSettings(owner),
    transcriptSegments: [{ start: 0, end: durationSec, text: transcript || String(video.title || 'Reminder'), words: [] }],
    clip: {
      id: outputClipId, title: String(video.title || `Clip ${index}`), transcript,
      description: transcript, startSec: 0, endSec: durationSec, score: score || 70,
      scoreReasons: video.viralReason ? [String(video.viralReason)] : ['Selected by Vizard AI from the source video.'],
      reviewRequired: false,
    },
  };
  const jobPath = path.join(dir, 'job.json');
  fs.writeFileSync(jobPath, JSON.stringify(payload, null, 2));
  const result = await runWorkerJob(jobPath, resultPath, `DeenClipped render ${index}`);
  const rendered = result.clips?.[0];
  if (!rendered?.renderVerified || !rendered?.musicVerified || !rendered?.clipFile || !fs.existsSync(rendered.clipFile)) {
    throw new Error(`Generated clip ${index} did not pass DeenClipped's render checks.`);
  }
  return withOwner({
    ...rendered,
    projectId: project.id,
    projectTitle: project.title,
    sourceFile: rawFile,
    provider: 'vizard',
    providerVideoId: video.videoId || null,
    providerEditorUrl: video.clipEditorUrl || null,
    status: 'waiting', targets: [], addedAt: Date.now(), scheduledAt: null, postedAt: null,
    engine: 'vizard+deenclipped', renderVersion: 1,
  }, ownerOf(project));
}

async function runVizardProject(project) {
  const control = { cancelled: false };
  running.set(project.id, control);
  const owner = ownerOfRecord(project);
  try {
    project.status = 'processing';
    project.stage = project.vizardProjectId ? 'Reconnecting to YouTube import' : 'Sending the YouTube video to the secure importer';
    project.progress = Math.max(2, Number(project.progress || 0));
    project.startedAt = project.startedAt || Date.now();
    project.error = null;
    save();

    if (!project.vizardProjectId) {
      const settings = clipSettings(owner);
      const preferredLength = settings.clipMaxSeconds <= 30 ? [1]
        : settings.clipMaxSeconds <= 60 ? [2]
          : settings.clipMaxSeconds <= 90 ? [3] : [4];
      const created = await vizard.createProject({
        videoUrl: project.url,
        projectName: project.sourceTitle || project.title,
        maxClips: Math.min(config.vizardMaxClips, Math.max(1, Number(settings.clipsPerVideo) || config.vizardMaxClips)),
        preferLength: preferredLength,
      });
      project.vizardProjectId = created.projectId;
      project.vizardShareLink = created.shareLink;
      project.vizardSubmittedAt = Date.now();
      project.stage = 'YouTube video accepted — finding the strongest moments';
      project.progress = 12;
      save();
    }

    let result = null;
    while (!control.cancelled && projectById(project.id)) {
      result = await vizard.queryProject(project.vizardProjectId);
      if (result.status === 'complete') break;
      const elapsed = Date.now() - Number(project.vizardSubmittedAt || project.startedAt || Date.now());
      if (elapsed > config.vizardProcessingTimeoutMs) throw new Error('YouTube clipping took too long. Retry the project to reconnect to the existing import.');
      project.stage = 'Finding and ranking the strongest moments';
      project.progress = Math.min(68, Math.max(15, 15 + Math.round(elapsed / config.vizardProcessingTimeoutMs * 53)));
      project.updatedAt = Date.now();
      save();
      await new Promise(resolve => setTimeout(resolve, config.vizardPollIntervalMs));
    }
    if (control.cancelled || !projectById(project.id)) return;
    const videos = (result?.videos || []).slice(0, config.vizardMaxClips);
    if (!videos.length) throw new Error('Vizard finished without returning any clips.');
    project.title = result.projectName || project.sourceTitle || project.title;
    project.stage = `Applying DeenClipped captions, template and music to ${videos.length} clips`;
    project.progress = 72;
    project.vizardShareLink = result.shareLink || project.vizardShareLink || null;
    save();

    const template = effectiveTemplateForUser(owner, selectedTemplate(owner));
    const tracks = workerMusicTracks(owner);
    if (!template?.id || !tracks.length) throw new Error('A saved template and at least one nasheed are required to finish these clips.');
    const imported = [];
    for (let index = 0; index < videos.length; index++) {
      if (control.cancelled || !projectById(project.id)) return;
      project.stage = `Rendering DeenClipped clip ${index + 1} of ${videos.length}`;
      project.progress = 72 + Math.round(index / videos.length * 25);
      save();
      imported.push(await renderVizardVideo(project, videos[index], index + 1, owner, template, tracks));
    }
    state.clips.push(...imported);
    project.clipCount = imported.length;
    project.durationSec = Number(project.sourceDurationSec || 0) || null;
    project.status = 'done';
    project.stage = 'Clips are ready for review';
    project.progress = 100;
    project.completedAt = Date.now();
    project.error = null;
    project.errorCode = null;
    try {
      const charge = billing.chargeSourceMinutes(ownerOf(project), Number(project.sourceDurationSec || 0), { projectId: project.id, title: project.title });
      if (charge.charged) project.tokensCharged = charge.charged;
    } catch (error) {
      project.billingWarning = error.message;
      log(`Could not charge tokens for "${project.title}": ${error.message}`, 'warn', ownerOf(project));
    }
    save();
    log(`${imported.length} YouTube clips are ready from "${project.title}". Vizard selected the moments; DeenClipped applied and verified the final template, captions and music.`, 'info', ownerOf(project));
  } catch (error) {
    if (!projectById(project.id) || control.cancelled) return;
    project.status = 'failed';
    project.stage = 'YouTube import failed';
    project.error = String(error?.message || 'The YouTube video could not be processed.').slice(0, 1800);
    project.errorCode = error?.code ? `vizard_${error.code}` : 'vizard_import_failed';
    project.updatedAt = Date.now();
    save();
    log(`Could not import "${project.title}" from YouTube: ${project.error}`, 'error', ownerOf(project));
  } finally {
    running.delete(project.id);
    pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  }
}

function importMoreResultObject(project, jobRecord, result, engine = 'self-hosted') {
  const existingIds = new Set(state.clips.map(clip => clip.id));
  const imported = [];
  for (const clip of result.clips || []) {
    if (!clip?.id || existingIds.has(clip.id)) continue;
    const record = withOwner({
      ...clip, projectId: project.id, projectTitle: project.title,
      status: 'waiting', targets: [], addedAt: Date.now(), scheduledAt: null, readyAt: null, postedAt: null,
      engine, renderVersion: 1, generatedFromSavedLecture: true,
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

function importMoreResult(project, jobRecord, file) {
  importMoreResultObject(project, jobRecord, JSON.parse(fs.readFileSync(file, 'utf8')));
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

function importRerenderResultObject(jobRecord, result) {
  const rendered = result.clips?.[0];
  if (!rendered?.renderVerified || !rendered?.musicVerified) throw new Error('The re-render did not pass verification.');
  const original = clipById(jobRecord.clipId);
  if (!original) throw new Error('The original clip was removed before the re-render completed.');
  jobRecord.finishedAt = Date.now();
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
      // Which quality this file actually is. A preview-tier clip is fine to
      // watch in the app but must be upgraded before it leaves the platform.
      renderTier: jobRecord.renderTier === 'preview' ? 'preview' : 'export',
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

function importRerenderResult(jobRecord, file) {
  importRerenderResultObject(jobRecord, JSON.parse(fs.readFileSync(file, 'utf8')));
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
  if ((!project.sourceFile || !fs.existsSync(project.sourceFile)) && !(project.engine === 'remote' && project.sourceObjectKey)) {
    throw new Error('The saved source video is unavailable. Generate more cannot safely re-download it because that would create a duplicate Library lecture.');
  }
  if ((!project.transcriptFile || !fs.existsSync(project.transcriptFile)) && !(project.engine === 'remote' && project.transcriptObjectKey)) {
    throw new Error('The saved transcript is unavailable. This lecture must be processed again before more clips can be generated.');
  }
  const count = Math.max(1, Math.min(20, Math.round(Number(requestedCount) || 8)));
  const owner = ownerOfRecord(project);
  billing.assertCanSpend(owner, billing.tokenCostForSeconds(count * (clipSettings(owner).clipMaxSeconds || 60)), 'generate more clips');
  const template = effectiveTemplateForUser(owner, selectedTemplate(owner));
  if (!template?.id) throw new Error('Choose a valid saved template.');
  const tracks = workerMusicTracks(owner);
  if (!tracks.length) throw new Error('Music is mandatory. Upload at least one nasheed first.');
  const transcriptSegments = project.transcriptFile && fs.existsSync(project.transcriptFile) ? JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8')) : [];
  if (project.engine !== 'remote' && (!Array.isArray(transcriptSegments) || !transcriptSegments.length)) throw new Error('The saved transcript is empty.');
  const existingRanges = state.clips
    .filter(clip => clip.projectId === project.id)
    .map(clip => ({ id: clip.id, startSec: Number(clip.startSec || 0), endSec: Number(clip.endSec || 0) }));

  const moreId = id('more');
  const dir = path.join(jobsDir, moreId);
  fs.mkdirSync(dir, { recursive: true });
  const resultPath = path.join(dir, 'result.json');
  const outputDir = path.join(clipsDir, project.id, 'more', moreId);
  const payload = project.engine === 'remote' ? {
    mode: 'more_clips', id: moreId, projectId: project.id, projectTitle: project.title, requestedCount: count,
    source: { type: 'object_storage', objectKey: project.sourceObjectKey, title: project.title },
    transcript: { objectKey: project.transcriptObjectKey }, existingRanges,
    template, musicTracks: remoteMusicTracks(tracks, owner.id), settings: { ...sharedSettings(owner), clipsPerVideo: count },
    tenant: owner.id, callbackUrl: '',
  } : {
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
    reusedSource: true, reusedTranscript: true, engine: project.engine === 'remote' ? 'remote' : 'self-hosted',
  };
  project.moreJob = record;
  project.updatedAt = Date.now();
  save();
  log(`Queued ${count} more clips inside "${project.title}" using the saved source and transcript.`, 'info', ownerOf(project));
  pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  return record;
}

/** Framing choices a single clip may override without editing the template. */
const FRAMING_BIASES = ['auto', 'left', 'center', 'right'];

export function queueClipRerender(clipId, templateId, { asVariant = false, batchId = '', batchLabel = '', batchTotal = 0, framingBias = undefined } = {}) {
  const clip = clipById(clipId);
  if (!clip) throw new Error('That clip does not exist.');
  if (clip.status === 'posted' && !asVariant) throw new Error('A posted video cannot be changed. Create a re-post variant instead.');
  const project = projectById(clip.projectId);
  const sourceFile = clip.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project?.sourceFile;
  if ((!sourceFile || !fs.existsSync(sourceFile)) && !(project?.engine === 'remote' && project.sourceObjectKey)) throw new Error('The original source file is unavailable. Keep source files enabled to re-render clips.');
  const owner = ownerOfRecord(clip);
  const baseTemplate = effectiveTemplateForUser(owner, templateById(templateId, owner) || selectedTemplate(owner));
  if (!baseTemplate?.id) throw new Error('Choose a valid saved template.');

  // A per-clip framing nudge, for the one clip where the automatic choice is
  // wrong. Editing the template instead would re-render every unposted clip
  // the account owns, which is a lot of collateral for fixing one shot.
  if (framingBias !== undefined) {
    if (!FRAMING_BIASES.includes(String(framingBias))) throw new Error('Choose a valid framing option.');
    clip.framingBias = String(framingBias) === 'auto' ? null : String(framingBias);
  }
  const template = clip.framingBias
    ? { ...baseTemplate, smartFramingBias: clip.framingBias }
    : baseTemplate;

  // Only a bulk template application renders at preview quality, and only
  // when the operator has opted in. A single deliberate re-render, and every
  // upgrade requested by a download or a publish, is always export quality.
  const previewQuality = Boolean(config.previewBatchRenders && batchId);
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
  const payload = project.engine === 'remote' ? {
    mode: 'rerender', id: rerenderId, projectId: project.id, clipIdOverride: outputClipId,
    source: { type: 'object_storage', objectKey: project.sourceObjectKey, title: project.title },
    transcript: { objectKey: project.transcriptObjectKey || '' }, template,
    musicTracks: remoteMusicTracks(tracks, owner.id), settings: { ...sharedSettings(owner), previewQuality },
    clip: {
      id: clip.id, title: clip.title, description: clip.description, transcript: clip.transcript,
      startSec: clip.startSec, endSec: clip.endSec, score: clip.score, scoreReasons: clip.scoreReasons,
      reviewRequired: clip.reviewRequired,
    },
    // Lets the worker skip speaker analysis when nothing that decides framing
    // has changed. It re-checks the signature itself, so a stale plan is
    // ignored rather than trusted.
    cropPlan: clip.cropPlan || null,
    tenant: owner.id, callbackUrl: '',
  } : {
    mode: 'rerender', id: rerenderId, projectId: project.id, clipIdOverride: outputClipId,
    sourceFile, outputDir, resultPath, ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath,
    template, musicTracks: tracks, settings: { ...sharedSettings(owner), previewQuality },
    transcriptSegments,
    clip: {
      id: clip.id, title: clip.title, description: clip.description, transcript: clip.transcript,
      startSec: clip.startSec, endSec: clip.endSec, score: clip.score, scoreReasons: clip.scoreReasons,
      reviewRequired: clip.reviewRequired,
    },
    cropPlan: clip.cropPlan || null,
  };
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  const record = withOwner({
    id: rerenderId, clipId: clip.id, templateId: template.id, templateName: template.name,
    asVariant: Boolean(asVariant), status: 'queued', stage: 'Waiting to re-render', progress: 0, engine: project.engine === 'remote' ? 'remote' : 'self-hosted',
    createdAt: Date.now(), jobFile: file, resultPath,
    clipTitle: clip.title || '', projectId: project.id, projectTitle: project.title || '',
    batchId: String(batchId || ''), batchLabel: String(batchLabel || ''), batchTotal: Number(batchTotal || 0),
    renderTier: previewQuality ? 'preview' : 'export',
    stages: [], etaSec: null, currentClip: null, totalClips: null, startedAt: null,
  }, ownerOf(clip));
  state.rerenderJobs.unshift(record);
  state.rerenderJobs = state.rerenderJobs.slice(0, 60);
  save();
  log(`Queued ${asVariant ? 'a re-post variant' : 'a re-render'} of "${clip.title}" using "${template.name}".`, 'info', ownerOf(clip));
  pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  return record;
}

/**
 * Fair queuing across accounts.
 *
 * This queue used to be a single global FIFO ordered by arrival time. That is
 * invisible with one customer and indefensible with ten: saving a template
 * queues a re-render of every unposted clip its owner has
 * (`queueTemplateForEveryUnpostedClip` in server.js), so forty of one
 * customer's jobs sat in front of another customer's brand-new import.
 *
 * Work is now taken round-robin by owner. Each account's queued jobs are
 * ranked within their own group by arrival, that rank is offset by however
 * many jobs the account already has running, and the global order is by rank
 * first and arrival second. Twenty jobs from A followed by one from B run
 * A, B, A, A, … instead of leaving B twenty-first.
 *
 * The rank is recomputed from state on every pass rather than carried in a
 * cursor, so a restart cannot lose its place in the rotation or strand an
 * account. Render order is a scheduling decision, not persisted data.
 */
const ownerKey = value => value || '';
const queuedAt = candidate => Number(candidate.at) || 0;
/** Background bulk work sorts behind an account's own foreground jobs. */
const batchRank = candidate => (candidate.item?.batchId ? 1 : 0);

/** How many jobs each account currently has in flight, by owner id. */
function runningOwnerCounts() {
  const counts = new Map();
  const bump = owner => counts.set(ownerKey(owner), (counts.get(ownerKey(owner)) || 0) + 1);
  for (const project of state.projects) {
    if (running.has(project.id)) bump(ownerOf(project));
    // `moreJob` is nested inside its project and carries no owner of its own.
    if (project.moreJob?.id && running.has(project.moreJob.id)) bump(ownerOf(project));
  }
  for (const job of state.rerenderJobs) {
    if (running.has(job.id)) bump(ownerOf(job));
  }
  return counts;
}

/** Everything waiting for a slot, tagged with the account that owns it. */
function queuedCandidates() {
  return [
    ...state.projects.filter(item => item.engine === 'remote' && item.status === 'queued' && Number(item.nextRetryAt || 0) <= Date.now()).map(item => ({ type: 'remote', item, at: item.submittedAt, owner: ownerOf(item) })),
    ...state.projects.filter(item => item.engine === 'self-hosted' && item.status === 'queued').map(item => ({ type: 'project', item, at: item.submittedAt, owner: ownerOf(item) })),
    ...state.projects.filter(item => item.engine === 'vizard' && item.status === 'queued').map(item => ({ type: 'vizard', item, at: item.submittedAt, owner: ownerOf(item) })),
    ...state.projects.filter(item => item.moreJob?.engine === 'remote' && item.moreJob.status === 'queued' && Number(item.moreJob.nextRetryAt || 0) <= Date.now()).map(item => ({ type: 'remote-more', item: item.moreJob, project: item, at: item.moreJob.createdAt, owner: ownerOf(item) })),
    ...state.projects.filter(item => item.moreJob?.engine !== 'remote' && item.moreJob?.status === 'queued').map(item => ({ type: 'more', item: item.moreJob, project: item, at: item.moreJob.createdAt, owner: ownerOf(item) })),
    ...state.rerenderJobs.filter(item => item.engine === 'remote' && item.status === 'queued' && Number(item.nextRetryAt || 0) <= Date.now()).map(item => ({ type: 'remote-rerender', item, project: projectById(clipById(item.clipId)?.projectId), at: item.createdAt, owner: ownerOf(item) })),
    ...state.rerenderJobs.filter(item => item.engine !== 'remote' && item.status === 'queued').map(item => ({ type: 'rerender', item, at: item.createdAt, owner: ownerOf(item) })),
  ];
}

/**
 * Order candidates round-robin by owner, skipping accounts that already hold
 * their share of the slots. Exported so the ordering can be tested without
 * spawning a renderer.
 */
export function fairQueueOrder(candidates, runningCounts = new Map(), maxPerOwner = Infinity) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = ownerKey(candidate.owner);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  const ranked = [];
  for (const [key, group] of groups) {
    const active = runningCounts.get(key) || 0;
    // This account is already using its allowance. Its remaining work waits
    // for one of its own jobs to finish, rather than taking someone else's turn.
    if (active >= maxPerOwner) continue;
    // Within one account, a bulk template batch yields to that account's own
    // foreground work. Otherwise saving a template monopolises the owner's
    // turn: they queue forty re-renders, import a lecture, and wait for all
    // forty first. Ordering inside each class is still arrival order.
    group.sort((a, b) => batchRank(a) - batchRank(b) || queuedAt(a) - queuedAt(b));
    group.forEach((candidate, index) => ranked.push({ ...candidate, rank: active + index }));
  }
  return ranked.sort((a, b) => a.rank - b.rank || queuedAt(a) - queuedAt(b));
}

/** The order queued work will actually be dispatched in, right now. */
export function plannedQueueOrder() {
  return fairQueueOrder(queuedCandidates(), runningOwnerCounts(), config.maxConcurrentJobsPerUser);
}

export async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (running.size < config.maxConcurrentJobs) {
      const next = plannedQueueOrder()[0];
      // Nothing queued, or everything queued belongs to accounts already at
      // their slot allowance. Each running job calls pump() again when it
      // finishes, so the held-back work is picked up then.
      if (!next) break;
      if (next.type === 'remote') runRemoteProject(next.item).catch(error => { next.item.status = 'failed'; next.item.error = error.message; save(); });
      else if (next.type === 'remote-more') runRemoteAux(next.project, next.item, 'more').catch(error => { next.item.status = 'failed'; next.item.error = error.message; save(); });
      else if (next.type === 'remote-rerender') runRemoteAux(next.project, next.item, 'rerender').catch(error => { next.item.status = 'failed'; next.item.error = error.message; save(); });
      else if (next.type === 'project') runProject(next.item).catch(error => { next.item.status = 'failed'; next.item.error = error.message; save(); });
      else if (next.type === 'vizard') runVizardProject(next.item).catch(error => { next.item.status = 'failed'; next.item.error = error.message; save(); });
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
/**
 * Make sure a clip is export quality before it leaves the platform.
 *
 * A bulk template application may have rendered it with a fast encoder preset
 * so the batch came back quickly. That file is fine to review in the app and
 * is not fine to publish or hand to a customer, so the first request that
 * would send it outside queues the full-quality render instead.
 *
 * Deliberately not a blocking re-encode: a render takes minutes and an HTTP
 * request cannot wait for one. The caller gets a clear, retryable error and
 * the work is already moving.
 */
export function assertExportQuality(clip) {
  if (!clip || clip.renderTier !== 'preview') return clip;
  const pending = state.rerenderJobs.some(job =>
    job.clipId === clip.id && job.renderTier !== 'preview' && ['queued', 'processing'].includes(job.status));
  if (!pending) {
    try {
      queueClipRerender(clip.id, clip.templateId || '', { asVariant: false });
    } catch (error) {
      const failure = new Error(`This clip needs a full-quality render first, which could not be started: ${error.message}`);
      failure.statusCode = 409;
      throw failure;
    }
  }
  const error = new Error('This clip is still a fast preview. The full-quality version is rendering now — try again shortly.');
  error.statusCode = 409;
  error.code = 'export_render_pending';
  throw error;
}

export async function socialPublishFile(clipId, provider) {
  const clip = clipById(clipId);
  if (!clip) throw new Error('That clip does not exist.');
  assertExportQuality(clip);
  if (clip.clipUrl) {
    if (provider === 'instagram') return null;
    if (provider === 'tiktok') {
      const template = clip.templateSnapshot || templateById(clip.templateId, ownerOfRecord(clip));
      if (String(template?.watermark || '').trim() || template?.brandLineEnabled) {
        throw new Error('TikTok requires a clean copy without an app watermark. Choose a TikTok-safe template and re-render this clip first.');
      }
    }
    return cacheRemotePublishClip(clip);
  }
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
    const sourceFile = clip.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project?.sourceFile;
    if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error('The original source is unavailable for the automatic TikTok-safe render.');
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
      sourceFile, outputDir, resultPath, ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath,
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

export function releaseSocialPublishFile(file) {
  if (!file) return;
  const resolved = path.resolve(file);
  const allowed = path.resolve(publishCacheDir) + path.sep;
  if (resolved.startsWith(allowed)) fs.rmSync(resolved, { force: true });
}

export function retryProject(projectId) {
  const project = projectById(projectId);
  if (!project) throw new Error('That project does not exist.');
  if (running.has(projectId)) throw new Error('That project is already processing.');
  if (project.engine === 'remote') {
    Object.assign(project, { status: 'queued', stage: 'queued', progress: Math.min(5, project.progress || 0), error: null, errorCode: null });
    save(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
    return project;
  }
  if (project.engine === 'vizard') {
    if (!vizard.configured()) throw new Error('YouTube URL import is not configured. Add VIZARD_API_KEY before retrying.');
    Object.assign(project, { status: 'queued', stage: 'Waiting to retry YouTube import', progress: Math.min(65, project.progress || 0), error: null, errorCode: null });
    save(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
    return project;
  }
  if (!fs.existsSync(jobFile(projectId))) throw new Error('The project job file is missing. Submit the video again.');
  const job = JSON.parse(fs.readFileSync(jobFile(projectId), 'utf8'));
  const projectOwner = ownerOfRecord(project);
  const template = effectiveTemplateForUser(projectOwner, selectedTemplate(projectOwner)); const tracks = workerMusicTracks(projectOwner);
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
  const current = running.get(projectId);
  const remoteProject = projectById(projectId);
  if (remoteProject?.engine === 'remote') workerClient.cancelJob(projectId).catch(() => {});
  if (typeof current?.kill === 'function') current.kill('SIGTERM');
  else if (current) current.cancelled = true;
  const project = projectById(projectId);
  if (project?.moreJob?.id) running.get(project.moreJob.id)?.kill('SIGTERM');
}
export function deleteProject(projectId) {
  const project = projectById(projectId);
  if (!project) throw new Error('That project does not exist.');
  cancelProject(projectId);
  const projectClips = state.clips.filter(clip => clip.projectId === projectId);
  const clipIds = new Set(projectClips.map(clip => clip.id));
  state.clips = state.clips.filter(clip => !clipIds.has(clip.id));
  state.projects = state.projects.filter(item => item.id !== projectId);
  state.rerenderJobs = state.rerenderJobs.filter(item => !clipIds.has(item.clipId));
  fs.rmSync(path.join(jobsDir, projectId), { recursive: true, force: true });
  if (project.moreJob?.id) fs.rmSync(path.join(jobsDir, project.moreJob.id), { recursive: true, force: true });
  fs.rmSync(path.join(clipsDir, projectId), { recursive: true, force: true });
  if (project.sourceFile) removeDataFile(project.sourceFile);
  if (project.uploadedInputFile) removeDataFile(project.uploadedInputFile);
  for (const clip of projectClips) if (clip.sourceFile) removeDataFile(clip.sourceFile);
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
  fs.rmSync(publishCacheDir, { recursive: true, force: true });
  fs.mkdirSync(publishCacheDir, { recursive: true });
  for (const project of state.projects) {
    if (project.engine === 'remote' && project.status === 'processing') {
      project.status = 'queued'; project.stage = 'Recovered after web server restart'; project.progress = Math.min(project.progress || 0, 5);
    }
    if (project.engine === 'self-hosted' && project.status === 'processing') {
      project.status = 'queued'; project.stage = 'Recovered after server restart'; project.progress = Math.min(project.progress || 0, 95);
    }
    if (project.engine === 'vizard' && project.status === 'processing') {
      project.status = 'queued'; project.stage = 'Reconnecting to YouTube import after server restart'; project.progress = Math.min(project.progress || 0, 68);
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
