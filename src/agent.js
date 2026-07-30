import { config } from './config.js';
import { state, save, log, opusKey, clipSettings, brandTemplateId, brandTemplateSelection, copyPrompt } from './store.js';
import * as opus from './opus.js';
import * as audio from './audio.js';
import * as thumbs from './thumbs.js';
import { nextSlot } from './slots.js';

const MINUTE = 60_000;
// Opus allows about one request a second on the publish endpoints.
const RATE_GAP = Number(process.env.RATE_MS) || 1200;

/**
 * Several clips from the same lecture can all be missing their export link
 * at once — calling Opus separately for each one would be several requests
 * asking the exact identical question. Cache the answer briefly so they
 * share a single fetch instead of risking Opus's own rate limits.
 */
const exportUrlCacheTtl = 15_000;
const exportUrlCache = new Map(); // projectId -> { at, promise }

async function fetchProjectClipsCached(projectId) {
  const hit = exportUrlCache.get(projectId);
  if (hit && Date.now() - hit.at < exportUrlCacheTtl) return hit.promise;
  const promise = opus.getClips(projectId).catch(err => { exportUrlCache.delete(projectId); throw err; });
  exportUrlCache.set(projectId, { at: Date.now(), promise });
  return promise;
}
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
  const template = brandTemplateSelection();
  const project = await opus.createProject(url, title, template);
  const id = project?.projectId || project?.id;
  if (!id) throw new Error('Opus accepted the video but did not return a project id.');

  state.projects.unshift({
    id, url, title: title || url,
    status: 'clipping',
    stage: 'Sent to Opus, waiting for it to start',
    submittedAt: Date.now(),
    imported: 0,
    clipCount: 0,
    // Snapshot the exact verified style used for the first render. Captions,
    // logos and layouts are burned into Opus exports and cannot be removed later.
    brandTemplateIdUsed: template.id,
    brandTemplateNameUsed: template.name || '',
    captionsEnabledUsed: template.enableCaption,
    // Short lectures can be ready quickly, so look soon, then ease off.
    checkAfter: Date.now() + 20_000,
  });
  save();
  log(`Sent to Opus for clipping: ${title || url}`);
  return id;
}

function sourceProjectIdForClip(clip) {
  return clip.sourceProjectId || clip.originalProjectId || clip.projectId;
}

function hiddenClipSet(project) {
  return new Set(Array.isArray(project?.hiddenClipIds) ? project.hiddenClipIds : []);
}

function importedClipsForProject(projectId) {
  return state.clips.filter(c => sourceProjectIdForClip(c) === projectId);
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
  const hidden = hiddenClipSet(project);
  const { clipsPerVideo } = clipSettings();
  const unknown = ranked.filter(c => !known.has(c.id) && !hidden.has(c.id));
  const fresh = clipsPerVideo > 0 ? unknown.slice(0, clipsPerVideo) : unknown;

  addClipsToQueue(fresh, project);

  project.clipCount = clips.length;
  project.status = 'done';
  delete project.stage;
  save();
  log(`${fresh.length} clips ready from ${project.title}${config.autoApprove ? '' : ' — waiting for your approval'}`);
}

function addClipsToQueue(clipsToAdd, project) {
  for (const c of clipsToAdd) {
    state.clips.push({
      ...c,
      projectTitle: project.title,
      sourceProjectId: project.id,
      sourceTemplateId: project.brandTemplateIdUsed ?? null,
      sourceTemplateName: project.brandTemplateNameUsed || '',
      sourceCaptionsEnabled: typeof project.captionsEnabledUsed === 'boolean'
        ? project.captionsEnabledUsed
        : null,
      status: config.autoApprove ? 'approved' : 'waiting',
      targets: [],                 // one entry per destination once scheduled
      addedAt: Date.now(),
      scheduledAt: null,
      thumbState: 'pending',
    });
  }
}

