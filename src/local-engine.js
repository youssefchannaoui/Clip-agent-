import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { state, save, log, clipSettings, musicSettings, ownerOfRecord, musicSatisfied, importNetworkSettings } from './store.js';
import { selectedTemplate, templateById, templateForClip } from './templates.js';
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

// Roughly five minutes of 30s retries before a lecture is failed with a message
// rather than looping in silence.
const MAX_WORKER_RETRIES = 10;

// The worker beats every 10s, so several minutes of total silence means it is
// hung rather than busy. Generous, because a slow transcription is not a stall.
const STALL_TIMEOUT_MS = 5 * 60_000;

// Stages that run before clip_worker.py starts, and therefore before anything
// heartbeats. The import is one long download, so it gets the import timeout
// plus headroom rather than the stall budget.
const PRE_WORKER_STAGES = new Set(['queued', 'importing', 'downloading']);
const IMPORT_STALL_TIMEOUT_MS = config.videoImportTimeoutMs + 5 * 60_000;

/**
 * How long a stage may sit with an unchanged status signature before the job is
 * treated as hung.
 *
 * Everything after the import beats every 10s, so silence there really is a
 * stall. The import beats only on workers carrying Processor.import_pulse, and
 * it is a single download that can legitimately run for half an hour — judging
 * it by the stall budget cancelled healthy jobs, which meant a long lecture
 * could never survive its own download.
 */
export function stallBudgetFor(stage) {
  return PRE_WORKER_STAGES.has(String(stage || '').toLowerCase())
    ? IMPORT_STALL_TIMEOUT_MS
    : STALL_TIMEOUT_MS;
}

// Tokens are charged per source minute once the real duration is known. Until
// then a job holds an estimate, so a second job cannot be started against tokens
// the first one is about to spend.
function reserveProjectHold(project, seconds) {
  const estimate = Number(seconds || 0);
  if (!estimate) return;
  try {
    const held = billing.reserveTokens(ownerOf(project), billing.tokenCostForSeconds(estimate), { projectId: project.id });
    if (held.reserved) project.tokensReserved = held.reserved;
  } catch (error) {
    // Surfaced by the caller: a job that cannot be paid for must not start.
    throw error;
  }
}

