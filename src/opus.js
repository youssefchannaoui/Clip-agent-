import { config } from './config.js';
import { opusKey, opusOrgId, brandTemplateId, clipSettings, copyPrompt } from './store.js';

const BASE = process.env.OPUS_BASE || 'https://api.opus.pro/api';

class OpusError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(pathname, { method = 'GET', body, retries = 2 } = {}) {
  const key = opusKey();
  if (!key) throw new OpusError('No Opus API key connected yet.', 401);

  const headers = { Authorization: `Bearer ${key}` };
  if (opusOrgId()) headers['x-opus-org-id'] = opusOrgId();
  if (body) headers['Content-Type'] = 'application/json';

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(BASE + pathname, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
      throw new OpusError(`Could not reach Opus: ${err.message}`, 0);
    }

    // Opus rate limits some endpoints to 1 request a second.
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(2000 * (attempt + 1));
      continue;
    }

    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch {}

    if (!res.ok) {
      const detail = parsed?.message || parsed?.error || text.slice(0, 300) || res.statusText;
      throw new OpusError(explain(res.status, detail), res.status);
    }
    return parsed;
  }
}

function explain(status, detail) {
  if (status === 401 || status === 403) {
    return `Opus rejected the key (${status}). Check it is correct, that your plan includes API access, and that social posting is enabled on your account. Detail: ${detail}`;
  }
  if (status === 402) return `Opus says you are out of credits. Detail: ${detail}`;
  return `Opus returned ${status}: ${detail}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ */

/** Send a long video off to be clipped. Returns the new project. */
export async function createProject(videoUrl, title) {
  const { clipMinSeconds, clipMaxSeconds } = clipSettings();
  const body = {
    videoUrl,
    curationPref: {
      model: 'ClipBasic',                       // lectures are talking-head footage
      genre: 'Auto',
      clipDurations: [[clipMinSeconds, clipMaxSeconds]],
    },
    renderPref: { layoutAspectRatio: 'portrait' },
  };
  if (title) body.uploadedVideoAttr = { title };
  if (brandTemplateId()) body.brandTemplateId = brandTemplateId();
  if (config.publicBaseUrl) {
    body.conclusionActions = [{
      type: 'WEBHOOK',
      notifyFailure: true,
      url: `${config.publicBaseUrl}/webhooks/opus`,
    }];
  }
  const res = await call('/clip-projects', { method: 'POST', body });
  return res?.data ?? res;
}

/**
 * Re-import a clip we've already rendered ourselves (with the nasheed mixed
 * in) so Opus treats it as one finished, postable clip rather than clipping
 * it again. This costs a second, small amount of Opus credit for the clip's
 * own short duration — the trade-off for automatic background music.
 */
export async function importMixedClip(videoUrl, title) {
  const body = {
    videoUrl,
    curationPref: { skipCurate: true },
  };
  if (title) body.uploadedVideoAttr = { title };
  // This re-import creates a whole new Opus render, separate from the
  // original clip — without this, Opus fell back to its own account
  // default template for it, regardless of whatever the person actually
  // has selected. That's exactly why captions could show up on a mixed
  // clip even with a captions-off template chosen.
  if (brandTemplateId()) body.brandTemplateId = brandTemplateId();
  const res = await call('/clip-projects', { method: 'POST', body });
  return res?.data ?? res;
}

/** Clips produced for a project. Empty until Opus finishes. */
export async function getClips(projectId) {
  const res = await call(`/exportable-clips?q=findByProjectId&projectId=${encodeURIComponent(projectId)}&pageNum=1&pageSize=50`);
  const list = Array.isArray(res) ? res : (res?.data ?? []);
  return list.map(c => ({
    id: c.id,                                        // "{projectId}.{curationId}"
    clipId: c.curationId || String(c.id).split('.').pop(),
    projectId: c.projectId || projectId,
    title: c.title || '',
    description: c.description || '',
    hashtags: c.hashtags || '',
    durationMs: c.durationMs || 0,
    exportUrl: c.uriForExport || c.uriForPreview || '',
    preview: c.uriForPreview || c.uriForExport || '',
    // Virality score is not in the documented schema, so fall back gracefully.
    score: firstNumber(c.viralityScore, c.score, c.viralScore),
  }));
}

function firstNumber(...vals) {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/** The clip styles saved in the Opus account, so one can be picked here. */
export async function getBrandTemplates() {
  const res = await call('/brand-templates?q=mine');
  const list = Array.isArray(res) ? res : (res?.data ?? []);
  return list.map(t => ({
    id: t.templateId || t.id,
    name: t.name || 'Untitled template',
  })).filter(t => t.id);
}

/** Social destinations already linked inside the Opus account. */
export async function getSocialAccounts() {
  const res = await call('/social-accounts?q=mine');
  return (res?.data ?? []).map(a => ({
    postAccountId: a.postAccountId,
    subAccountId: a.subAccountId || undefined,
    platform: a.platform,
    name: a.extUserName || a.platform,
    avatar: a.extUserPictureLink || '',
    profile: a.extUserProfileLink || '',
  }));
}

/** Ask Opus to write the title, description and hashtags for one clip. */
export async function requestCopy({ projectId, clipId, account, prompt, forceRegenerate = false }) {
  const res = await call('/social-copy-jobs', {
    method: 'POST',
    body: {
      projectId, clipId,
      postAccountId: account.postAccountId,
      subAccountId: account.subAccountId,
      prompt: String(prompt ?? copyPrompt()).trim(),
      // Opus otherwise may return an older cached result created before the
      // prompt changed, which is how Arabic copy could survive an English prompt.
      forceRegenerate: Boolean(forceRegenerate),
    },
  });
  return res?.data?.jobId;
}

export async function getCopy(jobId) {
  const res = await call(`/social-copy-jobs/${encodeURIComponent(jobId)}`);
  return res?.data ?? null;
}

function postDetail({ title, description, hashtags, platform }) {
  const body = [description, hashtags].filter(Boolean).join('\n\n').trim();
  return {
    title: (title || 'Reminder').slice(0, 100),
    mediaType: 'video',
    custom: {
      description: body.slice(0, 2000),
      ...(platform === 'YOUTUBE' ? { privacy: 'public' } : {}),
    },
  };
}

/** Queue a clip to go out at a future time. Opus does the posting. */
export async function schedulePost({ projectId, clipId, account, title, description, hashtags, publishAt }) {
  const res = await call('/publish-schedules', {
    method: 'POST',
    body: {
      projectId, clipId,
      postAccountId: account.postAccountId,
      subAccountId: account.subAccountId,
      postDetail: postDetail({ title, description, hashtags, platform: account.platform }),
      publishAt: new Date(publishAt).toISOString(),
    },
  });
  return res?.data?.scheduleId;
}

/** Push a clip out right now. */
export async function publishNow({ projectId, clipId, account, title, description, hashtags }) {
  const res = await call('/post-tasks', {
    method: 'POST',
    body: {
      projectId, clipId,
      postAccountId: account.postAccountId,
      subAccountId: account.subAccountId,
      postDetail: postDetail({ title, description, hashtags, platform: account.platform }),
    },
  });
  return res?.data ?? { ok: true };
}

export async function cancelSchedule(scheduleId) {
  return call(`/publish-schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' });
}

export { OpusError };