/**
 * Every clip Opus has for a project, flagged with whether it's already in
 * the queue — lets someone see exactly what's available and choose, rather
 * than only ever getting an automatic "next batch".
 */
export async function listAvailableClips(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) throw new Error('That lecture is no longer in your history.');

  const clips = await opus.getClips(projectId);
  const hidden = hiddenClipSet(project);
  const known = new Map(state.clips.map(c => [c.id, c]));
  return clips
    .filter(c => !hidden.has(c.id))
    .slice()
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .map(c => {
      const local = known.get(c.id);
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        hashtags: c.hashtags,
        durationMs: c.durationMs,
        score: c.score,
        previewUrl: c.preview || c.exportUrl || '',
        imported: Boolean(local),
        status: local?.status || null,
      };
    });
}

/** Import exactly the clips someone picked, by id — no extra Opus credits, same as refreshProjectClips. */
export async function importSelectedClips(projectId, clipIds) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) throw new Error('That lecture is no longer in your history.');

  const wanted = new Set(clipIds);
  const clips = await opus.getClips(projectId);
  const known = new Set(state.clips.map(c => c.id));
  const hidden = hiddenClipSet(project);
  const fresh = clips.filter(c => wanted.has(c.id) && !known.has(c.id) && !hidden.has(c.id));

  addClipsToQueue(fresh, project);

  project.clipCount = Math.max(project.clipCount || 0, clips.length);
  save();

  const imported = importedClipsForProject(projectId).length;
  if (fresh.length) log(`Added ${fresh.length} chosen clip${fresh.length === 1 ? '' : 's'} from ${project.title}, no extra Opus credits used`);
  return { added: fresh.length, imported, clipCount: project.clipCount };
}

/**
 * Pull in any clips Opus generated for a project that never made it into
 * the queue — because the clips-per-video cap left them out at the time,
 * or because they were discarded and are no longer tracked here. Opus
 * already did the clipping work, so this costs no extra credits — it's
 * just asking for the same finished job again. A manual request like this
 * is not capped: the person is explicitly asking for everything that's
 * left, not an automatic batch that needs limiting.
 */
export async function refreshProjectClips(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) throw new Error('That lecture is no longer in your history.');

  const clips = await opus.getClips(projectId);
  const known = new Set(state.clips.map(c => c.id));
  const hidden = hiddenClipSet(project);
  const fresh = clips.filter(c => !known.has(c.id) && !hidden.has(c.id));

  addClipsToQueue(fresh, project);

  project.clipCount = Math.max(project.clipCount || 0, clips.length);
  save();

  const imported = importedClipsForProject(projectId).length;
  if (fresh.length) log(`Pulled in ${fresh.length} more clip${fresh.length === 1 ? '' : 's'} from ${project.title}, no extra Opus credits used`);
  return { added: fresh.length, imported, clipCount: project.clipCount };
}


function normaliseOpusProjectId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/\bP[A-Za-z0-9_-]+\b/);
  return match ? match[0] : text;
}

/**
 * Add a project that was created directly in the Opus dashboard. Opus's
 * documented API can fetch clips when a project id is known, but it does not
 * expose an endpoint that lists every dashboard project for the organisation.
 */
export async function attachExistingProject(projectRef, title = '') {
  const id = normaliseOpusProjectId(projectRef);
  if (!id) throw new Error('Paste an Opus project ID or project link.');

  const existing = state.projects.find(p => p.id === id);
  if (existing) {
    return { added: false, projectId: id, clipCount: existing.clipCount || 0 };
  }

  const clips = await opus.getClips(id);
  if (!clips.length) {
    throw new Error('Opus returned no finished clips for that project. Check the ID and make sure processing is complete.');
  }

  const project = {
    id,
    url: '',
    title: String(title || '').trim() || `Opus project ${id}`,
    status: 'done',
    submittedAt: Date.now(),
    imported: 0,
    clipCount: clips.length,
    external: true,
    hiddenClipIds: [],
    // The public API does not reveal which template was selected for the
    // source project at library-list level, so do not pretend to know.
    brandTemplateIdUsed: undefined,
  };

  state.projects.unshift(project);
  save();
  log(`Added existing Opus project ${id} to the app library.`);
  return { added: true, projectId: id, clipCount: clips.length };
}

