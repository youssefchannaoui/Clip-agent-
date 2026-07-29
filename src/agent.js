import { config } from './config.js';
import { state, save, log, opusKey, clipSettings } from './store.js';
import * as opus from './opus.js';
import * as audio from './audio.js';
import * as thumbs from './thumbs.js';
import { nextSlot } from './slots.js';

const MINUTE = 60_000;
// Opus allows about one request a second on the publish endpoints.
const RATE_GAP = Number(process.env.RATE_MS) || 1200;
let running = false;

/**
 * Refresh the list of accounts linked inside Opus, at most every 10 minutes.
 * During background passes a failure is only logged, so one bad response
 * doesn't stall the queue. When `strict` is set — checking a key someone just
 * pasted — the error is thrown so it can be shown to them.
 */
export async function refreshAccounts(force = false, strict = false) {
  if (!opusKey()) {
    if (strict) throw new Error('No Opus API key to check.');
    return state.accounts;
  }
  if (!force && Date.now() - state.accountsCheckedAt < 10 * MINUTE) return state.accounts;
  try {
    state.accounts = await opus.getSocialAccounts();
    state.accountsCheckedAt = Date.now();
    save();
  } catch (err) {
    if (strict) throw err;
    log(`Could not read your connected accounts. ${err.message}`, 'error');
  }
  return state.accounts;
}

/** Hand a video to Opus for clipping. */
export async function submitVideo(url, title) {
  const project = await opus.createProject(url, title);
  const id = project?.projectId || project?.id;
  if (!id) throw new Error('Opus accepted the video but did not return a project id.');

  state.projects.unshift({
    id, url, title: title || url,
    status: 'clipping',
    stage: 'Sent to Opus, waiting for it to start',
    submittedAt: Date.now(),
    imported: 0,
    // Short lectures can be ready quickly, so look soon, then ease off.
    checkAfter: Date.now() + 20_000,
  });
  save();
  log(`Sent to Opus for clipping: ${title || url}`);
  return id;
}

/** Pull finished clips into the queue. */
async function importClips(project) {
  let clips;
  try {
    clips = await opus.getClips(project.id);
  } catch (err) {
    log(`Could not fetch clips for ${project.title}. ${err.message}`, 'error');
    project.checkAfter = Date.now() + 2 * MINUTE;
    save();
    return;
  }

  if (!clips.length) {
    // Still clipping. Back off gradually, but keep checking for a day.
    const waited = Date.now() - project.submittedAt;
    const mins = Math.floor(waited / MINUTE);
    project.stage = mins < 1
      ? 'Opus is clipping'
      : `Opus is clipping, ${mins} minute${mins === 1 ? '' : 's'} so far`;
    project.checkAfter = Date.now() + Math.min(2 * MINUTE, 15_000 + waited / 10);
    if (waited > 24 * 60 * MINUTE) {
      project.status = 'stalled';
      project.stage = 'Opus has not returned anything for a day';
      log(`Opus has not returned clips for ${project.title} after a day.`, 'warn');
    }
    save();
    return;
  }

  project.stage = 'Bringing the clips in';
  save();

  // Opus returns its own ranking; use the score when it is present.
  const ranked = clips.slice().sort((a, b) => {
    if (a.score != null && b.score != null) return b.score - a.score;
    return 0;
  });

  const known = new Set(state.clips.map(c => c.id));
  const { clipsPerVideo } = clipSettings();
  const unknown = ranked.filter(c => !known.has(c.id));
  const fresh = clipsPerVideo > 0 ? unknown.slice(0, clipsPerVideo) : unknown;

  for (const c of fresh) {
    state.clips.push({
      ...c,
      projectTitle: project.title,
      status: config.autoApprove ? 'approved' : 'waiting',
      targets: [],                 // one entry per destination once scheduled
      addedAt: Date.now(),
      scheduledAt: null,
      thumbState: 'pending',
    });
  }

  project.imported = fresh.length;
  project.clipCount = clips.length;
  project.status = 'done';
  delete project.stage;
  save();
  log(`${fresh.length} clips ready from ${project.title}${config.autoApprove ? '' : ' — waiting for your approval'}`);
}

/**
 * Record what the agent is doing to a clip right now, so the interface can
 * show it step by step instead of sitting silent for a minute.
 */
function stage(clip, text, step = 0, total = 0) {
  clip.stage = { text, step, total, at: Date.now() };
  save();
}
function clearStage(clip) {
  if (clip.stage) { delete clip.stage; save(); }
}