// Safe to call more than once; a hold already released clamps at zero.
function releaseProjectHold(project) {
  const held = Number(project.tokensReserved || 0);
  if (!held) return;
  project.tokensReserved = 0;
  try { billing.releaseTokens(ownerOf(project), held); } catch { /* nothing to release */ }
}
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
// `musicEnabled` travels in settings because the worker reads it there, and it
// has to be explicit: an empty musicTracks list alone is ambiguous between "the
// user switched the nasheed off" and "the upload went missing", and those two
// must not render the same.
function sharedSettings(user, options = {}) {
  return {
    ...clipSettings(user), ...musicSettings(user),
    musicEnabled: options.musicEnabled !== false,
    model: config.aiModel, device: config.aiDevice, computeType: config.aiComputeType,
    task: config.aiTask, language: config.aiLanguage, maxSourceMinutes: config.maxSourceMinutes,
    keepSourceFiles: config.keepSourceFiles, ollamaUrl: config.ollamaUrl, ollamaModel: config.ollamaModel,
  };
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
// Exported because the read path needs it too: lectures submitted before the
// client sent sourceMeta have sourceThumbUrl null on the record, and deriving
// the poster from the URL at read time gives them one without a migration.
export function fallbackThumb(url) {
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
    // Downloading needs the worker; reading the video's metadata does not. Both
    // lookups below are plain HTTP from this process, so there was never a
    // reason to skip them here -- and skipping them is why the job panel could
    // not offer a range picker, showed the design's placeholder length, called
    // the lecture by its URL, and could only say "cost confirmed before
    // processing" instead of a real token estimate.
    //
    // yt-dlp and ffprobe are deliberately not attempted: neither is installed on
    // the web service, and this runs while the user waits on a paste.
    const remoteWarnings = [];
    try {
      const apiInfo = await sourceInfoViaYouTubeDataApi(value);
      if (apiInfo?.durationSec) return { ...apiInfo, durationKnown: true };
    } catch (error) { remoteWarnings.push(`YouTube Data API failed: ${error.message}`); }

    try {
      const htmlInfo = await sourceInfoViaYouTubeHtml(value);
      if (htmlInfo?.durationSec) {
        return { ...htmlInfo, durationKnown: true, warning: remoteWarnings.join(' | ') || undefined };
      }
    } catch (error) { remoteWarnings.push(`YouTube HTML lookup failed: ${error.message}`); }

    // Still a supported outcome: the worker confirms the real length after it
    // downloads, and the panel says so rather than inventing a number.
    return {
      url: parsed.canonicalUrl, title: parsed.canonicalUrl, durationSec: null, durationKnown: false,
      thumbnail: fallbackThumb(parsed.canonicalUrl), extractor: 'validated-only',
      warning: remoteWarnings.join(' | ') || undefined,
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
  const template = selectedTemplate(user);
  if (!template?.id) throw new Error('Select a valid template before submitting.');
  const tracks = workerMusicTracks(user);
  // Music stays required by default. Only an explicit choice on the job panel
  // waives it, so a forgotten upload still fails loudly rather than quietly
  // producing silent clips.
  if (!tracks.length && options.musicEnabled !== false) {
    throw new Error('Music is required on every clip. Upload at least one nasheed first, or switch the nasheed off for this job.');
  }
  return { value, template, tracks: options.musicEnabled === false ? [] : tracks };
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

  // A submission that times out or 502s server-side may still have created the
  // project. Without this the client cannot tell, resubmits, and the account is
  // charged for the same lecture twice. The key is supplied by the client and is
  // stable across its own retries.
  const idempotencyKey = String(options?.idempotencyKey || '').trim().slice(0, 120);
  if (idempotencyKey) {
    const existing = state.projects.find(item => item.idempotencyKey === idempotencyKey && ownerOf(item) === user.id);
    if (existing) return existing.id;
  }

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
    // Falling back to the URL here put "https://www.youtube.com/watch?v=..." in
    // every heading until the worker finished and sent the real title back --
    // which is exactly the window Happening now covers. sourceMeta carries the
    // title the preflight already fetched; an empty string lets the read path
    // decide, rather than baking a URL into the record.
    id: projectId, idempotencyKey, url: String(options.displayUrl || value), title: String(title || '').trim() || sourceMeta?.title || '',
    engine: useRemote ? 'remote' : useVizard ? 'vizard' : 'self-hosted', status: 'queued',
    stage: useRemote ? 'queued' : useVizard ? 'Waiting for secure YouTube import' : 'Waiting for the local AI worker', progress: 0,
    submittedAt: Date.now(), clipCount: 0, templateIdUsed: template.id, templateNameUsed: template.name,
    templateVersionUsed: template.version || 1, templateSnapshot: template,
    musicRequired: options.musicEnabled !== false, musicEnabled: options.musicEnabled !== false, error: null,
    sourceStartSec: sourceRange.startSec || 0, sourceEndSec: sourceRange.endSec || null,
    sourceTitle: sourceMeta?.title || null, sourceDurationSec: sourceMeta?.durationSec || null,
    // Falls back to the URL's own poster: the dashboard did not send sourceMeta,
    // so every lecture stored null here and the library showed empty cards.
    sourceThumbUrl: sourceMeta?.thumbnail || fallbackThumb(value) || null,
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
      : withImportNetwork({ type: 'youtube', url: parseYouTubeUrl(value).canonicalUrl }),
    template, musicTracks: remoteMusicTracks(tracks, user.id), settings: sharedSettings(user, options),
    requestedClipCount: clipSettings(user).clipsPerVideo,
    sourceStartSec: sourceRange.startSec || 0, sourceEndSec: sourceRange.endSec || null,
    callbackUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/api/worker-callbacks/${encodeURIComponent(projectId)}` : '',
  } : {
    id: projectId, url: value, title: String(title || '').trim(), sourceDir: sourcesDir,
    outputDir: path.join(clipsDir, projectId), resultPath: resultFile(projectId),
    ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath, template, musicTracks: tracks,
    settings: sharedSettings(user, options), sourceStartSec: sourceRange.startSec || 0, sourceEndSec: sourceRange.endSec || null,
    sourceTitle: sourceMeta?.title || null, sourceDurationSec: sourceMeta?.durationSec || null,
    // Falls back to the URL's own poster: the dashboard did not send sourceMeta,
    // so every lecture stored null here and the library showed empty cards.
    sourceThumbUrl: sourceMeta?.thumbnail || fallbackThumb(value) || null,
  };
  // Hold an estimate against the account before the job starts. A trimmed range
  // is exact; a known full duration is next best. In remote mode neither is
  // available until the worker downloads the source, so nothing is held and the
  // charge still happens on completion -- the hold is an improvement where the
  // length is knowable, not a guarantee everywhere.
  const estimateSeconds = sourceRange.endSec
    ? sourceRange.endSec - (sourceRange.startSec || 0)
    : Number(sourceMeta?.durationSec || 0);
  // With no known length, hold the same minimum the account had to prove it
  // could afford to start. Holding nothing meant a remote link import reserved
  // nothing at all, the clips were delivered before the charge was attempted,
  // and a shortfall only ever became a warning on a project nobody reads --
  // so the work was given away and could be repeated indefinitely.
  reserveProjectHold(project, estimateSeconds || billing.secondsForTokenCost(config.minimumTokensToStart));

  fs.writeFileSync(jobFile(projectId), JSON.stringify(job, null, 2));
  const rangeCopy = sourceRange.endSec ? ` · source window ${Math.round(sourceRange.startSec / 60)}–${Math.round(sourceRange.endSec / 60)} min` : (sourceRange.startSec ? ` · source starts at ${Math.round(sourceRange.startSec / 60)} min` : '');
  log(`Queued "${project.title}" for ${useRemote ? 'the external processing worker' : useVizard ? 'secure YouTube import and DeenClipped rendering' : 'the self-hosted clip AI'} using template "${template.name}"${rangeCopy}.`, 'info', user.id);
  pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
  return projectId;
}

// The per-clip breakdown behind "Rendering clip 2 of 4": which clip is being
// worked on, how far through it is, and the names of all of them. Shared so the
// local and remote paths cannot drift -- the remote path is what production
// runs, and it is the one that gets forgotten.
export function applyClipBreakdown(record, payload) {
  const whole = (value, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : null;
  };
  if (payload.totalClips !== undefined) record.totalClips = whole(payload.totalClips, 999);
  if (payload.currentClip !== undefined) record.currentClip = whole(payload.currentClip, 999);
  if (payload.clipPercent !== undefined) {
    const n = Number(payload.clipPercent);
    record.clipPercent = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }
  if (Array.isArray(payload.clipPlan)) {
    // Capped and trimmed: this is rendered as a list, and the worker's titles
    // reach the page.
    record.clipPlan = payload.clipPlan.slice(0, 40).map((clip, i) => ({
      index: whole(clip?.index, 999) ?? i + 1,
      title: String(clip?.title || '').trim().slice(0, 120),
      durationSec: Number.isFinite(Number(clip?.durationSec)) ? Math.round(Number(clip.durationSec)) : null,
    }));
  }
}

function parseWorkerLine(record, line) {
  let payload;
  try { payload = JSON.parse(line); } catch { return; }
  if (payload.type === 'progress') {
    record.stage = String(payload.stage || 'Processing');
    applyClipBreakdown(record, payload);
    // The worker computes a real ETA from its own throughput. Nothing carried it,
    // so the UI could only ever show a percentage.
    if (payload.etaSec === null || payload.etaSec === undefined) record.etaSec = null;
    else record.etaSec = Math.max(0, Math.round(Number(payload.etaSec)));
    // A stable identifier from the worker, so the UI never has to guess which
    // step it is on by matching words.
    if (payload.phase) record.phase = String(payload.phase);
    record.progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
    record.status = 'processing';
    record.updatedAt = Date.now();
    save();
  } else if (payload.type === 'heartbeat') {
    // Proof of life between progress events. Transcription can run for minutes
    // without advancing a percentage, so silence is the only usable stall
    // signal and it needs its own timestamp.
    record.heartbeatAt = Date.now();
    record.updatedAt = Date.now();
  } else if (payload.type === 'warning') {
    // Attributed, or the customer never sees it. A worker warning is exactly the
    // kind of thing they need — "your clips were scored without the AI" is not
    // an operator detail.
    log(String(payload.warning || 'The worker reported a warning.'), 'warn', ownerOfRecord(record));
    record.lastWarning = String(payload.warning || '');
    record.lastWarningCode = String(payload.code || '');
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
  // A 403 that came back through both the import service and the direct
  // fallback. Reached the customer as a raw yt-dlp traceback naming providers
  // they have never heard of, which reads as the product being broken.
  //
  // Verified by hand before writing this: the same key downloaded a different
  // video a minute later, so a 403 here is the video being refused rather than
  // a spent key or a broken account. The message says so, because "403" alone
  // sends people to check a plan that is fine.
  if (/http error 403|403: forbidden|\brefused this download\b/i.test(raw)) {
    return {
      code: 'youtube_import_blocked',
      message: 'YouTube refused to hand this video over (403) — both to the import service and directly. '
        + 'That points at this particular video rather than your account or your plan; other lectures usually still import. '
        + 'Download it yourself and upload the MP4 or MOV instead.',
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
  // Which import provider actually served the source. With a fallback chain,
  // "the import worked" says nothing about the configured provider's health;
  // this makes "socialkit failed, ytdlp carried it" answerable from the record.
  project.importProvider = result.project?.importProvider || project.importProvider || null;
  project.transcriptUrl = result.project?.transcriptUrl || null;
  project.clipCount = imported.length;
  // Kept so the UI can explain a shortfall rather than leaving it unexplained.
  project.clipsRequested = Number(result.project?.clipsRequested || project.clipsRequested || 0);
  project.status = 'done'; project.stage = 'Clips are ready for review'; project.progress = 100;
  project.completedAt = Date.now(); project.error = null;
  try {
    // The hold goes back first, so the real charge is measured against true
    // availability rather than against the estimate that was reserved.
    releaseProjectHold(project);
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
  // A warning the worker raised about how the clips were made. Logged once, to
  // the owning account, rather than repeated on every poll.
  if (update.etaSec !== undefined) project.etaSec = update.etaSec === null ? null : Math.max(0, Math.round(Number(update.etaSec)));
  applyClipBreakdown(project, update);
  // Download size, so the import can say how much of the file has landed rather
  // than only a percentage of a band the customer cannot see.
  for (const key of ['bytesDone', 'bytesTotal']) {
    if (update[key] === undefined) continue;
    const value = Number(update[key]);
    project[key] = Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (update.lastWarning && update.lastWarning !== project.lastWarning) {
    project.lastWarning = String(update.lastWarning);
    project.lastWarningCode = String(update.lastWarningCode || '');
    log(project.lastWarning, 'warn', ownerOf(project));
  }
  if (update.status === 'completed' && update.result && project.status !== 'done') {
    importResultObject(project, update.result, 'remote-worker');
  } else if (update.status === 'failed') {
    project.status = 'failed'; releaseProjectHold(project); project.stage = 'failed'; project.progress = Number(update.progress || project.progress || 0);
    // Keep the classified code, not a hardcoded one. Overwriting it with
    // 'processing_failed' threw away `youtube_import_blocked`, which is the one
    // failure with a specific fix the customer can act on — upload the MP4 —
    // so the UI could only ever offer a generic retry for it.
    const classified = customerSafeProjectError(update.error || 'The external worker failed.');
    project.error = classified.message;
    project.errorCode = classified.code; project.updatedAt = Date.now(); save();
  } else if (update.status === 'cancelled') {
    // Cancelled from the worker's side counts the same as cancelling here: no
    // clips are produced, so nothing should stay charged against the account.
    project.status = 'cancelled'; releaseProjectHold(project); project.stage = 'cancelled'; project.updatedAt = Date.now(); save();
  } else if (project.status !== 'done') {
    project.status = update.status === 'queued' ? 'queued' : 'processing';
    project.stage = String(update.stage || update.status || 'processing');
    project.progress = Math.max(0, Math.min(100, Number(update.progress) || 0));
    project.updatedAt = Date.now(); save();
  }
  return project;
}

async function runRemoteProject(project) {
  const file = jobFile(project.id);
  if (!fs.existsSync(file)) {
    project.status = 'failed'; releaseProjectHold(project); project.stage = 'failed'; project.error = 'The remote job metadata is missing. Submit the video again.'; save(); return;
  }
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  // A retried project carries a fresh worker job id so the worker treats it as a
  // new run. Everything server-side still keys off project.id.
  const workerJobId = project.workerJobId || project.id;
  payload.id = workerJobId;
  project.status = 'processing'; project.stage = 'Connecting to processing worker'; project.progress = Math.max(1, project.progress || 0); project.error = null; save();
  running.set(project.id, { remote: true });
  const started = Date.now();
  project.workerRetries = project.workerRetries || 0;
  try {
    await workerClient.createJob(payload);
    let lastMovementAt = Date.now();
    let lastSignature = '';
    while (Date.now() - started < config.workerJobTimeoutMs) {
      const update = await workerClient.getJob(workerJobId);
      acceptRemoteUpdate(project.id, update);
      if (['completed', 'failed', 'cancelled'].includes(update.status)) return;
      // Any of these moving means the worker is alive. The heartbeat covers the
      // long quiet stretches -- transcription can run for minutes without the
      // percentage changing -- so a job that stops emitting all three is hung,
      // not slow, and there is no reason to hold the single worker slot for it
      // until the full job timeout expires.
      const signature = `${update.stage || ''}|${update.progress || 0}|${update.heartbeatAt || 0}`;
      // Before clip_worker.py launches there is nothing beating: the import is a
      // single uninterrupted download that legitimately runs for as long as
      // VIDEO_IMPORT_TIMEOUT_MS allows. Judging it by the five-minute stall
      // budget cancelled healthy jobs -- a long lecture could never survive its
      // own download. Workers that heartbeat through the import (see
      // Processor.import_pulse) move the signature and never reach either
      // branch; this budget is what protects the ones not yet redeployed.
      if (signature !== lastSignature) { lastSignature = signature; lastMovementAt = Date.now(); }
      else if (Date.now() - lastMovementAt > stallBudgetFor(update.stage)) {
        await workerClient.cancelJob(workerJobId).catch(() => {});
        throw new Error('The processing worker stopped responding partway through. The job can be retried safely.');
      }
      await new Promise(resolve => setTimeout(resolve, config.workerPollIntervalMs));
    }
    // Tell the worker to stop before giving up locally. Without this the run
    // kept going on a MAX_CONCURRENT_JOBS=1 worker, so one timed-out job blocked
    // every other customer indefinitely.
    await workerClient.cancelJob(workerJobId).catch(() => {});
    throw new Error('The processing worker exceeded the job timeout. The job can be retried safely.');
  } catch (error) {
    if (project.status !== 'done') {
      // An unreachable worker used to re-queue every 30s forever, with the retry
      // window reset each cycle, so a VPS outage looped silently and the client
      // polled /api/state the whole time. Give up after a bounded number of
      // attempts and say so.
      const unavailable = error.code === 'worker_unavailable';
      const attempts = Number(project.workerRetries || 0) + (unavailable ? 1 : 0);
      const exhausted = unavailable && attempts > MAX_WORKER_RETRIES;
      project.workerRetries = unavailable ? attempts : 0;
      project.status = unavailable && !exhausted ? 'queued' : 'failed';
      project.stage = unavailable && !exhausted
        ? `Worker unavailable — retrying (${attempts}/${MAX_WORKER_RETRIES})`
        : 'failed';
      project.error = exhausted
        ? 'The processing worker has been unreachable for several minutes. Retry once it is back.'
        : error.message;
      project.errorCode = exhausted ? 'worker_unavailable_exhausted' : (error.code || 'processing_failed');
      // A failed job must not keep holding tokens. A retry re-reserves.
      if (project.status === 'failed') releaseProjectHold(project);
      if (unavailable && !exhausted) project.nextRetryAt = Date.now() + 30_000;
      save();
      if (unavailable && !exhausted) setTimeout(() => pump().catch(() => {}), 30_000);
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
      jobRecord.status = update.status === 'queued' ? 'queued' : 'processing'; save();
      if (update.status === 'completed') {
        if (kind === 'more') importMoreResultObject(project, jobRecord, update.result || {}, 'remote-worker');
        else importRerenderResultObject(jobRecord, update.result || {});
        return;
      }
      if (update.status === 'failed') throw new Error(update.error || 'The external worker failed.');
      if (update.status === 'cancelled') { jobRecord.status = 'cancelled'; jobRecord.stage = 'cancelled'; save(); return; }
      await new Promise(resolve => setTimeout(resolve, config.workerPollIntervalMs));
    }
    throw new Error('The processing worker exceeded the job timeout.');
  } catch (error) {
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
      project.status = 'failed'; releaseProjectHold(project); project.error = 'The job file is missing. Retry the project.'; save(); resolve(); return;
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
        else { finishFailed(project, stderr, code, 'Processing'); log(`Could not process "${project.title}": ${project.error}`, 'error', ownerOf(project)); }
      } catch (error) {
        project.status = 'failed'; releaseProjectHold(project); project.stage = 'Could not import rendered clips'; project.error = error.message; save();
        log(`Could not import "${project.title}": ${error.message}`, 'error', ownerOf(project));
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
  if (!rendered?.renderVerified || !musicSatisfied(rendered) || !rendered?.clipFile || !fs.existsSync(rendered.clipFile)) {
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

    const template = selectedTemplate(owner);
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
    project.status = 'failed'; releaseProjectHold(project);
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
        else { finishFailed(jobRecord, stderr, code, 'Generate more clips'); log(`Could not generate more clips for "${project.title}": ${jobRecord.error}`, 'error', ownerOf(project)); }
      } catch (error) {
        jobRecord.status = 'failed'; jobRecord.stage = 'Could not import the new clips'; jobRecord.error = error.message; save();
        log(`Could not import more clips for "${project.title}": ${error.message}`, 'error', ownerOf(project));
      }
      resolve(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error'));
    });
  });
}

function importRerenderResultObject(jobRecord, result) {
  const rendered = result.clips?.[0];
  if (!rendered?.renderVerified || !musicSatisfied(rendered)) throw new Error('The re-render did not pass verification.');
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
    log(`Created a re-post variant of "${original.title}" with template "${rendered.templateName}".`, 'info', ownerOfRecord(original));
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
    log(`Re-rendered "${original.title}" with template "${rendered.templateName}" while preserving its queue status.`, 'info', ownerOfRecord(original));
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
  // A remote lecture with a link can be fetched again; only one with neither an
  // upload nor a link is genuinely stuck.
  if ((!project.sourceFile || !fs.existsSync(project.sourceFile))
    && !(project.engine === 'remote' && (project.sourceObjectKey || project.url))) {
    throw new Error('The saved source video is unavailable. Generate more cannot safely re-download it because that would create a duplicate Library lecture.');
  }
  if ((!project.transcriptFile || !fs.existsSync(project.transcriptFile)) && !(project.engine === 'remote' && project.transcriptObjectKey)) {
    throw new Error('The saved transcript is unavailable. This lecture must be processed again before more clips can be generated.');
  }
  const count = Math.max(1, Math.min(20, Math.round(Number(requestedCount) || 8)));
  const owner = ownerOfRecord(project);
  billing.assertCanSpend(owner, billing.tokenCostForSeconds(count * (clipSettings(owner).clipMaxSeconds || 60)), 'generate more clips');
  const template = selectedTemplate(owner);
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
    source: remoteSourceFor(project),
    transcript: { objectKey: project.transcriptObjectKey }, existingRanges,
    template, musicTracks: remoteMusicTracks(tracks, owner.id), settings: { ...sharedSettings(owner), clipsPerVideo: count },
    callbackUrl: '',
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

// Where a remote job should fetch a finished lecture's source from again.
//
// Both the re-render and the more-clips paths hardcoded an object_storage
// source, and sourceObjectKey is only ever set for uploads. Every lecture
// imported from a link therefore sent `objectKey: null` and came back with "The
// uploaded video reference is invalid" -- a message about uploads, on a job that
// never involved one.
//
// An upload is preferred when there is one: it is the exact bytes the clips were
// cut from, where a re-download can differ if the video was re-encoded or
// replaced.
function remoteSourceFor(project) {
  if (project?.sourceObjectKey) {
    return { type: 'object_storage', objectKey: project.sourceObjectKey, title: project.title || '' };
  }
  const url = String(project?.url || '').trim();
  if (url) return withImportNetwork({ type: 'youtube', url, title: project.title || '' });
  throw new Error('This lecture has no source left to work from: the upload is gone and it has no link to re-import.');
}

// The operator's proxy / cookies ride inside the source, so every job type that
// downloads from YouTube gets them without separate plumbing. Only YouTube
// sources: an upload never talks to YouTube and must not carry credentials it
// has no use for. Exported for tests.
export function withImportNetwork(source) {
  if (source?.type !== 'youtube') return source;
  const settings = importNetworkSettings();
  const network = {};
  if (settings.proxy) network.proxy = settings.proxy;
  if (settings.cookiesText) network.cookiesText = settings.cookiesText;
  return Object.keys(network).length ? { ...source, network } : source;
}

export function queueClipRerender(clipId, templateId, { asVariant = false } = {}) {
  const clip = clipById(clipId);
  if (!clip) throw new Error('That clip does not exist.');
  if (clip.status === 'posted' && !asVariant) throw new Error('A posted video cannot be changed. Create a re-post variant instead.');
  const project = projectById(clip.projectId);
  // Guarded because the lines below dereference it directly. A clip whose
  // lecture was deleted otherwise threw a raw TypeError at the user.
  if (!project) throw new Error('The lecture this clip came from no longer exists, so it cannot be re-rendered.');
  const sourceFile = clip.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project.sourceFile;
  if ((!sourceFile || !fs.existsSync(sourceFile))
    && !(project.engine === 'remote' && (project.sourceObjectKey || project.url))) {
    throw new Error('The original source file is unavailable. Keep source files enabled to re-render clips.');
  }
  const owner = ownerOfRecord(clip);
  const baseTemplate = templateById(templateId, owner) || selectedTemplate(owner);
  if (!baseTemplate?.id) throw new Error('Choose a valid saved template.');
  // This clip's own tweaks win over the shared style. Without this, editing one
  // clip either changed every clip on the template or was silently discarded at
  // render time.
  const template = templateForClip(baseTemplate, clip.styleOverrides);
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
    source: remoteSourceFor(project),
    transcript: { objectKey: project.transcriptObjectKey || '' }, template,
    musicTracks: remoteMusicTracks(tracks, owner.id), settings: sharedSettings(owner),
    clip: {
      id: clip.id, title: clip.title, description: clip.description, transcript: clip.transcript,
      startSec: clip.startSec, endSec: clip.endSec, score: clip.score, scoreReasons: clip.scoreReasons,
      reviewRequired: clip.reviewRequired,
    }, callbackUrl: '',
  } : {
    mode: 'rerender', id: rerenderId, projectId: project.id, clipIdOverride: outputClipId,
    sourceFile, outputDir, resultPath, ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath,
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
    asVariant: Boolean(asVariant), status: 'queued', stage: 'Waiting to re-render', progress: 0, engine: project.engine === 'remote' ? 'remote' : 'self-hosted',
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
        ...state.projects.filter(item => item.engine === 'remote' && item.status === 'queued' && Number(item.nextRetryAt || 0) <= Date.now()).map(item => ({ type: 'remote', item, at: item.submittedAt })),
        ...state.projects.filter(item => item.engine === 'self-hosted' && item.status === 'queued').map(item => ({ type: 'project', item, at: item.submittedAt })),
        ...state.projects.filter(item => item.engine === 'vizard' && item.status === 'queued').map(item => ({ type: 'vizard', item, at: item.submittedAt })),
        ...state.projects.filter(item => item.moreJob?.engine === 'remote' && item.moreJob.status === 'queued' && Number(item.moreJob.nextRetryAt || 0) <= Date.now()).map(item => ({ type: 'remote-more', item: item.moreJob, project: item, at: item.moreJob.createdAt })),
        ...state.projects.filter(item => item.moreJob?.engine !== 'remote' && item.moreJob?.status === 'queued').map(item => ({ type: 'more', item: item.moreJob, project: item, at: item.moreJob.createdAt })),
        ...state.rerenderJobs.filter(item => item.engine === 'remote' && item.status === 'queued' && Number(item.nextRetryAt || 0) <= Date.now()).map(item => ({ type: 'remote-rerender', item, project: projectById(clipById(item.clipId)?.projectId), at: item.createdAt })),
        ...state.rerenderJobs.filter(item => item.engine !== 'remote' && item.status === 'queued').map(item => ({ type: 'rerender', item, at: item.createdAt })),
      ].sort((a, b) => a.at - b.at);
      const next = candidates[0];
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
export async function socialPublishFile(clipId, provider) {
  const clip = clipById(clipId);
  if (!clip) throw new Error('That clip does not exist.');
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
    log(`Rendering a TikTok-safe copy of "${clip.title}" without the app watermark.`, 'info', ownerOfRecord(clip));
    const result = await runWorkerJob(jobPath, resultPath, 'TikTok-safe render');
    const rendered = result.clips?.[0];
    if (!rendered?.renderVerified || !musicSatisfied(rendered) || !rendered?.clipFile || !fs.existsSync(rendered.clipFile)) {
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
    // The worker keys jobs by id and returns the existing record rather than
    // starting a new run, so retrying under the same id re-read the old failure
    // and never resubmitted. A retry gets a fresh worker job id; the project id
    // is unchanged, so nothing else has to know.
    project.workerJobId = `${project.id}-retry-${Date.now().toString(36)}`;
    Object.assign(project, { status: 'queued', stage: 'queued', progress: Math.min(5, project.progress || 0), error: null, errorCode: null });
    save(); pump().catch(error => log(`Worker queue failed: ${error.message}`, 'error', ownerOf(project)));
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
  const current = running.get(projectId);
  const remoteProject = projectById(projectId);
  // A retried project runs under a fresh worker job id. Cancelling the project
  // id named a job the worker no longer has, so it 404'd, the error was
  // swallowed, and the real run kept the single worker slot — the user cancelled
  // and then waited behind their own cancelled job.
  if (remoteProject?.engine === 'remote') {
    workerClient.cancelJob(remoteProject.workerJobId || projectId).catch(() => {});
  }
  if (typeof current?.kill === 'function') current.kill('SIGTERM');
  else if (current) current.cancelled = true;
  const project = projectById(projectId);
  // Cancelling stops the work, so the tokens held against it must go back. This
  // was missing, and because a free account never rolls over, every cancelled
  // job shrank the balance permanently with no way to recover it.
  if (project) { releaseProjectHold(project); save(); }
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
  save(); log(`Removed "${project.title}" and its local rendered files.`, 'info', ownerOf(project));
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