/**
 * Remove an entire lecture from this app. This cancels future schedules and
 * deletes local queue records/thumbnails. The documented Opus API has no
 * delete-project endpoint, so the project still exists in the Opus dashboard
 * until the person deletes it there.
 */
export async function removeProject(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) throw new Error('That lecture is no longer in your app library.');

  const related = state.clips.filter(c => sourceProjectIdForClip(c) === projectId);
  let scheduled = 0;
  let posted = 0;

  for (const clip of related) {
    if (clip.status === 'scheduled') scheduled++;
    if (clip.status === 'posted') posted++;
    await unschedule(clip);
    thumbs.deleteThumbnail(clip.id);
  }

  state.clips = state.clips.filter(c => sourceProjectIdForClip(c) !== projectId);
  state.projects = state.projects.filter(p => p.id !== projectId);
  exportUrlCache.delete(projectId);
  save();

  log(`Removed ${project.title} from the app library${scheduled ? ` and cancelled ${scheduled} future schedule${scheduled === 1 ? '' : 's'}` : ''}${posted ? `. ${posted} already-published post${posted === 1 ? '' : 's'} remain online` : ''}.`);
  return { removed: true, clipsRemoved: related.length, schedulesCancelled: scheduled, postedRemain: posted };
}

/**
 * Remove one Opus result from this app. Opus's public API does not expose a
 * delete-exportable-clip endpoint, so unimported results are hidden locally.
 * Imported results are also unscheduled and removed from the local queue.
 */
export async function removeProjectClip(projectId, clipId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) throw new Error('That lecture is no longer in your history.');

  const id = String(clipId || '');
  if (!id) throw new Error('No clip was selected.');

  const clip = state.clips.find(c => c.id === id && sourceProjectIdForClip(c) === projectId);
  const previousStatus = clip?.status || null;

  if (clip) {
    await unschedule(clip);
    state.clips = state.clips.filter(c => c !== clip);
    thumbs.deleteThumbnail(clip.id);
  }

  const hidden = hiddenClipSet(project);
  hidden.add(id);
  project.hiddenClipIds = [...hidden];
  save();

  log(`${clip ? 'Removed' : 'Hidden'} a clip from ${project.title}${previousStatus === 'posted' ? ' (the already-published social post was not deleted)' : ''}.`);
  return {
    removed: true,
    wasImported: Boolean(clip),
    previousStatus,
    imported: importedClipsForProject(projectId).length,
    hidden: project.hiddenClipIds.length,
  };
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

const ARABIC_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;

function wantsEnglish(prompt) {
  return /\benglish\b/i.test(String(prompt || ''));
}

function normaliseCopy(copy) {
  if (!copy) return null;
  const clean = {
    title: String(copy.title || '').trim(),
    description: String(copy.description || '').trim(),
    hashtags: String(copy.hashtags || '').trim(),
  };
  return clean.title || clean.description || clean.hashtags ? clean : null;
}

function containsArabicCopy(copy) {
  return ARABIC_SCRIPT.test([copy?.title, copy?.description, copy?.hashtags].filter(Boolean).join(' '));
}

function clipSourceText(clip) {
  const parts = [
    clip.title && `SOURCE TITLE:\n${clip.title}`,
    clip.description && `SOURCE DESCRIPTION:\n${clip.description}`,
    clip.hashtags && `SOURCE HASHTAGS:\n${clip.hashtags}`,
    clip.text && `SOURCE TRANSCRIPT EXCERPT:\n${String(clip.text).slice(0, 1100)}`,
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, 1700);
}