/** Ask Opus to write the caption, then wait for it. */
async function generateCopy(clip, account) {
  try {
    const jobId = await opus.requestCopy({
      projectId: clip.projectId, clipId: clip.clipId, account,
    });
    if (!jobId) return null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, Number(process.env.COPY_POLL_MS) || 3000));
      const res = await opus.getCopy(jobId);
      if (res?.status === 'COMPLETED') return res;
      if (res?.status === 'FAILED') return null;
    }
  } catch (err) {
    log(`Caption generation failed, using the clip's own title instead. ${err.message}`, 'warn');
  }
  return null;
}

/**
 * Mix a random nasheed into the clip and swap Opus's ids to point at that
 * mixed version, before anything gets scheduled. Runs once per clip. If it
 * fails for any reason, the clip still goes out — just without music,
 * rather than sitting stuck forever.
 */
async function ensureMusic(clip) {
  if (clip.musicMixed) return;

  stage(clip, 'Adding background music');
  try {
    const result = await audio.mixClipMusic(clip.exportUrl, text => stage(clip, text));

    if (result.skipped) {
      clip.musicMixed = 'skipped';
      clip.musicNote = result.skipped;
      log(`No music added to "${clip.title}". ${result.skipped}`, 'warn');
    } else {
      stage(clip, 'Bringing the mixed clip back into Opus');
      const project = await opus.importMixedClip(result.publicUrl, clip.title);
      const newProjectId = project?.projectId || project?.id;
      if (!newProjectId) throw new Error('Opus did not return a project id for the mixed clip.');

      stage(clip, 'Waiting for Opus to finish importing it');
      const newClip = await waitForImportedClip(newProjectId);
      if (!newClip) throw new Error('Opus did not return the imported clip in time.');

      clip.originalProjectId = clip.projectId;
      clip.originalClipId = clip.clipId;
      clip.projectId = newClip.projectId;
      clip.clipId = newClip.clipId;
      clip.musicMixed = 'done';
      clip.musicNote = `Mixed with "${result.nasheedName}"`;
    }
  } catch (err) {
    clip.musicMixed = 'failed';
    clip.musicNote = err.message;
    log(`Could not add music to "${clip.title}", posting without it. ${err.message}`, 'warn');
  }
  save();
}

