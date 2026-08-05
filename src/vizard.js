import { config } from './config.js';

const ERROR_MESSAGES = {
  4001: 'The Vizard API key is invalid.',
  4002: 'Vizard could not create or process this clipping project.',
  4003: 'The YouTube importer is busy. Please retry in a few minutes.',
  4004: 'Vizard does not support this video format.',
  4005: 'The YouTube URL or video is invalid.',
  4006: 'Vizard rejected one of the clipping settings.',
  4007: 'The Vizard account does not have enough processing minutes.',
  4008: 'Vizard could not retrieve this YouTube video.',
  4009: 'Paste a valid public YouTube video URL.',
  4010: 'Vizard could not detect the spoken language in this video.',
};

export class VizardError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'VizardError';
    this.code = code;
  }
}

export function configured() {
  return Boolean(String(config.vizardApiKey || '').trim());
}

export function isYouTubeUrl(value = '') {
  try {
    const url = new URL(String(value).trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  } catch {
    return false;
  }
}

function messageFor(payload, fallback) {
  const code = Number(payload?.code);
  return String(payload?.errMsg || '').trim() || ERROR_MESSAGES[code] || fallback;
}

async function request(pathname, options = {}, timeoutMs = 30_000) {
  if (!configured()) throw new VizardError('YouTube URL import is not configured yet. Add VIZARD_API_KEY to the server.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.vizardApiBase}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        VIZARDAI_API_KEY: config.vizardApiKey,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new VizardError(messageFor(payload, `Vizard returned HTTP ${response.status}.`), Number(payload?.code) || response.status);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new VizardError('Vizard did not respond in time. Please retry.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function createProject({ videoUrl, projectName = '', maxClips = config.vizardMaxClips, preferLength = [0] } = {}) {
  if (!isYouTubeUrl(videoUrl)) throw new VizardError('Paste a valid YouTube video URL.');
  const body = {
    lang: 'auto',
    preferLength: Array.isArray(preferLength) && preferLength.length
      ? [...new Set(preferLength.map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= 4))].slice(0, 4)
      : [0],
    videoUrl: String(videoUrl).trim(),
    videoType: 2,
    maxClipNumber: Math.max(1, Math.min(100, Math.round(Number(maxClips) || config.vizardMaxClips))),
    subtitleSwitch: 0,
    headlineSwitch: 0,
    clipModel: config.vizardClipModel,
  };
  if (!body.preferLength.length) body.preferLength = [0];
  if (String(projectName || '').trim()) body.projectName = String(projectName).trim().slice(0, 180);
  const payload = await request('/project/create', { method: 'POST', body: JSON.stringify(body) });
  if (Number(payload?.code) !== 2000 || !payload?.projectId) {
    throw new VizardError(messageFor(payload, 'Vizard did not accept this YouTube video.'), Number(payload?.code) || null);
  }
  return { projectId: String(payload.projectId), shareLink: payload.shareLink || null };
}

export async function queryProject(projectId) {
  const id = String(projectId || '').trim();
  if (!/^\d+$/.test(id)) throw new VizardError('The Vizard project ID is invalid.');
  const payload = await request(`/project/query/${encodeURIComponent(id)}`, { method: 'GET' });
  const code = Number(payload?.code);
  if (code === 1000) return { status: 'processing', projectId: id, videos: [] };
  if (code !== 2000) throw new VizardError(messageFor(payload, 'Vizard could not finish this video.'), code || null);
  const videos = Array.isArray(payload?.videos) ? payload.videos.filter(video => video?.videoUrl) : [];
  if (!videos.length) return { status: 'processing', projectId: id, videos: [] };
  return {
    status: 'complete',
    projectId: id,
    projectName: String(payload.projectName || '').trim(),
    shareLink: payload.shareLink || null,
    videos,
  };
}

export function assertTrustedClipUrl(value) {
  const url = new URL(String(value || ''));
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'vizard.ai' && !host.endsWith('.vizard.ai'))) {
    throw new VizardError('Vizard returned an untrusted clip download URL.');
  }
  return url.toString();
}