async function hydrateCopySource(clip) {
  if (clip.text) return;
  try {
    const latest = await fetchProjectClipsCached(clip.projectId);
    const match = latest.find(c => c.id === clip.id || c.clipId === clip.clipId);
    if (!match) return;
    if (match.text) clip.text = match.text;
    if (!clip.description && match.description) clip.description = match.description;
    if (!clip.hashtags && match.hashtags) clip.hashtags = match.hashtags;
    save();
  } catch {
    // The copy endpoint can still work from the clip itself, so source hydration
    // is helpful rather than mandatory.
  }
}

function preferredCopyAccounts(accounts) {
  const priority = {
    YOUTUBE: 0,
    TIKTOK_BUSINESS: 1,
    INSTAGRAM_BUSINESS: 2,
    FACEBOOK_PAGE: 3,
    LINKEDIN: 4,
    TWITTER: 5,
  };
  return [...accounts].sort((a, b) =>
    (priority[a.platform] ?? 99) - (priority[b.platform] ?? 99));
}

function copyPromptForAttempt(clip, attempt, rejectedCopy) {
  const savedPrompt = copyPrompt();
  if (!wantsEnglish(savedPrompt)) return savedPrompt;

  const source = clipSourceText(clip);
  const rejected = rejectedCopy
    ? [rejectedCopy.title, rejectedCopy.description, rejectedCopy.hashtags].filter(Boolean).join('\n').slice(0, 1200)
    : '';

  if (attempt === 0) {
    return `${savedPrompt}

OUTPUT LANGUAGE RULE: Write every character of the title, description and hashtags in natural English only. The spoken/source language may be Arabic; translate the meaning rather than copying its wording. Do not include Arabic letters, transliterated Arabic phrases, or Arabic-script hashtags.

Use this source material to understand the exact topic:
${source || 'Use the clip audio and visuals as the source.'}`.slice(0, 3900);
  }

  return `Translate and rewrite the material below as accurate social-media copy in ENGLISH ONLY.

Return:
- one concise English title
- one clear English description
- relevant English hashtags

ABSOLUTE RULES:
- no Arabic characters anywhere
- do not preserve the source-language title
- do not invent Quran or hadith quotations
- keep the meaning respectful and accurate

${rejected ? `YOUR PREVIOUS RESULT WAS REJECTED BECAUSE IT STILL CONTAINED ARABIC:\n${rejected}\n\n` : ''}${source || 'Use the clip audio and visuals as the source.'}`.slice(0, 3900);
}

/** Ask Opus to write the title, description and hashtags, then wait for it. */
async function generateCopy(clip, accountList, forceRegenerate = true) {
  const accounts = preferredCopyAccounts(Array.isArray(accountList) ? accountList : [accountList].filter(Boolean));
  if (!accounts.length) return null;

  await hydrateCopySource(clip);
  const englishOnly = wantsEnglish(copyPrompt());
  // Try several Opus destinations because its social-copy model can tailor the
  // response to the connected account/platform. A different destination plus
  // an explicit translation correction often succeeds when the first one
  // mirrors the Arabic source language.
  const maxAttempts = englishOnly ? Math.min(4, Math.max(2, accounts.length + 1)) : 2;
  let rejectedCopy = null;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const account = accounts[attempt % accounts.length];
    const prompt = copyPromptForAttempt(clip, attempt, rejectedCopy);

    try {
      const jobId = await opus.requestCopy({
        projectId: clip.projectId,
        clipId: clip.clipId,
        account,
        prompt,
        forceRegenerate: Boolean(forceRegenerate || attempt > 0),
      });
      if (!jobId) {
        lastError = 'Opus did not create a copy job.';
        continue;
      }

      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, Number(process.env.COPY_POLL_MS) || 3000));
        const res = await opus.getCopy(jobId);
        if (res?.status === 'FAILED') {
          lastError = 'Opus marked the copy job as failed.';
          break;
        }
        if (res?.status !== 'COMPLETED') continue;

        const clean = normaliseCopy(res);
        if (!clean) {
          lastError = 'Opus completed the job without returning usable wording.';
          break;
        }

        if (englishOnly && containsArabicCopy(clean)) {
          rejectedCopy = clean;
          lastError = 'Opus returned Arabic wording despite the English-only prompt.';
          log(`Opus returned Arabic copy for "${clip.title}" using ${account.name || account.platform}. Trying a stricter English translation request.`, 'warn');
          break;
        }

        return clean;
      }
    } catch (err) {
      lastError = err.message;
    }

    // POST /social-copy-jobs is limited to roughly one request per second.
    if (attempt + 1 < maxAttempts) await new Promise(r => setTimeout(r, 1300));
  }

  clip.copyError = lastError || 'Opus could not create English wording.';
  log(`English caption rewrite failed for "${clip.title}" after ${maxAttempts} Opus attempts. ${clip.copyError}`, 'error');
  return null;
}