async function waitForImportedClip(projectId, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const clips = await opus.getClips(projectId);
    if (clips.length) return clips[0];
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

/** Schedule one approved clip across every connected account. */
async function scheduleClip(clip) {
  await ensureMusic(clip);

  stage(clip, 'Checking your connected accounts');
  const accounts = await refreshAccounts();
  if (!accounts.length) {
    clearStage(clip);
    log('No social accounts are connected inside Opus yet, so nothing can be scheduled.', 'warn');
    return;
  }

  stage(clip, 'Finding the next free slot');
  const taken = state.clips.map(c => c.scheduledAt).filter(Boolean);
  const at = clip.scheduledAt || nextSlot(taken);
  clip.scheduledAt = at;

  const total = accounts.length;
  let step = 0;

  for (const account of accounts) {
    step++;
    if (clip.targets.some(t => t.postAccountId === account.postAccountId && t.status !== 'failed')) continue;

    let copy = clip.copy;
    if (!copy) {
      stage(clip, 'Writing the caption', step, total);
      copy = await generateCopy(clip, account) || {
        title: clip.title,
        description: clip.description,
        hashtags: clip.hashtags,
      };
      clip.copy = copy;
      save();
    }

    stage(clip, `Scheduling to ${account.name}`, step, total);
    try {
      const scheduleId = await opus.schedulePost({
        projectId: clip.projectId,
        clipId: clip.clipId,
        account,
        title: clip.editedTitle || copy.title || clip.title,
        description: clip.editedDescription || copy.description || clip.description,
        hashtags: clip.editedHashtags ?? copy.hashtags ?? clip.hashtags,
        publishAt: at,
      });
      upsertTarget(clip, account, { status: 'scheduled', scheduleId });
      log(`Scheduled to ${account.name}`);
    } catch (err) {
      upsertTarget(clip, account, { status: 'failed', error: err.message });
      log(`Could not schedule to ${account.name}. ${err.message}`, 'error');
    }
    await new Promise(r => setTimeout(r, RATE_GAP));
  }

  const anyGood = clip.targets.some(t => t.status === 'scheduled');
  clip.status = anyGood ? 'scheduled' : 'waiting';
  clearStage(clip);
  save();
  if (anyGood) log(`Scheduled "${clip.editedTitle || clip.title}" across ${clip.targets.filter(t => t.status === 'scheduled').length} accounts`);
  else log(`Could not schedule "${clip.editedTitle || clip.title}" anywhere. It is back in your queue.`, 'error');
}

function upsertTarget(clip, account, patch) {
  const existing = clip.targets.find(t => t.postAccountId === account.postAccountId);
  const next = {
    postAccountId: account.postAccountId,
    platform: account.platform,
    name: account.name,
    ...existing, ...patch,
  };
  clip.targets = [...clip.targets.filter(t => t.postAccountId !== account.postAccountId), next];
}

/** Post one clip immediately, ignoring the schedule. */
export async function postNow(clipId) {
  const clip = state.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('That clip is no longer in the queue.');
  await ensureMusic(clip);

  stage(clip, 'Checking your connected accounts');
  const accounts = await refreshAccounts();
  if (!accounts.length) {
    clearStage(clip);
    throw new Error('No social accounts are connected inside Opus.');
  }

  const total = accounts.length;
  let step = 0;

  for (const account of accounts) {
    step++;
    stage(clip, `Uploading to ${account.name}`, step, total);
    try {
      const copy = clip.copy || {};
      await opus.publishNow({
        projectId: clip.projectId,
        clipId: clip.clipId,
        account,
        title: clip.editedTitle || copy.title || clip.title,
        description: clip.editedDescription || copy.description || clip.description,
        hashtags: clip.editedHashtags ?? copy.hashtags ?? clip.hashtags,
      });
      upsertTarget(clip, account, { status: 'posted', scheduleId: undefined });
      log(`Posted to ${account.name}`);
    } catch (err) {
      upsertTarget(clip, account, { status: 'failed', error: err.message });
      log(`Could not post to ${account.name}. ${err.message}`, 'error');
    }
    await new Promise(r => setTimeout(r, RATE_GAP));
  }
  clip.status = clip.targets.some(t => t.status === 'posted') ? 'posted' : 'waiting';
  clearStage(clip);
  save();
  log(`Posted "${clip.editedTitle || clip.title}" now`);
}

/** Cancel anything already queued inside Opus for this clip. */
export async function unschedule(clip) {
  const queued = clip.targets.filter(t => t.status === 'scheduled' && t.scheduleId);
  let step = 0;
  for (const t of queued) {
    step++;
    stage(clip, `Cancelling in Opus`, step, queued.length);
    try { await opus.cancelSchedule(t.scheduleId); } catch { /* already gone */ }
  }
  clip.targets = [];
  clip.scheduledAt = null;
  clearStage(clip);
  save();
}

/**
 * Opus does the publishing, so once a scheduled slot has passed the clip has
 * gone out. Move it to posted, and keep the history from growing forever.
 */
function retirePassed() {
  const now = Date.now();
  let changed = false;

  for (const c of state.clips) {
    if (c.status !== 'scheduled' || !c.scheduledAt || c.scheduledAt > now) continue;
    c.status = 'posted';
    c.postedAt = c.scheduledAt;
    c.targets = c.targets.map(t => (t.status === 'scheduled' ? { ...t, status: 'posted' } : t));
    changed = true;
  }

  const posted = state.clips.filter(c => c.status === 'posted');
  if (posted.length > 400) {
    const cutoff = posted
      .map(c => c.postedAt || c.addedAt || 0)
      .sort((a, b) => b - a)[400];
    const keep = state.clips.filter(c => c.status !== 'posted' || (c.postedAt || c.addedAt || 0) > cutoff);
    const dropped = state.clips.filter(c => !keep.includes(c));
    dropped.forEach(c => thumbs.deleteThumbnail(c.id));
    state.clips = keep;
    changed = true;
  }

  if (changed) save();
}

/** One pass of the agent: check projects, then schedule whatever is approved. */
/**
 * Grab a real frame from each clip's own video as a thumbnail, a few at a
 * time so a big batch of clips doesn't stall the rest of the tick. Runs
 * one at a time (not in parallel) — a small Render instance doesn't have
 * the CPU to spare for several ffmpeg processes at once.
 */
async function processThumbnails(maxPerTick = 4) {
  const pending = state.clips.filter(c => c.thumbState === 'pending').slice(0, maxPerTick);
  for (const clip of pending) {
    const success = await thumbs.generateThumbnail(clip.id, clip.exportUrl).catch(() => false);
    clip.thumbState = success ? 'ready' : 'failed';
    save();
  }
}

export async function tick() {
  if (running || !opusKey()) return;
  running = true;
  try {
    for (const p of state.projects) {
      if (p.status !== 'clipping') continue;
      if (Date.now() < (p.checkAfter || 0)) continue;
      await importClips(p);
    }
    await processThumbnails();
    for (const c of state.clips) {
      if (c.status === 'approved') await scheduleClip(c);
    }
    retirePassed();
  } catch (err) {
    log(`Agent pass failed: ${err.message}`, 'error');
  } finally {
    running = false;
  }
}

export function start() {
  // How often the agent wakes up. Overridable so tests don't wait on it.
  const every = Number(process.env.TICK_MS) || 20_000;
  setInterval(() => { tick().catch(() => {}); }, every);
  setTimeout(() => { tick().catch(() => {}); }, Math.min(3000, every));
}