/** Rewrite one waiting clip immediately with the currently saved Opus prompt. */
export async function regenerateCopy(clipId) {
  const clip = state.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('That clip is no longer in the queue.');
  if (clip.status !== 'waiting') throw new Error('Pull the clip back before rewriting its title and description.');

  const accounts = await refreshAccounts();
  if (!accounts.length) throw new Error('Connect at least one social account in Opus first.');

  delete clip.copy;
  delete clip.copyState;
  delete clip.copyError;
  delete clip.editedTitle;
  delete clip.editedDescription;
  delete clip.editedHashtags;
  stage(clip, 'Rewriting title and caption with Opus AI');

  try {
    const copy = await generateCopy(clip, accounts, true);
    if (!copy) {
      clip.copyState = 'failed';
      throw new Error(clip.copyError || 'Opus did not return new English copy. Try again in a moment.');
    }
    clip.copy = copy;
    clip.copyState = 'done';
    delete clip.copyError;
    return copy;
  } finally {
    clearStage(clip);
    save();
  }
}

function clipSourceProject(clip) {
  const sourceId = clip.sourceProjectId || clip.originalProjectId || clip.projectId;
  return state.projects.find(p => p.id === sourceId) || null;
}

/**
 * Opus burns captions, logos and layouts into each exported clip. A later
 * music re-import can add another template, but it cannot remove pixels that
 * were already rendered by an older one. Block scheduling rather than quietly
 * publishing a clip whose visual style cannot be proven.
 */
function templateProblem(clip) {
  // Do not block the person from approving or posting because an older Opus
  // project could not be proven against the currently selected style. The app
  // still applies the selected style to every new lecture and to every music
  // re-import; this function is only kept so older saved state does not break.
  return null;
}

const MUSIC_RETRY_BASE_MS = Number(process.env.MUSIC_RETRY_MS) || 60_000;

function musicRetryDelay(attempts) {
  return Math.min(15 * MINUTE, MUSIC_RETRY_BASE_MS * Math.max(1, attempts));
}

/**
 * Add music before scheduling. When music is enabled this is deliberately
 * fail-closed: no successful mix means no post. Transient failures are retried
 * with backoff instead of being marked forever and silently posted unmixed.
 */
async function ensureMusic(clip) {
  const settings = audio.musicSettings();
  if (!settings.enabled) {
    delete clip.musicNextTryAt;
    delete clip.musicAttempts;
    return { ok: true, required: false };
  }

  const selected = brandTemplateSelection();
  if (clip.musicMixed === 'done') {
    if (clip.musicTemplateId && clip.musicTemplateId !== selected.id) {
      clip.musicMixed = 'retrying';
      clip.musicNote = 'The selected Clip style changed after this music render. Pull back and re-submit the lecture with the current style.';
      return { ok: false, reason: clip.musicNote };
    }
    return { ok: true, required: true };
  }

  if (clip.musicNextTryAt && Date.now() < clip.musicNextTryAt) {
    return { ok: false, reason: clip.musicNote || 'Waiting to retry the music mix.' };
  }

  stage(clip, 'Adding background music');
  try {
    let importProjectId = clip.musicImportProjectId || null;
    let nasheedName = clip.musicImportNasheedName || '';

    if (importProjectId) {
      // Creating an Opus project consumes processing credits. Once that call
      // succeeds, every retry must resume the same project rather than create
      // another one and charge the same clip again.
      if (clip.musicImportTemplateId && clip.musicImportTemplateId !== selected.id) {
        throw new Error('The Clip style changed after Opus started the paid music import. Re-select the previous style or remove and re-submit this clip.');
      }
      stage(clip, 'Resuming the existing Opus music render');
    } else {
      // Always refresh against the original Opus project before the first mix.
      // A newly generated clip can expose metadata before its export URL is ready.
      let exportUrl = clip.exportUrl;
      const lookupProjectId = sourceProjectIdForClip(clip);
      if (!exportUrl) {
        stage(clip, 'Checking Opus for the finished clip');
        try {
          const latest = await fetchProjectClipsCached(lookupProjectId);
          const match = latest.find(c => c.id === clip.id || c.clipId === clip.originalClipId || c.clipId === clip.clipId);
          if (match?.exportUrl) {
            exportUrl = match.exportUrl;
            clip.exportUrl = exportUrl;
            clip.preview = match.preview || exportUrl;
            clip.renderPref = match.renderPref || clip.renderPref || null;
            save();
          }
        } catch { /* the mixer below will return the useful error */ }
      }

      const result = await audio.mixClipMusic(exportUrl, text => stage(clip, text));
      if (result.skipped) throw new Error(result.skipped);

      stage(clip, 'Bringing the mixed clip back into Opus');
      const project = await opus.importMixedClip(result.publicUrl, clip.title, selected);
      importProjectId = project?.projectId || project?.id;
      if (!importProjectId) throw new Error('Opus did not return a project id for the mixed clip.');

      // Save immediately after the chargeable create-project call. If Render
      // restarts or Opus takes longer than expected, the next pass resumes this
      // exact project instead of creating and charging for a duplicate.
      clip.musicImportProjectId = importProjectId;
      clip.musicImportTemplateId = selected.id;
      clip.musicImportTemplateName = selected.name || '';
      clip.musicImportNasheedName = result.nasheedName || '';
      clip.musicImportCreatedAt = Date.now();
      nasheedName = result.nasheedName || '';
      save();
    }

    stage(clip, 'Waiting for Opus to finish the mixed clip');
    const newClip = await waitForImportedClip(importProjectId);
    if (!newClip) {
      throw new Error('Opus is still processing the already-paid music import. The app will resume the same project later without another charge.');
    }

    // The API exposes the final render preferences. Refuse a no-caption style
    // if Opus reports that captions were enabled on the mixed result.
    if (selected.enableCaption === false && newClip.renderPref?.enableCaption === true) {
      throw new Error('Opus reported captions enabled on the mixed result, so it was not scheduled.');
    }

    if (!clip.originalProjectId) clip.originalProjectId = clip.projectId;
    if (!clip.originalClipId) clip.originalClipId = clip.clipId;
    clip.projectId = newClip.projectId;
    clip.clipId = newClip.clipId;
    clip.exportUrl = newClip.exportUrl || clip.exportUrl;
    clip.preview = newClip.preview || newClip.exportUrl || clip.preview;
    clip.renderPref = newClip.renderPref || clip.renderPref || null;
    clip.musicMixed = 'done';
    clip.musicNote = `Mixed with "${nasheedName || 'your music library'}"`;
    clip.musicTemplateId = selected.id;
    clip.musicTemplateName = selected.name || '';
    clip.musicVerifiedAt = Date.now();
    delete clip.musicNextTryAt;
    delete clip.musicAttempts;
    return { ok: true, required: true };
  } catch (err) {
    clip.musicAttempts = (clip.musicAttempts || 0) + 1;
    clip.musicMixed = 'retrying';
    clip.musicNote = err.message;
    clip.musicNextTryAt = Date.now() + musicRetryDelay(clip.musicAttempts);
    log(`Music is required, so "${clip.title}" was not scheduled. Retry ${clip.musicAttempts}: ${err.message}`, 'warn');
    return { ok: false, reason: err.message };
  } finally {
    save();
  }
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
  const styleProblem = templateProblem(clip);
  if (styleProblem) {
    clip.templateError = styleProblem;
    clip.status = 'waiting';
    clearStage(clip);
    save();
    log(`Blocked "${clip.title}" because its Clip style could not be verified. ${styleProblem}`, 'error');
    return;
  }
  delete clip.templateError;

  const music = await ensureMusic(clip);
  if (!music.ok) {
    clearStage(clip);
    save();
    return;
  }

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
      const generated = await generateCopy(clip, accounts);
      copy = generated || {
        title: clip.title,
        description: clip.description,
        hashtags: clip.hashtags,
      };
      clip.copy = copy;
      clip.copyState = generated ? 'done' : 'failed';
      if (generated) delete clip.copyError;
      save();
    }

    stage(clip, `Scheduling to ${account.name}`, step, total);
    try {
      const scheduled = await opus.schedulePost({
        projectId: clip.projectId,
        clipId: clip.clipId,
        account,
        title: clip.editedTitle || copy.title || clip.title,
        description: clip.editedDescription || copy.description || clip.description,
        hashtags: clip.editedHashtags ?? copy.hashtags ?? clip.hashtags,
        publishAt: at,
      });
      const scheduleId = typeof scheduled === 'string' ? scheduled : (scheduled?.scheduleId || scheduled?.id);
      upsertTarget(clip, account, {
        status: 'scheduled',
        scheduleId,
        postUrl: scheduled?.postUrl || scheduled?.url || scheduled?.permalink || scheduled?.shareUrl,
        postTaskId: scheduled?.postTaskId || scheduled?.taskId || scheduled?.id,
      });
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

  const styleProblem = templateProblem(clip);
  if (styleProblem) {
    clip.templateError = styleProblem;
    save();
    throw new Error(styleProblem);
  }
  delete clip.templateError;

  const music = await ensureMusic(clip);
  if (!music.ok) {
    clearStage(clip);
    save();
    throw new Error(`This clip was not posted because music is required. ${music.reason || 'The mix will be retried.'}`);
  }

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
      const posted = await opus.publishNow({
        projectId: clip.projectId,
        clipId: clip.clipId,
        account,
        title: clip.editedTitle || copy.title || clip.title,
        description: clip.editedDescription || copy.description || clip.description,
        hashtags: clip.editedHashtags ?? copy.hashtags ?? clip.hashtags,
      });
      upsertTarget(clip, account, {
        status: 'posted',
        scheduleId: undefined,
        postUrl: posted?.postUrl || posted?.url || posted?.permalink || posted?.shareUrl,
        postTaskId: posted?.postTaskId || posted?.taskId || posted?.id,
      });
      log(`Posted to ${account.name}`);
    } catch (err) {
      upsertTarget(clip, account, { status: 'failed', error: err.message });
      log(`Could not post to ${account.name}. ${err.message}`, 'error');
    }
    await new Promise(r => setTimeout(r, RATE_GAP));
  }
  clip.status = clip.targets.some(t => t.status === 'posted') ? 'posted' : 'waiting';
  if (clip.status === 'posted' && !clip.postedAt) clip.postedAt = Date.now();
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
/**
 * Grabbing a frame is mostly spent waiting on the network (fetching from
 * Opus's video), not actual CPU work, so a few can safely run at once
 * without meaningfully loading a small server — unlike the music mixing
 * step, which does real ffmpeg encoding and stays strictly one at a time.
 */
const THUMB_MAX_ATTEMPTS = 4;
const THUMB_RETRY_BASE_MS = Number(process.env.THUMB_RETRY_MS) || 15_000;

/**
 * Update a clip's thumbnail bookkeeping after one generation attempt.
 * Exported and pure (aside from mutating the clip) so this decision logic
 * can be tested directly and fast, without depending on real ffmpeg or
 * network behaviour — ffmpeg's own protocol-level resilience can silently
 * absorb a transient HTTP error before it ever reaches this code, which
 * makes black-box HTTP failure injection an unreliable way to exercise it.
 */
export function recordThumbAttempt(clip, success) {
  if (success) {
    clip.thumbState = 'ready';
    delete clip.thumbNextTryAt;
    delete clip.thumbAttempts;
    return;
  }
  // A brand-new clip's export URL can genuinely not be ready yet on
  // Opus's own CDN the instant it appears — give it a few spaced-out
  // retries before treating it as a real, permanent failure.
  clip.thumbAttempts = (clip.thumbAttempts || 0) + 1;
  if (clip.thumbAttempts < THUMB_MAX_ATTEMPTS) {
    clip.thumbState = 'pending';
    clip.thumbNextTryAt = Date.now() + clip.thumbAttempts * THUMB_RETRY_BASE_MS;
  } else {
    clip.thumbState = 'failed';
    delete clip.thumbNextTryAt;
  }
}

async function processThumbnails(maxPerTick = 12, concurrency = 3) {
  const now = Date.now();
  const pending = state.clips
    .filter(c => c.thumbState === 'pending' && (!c.thumbNextTryAt || c.thumbNextTryAt <= now))
    .slice(0, maxPerTick);
  let index = 0;

  async function worker() {
    while (index < pending.length) {
      const clip = pending[index++];
      if (!clip.exportUrl) {
        // Same situation as the music path: Opus may still be finishing
        // the actual render even after clip metadata is available. Retrying
        // the same empty link forever would never succeed, so check for a
        // fresher one before each attempt.
        try {
          const latest = await fetchProjectClipsCached(clip.projectId);
          const match = latest.find(c => c.id === clip.id);
          if (match?.exportUrl) clip.exportUrl = match.exportUrl;
        } catch { /* fall through and let this attempt fail normally */ }
      }
      const success = await thumbs.generateThumbnail(clip.id, clip.exportUrl).catch(() => false);
      recordThumbAttempt(clip, success);
      save();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
}

/**
 * Write each clip's title, description and hashtags early — right after
 * import, before anyone has approved anything — so what shows up in the
 * queue is already the AI-written version (in whatever language or tone
 * the prompt asks for), not Opus's own raw text that later gets silently
 * swapped out at posting time. Once this has run for a clip, the existing
 * per-account scheduling step just reuses the same result instead of
 * generating it again.
 */
async function processCopy(maxPerTick = 8, concurrency = 1) {
  const accounts = state.accounts || [];
  if (!accounts.length) return; // nothing to ask Opus to write for yet

  const pending = state.clips.filter(c => c.status === 'waiting' && !c.copy && !c.copyState).slice(0, maxPerTick);
  if (!pending.length) return;
  let index = 0;

  async function worker() {
    while (index < pending.length) {
      const clip = pending[index++];
      stage(clip, wantsEnglish(copyPrompt())
        ? 'Writing an English title and description with Opus AI'
        : 'Writing the title and description with Opus AI');
      try {
        const copy = await generateCopy(clip, accounts, true);
        if (copy) {
          clip.copy = copy;
          clip.copyState = 'done';
          delete clip.copyError;
        } else {
          clip.copyState = 'failed';
        }
      } catch (err) {
        clip.copyState = 'failed';
        clip.copyError = err.message || clip.copyError || 'Opus AI rewrite failed.';
      } finally {
        clearStage(clip);
        save();
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
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
    await processCopy();
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
